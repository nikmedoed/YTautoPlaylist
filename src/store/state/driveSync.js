// Google Drive appData sync adapter. Stores one portable snapshot file in the
// signed-in Google account.
import { getToken, clearToken, signInUser } from "../../auth.js";
import {
  DRIVE_SYNC_FILE_NAME,
  DRIVE_SYNC_LOCAL_META_STORAGE_KEY,
} from "./constants.js";
import {
  buildLocalPlaylistSyncSnapshot,
  importPlaylistSyncSnapshot,
} from "./storage.js";
import {
  buildSyncState,
  getPlaylistSyncStatus,
  getSyncStateFingerprint,
  recordPlaylistSyncError,
  recordPushedPlaylistSyncSnapshot,
} from "./sync.js";
import {
  normalizeSyncTimestamp,
} from "./syncSnapshot.js";

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const DRIVE_SYNC_VERSION = 1;

function formatDriveError(status, text) {
  try {
    const parsed = JSON.parse(text);
    const error = parsed?.error;
    const reason = error?.errors?.[0]?.reason || error?.status || "";
    const message = error?.message || text;
    return [`Drive API failed: ${status}`, reason, message]
      .filter(Boolean)
      .join(" - ")
      .slice(0, 500);
  } catch {
    return `Drive API failed: ${status}${text ? ` - ${text.slice(0, 300)}` : ""}`;
  }
}

function hasChromeStorage() {
  return typeof chrome !== "undefined" && chrome?.storage?.local;
}

async function storageGet(key) {
  return hasChromeStorage() ? chrome.storage.local.get(key) : {};
}

async function storageSet(payload) {
  if (hasChromeStorage()) await chrome.storage.local.set(payload);
}

function createDeviceId() {
  const random =
    typeof crypto !== "undefined" && crypto?.randomUUID
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `drive_${Date.now().toString(36)}_${random}`;
}

async function readLocalMeta() {
  const stored = await storageGet(DRIVE_SYNC_LOCAL_META_STORAGE_KEY);
  const meta = stored?.[DRIVE_SYNC_LOCAL_META_STORAGE_KEY];
  return meta && typeof meta === "object" ? meta : {};
}

async function writeLocalMeta(meta) {
  await storageSet({
    [DRIVE_SYNC_LOCAL_META_STORAGE_KEY]: {
      ...meta,
      deviceId: meta.deviceId || createDeviceId(),
    },
  });
}

async function ensureDeviceId(meta = null) {
  const current = meta || (await readLocalMeta());
  if (typeof current.deviceId === "string" && current.deviceId) {
    return current.deviceId;
  }
  const deviceId = createDeviceId();
  await writeLocalMeta({ ...current, deviceId });
  return deviceId;
}

async function driveFetch(url, init = {}, { interactive = false } = {}) {
  const token = await getToken({ interactive });
  const headers = {
    ...(init.headers || {}),
    Authorization: `Bearer ${token}`,
  };
  let response = await fetch(url, { ...init, headers });
  if ((response.status === 401 || response.status === 403) && interactive) {
    clearToken();
    const refreshed = await signInUser();
    response = await fetch(url, {
      ...init,
      headers: { ...headers, Authorization: `Bearer ${refreshed}` },
    });
  }
  if (!response.ok) {
    const text = await response.text();
    const err = new Error(formatDriveError(response.status, text));
    err.status = response.status;
    err.body = text;
    throw err;
  }
  return response;
}

function encodePlaylistSnapshot(snapshot) {
  if (!snapshot) return null;
  return {
    manifest: snapshot.manifest,
    state: snapshot.state,
  };
}

function parseDrivePlaylistSnapshot(raw) {
  if (!raw || typeof raw !== "object" || !raw.state) return null;
  const state = buildSyncState(raw.state);
  const hash = getSyncStateFingerprint(state);
  const manifest = raw.manifest && typeof raw.manifest === "object"
    ? raw.manifest
    : {};
  if (typeof manifest.hash === "string" && manifest.hash && manifest.hash !== hash) {
    return null;
  }
  return {
    manifest: { ...manifest, hash },
    state,
    updatedAt: normalizeSyncTimestamp(manifest.updatedAt),
    hash,
  };
}

