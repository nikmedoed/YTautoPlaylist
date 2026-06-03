// Pure settings sync helpers. Normalizes filter settings, snapshots them for
// chrome.storage.sync, and merges rule conflicts conservatively.
import {
  SETTINGS_SYNC_CHUNK_STORAGE_PREFIX,
  SETTINGS_SYNC_MANIFEST_STORAGE_KEY,
  SETTINGS_SYNC_TOTAL_TARGET_BYTES,
  SYNC_CHUNK_TARGET_BYTES,
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
    if (!Array.isArray(raw[key])) return;
    const values = Array.from(
      new Set(raw[key].map((value) => String(value).trim()).filter(Boolean))
    );
    if (values.length) result[key] = values;
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
  if (!raw || typeof raw !== "object") return cloneDefaultFilters();
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

export function defaultSettingsFingerprint() {
  return settingsFingerprint(DEFAULT_FILTERS);
}

export function settingsFingerprint(filters) {
  return hashString(JSON.stringify(normalizeSettingsFilters(filters)));
}

export function getSettingsChunkKey(index) {
  return `${SETTINGS_SYNC_CHUNK_STORAGE_PREFIX}${index}`;
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

export function buildSettingsSnapshot(filtersInput, { updatedAt, deviceId } = {}) {
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

export function parseSettingsSnapshot(manifest, chunks) {
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

export function mergeFiltersConservatively(localInput, remoteInput) {
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
