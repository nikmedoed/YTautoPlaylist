// Settings sync adapter. Mirrors filter settings into chrome.storage.sync with
// conservative conflict merging so ignore rules are not lost across devices.
import {
  FILTERS_STORAGE_KEY,
  SETTINGS_SYNC_CHUNK_STORAGE_PREFIX,
  SETTINGS_SYNC_LOCAL_META_STORAGE_KEY,
  SETTINGS_SYNC_MANIFEST_STORAGE_KEY,
  SETTINGS_SYNC_TOTAL_TARGET_BYTES,
  SYNC_ALARM_NAME,
  SYNC_CHUNK_TARGET_BYTES,
  SYNC_DEBOUNCE_MS,
} from "./constants.js";
import {
  hashString,
  normalizeSyncTimestamp,
  storageItemBytes,
} from "./syncSnapshot.js";

const SETTINGS_SYNC_FORMAT_VERSION = 1;
const DEFAULT_FILTERS = Object.freeze({
  global: { noShorts: true },
  channels: {},
});

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

function cloneDefaultFilters() {
  return { global: { ...DEFAULT_FILTERS.global }, channels: {} };
}

function normalizeRuleSet(raw = {}) {
  const result = {};
  if (typeof raw.noShorts === "boolean") result.noShorts = raw.noShorts;
  if (typeof raw.noBroadcasts === "boolean") {
    result.noBroadcasts = raw.noBroadcasts;
  }
  ["title", "tags", "playlists"].forEach((key) => {
    if (Array.isArray(raw[key])) {
      const values = Array.from(
        new Set(raw[key].map((value) => String(value).trim()).filter(Boolean))
      );
      if (values.length) result[key] = values;
    }
  });
  if (Array.isArray(raw.duration)) {
    const duration = raw.duration
      .map((entry) => ({
        min: Math.max(0, Number(entry?.min) || 0),
        max:
          entry?.max === Infinity
            ? Infinity
            : Math.max(0, Number(entry?.max) || 0),
      }))
      .filter((entry) => entry.max === Infinity || entry.max >= entry.min);
    if (duration.length) result.duration = duration;
  }
  return result;
}

export function normalizeSettingsFilters(raw) {
  if (!raw || typeof raw !== "object") {
    return cloneDefaultFilters();
  }
  const normalized = cloneDefaultFilters();
  normalized.global = {
    ...normalized.global,
    ...normalizeRuleSet(raw.global || {}),
  };
  if (raw.channels && typeof raw.channels === "object") {
    Object.entries(raw.channels).forEach(([channelId, rules]) => {
      const id = typeof channelId === "string" ? channelId.trim() : "";
      if (id) normalized.channels[id] = normalizeRuleSet(rules);
    });
  }
  return normalized;
}

function parseStoredFilters(raw) {
  try {
    return normalizeSettingsFilters(typeof raw === "string" ? JSON.parse(raw) : raw);
  } catch {
    return cloneDefaultFilters();
  }
}

function getSettingsChunkKey(index) {
  return `${SETTINGS_SYNC_CHUNK_STORAGE_PREFIX}${index}`;
}

function settingsFingerprint(filters) {
  return hashString(JSON.stringify(normalizeSettingsFilters(filters)));
}

