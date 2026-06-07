// Playlist account sync shared helpers. Playlist data is transported through
// Google Drive appData; chrome.storage.sync is intentionally not used here.
import {
  AUTO_COLLECT_SYNC_STORAGE_KEY,
  SYNC_ALARM_NAME,
  SYNC_DEBOUNCE_MS,
  SYNC_LOCAL_META_STORAGE_KEY,
} from "./constants.js";
import { sanitizeState } from "./sanitizers.js";
import {
  buildSyncSnapshot,
  buildSyncState,
  getSyncStateFingerprint,
  hashString,
  hasSyncableUserData,
  mergeSyncStatesConservatively,
  mergeRemoteSyncState,
  normalizeSyncTimestamp,
  parseSyncSnapshot,
} from "./syncSnapshot.js";

const AUTO_COLLECT_SYNC_VERSION = 1;

export {
  buildSyncSnapshot,
  buildSyncState,
  getSyncStateFingerprint,
  hasSyncableUserData,
  mergeSyncStatesConservatively,
  mergeRemoteSyncState,
  parseSyncSnapshot,
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

function normalizeAutoCollectMeta(metaInput) {
  return sanitizeState({ autoCollect: metaInput }).autoCollect;
}

function autoCollectFingerprint(metaInput) {
  return hashString(JSON.stringify(normalizeAutoCollectMeta(metaInput)));
}

function buildAutoCollectSyncSnapshot(stateInput, { updatedAt, deviceId } = {}) {
  const autoCollect = normalizeAutoCollectMeta(sanitizeState(stateInput).autoCollect);
  const payload = JSON.stringify(autoCollect);
  return {
    version: AUTO_COLLECT_SYNC_VERSION,
    updatedAt: normalizeSyncTimestamp(updatedAt) || Date.now(),
    deviceId: typeof deviceId === "string" && deviceId ? deviceId : null,
    hash: hashString(payload),
    autoCollect,
  };
}

function parseAutoCollectSyncSnapshot(raw) {
  if (
    !raw ||
    typeof raw !== "object" ||
    raw.version !== AUTO_COLLECT_SYNC_VERSION ||
    !raw.autoCollect ||
    typeof raw.autoCollect !== "object"
  ) {
    return null;
  }
  const autoCollect = normalizeAutoCollectMeta(raw.autoCollect);
  const hash = hashString(JSON.stringify(autoCollect));
  if (typeof raw.hash === "string" && raw.hash && raw.hash !== hash) {
    return null;
  }
  return {
    version: raw.version,
    updatedAt: normalizeSyncTimestamp(raw.updatedAt),
    deviceId: typeof raw.deviceId === "string" ? raw.deviceId : null,
    hash,
    autoCollect,
  };
}

async function readRemoteAutoCollectSyncSnapshot() {
  const stored = await storageGet("sync", AUTO_COLLECT_SYNC_STORAGE_KEY);
  return parseAutoCollectSyncSnapshot(stored?.[AUTO_COLLECT_SYNC_STORAGE_KEY]);
}

function mergeAutoCollectMeta(localInput, remoteInput) {
  const local = normalizeAutoCollectMeta(localInput);
  const remote = normalizeAutoCollectMeta(remoteInput);
  const preferRemote = remote.lastRunAt >= local.lastRunAt;
  return normalizeAutoCollectMeta({
    lastRunAt: Math.max(local.lastRunAt, remote.lastRunAt),
    lastAdded: preferRemote ? remote.lastAdded : local.lastAdded,
    lastFetched: preferRemote ? remote.lastFetched : local.lastFetched,
    nextAutoCollectAt: Math.max(local.nextAutoCollectAt, remote.nextAutoCollectAt),
    seenIds: [...(local.seenIds || []), ...(remote.seenIds || [])],
  });
}

function mergeRemoteAutoCollectState(localStateInput, remoteSnapshot) {
  const local = sanitizeState(localStateInput);
  if (!remoteSnapshot?.autoCollect) {
    return { state: local, imported: false };
  }
  const mergedAutoCollect = mergeAutoCollectMeta(
    local.autoCollect,
    remoteSnapshot.autoCollect
  );
  const changed =
    autoCollectFingerprint(local.autoCollect) !==
    autoCollectFingerprint(mergedAutoCollect);
  return {
    state: sanitizeState({ ...local, autoCollect: mergedAutoCollect }),
    imported: changed,
    remoteUpdatedAt: remoteSnapshot.updatedAt,
  };
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

export function isAutoCollectSyncStorageChange(changes = {}) {
  return Object.prototype.hasOwnProperty.call(
    changes,
    AUTO_COLLECT_SYNC_STORAGE_KEY
  );
}

export async function resolveRemotePlaylistSyncState(localStateInput) {
  const remote = await readRemoteAutoCollectSyncSnapshot();
  return mergeRemoteAutoCollectState(localStateInput, remote);
}

export async function forceRemotePlaylistSyncState(localStateInput) {
  const remote = await readRemoteAutoCollectSyncSnapshot();
  const result = mergeRemoteAutoCollectState(localStateInput, remote);
  return remote ? result : { ...result, reason: "no-auto-collect-remote" };
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
  await writeLocalSyncMeta({
    ...localMeta,
    localUpdatedAt: force ? snapshot.updatedAt : now,
    localHash,
    syncedUpdatedAt: force ? snapshot.updatedAt : now,
    syncedHash: force ? remoteHash : localHash,
    remoteUpdatedAt: normalizeSyncTimestamp(snapshot.updatedAt),
    remoteHash,
    pending: false,
    pendingSince: null,
    flushAfter: null,
    lastError: null,
  });
}

export async function getPlaylistSyncStatus() {
  const [meta, remoteAutoCollect] = await Promise.all([
    readLocalSyncMeta(),
    readRemoteAutoCollectSyncSnapshot(),
  ]);
  return {
    localDeviceId: meta.deviceId || null,
    localUpdatedAt: normalizeSyncTimestamp(meta.localUpdatedAt),
    remoteUpdatedAt: normalizeSyncTimestamp(remoteAutoCollect?.updatedAt),
    remoteDeviceId: remoteAutoCollect?.deviceId || null,
    remoteChunkCount: remoteAutoCollect ? 1 : 0,
    pending: false,
    lastWriteAt: normalizeSyncTimestamp(meta.lastWriteAt),
    lastError: null,
    remoteAvailable: Boolean(remoteAutoCollect),
    technicalOnly: true,
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
  let snapshot = null;
  if (stateInput) {
    const deviceId = localMeta.deviceId || createDeviceId();
    snapshot = buildAutoCollectSyncSnapshot(stateInput, {
      updatedAt: normalizeSyncTimestamp(localMeta.localUpdatedAt) || now,
      deviceId,
    });
    await storageSet("sync", { [AUTO_COLLECT_SYNC_STORAGE_KEY]: snapshot });
  }
  await writeLocalSyncMeta({
    ...localMeta,
    pending: false,
    pendingSince: null,
    flushAfter: null,
    syncedUpdatedAt: normalizeSyncTimestamp(localMeta.localUpdatedAt) || now,
    syncedHash: localMeta.localHash || null,
    remoteUpdatedAt: snapshot?.updatedAt || localMeta.remoteUpdatedAt || null,
    remoteHash: snapshot?.hash || localMeta.remoteHash || null,
    lastWriteAt: now,
    lastError: null,
  });
  return {
    wrote: true,
    reason: "drive-pending",
    autoCollectPushed: Boolean(snapshot),
  };
}
