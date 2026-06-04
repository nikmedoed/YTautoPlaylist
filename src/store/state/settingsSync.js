// Settings sync adapter. Mirrors filter settings into chrome.storage.sync with
// conservative conflict merging so ignore rules are not lost across devices.
import {
  FILTERS_STORAGE_KEY,
  SETTINGS_SYNC_CHUNK_STORAGE_PREFIX,
  SETTINGS_SYNC_LOCAL_META_STORAGE_KEY,
  SETTINGS_SYNC_MANIFEST_STORAGE_KEY,
  SYNC_ALARM_NAME,
  SYNC_DEBOUNCE_MS,
} from "./constants.js";
import {
  normalizeSyncTimestamp,
} from "./syncSnapshot.js";
import {
  buildSettingsSnapshot,
  defaultSettingsFingerprint,
  getSettingsChunkKey,
  mergeFiltersConservatively,
  normalizeSettingsFilters,
  parseSettingsSnapshot,
  settingsFingerprint,
} from "./settingsSyncSnapshot.js";

function hasChromeStorageArea(area) {
  return typeof chrome !== "undefined" && chrome?.storage?.[area];
}

async function storageGet(area, keys) {
  return hasChromeStorageArea(area) ? chrome.storage[area].get(keys) : {};
}

async function storageSet(area, payload) {
  if (hasChromeStorageArea(area)) {
    await chrome.storage[area].set(payload);
  }
}

async function storageRemove(area, keys) {
  if (hasChromeStorageArea(area) && keys.length) {
    await chrome.storage[area].remove(keys);
  }
}

function createDeviceId() {
  const random =
    typeof crypto !== "undefined" && crypto?.randomUUID
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `device_${Date.now().toString(36)}_${random}`;
}

function parseStoredFilters(raw) {
  try {
    return normalizeSettingsFilters(typeof raw === "string" ? JSON.parse(raw) : raw);
  } catch {
    return normalizeSettingsFilters(null);
  }
}

async function readLocalMeta() {
  const stored = await storageGet("local", SETTINGS_SYNC_LOCAL_META_STORAGE_KEY);
  const meta = stored?.[SETTINGS_SYNC_LOCAL_META_STORAGE_KEY];
  return meta && typeof meta === "object" ? meta : {};
}

