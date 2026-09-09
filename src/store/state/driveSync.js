// Google Drive appData sync adapter. Stores one portable snapshot file in the
// signed-in Google account.
import { DRIVE_SYNC_LOCAL_META_STORAGE_KEY } from "./constants.js";
import {
  buildLocalPlaylistSyncSnapshot,
  importPlaylistSyncSnapshot,
} from "./storage.js";
import {
  buildSyncSnapshot,
  getPlaylistSyncStatus,
  isPlaylistSyncMutationCurrent,
  recordPlaylistSyncError,
  recordPushedPlaylistSyncSnapshot,
} from "./sync.js";
import { normalizeSyncTimestamp } from "./syncSnapshot.js";
import {
  buildPlaylistBackups,
  DRIVE_SYNC_VERSION,
  encodePlaylistSnapshot,
  encodePlaylistSnapshots,
} from "./driveSyncPayload.js";
import { readDrivePayload, writeDrivePayload } from "./driveClient.js";

function playlistContentHash(state) {
  const copy = JSON.parse(JSON.stringify(state || {}));
  copy.currentListId = null;
  copy.currentVideoId = null;
  return JSON.stringify(copy.lists || {}) + JSON.stringify(copy.history || []) + JSON.stringify(copy.deletedHistory || []);
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


let driveOperation = Promise.resolve();
function serializeDriveOperation(operation) {
  const next = driveOperation.then(operation, operation);
  driveOperation = next.catch(() => {});
  return next;
}

export function pushLocalDriveSyncNow(options = {}) {
  return serializeDriveOperation(() => pushLocalDriveSync(options));
}

async function pushLocalDriveSync({
  interactive = true,
  force = false,
  expectedMutationVersion = null,
} = {}) {
  const meta = await readLocalMeta();
  const deviceId = await ensureDeviceId(meta);
  try {
    const remote = await readDrivePayload({ interactive });
    const playlist = await buildLocalPlaylistSyncSnapshot(deviceId);
    const playlistStatus = await getPlaylistSyncStatus();
    const remoteHash = remote.payload?.playlist?.hash || "";
    const knownRemoteHash =
      typeof playlistStatus.remoteHash === "string" ? playlistStatus.remoteHash : "";
    if (!force && remoteHash && remoteHash !== knownRemoteHash && remoteHash !== playlist.hash) {
      const imported = await importPlaylistSyncSnapshot(remote.payload.playlist);
      if (!imported.imported) {
        if (playlistContentHash(playlist.state) === playlistContentHash(remote.payload.playlist.state)) {
          return { pushed: false, skipped: true, reason: "runtime-only-local-change" };
        }
        throw new Error("Конфликт списков: выберите облачную версию или восстановите сохранённую. Автоотправка остановлена.");
      }
      // Importing a newer baseline never requires immediately uploading it again.
      return { pushed: false, skipped: true, reason: "remote-imported" };
    }
    const payload = {
      version: DRIVE_SYNC_VERSION,
      updatedAt: playlist.manifest.updatedAt,
      deviceId,
      playlist: encodePlaylistSnapshot(playlist),
      playlistBackups: encodePlaylistSnapshots(
        buildPlaylistBackups(remote.payload, playlist.hash)
      ),
    };
    const file = await writeDrivePayload(payload, {
      interactive,
      existing: remote.file,
      shouldContinue:
        expectedMutationVersion === null
          ? null
          : () => isPlaylistSyncMutationCurrent(expectedMutationVersion),
    });
    const now = Date.now();
    const superseded =
      expectedMutationVersion !== null &&
      !isPlaylistSyncMutationCurrent(expectedMutationVersion);
    if (!superseded) {
      await recordPushedPlaylistSyncSnapshot(playlist);
    }
    await writeLocalMeta({
      ...meta,
      deviceId,
      fileId: file.id,
      remoteUpdatedAt: payload.updatedAt,
      remoteDeviceId: deviceId,
      remoteAvailable: true,
      playlistBackupCount: payload.playlistBackups.length,
      lastWriteAt: now,
      lastReadAt: now,
      lastError: null,
    });
    return {
      pushed: true,
      updatedAt: payload.updatedAt,
      superseded,
    };
  } catch (err) {
    if (err?.code === "SYNC_SUPERSEDED") {
      return { pushed: false, skipped: true, reason: "newer-local-changes" };
    }
    await recordPlaylistSyncError(err);
    await writeLocalMeta({ ...meta, deviceId, lastError: err.message });
    return { pushed: false, reason: err.message };
  }
}

export function importDriveSync(options = {}) {
  return serializeDriveOperation(() => importDriveSyncInternal(options));
}

async function importDriveSyncInternal({
  force = false,
  interactive = true,
  mergePending = false,
} = {}) {
  const meta = await readLocalMeta();
  const deviceId = await ensureDeviceId(meta);
  try {
    const { file, payload } = await readDrivePayload({ interactive });
    if (!payload) return { imported: false, reason: "no-drive-remote" };
    const playlist = payload.playlist
      ? await importPlaylistSyncSnapshot(payload.playlist, {
          force,
          mergePending,
        })
      : { imported: false };
    const conflict = playlist.reason === "local-pending";
    await writeLocalMeta({
      ...meta,
      deviceId,
      fileId: file?.id || meta.fileId || null,
      remoteUpdatedAt: payload.updatedAt,
      remoteDeviceId: payload.deviceId,
      remoteAvailable: true,
      playlistBackupCount: payload.playlistBackups?.length || 0,
      lastReadAt: Date.now(),
      lastError: conflict
        ? "Конфликт списков: локальные изменения сохранены. Выберите замену из облака, отправку локальной версии или восстановление."
        : null,
    });
    return {
      imported: Boolean(playlist.imported),
      playlistImported: Boolean(playlist.imported),
      reason: playlist.reason || null,
      settingsImported: false,
      updatedAt: payload.updatedAt,
      playlistBackupCount: payload.playlistBackups?.length || 0,
    };
  } catch (err) {
    await writeLocalMeta({ ...meta, deviceId, lastError: err.message });
    return { imported: false, reason: err.message };
  }
}

export function restoreDrivePlaylistBackup(options = {}) {
  return serializeDriveOperation(() => restoreDrivePlaylistBackupInternal(options));
}

async function restoreDrivePlaylistBackupInternal({
  offset = 1,
  hash = null,
  interactive = true,
} = {}) {
  const meta = await readLocalMeta();
  const deviceId = await ensureDeviceId(meta);
  try {
    const remote = await readDrivePayload({ interactive });
    const payload = remote.payload;
    const backups = Array.isArray(payload?.playlistBackups)
      ? payload.playlistBackups
      : [];
    const index = hash
      ? backups.findIndex((snapshot) => snapshot.hash === hash)
      : Math.max(0, Math.trunc(Number(offset) || 1) - 1);
    const target = backups[index] || null;
    if (!payload?.playlist || !target) {
      return { restored: false, reason: "no-playlist-backup" };
    }
    const restored = buildSyncSnapshot(target.state, {
      deviceId,
      updatedAt: Date.now(),
    });
    const remainingBackups = backups.filter((_, itemIndex) => itemIndex !== index);
    const nextPayload = {
      version: DRIVE_SYNC_VERSION,
      updatedAt: restored.manifest.updatedAt,
      deviceId,
      playlist: encodePlaylistSnapshot(restored),
      playlistBackups: encodePlaylistSnapshots(
        buildPlaylistBackups(
          {
            playlist: payload.playlist,
            playlistBackups: remainingBackups,
          },
          restored.hash
        )
      ),
    };
    const file = await writeDrivePayload(nextPayload, {
      interactive,
      existing: remote.file,
    });
    await importPlaylistSyncSnapshot(
      {
        state: restored.state,
        hash: restored.hash,
        updatedAt: restored.manifest.updatedAt,
        manifest: restored.manifest,
      },
      { force: true }
    );
    const now = Date.now();
    await writeLocalMeta({
      ...meta,
      deviceId,
      fileId: file.id,
      remoteUpdatedAt: nextPayload.updatedAt,
      remoteDeviceId: deviceId,
      remoteAvailable: true,
      playlistBackupCount: nextPayload.playlistBackups.length,
      lastWriteAt: now,
      lastReadAt: now,
      lastError: null,
    });
    return {
      restored: true,
      updatedAt: nextPayload.updatedAt,
      backupOffset: index + 1,
      playlistBackupCount: nextPayload.playlistBackups.length,
    };
  } catch (err) {
    await recordPlaylistSyncError(err);
    await writeLocalMeta({ ...meta, deviceId, lastError: err.message });
    return { restored: false, reason: err.message };
  }
}

export async function getDriveSyncStatus({ refreshRemote = false } = {}) {
  const meta = await readLocalMeta();
  if (!refreshRemote) {
    return {
      remoteAvailable: Boolean(meta.remoteAvailable || meta.remoteUpdatedAt),
      remoteUpdatedAt: normalizeSyncTimestamp(meta.remoteUpdatedAt),
      remoteDeviceId: meta.remoteDeviceId || null,
      playlistBackupCount: Number(meta.playlistBackupCount) || 0,
      lastWriteAt: normalizeSyncTimestamp(meta.lastWriteAt),
      lastReadAt: normalizeSyncTimestamp(meta.lastReadAt),
      lastError: meta.lastError || null,
    };
  }
  try {
    const { file, payload } = await readDrivePayload({ interactive: false });
    const now = Date.now();
    return {
      remoteAvailable: Boolean(payload),
      remoteUpdatedAt: normalizeSyncTimestamp(payload?.updatedAt),
      playlistRemoteUpdatedAt: normalizeSyncTimestamp(payload?.playlist?.updatedAt),
      settingsRemoteUpdatedAt: 0,
      remoteDeviceId: payload?.deviceId || null,
      playlistBackupCount: payload?.playlistBackups?.length || 0,
      playlistBackups: (payload?.playlistBackups || []).map((snapshot) => ({
        updatedAt: normalizeSyncTimestamp(snapshot?.updatedAt),
        hash: snapshot?.hash || null,
        deviceId: snapshot?.manifest?.deviceId || null,
        listCount: Object.keys(snapshot.state.lists || {}).length,
        videoCount: Object.values(snapshot.state.lists || {}).reduce(
          (count, list) => count + (list.queue?.length || 0), 0
        ),
      })),
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
      playlistBackupCount: Number(meta.playlistBackupCount) || 0,
      playlistBackups: [],
      fileModifiedTime: null,
      lastWriteAt: normalizeSyncTimestamp(meta.lastWriteAt),
      lastReadAt: normalizeSyncTimestamp(meta.lastReadAt),
      lastError: err.message,
    };
  }
}