function splitStringByStorageBytes(value) {
  const chunks = [];
  let offset = 0;
  while (offset < value.length) {
    let low = 1;
    let high = value.length - offset;
    let best = 1;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const candidate = value.slice(offset, offset + mid);
      const bytes = storageItemBytes(getSettingsChunkKey(chunks.length), candidate);
      if (bytes <= SYNC_CHUNK_TARGET_BYTES) {
        best = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    chunks.push(value.slice(offset, offset + best));
    offset += best;
  }
  return chunks;
}

function buildSettingsSnapshot(filtersInput, { updatedAt, deviceId } = {}) {
  const filters = normalizeSettingsFilters(filtersInput);
  const json = JSON.stringify(filters);
  const hash = hashString(json);
  const chunks = splitStringByStorageBytes(json);
  const manifest = {
    version: SETTINGS_SYNC_FORMAT_VERSION,
    updatedAt: normalizeSyncTimestamp(updatedAt) || Date.now(),
    deviceId: typeof deviceId === "string" && deviceId ? deviceId : null,
    hash,
    chunkCount: chunks.length,
  };
  const totalBytes =
    storageItemBytes(SETTINGS_SYNC_MANIFEST_STORAGE_KEY, manifest) +
    chunks.reduce(
      (sum, chunk, index) => sum + storageItemBytes(getSettingsChunkKey(index), chunk),
      0
    );
  if (totalBytes > SETTINGS_SYNC_TOTAL_TARGET_BYTES) {
    throw new Error(`Settings sync snapshot is too large (${totalBytes} bytes)`);
  }
  return { manifest, chunks, hash, totalBytes };
}

function parseSettingsSnapshot(manifest, chunks) {
  if (
    !manifest ||
    typeof manifest !== "object" ||
    manifest.version !== SETTINGS_SYNC_FORMAT_VERSION ||
    !Number.isInteger(manifest.chunkCount) ||
    manifest.chunkCount <= 0 ||
    manifest.chunkCount > 100 ||
    !Array.isArray(chunks) ||
    chunks.some((chunk) => typeof chunk !== "string")
  ) {
    return null;
  }
  const json = chunks.join("");
  const hash = hashString(json);
  if (hash !== manifest.hash) return null;
  try {
    return {
      manifest,
      filters: normalizeSettingsFilters(JSON.parse(json)),
      updatedAt: normalizeSyncTimestamp(manifest.updatedAt),
      hash,
    };
  } catch {
    return null;
  }
}

function mergeArrays(primary = [], secondary = []) {
  return Array.from(new Set([...primary, ...secondary]));
}

function mergeRuleSet(primary = {}, secondary = {}) {
  const merged = {};
  if (primary.noShorts || secondary.noShorts) merged.noShorts = true;
  if (primary.noBroadcasts || secondary.noBroadcasts) merged.noBroadcasts = true;
  ["title", "tags", "playlists"].forEach((key) => {
    const values = mergeArrays(primary[key] || [], secondary[key] || []);
    if (values.length) merged[key] = values;
  });
  const durations = mergeArrays(
    (primary.duration || []).map((entry) => JSON.stringify(entry)),
    (secondary.duration || []).map((entry) => JSON.stringify(entry))
  ).map((entry) => JSON.parse(entry));
  if (durations.length) merged.duration = durations;
  return normalizeRuleSet(merged);
}

function mergeFiltersConservatively(localInput, remoteInput) {
  const local = normalizeSettingsFilters(localInput);
  const remote = normalizeSettingsFilters(remoteInput);
  const channels = {};
  const ids = new Set([
    ...Object.keys(remote.channels || {}),
    ...Object.keys(local.channels || {}),
  ]);
  ids.forEach((id) => {
    channels[id] = mergeRuleSet(remote.channels[id], local.channels[id]);
  });
  return normalizeSettingsFilters({
    global: mergeRuleSet(remote.global, local.global),
    channels,
  });
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

export async function scheduleSettingsSync(filtersInput) {
  if (!hasChromeStorageArea("sync") || !hasChromeStorageArea("local")) return;
  const meta = await readLocalMeta();
  const localHash = settingsFingerprint(filtersInput);
  if (localHash === meta.localHash) return;
  const now = Date.now();
  const dueAt = now + SYNC_DEBOUNCE_MS;
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

export async function flushPendingSettingsSync() {
  if (!hasChromeStorageArea("sync") || !hasChromeStorageArea("local")) {
    return { wrote: false, reason: "storage-unavailable" };
  }
  const meta = await readLocalMeta();
  if (!meta.pending) return { wrote: false, reason: "not-pending" };
  const now = Date.now();
  const flushAfter = normalizeSyncTimestamp(meta.flushAfter);
  if (flushAfter && flushAfter > now) {
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
  const conflict = remoteFromOther && (!baseHash || remote.hash !== baseHash);
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
    if (settingsFingerprint(localFilters) !== settingsFingerprint(DEFAULT_FILTERS)) {
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
    localUpdatedAt: normalizeSyncTimestamp(meta.localUpdatedAt),
    remoteUpdatedAt: normalizeSyncTimestamp(remote?.updatedAt),
    pending: Boolean(meta.pending),
    lastWriteAt: normalizeSyncTimestamp(meta.lastWriteAt),
    lastError: meta.lastError || null,
    remoteAvailable: Boolean(remote),
  };
}