async function writeLocalMeta(meta) {
  await storageSet("local", {
    [SETTINGS_SYNC_LOCAL_META_STORAGE_KEY]: {
      ...meta,
      deviceId:
        typeof meta.deviceId === "string" && meta.deviceId
          ? meta.deviceId
          : createDeviceId(),
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

async function scheduleAlarm(dueAt) {
  if (typeof chrome !== "undefined" && chrome?.alarms?.create) {
    chrome.alarms.create(SYNC_ALARM_NAME, { when: dueAt });
  }
}

export function isSettingsSyncStorageChange(changes = {}) {
  return Object.keys(changes).some(
    (key) =>
      key === SETTINGS_SYNC_MANIFEST_STORAGE_KEY ||
      key.startsWith(SETTINGS_SYNC_CHUNK_STORAGE_PREFIX)
  );
}

export async function readRemoteSettingsSyncSnapshot() {
  const storedManifest = await storageGet("sync", SETTINGS_SYNC_MANIFEST_STORAGE_KEY);
  const manifest = storedManifest?.[SETTINGS_SYNC_MANIFEST_STORAGE_KEY];
  if (!manifest || !Number.isInteger(manifest.chunkCount)) return null;
  const keys = Array.from({ length: manifest.chunkCount }, (_, index) =>
    getSettingsChunkKey(index)
  );
  const storedChunks = await storageGet("sync", keys);
  return parseSettingsSnapshot(manifest, keys.map((key) => storedChunks?.[key]));
}

export async function readLocalSettingsFilters() {
  const stored = await storageGet("local", FILTERS_STORAGE_KEY);
  return parseStoredFilters(stored?.[FILTERS_STORAGE_KEY]);
}

async function writeLocalSettingsFilters(filters) {
  await storageSet("local", {
    [FILTERS_STORAGE_KEY]: JSON.stringify(normalizeSettingsFilters(filters)),
  });
}

export async function scheduleSettingsSync(filtersInput, { immediate = false } = {}) {
  if (!hasChromeStorageArea("sync") || !hasChromeStorageArea("local")) return;
  const meta = await readLocalMeta();
  const localHash = settingsFingerprint(filtersInput);
  if (localHash === meta.localHash && !immediate) return;
  const now = Date.now();
  const dueAt = immediate ? now : now + SYNC_DEBOUNCE_MS;
  await writeLocalMeta({
    ...meta,
    deviceId: await ensureDeviceId(meta),
    localHash,
    localUpdatedAt: now,
    baseRemoteHash: meta.pending
      ? meta.baseRemoteHash || null
      : meta.remoteHash || meta.syncedHash || null,
    pending: true,
    pendingSince: meta.pendingSince || now,
    flushAfter: dueAt,
    lastError: null,
  });
  await scheduleAlarm(dueAt);
}

export async function flushPendingSettingsSync({ force = false } = {}) {
  if (!hasChromeStorageArea("sync") || !hasChromeStorageArea("local")) {
    return { wrote: false, reason: "storage-unavailable" };
  }
  const meta = await readLocalMeta();
  if (!meta.pending) return { wrote: false, reason: "not-pending" };
  const now = Date.now();
  const flushAfter = normalizeSyncTimestamp(meta.flushAfter);
  if (!force && flushAfter && flushAfter > now) {
    await scheduleAlarm(flushAfter);
    return { wrote: false, reason: "debounced" };
  }
  const localFilters = await readLocalSettingsFilters();
  const localHash = settingsFingerprint(localFilters);
  if (localHash !== meta.localHash) {
    await scheduleSettingsSync(localFilters);
    return { wrote: false, reason: "state-changed" };
  }
  const deviceId = await ensureDeviceId(meta);
  const remote = await readRemoteSettingsSyncSnapshot();
  const remoteFromOther = remote && remote.manifest?.deviceId !== deviceId;
  const baseHash = typeof meta.baseRemoteHash === "string" ? meta.baseRemoteHash : null;
  const conflict = !force && remoteFromOther && (!baseHash || remote.hash !== baseHash);
  const filtersToWrite = conflict
    ? mergeFiltersConservatively(localFilters, remote.filters)
    : localFilters;
  const updatedAt = conflict
    ? now
    : normalizeSyncTimestamp(meta.localUpdatedAt) || now;
  let snapshot;
  try {
    snapshot = buildSettingsSnapshot(filtersToWrite, { updatedAt, deviceId });
  } catch (err) {
    await writeLocalMeta({
      ...meta,
      pending: false,
      lastError: err?.message || String(err),
      lastErrorAt: now,
    });
    return { wrote: false, reason: "too-large" };
  }
  const payload = { [SETTINGS_SYNC_MANIFEST_STORAGE_KEY]: snapshot.manifest };
  snapshot.chunks.forEach((chunk, index) => {
    payload[getSettingsChunkKey(index)] = chunk;
  });
  await storageSet("sync", payload);
  const previousCount = remote?.manifest?.chunkCount || 0;
  const staleKeys = [];
  for (let index = snapshot.chunks.length; index < previousCount; index += 1) {
    staleKeys.push(getSettingsChunkKey(index));
  }
  await storageRemove("sync", staleKeys);
  if (conflict) await writeLocalSettingsFilters(filtersToWrite);
  await writeLocalMeta({
    ...meta,
    deviceId,
    localHash: settingsFingerprint(filtersToWrite),
    localUpdatedAt: updatedAt,
    syncedHash: snapshot.hash,
    syncedUpdatedAt: updatedAt,
    remoteHash: snapshot.hash,
    remoteUpdatedAt: updatedAt,
    baseRemoteHash: null,
    pending: false,
    pendingSince: null,
    flushAfter: null,
    lastWriteAt: now,
    lastError: null,
    lastBytes: snapshot.totalBytes,
  });
  return { wrote: true, conflictMerged: conflict, updatedAt };
}

export async function pushLocalSettingsSyncNow() {
  const filters = await readLocalSettingsFilters();
  await scheduleSettingsSync(filters, { immediate: true });
  const result = await flushPendingSettingsSync({ force: true });
  return { ...result, pushed: Boolean(result?.wrote) };
}

export async function resolveRemoteSettingsSyncFilters(localFiltersInput) {
  const localFilters = normalizeSettingsFilters(localFiltersInput);
  const meta = await readLocalMeta();
  if (meta.pending) {
    await scheduleAlarm(
      normalizeSyncTimestamp(meta.flushAfter) || Date.now() + SYNC_DEBOUNCE_MS
    );
  }
  const remote = await readRemoteSettingsSyncSnapshot();
  if (!remote) {
    if (settingsFingerprint(localFilters) !== defaultSettingsFingerprint()) {
      await scheduleSettingsSync(localFilters);
    }
    return { filters: localFilters, imported: false };
  }
  const localUpdatedAt = normalizeSyncTimestamp(meta.localUpdatedAt);
  const shouldImport =
    !meta.pending &&
    (localUpdatedAt <= 0 || remote.updatedAt > localUpdatedAt);
  if (!shouldImport) {
    await writeLocalMeta({ ...meta, remoteHash: remote.hash, remoteUpdatedAt: remote.updatedAt });
    return { filters: localFilters, imported: false };
  }
  await writeLocalSettingsFilters(remote.filters);
  await writeLocalMeta({
    ...meta,
    localHash: settingsFingerprint(remote.filters),
    localUpdatedAt: remote.updatedAt,
    syncedHash: remote.hash,
    syncedUpdatedAt: remote.updatedAt,
    remoteHash: remote.hash,
    remoteUpdatedAt: remote.updatedAt,
    baseRemoteHash: null,
    pending: false,
    lastError: null,
  });
  return { filters: remote.filters, imported: true };
}

export async function importRemoteSettingsSync({ force = false } = {}) {
  const localFilters = await readLocalSettingsFilters();
  const remote = await readRemoteSettingsSyncSnapshot();
  if (!remote) return { imported: false, reason: "no-remote" };
  const meta = await readLocalMeta();
  const localUpdatedAt = normalizeSyncTimestamp(meta.localUpdatedAt);
  const shouldImport = force || !meta.pending || remote.updatedAt > localUpdatedAt;
  if (!shouldImport) return { imported: false, reason: "local-pending" };
  const filters = force
    ? remote.filters
    : mergeFiltersConservatively(localFilters, remote.filters);
  await writeLocalSettingsFilters(filters);
  await writeLocalMeta({
    ...meta,
    localHash: settingsFingerprint(filters),
    localUpdatedAt: force ? remote.updatedAt : Date.now(),
    syncedHash: force ? remote.hash : settingsFingerprint(filters),
    syncedUpdatedAt: force ? remote.updatedAt : Date.now(),
    remoteHash: remote.hash,
    remoteUpdatedAt: remote.updatedAt,
    baseRemoteHash: null,
    pending: !force && settingsFingerprint(filters) !== remote.hash,
    flushAfter: !force ? Date.now() + SYNC_DEBOUNCE_MS : null,
    lastError: null,
  });
  if (!force && settingsFingerprint(filters) !== remote.hash) {
    await scheduleSettingsSync(filters);
  }
  return { imported: true, force, updatedAt: remote.updatedAt };
}

export async function getSettingsSyncStatus() {
  const [meta, remote] = await Promise.all([
    readLocalMeta(),
    readRemoteSettingsSyncSnapshot(),
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
