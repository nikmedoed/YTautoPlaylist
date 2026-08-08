// Filter persistence helper. Reads and writes saved filter settings through Chrome storage.
import {
  AUTO_COLLECT_STORAGE_KEY,
  FILTERS_STORAGE_KEY,
  normalizeSettingsFilters,
  resolveRemoteSettingsSyncFilters,
  scheduleSettingsSync,
} from "./store/state/index.js";

const STORAGE_KEYS = {
  filters: FILTERS_STORAGE_KEY,
  autoCollect: AUTO_COLLECT_STORAGE_KEY,
};

const DEFAULT_FILTERS = Object.freeze({
  global: { noShorts: true },
  channels: {},
});

const hasChromeStorage = typeof chrome !== "undefined" && chrome?.storage?.local;

let filtersCache = null;
let autoCollectLastRun = null;

function asValidDate(value) {
  const candidate =
    value instanceof Date
      ? new Date(value.getTime())
      : typeof value === "number" || typeof value === "string"
        ? new Date(value)
        : null;
  return candidate && !Number.isNaN(candidate.getTime()) ? candidate : null;
}

function updateAutoCollectLastRun(meta) {
  const candidate =
    meta && typeof meta === "object" ? meta.lastRunAt ?? meta : meta;
  autoCollectLastRun = asValidDate(candidate);
}

function cloneDefaultFilters() {
  return {
    global: { ...DEFAULT_FILTERS.global },
    channels: {},
  };
}

export function normalizeFilters(raw) {
  return normalizeSettingsFilters(raw);
}

function parseStoredFilters(raw) {
  if (!raw) return cloneDefaultFilters();
  try {
    return normalizeFilters(typeof raw === "string" ? JSON.parse(raw) : raw);
  } catch {
    return cloneDefaultFilters();
  }
}

const chromeGet = (keys) =>
  new Promise((resolve) => chrome.storage.local.get(keys, (data) => resolve(data || {})));

const chromeSet = (payload) =>
  new Promise((resolve) => chrome.storage.local.set(payload, resolve));

if (hasChromeStorage && chrome.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes[STORAGE_KEYS.filters]) {
      filtersCache = parseStoredFilters(changes[STORAGE_KEYS.filters].newValue);
    }
    if (changes[STORAGE_KEYS.autoCollect]) {
      updateAutoCollectLastRun(changes[STORAGE_KEYS.autoCollect].newValue);
    }
  });
}

export function getFiltersLastSaved() {
  return asValidDate(autoCollectLastRun);
}

export async function getFilters() {
  if (filtersCache) {
    return filtersCache;
  }
  if (!hasChromeStorage) {
    filtersCache = cloneDefaultFilters();
    return filtersCache;
  }
  const data = await chromeGet([STORAGE_KEYS.filters, STORAGE_KEYS.autoCollect]);
  filtersCache = parseStoredFilters(data?.[STORAGE_KEYS.filters]);
  const resolved = await resolveRemoteSettingsSyncFilters(filtersCache);
  if (resolved.imported) {
    filtersCache = resolved.filters;
  }
  if (!data?.[STORAGE_KEYS.filters]) {
    await chromeSet({ [STORAGE_KEYS.filters]: JSON.stringify(filtersCache) });
  }
  updateAutoCollectLastRun(data?.[STORAGE_KEYS.autoCollect]);
  return filtersCache;
}

export async function saveFilters(filters) {
  filtersCache = normalizeFilters(filters);
  if (!hasChromeStorage) {
    return;
  }
  await chromeSet({ [STORAGE_KEYS.filters]: JSON.stringify(filtersCache) });
  await scheduleSettingsSync(filtersCache);
}
