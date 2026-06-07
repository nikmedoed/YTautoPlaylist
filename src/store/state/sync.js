// Playlist account sync shared helpers. Playlist data is transported through
// Google Drive appData; chrome.storage.sync is intentionally not used here.
import {
  SYNC_ALARM_NAME,
  SYNC_DEBOUNCE_MS,
  SYNC_LOCAL_META_STORAGE_KEY,
} from "./constants.js";
import { sanitizeState } from "./sanitizers.js";
import {
  buildSyncSnapshot,
  buildSyncState,
  getSyncStateFingerprint,
  hasSyncableUserData,
  mergeSyncStatesConservatively,
  mergeRemoteSyncState,
  normalizeSyncTimestamp,
} from "./syncSnapshot.js";

export {
  buildSyncSnapshot,
  buildSyncState,
  getSyncStateFingerprint,
  hasSyncableUserData,
  mergeSyncStatesConservatively,
  mergeRemoteSyncState,
} from "./syncSnapshot.js";

function hasChromeStorageArea(area) {
  return typeof chrome !== "undefined" && chrome?.storage?.[area];
}

function hasChromeLocalStorage() {
  return hasChromeStorageArea("local");
}

async function storageGet(area, key) {
  return hasChromeStorageArea(area) ? chrome.storage[area].get(key) : {};
}

async function storageSet(area, payload) {
  if (hasChromeStorageArea(area)) await chrome.storage[area].set(payload);
}

function createDeviceId() {
  const random =
    typeof crypto !== "undefined" && crypto?.randomUUID
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `device_${Date.now().toString(36)}_${random}`;
}

async function readLocalSyncMeta() {
  const stored = await storageGet("local", SYNC_LOCAL_META_STORAGE_KEY);
  const meta = stored?.[SYNC_LOCAL_META_STORAGE_KEY];
  return meta && typeof meta === "object" ? meta : {};
}

async function writeLocalSyncMeta(meta) {
  await storageSet("local", {
    [SYNC_LOCAL_META_STORAGE_KEY]: {
      ...meta,
      deviceId:
        typeof meta.deviceId === "string" && meta.deviceId
          ? meta.deviceId
          : createDeviceId(),
    },
  });
}

async function scheduleSyncAlarm(dueAt) {
  if (typeof chrome === "undefined") return;
  if (chrome?.alarms?.create) {
    chrome.alarms.create(SYNC_ALARM_NAME, { when: dueAt });
  }
}

export async function configurePlaylistSyncAccess() {
  return undefined;
}

export function isPlaylistSyncStorageChange() {
  return false;
}

export async function resolveRemotePlaylistSyncState(localStateInput) {
  return { state: sanitizeState(localStateInput), imported: false };
}

export async function forceRemotePlaylistSyncState(localStateInput) {
  return {
    state: sanitizeState(localStateInput),
    imported: false,
    reason: "drive-sync-required",
  };
}

export async function recordImportedPlaylistSyncSnapshot(
  snapshot,
  stateInput,
  { force = false } = {}
) {
  if (!snapshot?.state) return;
  const now = Date.now();
  const state = sanitizeState(stateInput);
  const localHash = getSyncStateFingerprint(state);
  const remoteHash = typeof snapshot.hash === "string" ? snapshot.hash : "";
  const localMeta = await readLocalSyncMeta();
  const mergedNeedsPush = !force && localHash !== remoteHash;
  const flushAfter = mergedNeedsPush ? now + SYNC_DEBOUNCE_MS : null;
  await writeLocalSyncMeta({
    ...localMeta,
    localUpdatedAt: force ? snapshot.updatedAt : now,
    localHash,
    syncedUpdatedAt: force ? snapshot.updatedAt : now,
    syncedHash: force || !mergedNeedsPush ? remoteHash || localHash : localHash,
    remoteUpdatedAt: normalizeSyncTimestamp(snapshot.updatedAt),
    remoteHash,
    pending: mergedNeedsPush,
    pendingSince: null,
    flushAfter,
    lastError: null,
  });
  if (flushAfter) await scheduleSyncAlarm(flushAfter);
}