function parseDrivePayload(raw) {
  if (!raw || typeof raw !== "object" || raw.version !== DRIVE_SYNC_VERSION) {
    return null;
  }
  const playlist = parseDrivePlaylistSnapshot(raw.playlist);
  if (!playlist) return null;
  const updatedAt =
    normalizeSyncTimestamp(raw.updatedAt) ||
    normalizeSyncTimestamp(playlist.updatedAt);
  return {
    updatedAt,
    deviceId: typeof raw.deviceId === "string" ? raw.deviceId : null,
    playlist,
  };
}

async function findDriveFile({ interactive = false } = {}) {
  const params = new URLSearchParams({
    spaces: "appDataFolder",
    fields: "files(id,name,modifiedTime)",
    q: `name='${DRIVE_SYNC_FILE_NAME}' and trashed=false`,
  });
  const response = await driveFetch(`${DRIVE_API}/files?${params}`, {}, { interactive });
  const data = await response.json();
  return Array.isArray(data.files) && data.files.length ? data.files[0] : null;
}

async function readDrivePayload({ interactive = false } = {}) {
  const file = await findDriveFile({ interactive });
  if (!file?.id) return { file: null, payload: null };
  const response = await driveFetch(
    `${DRIVE_API}/files/${encodeURIComponent(file.id)}?alt=media`,
    {},
    { interactive }
  );
  return { file, payload: parseDrivePayload(await response.json()) };
}

function buildMultipartBody(metadata, payload) {
  const boundary = `yta_drive_sync_${Date.now()}`;
  const body = [
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify(metadata),
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify(payload),
    `--${boundary}--`,
    "",
  ].join("\r\n");
  return { boundary, body };
}

async function writeDrivePayload(payload, { interactive = true, existing = null } = {}) {
  const existingFile = existing || (await findDriveFile({ interactive }));
  const metadata = existingFile?.id
    ? { name: DRIVE_SYNC_FILE_NAME }
    : { name: DRIVE_SYNC_FILE_NAME, parents: ["appDataFolder"] };
  const { boundary, body } = buildMultipartBody(metadata, payload);
  const target = existingFile?.id
    ? `${DRIVE_UPLOAD_API}/files/${encodeURIComponent(existingFile.id)}`
    : `${DRIVE_UPLOAD_API}/files`;
  const params = new URLSearchParams({
    uploadType: "multipart",
    fields: "id,modifiedTime",
  });
  const response = await driveFetch(`${target}?${params}`, {
    method: existingFile?.id ? "PATCH" : "POST",
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  }, { interactive });
  return response.json();
}

export async function pushLocalDriveSyncNow({ interactive = true } = {}) {
  const meta = await readLocalMeta();
  const deviceId = await ensureDeviceId(meta);
  try {
    const remote = await readDrivePayload({ interactive });
    let playlist = await buildLocalPlaylistSyncSnapshot(deviceId);
    const playlistStatus = await getPlaylistSyncStatus();
    const remoteHash = remote.payload?.playlist?.hash || "";
    const knownRemoteHash =
      typeof playlistStatus.remoteHash === "string" ? playlistStatus.remoteHash : "";
    if (remoteHash && remoteHash !== knownRemoteHash && remoteHash !== playlist.hash) {
      await importPlaylistSyncSnapshot(remote.payload.playlist, { mergePending: true });
      playlist = await buildLocalPlaylistSyncSnapshot(deviceId);
    }
    const payload = {
      version: DRIVE_SYNC_VERSION,
      updatedAt: playlist.manifest.updatedAt,
      deviceId,
      playlist: encodePlaylistSnapshot(playlist),
    };
    const file = await writeDrivePayload(payload, {
      interactive,
      existing: remote.file,
    });
    const now = Date.now();
    await recordPushedPlaylistSyncSnapshot(playlist);
    await writeLocalMeta({
      ...meta,
      deviceId,
      fileId: file.id,
      remoteUpdatedAt: payload.updatedAt,
      remoteDeviceId: deviceId,
      remoteAvailable: true,
      lastWriteAt: now,
      lastReadAt: now,
      lastError: null,
    });
    return { pushed: true, updatedAt: payload.updatedAt };
  } catch (err) {
    await recordPlaylistSyncError(err);
    await writeLocalMeta({ ...meta, deviceId, lastError: err.message });
    return { pushed: false, reason: err.message };
  }
}

