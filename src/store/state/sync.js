// Account sync adapter. Keeps chrome.storage.local authoritative and mirrors a
// debounced playlist snapshot into chrome.storage.sync as a recoverable backup.
import {
  SYNC_ALARM_NAME,
  SYNC_CHUNK_STORAGE_PREFIX,
  SYNC_DEBOUNCE_MS,
  SYNC_LOCAL_META_STORAGE_KEY,
  SYNC_MANIFEST_STORAGE_KEY,
} from "./constants.js";
import { sanitizeState } from "./sanitizers.js";
import {
  buildSyncSnapshot,
  getSyncChunkKey,
  getSyncStateFingerprint,
  hasSyncableUserData,
  mergeSyncStatesConservatively,
  mergeRemoteSyncState,
  normalizeSyncTimestamp,
  parseSyncSnapshot,
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
  return (
    typeof chrome !== "undefined" &&
    chrome?.storage &&
    chrome.storage[area]
  );
}

async function storageGet(area, keys) {
  if (!hasChromeStorageArea(area)) {
    return {};
  }
  return chrome.storage[area].get(keys);
}

async function storageSet(area, payload) {
  if (!hasChromeStorageArea(area)) {
    return;
  }
  await chrome.storage[area].set(payload);
}

async function storageRemove(area, keys) {
  if (!hasChromeStorageArea(area) || !keys.length) {
    return;
  }
  await chrome.storage[area].remove(keys);
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

async function ensureLocalDeviceId(meta = null) {
  const current = meta || (await readLocalSyncMeta());
  if (typeof current.deviceId === "string" && current.deviceId) {
    return current.deviceId;
  }
  const deviceId = createDeviceId();
  await writeLocalSyncMeta({ ...current, deviceId });
  return deviceId;
}

export async function readRemotePlaylistSyncSnapshot() {
  if (!hasChromeStorageArea("sync")) {
    return null;
  }
  const storedManifest = await storageGet("sync", SYNC_MANIFEST_STORAGE_KEY);
  const manifest = storedManifest?.[SYNC_MANIFEST_STORAGE_KEY];
  if (!manifest || !Number.isInteger(manifest.chunkCount)) {
    return null;
  }
  const keys = Array.from({ length: manifest.chunkCount }, (_, index) =>
    getSyncChunkKey(index)
  );
  const storedChunks = await storageGet("sync", keys);
  return parseSyncSnapshot(
    manifest,
    keys.map((key) => storedChunks?.[key])
  );
}

async function scheduleSyncAlarm(dueAt) {
  if (typeof chrome === "undefined") {
    return;
  }
  if (chrome?.alarms?.create) {
    chrome.alarms.create(SYNC_ALARM_NAME, { when: dueAt });
  }
}

export async function configurePlaylistSyncAccess() {
  if (!hasChromeStorageArea("sync")) return;
  try {
    await chrome.storage.sync.setAccessLevel?.({
      accessLevel: "TRUSTED_CONTEXTS",
    });
  } catch {
    /* Older Chromium builds may not support setAccessLevel. */
  }
}

export function isPlaylistSyncStorageChange(changes = {}) {
  return Object.keys(changes).some(
    (key) =>
      key === SYNC_MANIFEST_STORAGE_KEY ||
      key.startsWith(SYNC_CHUNK_STORAGE_PREFIX)
  );
}

export async function resolveRemotePlaylistSyncState(localStateInput) {
  const localState = sanitizeState(localStateInput);
  const localMeta = await readLocalSyncMeta();
  const remote = await readRemotePlaylistSyncSnapshot();
  if (localMeta.pending) {
    const flushAfter =
      normalizeSyncTimestamp(localMeta.flushAfter) || Date.now() + SYNC_DEBOUNCE_MS;
    await scheduleSyncAlarm(flushAfter);
  }
  if (!remote) {
    if (
      hasChromeStorageArea("sync") &&
      !localMeta.localHash &&
      hasSyncableUserData(localState)
    ) {
      const now = Date.now();
      const dueAt = now + SYNC_DEBOUNCE_MS;
      const deviceId = await ensureLocalDeviceId(localMeta);
      await writeLocalSyncMeta({
        ...localMeta,
        deviceId,
        localHash: getSyncStateFingerprint(localState),
        localUpdatedAt: now,
        pending: true,
        pendingSince: now,
        flushAfter: dueAt,
        lastError: null,
      });
      await scheduleSyncAlarm(dueAt);
    }
    return { state: localState, imported: false };
  }

  const localUpdatedAt = normalizeSyncTimestamp(localMeta.localUpdatedAt);
  const shouldImport =
    !localMeta.pending &&
    ((!hasSyncableUserData(localState) && remote.updatedAt > 0) ||
      (localUpdatedAt > 0 && remote.updatedAt > localUpdatedAt));

  if (!shouldImport) {
    await writeLocalSyncMeta({
      ...localMeta,
      remoteUpdatedAt: remote.updatedAt,
      remoteHash: remote.hash,
    });
    return { state: localState, imported: false };
  }

  const merged = mergeRemoteSyncState(localState, remote.state);
  await writeLocalSyncMeta({
    ...localMeta,
    localUpdatedAt: remote.updatedAt,
    localHash: getSyncStateFingerprint(merged),
    syncedUpdatedAt: remote.updatedAt,
    syncedHash: remote.hash,
    remoteUpdatedAt: remote.updatedAt,
    remoteHash: remote.hash,
    baseRemoteHash: null,
    baseRemoteUpdatedAt: null,
    pending: false,
    lastError: null,
  });
  return { state: merged, imported: true, remoteUpdatedAt: remote.updatedAt };
}

export async function forceRemotePlaylistSyncState(localStateInput) {
  const localState = sanitizeState(localStateInput);
  const localMeta = await readLocalSyncMeta();
  const remote = await readRemotePlaylistSyncSnapshot();
  if (!remote) {
    return { state: localState, imported: false, reason: "no-remote" };
  }
  const merged = mergeRemoteSyncState(localState, remote.state);
  await writeLocalSyncMeta({
    ...localMeta,
    localUpdatedAt: remote.updatedAt,
    localHash: getSyncStateFingerprint(merged),
    syncedUpdatedAt: remote.updatedAt,
    syncedHash: remote.hash,
    remoteUpdatedAt: remote.updatedAt,
    remoteHash: remote.hash,
    baseRemoteHash: null,
    baseRemoteUpdatedAt: null,
    pending: false,
    pendingSince: null,
    flushAfter: null,
    lastError: null,
  });
  return { state: merged, imported: true, remoteUpdatedAt: remote.updatedAt };
}
export async function getPlaylistSyncStatus() {
  const [meta, remote] = await Promise.all([
    readLocalSyncMeta(),
    readRemotePlaylistSyncSnapshot(),
  ]);
  return {
    localDeviceId: meta.deviceId || null,
    localUpdatedAt: normalizeSyncTimestamp(meta.localUpdatedAt),
    remoteUpdatedAt: normalizeSyncTimestamp(remote?.updatedAt),
    remoteDeviceId: remote?.manifest?.deviceId || null,
    remoteChunkCount: remote?.manifest?.chunkCount || 0,
    pending: Boolean(meta.pending),
    lastWriteAt: normalizeSyncTimestamp(meta.lastWriteAt),
    lastError: meta.lastError || null,
    remoteAvailable: Boolean(remote),
  };
}
export async function schedulePlaylistSync(stateInput, { immediate = false } = {}) {
  if (!hasChromeStorageArea("sync") || !hasChromeStorageArea("local")) {
    return;
  }
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
  const deviceId = await ensureLocalDeviceId(localMeta);
  const dueAt = immediate ? now : now + SYNC_DEBOUNCE_MS;
  await writeLocalSyncMeta({
    ...localMeta,
    deviceId,
    localUpdatedAt: now,
    localHash,
    baseRemoteHash: localMeta.pending
      ? localMeta.baseRemoteHash || null
      : localMeta.remoteHash || localMeta.syncedHash || null,
    baseRemoteUpdatedAt: localMeta.pending
      ? normalizeSyncTimestamp(localMeta.baseRemoteUpdatedAt)
      : normalizeSyncTimestamp(localMeta.remoteUpdatedAt) ||
        normalizeSyncTimestamp(localMeta.syncedUpdatedAt),
    pending: true,
    pendingSince: localMeta.pendingSince || now,
    flushAfter: dueAt,
    lastError: null,
  });
  await scheduleSyncAlarm(dueAt);
}

export async function writePendingPlaylistSync(stateInput, { force = false } = {}) {
  if (!hasChromeStorageArea("sync") || !hasChromeStorageArea("local")) {
    return { wrote: false, reason: "storage-unavailable" };
  }
  const localMeta = await readLocalSyncMeta();
  if (!localMeta.pending) {
    return { wrote: false, reason: "not-pending" };
  }
  const now = Date.now();
  const flushAfter = normalizeSyncTimestamp(localMeta.flushAfter);
  if (!force && flushAfter && flushAfter > now) {
    await scheduleSyncAlarm(flushAfter);
    return { wrote: false, reason: "debounced" };
  }

  const localHash = getSyncStateFingerprint(stateInput);
  if (localHash !== localMeta.localHash) {
    await schedulePlaylistSync(stateInput);
    return { wrote: false, reason: "state-changed" };
  }

  const deviceId = await ensureLocalDeviceId(localMeta);
  const updatedAt = normalizeSyncTimestamp(localMeta.localUpdatedAt) || now;
  let snapshot;
  try {
    snapshot = buildSyncSnapshot(stateInput, { updatedAt, deviceId });
  } catch (err) {
    await writeLocalSyncMeta({
      ...localMeta,
      pending: false,
      lastError: err?.message || String(err),
      lastErrorAt: now,
    });
    return { wrote: false, reason: "too-large" };
  }

  const previousRemote = await readRemotePlaylistSyncSnapshot();
  const remoteFromOtherDevice =
    previousRemote && previousRemote.manifest?.deviceId !== deviceId;
  const baseRemoteHash =
    typeof localMeta.baseRemoteHash === "string" && localMeta.baseRemoteHash
      ? localMeta.baseRemoteHash
      : null;
  const remoteChangedSinceBase =
    remoteFromOtherDevice &&
    previousRemote &&
    (baseRemoteHash ? previousRemote.hash !== baseRemoteHash : true);
  const remoteNewerThanLocal =
    remoteFromOtherDevice && previousRemote.updatedAt > updatedAt;
  let stateToWrite = stateInput;
  let conflictMerged = false;
  let snapshotUpdatedAt = updatedAt;
  if (!force && (remoteChangedSinceBase || remoteNewerThanLocal)) {
    stateToWrite = mergeSyncStatesConservatively(stateInput, previousRemote.state);
    conflictMerged = true;
    snapshotUpdatedAt = now;
    try {
      snapshot = buildSyncSnapshot(stateToWrite, {
        updatedAt: snapshotUpdatedAt,
        deviceId,
      });
    } catch (err) {
      await writeLocalSyncMeta({
        ...localMeta,
        pending: false,
        lastError: err?.message || String(err),
        lastErrorAt: now,
      });
      return { wrote: false, reason: "merged-too-large" };
    }
  }

  const payload = { [SYNC_MANIFEST_STORAGE_KEY]: snapshot.manifest };
  snapshot.chunks.forEach((chunk, index) => {
    payload[getSyncChunkKey(index)] = chunk;
  });
  await storageSet("sync", payload);

  const previousCount = previousRemote?.manifest?.chunkCount || 0;
  const staleKeys = [];
  for (let index = snapshot.chunks.length; index < previousCount; index += 1) {
    staleKeys.push(getSyncChunkKey(index));
  }
  await storageRemove("sync", staleKeys);

  await writeLocalSyncMeta({
    ...localMeta,
    deviceId,
    localUpdatedAt: snapshotUpdatedAt,
    localHash: getSyncStateFingerprint(stateToWrite),
    syncedUpdatedAt: snapshotUpdatedAt,
    syncedHash: snapshot.hash,
    remoteUpdatedAt: snapshotUpdatedAt,
    remoteHash: snapshot.hash,
    baseRemoteHash: null,
    baseRemoteUpdatedAt: null,
    pending: false,
    pendingSince: null,
    flushAfter: null,
    lastWriteAt: now,
    lastError: null,
    lastChunkCount: snapshot.chunks.length,
    lastBytes: snapshot.totalBytes,
  });
  return {
    wrote: true,
    updatedAt: snapshotUpdatedAt,
    chunkCount: snapshot.chunks.length,
    conflictMerged,
    mergedState: conflictMerged ? stateToWrite : null,
  };
}