export async function recordPushedPlaylistSyncSnapshot(snapshot) {
  if (!snapshot?.state) return;
  const now = Date.now();
  const localHash = getSyncStateFingerprint(snapshot.state);
  const remoteHash = typeof snapshot.hash === "string" ? snapshot.hash : localHash;
  const localMeta = await readLocalSyncMeta();
  await writeLocalSyncMeta({
    ...localMeta,
    localUpdatedAt: normalizeSyncTimestamp(snapshot.manifest?.updatedAt) || now,
    localHash,
    syncedUpdatedAt: normalizeSyncTimestamp(snapshot.manifest?.updatedAt) || now,
    syncedHash: remoteHash,
    remoteUpdatedAt: normalizeSyncTimestamp(snapshot.manifest?.updatedAt) || now,
    remoteHash,
    remoteDeviceId: snapshot.manifest?.deviceId || localMeta.remoteDeviceId || null,
    pending: false,
    pendingSince: null,
    flushAfter: null,
    lastWriteAt: now,
    lastError: null,
  });
}

export async function recordPlaylistSyncError(error) {
  const localMeta = await readLocalSyncMeta();
  await writeLocalSyncMeta({
    ...localMeta,
    pending: Boolean(localMeta.pending),
    lastError: error?.message || String(error),
    lastErrorAt: Date.now(),
  });
}

export async function getPlaylistSyncStatus() {
  const meta = await readLocalSyncMeta();
  return {
    localDeviceId: meta.deviceId || null,
    localUpdatedAt: normalizeSyncTimestamp(meta.localUpdatedAt),
    remoteUpdatedAt: normalizeSyncTimestamp(meta.remoteUpdatedAt),
    remoteDeviceId: meta.remoteDeviceId || null,
    remoteChunkCount: 0,
    pending: Boolean(meta.pending),
    lastWriteAt: normalizeSyncTimestamp(meta.lastWriteAt),
    lastError: meta.lastError || null,
    remoteAvailable: Boolean(meta.remoteUpdatedAt),
    technicalOnly: false,
  };
}

export async function schedulePlaylistSync(stateInput, { immediate = false } = {}) {
  if (!hasChromeLocalStorage()) return;
  const localMeta = await readLocalSyncMeta();
  const localHash = getSyncStateFingerprint(stateInput);
  if (localHash === localMeta.localHash && !immediate) {
    if (localMeta.pending) {
      const flushAfter =
        normalizeSyncTimestamp(localMeta.flushAfter) ||
        Date.now() + SYNC_DEBOUNCE_MS;
      await scheduleSyncAlarm(flushAfter);
    }
    return;
  }
  const now = Date.now();
  const dueAt = immediate ? now : now + SYNC_DEBOUNCE_MS;
  await writeLocalSyncMeta({
    ...localMeta,
    localUpdatedAt: now,
    localHash,
    pending: true,
    pendingSince: localMeta.pendingSince || now,
    flushAfter: dueAt,
    lastError: null,
  });
  await scheduleSyncAlarm(dueAt);
}

export async function writePendingPlaylistSync(stateInput = null) {
  if (!hasChromeLocalStorage()) {
    return { wrote: false, reason: "storage-unavailable" };
  }
  const localMeta = await readLocalSyncMeta();
  if (!localMeta.pending) {
    return { wrote: false, reason: "not-pending" };
  }
  const now = Date.now();
  const flushAfter = normalizeSyncTimestamp(localMeta.flushAfter);
  if (flushAfter && flushAfter > now) {
    await scheduleSyncAlarm(flushAfter);
    return { wrote: false, reason: "debounced" };
  }
  await writeLocalSyncMeta({
    ...localMeta,
    pending: true,
    pendingSince: localMeta.pendingSince || now,
    flushAfter: null,
    lastError: null,
  });
  return {
    wrote: false,
    ready: true,
    reason: "drive-pending",
  };
}