export async function importDriveSync({ force = false, interactive = true } = {}) {
  const meta = await readLocalMeta();
  const deviceId = await ensureDeviceId(meta);
  try {
    const { file, payload } = await readDrivePayload({ interactive });
    if (!payload) return { imported: false, reason: "no-drive-remote" };
    const playlist = payload.playlist
      ? await importPlaylistSyncSnapshot(payload.playlist, { force })
      : { imported: false };
    await writeLocalMeta({
      ...meta,
      deviceId,
      fileId: file?.id || meta.fileId || null,
      remoteUpdatedAt: payload.updatedAt,
      remoteDeviceId: payload.deviceId,
      remoteAvailable: true,
      lastReadAt: Date.now(),
      lastError: null,
    });
    return {
      imported: Boolean(playlist.imported),
      playlistImported: Boolean(playlist.imported),
      settingsImported: false,
      updatedAt: payload.updatedAt,
    };
  } catch (err) {
    await writeLocalMeta({ ...meta, deviceId, lastError: err.message });
    return { imported: false, reason: err.message };
  }
}

export async function getDriveSyncStatus({ refreshRemote = false } = {}) {
  const meta = await readLocalMeta();
  if (!refreshRemote) {
    return {
      remoteAvailable: Boolean(meta.remoteAvailable || meta.remoteUpdatedAt),
      remoteUpdatedAt: normalizeSyncTimestamp(meta.remoteUpdatedAt),
      remoteDeviceId: meta.remoteDeviceId || null,
      lastWriteAt: normalizeSyncTimestamp(meta.lastWriteAt),
      lastReadAt: normalizeSyncTimestamp(meta.lastReadAt),
      lastError: meta.lastError || null,
    };
  }
  try {
    const { file, payload } = await readDrivePayload({ interactive: false });
    const now = Date.now();
    await writeLocalMeta({
      ...meta,
      fileId: file?.id || meta.fileId || null,
      remoteAvailable: Boolean(payload),
      remoteUpdatedAt: normalizeSyncTimestamp(payload?.updatedAt),
      remoteDeviceId: payload?.deviceId || meta.remoteDeviceId || null,
      lastReadAt: now,
      lastError: null,
    });
    return {
      remoteAvailable: Boolean(payload),
      remoteUpdatedAt: normalizeSyncTimestamp(payload?.updatedAt),
      playlistRemoteUpdatedAt: normalizeSyncTimestamp(payload?.playlist?.updatedAt),
      settingsRemoteUpdatedAt: 0,
      remoteDeviceId: payload?.deviceId || null,
      fileModifiedTime: file?.modifiedTime || null,
      lastWriteAt: normalizeSyncTimestamp(meta.lastWriteAt),
      lastReadAt: now,
      lastError: meta.lastError || null,
    };
  } catch (err) {
    return {
      remoteAvailable: false,
      remoteUpdatedAt: 0,
      playlistRemoteUpdatedAt: 0,
      settingsRemoteUpdatedAt: 0,
      remoteDeviceId: null,
      fileModifiedTime: null,
      lastWriteAt: normalizeSyncTimestamp(meta.lastWriteAt),
      lastReadAt: normalizeSyncTimestamp(meta.lastReadAt),
      lastError: err.message,
    };
  }
}
