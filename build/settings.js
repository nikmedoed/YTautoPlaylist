// src/utils.js
var YOUTUBE_ID_PATTERN = /[\w-]{11}/;
function parseVideoId(input) {
  if (!input) return "";
  const str = String(input).trim();
  if (/^[\w-]{11}$/.test(str)) return str;
  try {
    const baseUrl = typeof globalThis?.location?.href === "string" ? globalThis.location.href : null;
    const url = baseUrl ? new URL(str, baseUrl) : new URL(str);
    if (url.hostname.includes("youtu.be")) {
      const id = url.pathname.split("/").filter(Boolean)[0];
      if (/^[\w-]{11}$/.test(id)) return id;
    }
    const candidate = url.searchParams.get("v");
    if (candidate && /^[\w-]{11}$/.test(candidate)) return candidate;
    const segments = url.pathname.split("/");
    for (const segment of segments) {
      if (/^[\w-]{11}$/.test(segment)) return segment;
    }
  } catch {
  }
  const match = str.match(YOUTUBE_ID_PATTERN);
  return match ? match[0] : "";
}

// src/time.js
var ISO_DURATION_PATTERN = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/;
var DISPLAY_DATE_FORMATTER = new Intl.DateTimeFormat("ru-RU", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit"
});
var STORAGE_TIMESTAMP_FORMATTER = new Intl.DateTimeFormat("ru", {
  year: "2-digit",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric"
});
function parseDuration(duration) {
  if (duration == null) return void 0;
  if (typeof duration === "number" && Number.isFinite(duration)) {
    return Math.max(0, duration);
  }
  const match = ISO_DURATION_PATTERN.exec(String(duration));
  if (!match) return void 0;
  const hours = Number(match[1] || 0);
  const minutes = Number(match[2] || 0);
  const seconds = Number(match[3] || 0);
  return hours * 3600 + minutes * 60 + seconds;
}

// src/auth.js
if (typeof chrome !== "undefined") {
  chrome.storage.local.set({ authStatus: false });
}
var currentToken = null;
function clearToken() {
  if (typeof chrome !== "undefined" && currentToken) {
    chrome.identity.removeCachedAuthToken({ token: currentToken }, () => {
    });
  }
  currentToken = null;
  if (typeof chrome !== "undefined") {
    chrome.storage.local.set({ authStatus: false });
  }
}
function signInUser() {
  if (typeof chrome === "undefined") {
    return Promise.reject(new Error("chrome API unavailable"));
  }
  if (currentToken) {
    chrome.identity.removeCachedAuthToken({ token: currentToken }, () => {
    });
    currentToken = null;
  }
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: true }, (token) => {
      if (chrome.runtime.lastError || !token) {
        console.error("Failed to obtain token", chrome.runtime.lastError);
        chrome.storage.local.set({ authStatus: false });
        reject(chrome.runtime.lastError);
      } else {
        currentToken = token;
        chrome.storage.local.set({ authStatus: true });
        resolve(token);
      }
    });
  });
}
function getToken({ interactive = true } = {}) {
  if (typeof chrome === "undefined") {
    return Promise.reject(new Error("chrome API unavailable"));
  }
  if (currentToken) return Promise.resolve(currentToken);
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: false }, async (token) => {
      if (chrome.runtime.lastError || !token) {
        if (!interactive) {
          reject(chrome.runtime.lastError || new Error("Auth token unavailable"));
          return;
        }
        try {
          const t = await signInUser();
          resolve(t);
        } catch (err) {
          reject(err);
        }
      } else {
        currentToken = token;
        chrome.storage.local.set({ authStatus: true });
        resolve(token);
      }
    });
  });
}

// src/youtube-api/transport.js
async function defaultCallApi(path, params = {}, method = "GET", body = null, retry) {
  const token = await getToken();
  const url = new URL("https://www.googleapis.com/youtube/v3/" + path);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== void 0 && v !== null) url.searchParams.set(k, v);
  });
  const init = {
    method,
    headers: { Authorization: "Bearer " + token, Accept: "application/json" }
  };
  if (body) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const resp = await fetch(url.toString(), init);
  if (!resp.ok) {
    if ((resp.status === 401 || resp.status === 403) && !retry) {
      clearToken();
      try {
        await signInUser();
      } catch (e) {
        const text2 = await resp.text();
        const err2 = new Error("API " + path + " failed: " + resp.status);
        err2.status = resp.status;
        err2.body = text2;
        err2.error = e;
        throw err2;
      }
      return defaultCallApi(path, params, method, body, true);
    }
    const text = await resp.text();
    const err = new Error("API " + path + " failed: " + resp.status);
    err.status = resp.status;
    err.body = text;
    try {
      err.error = JSON.parse(text);
    } catch {
      err.error = text;
    }
    throw err;
  }
  return resp.json();
}
var callApiImpl = defaultCallApi;
async function callApi(path, params = {}, method = "GET", body = null, retry) {
  return callApiImpl(path, params, method, body, retry);
}

// src/youtube-api/playlists.js
async function listChannelPlaylists(channelId, nextPage) {
  const data = await callApi("playlists", {
    part: "id,snippet",
    channelId,
    maxResults: 50,
    pageToken: nextPage
  });
  const items = data.items.map((it) => ({ id: it.id, title: it.snippet.title }));
  if (data.nextPageToken) {
    const rest = await listChannelPlaylists(channelId, data.nextPageToken);
    return items.concat(rest);
  }
  return items;
}
async function isVideoInPlaylist(videoId, playlistId) {
  const data = await callApi("playlistItems", {
    part: "id",
    maxResults: 25,
    playlistId,
    videoId
  });
  return Array.isArray(data.items) && data.items.length > 0;
}

// src/background/constants.js
var COLLECTION_WINDOW_MS = 7 * 24 * 60 * 60 * 1e3;
var COLLECTION_FETCH_OVERLAP_MS = 48 * 60 * 60 * 1e3;

// src/store/state/constants.js
var AUTO_COLLECT_STORAGE_KEY = "subscriptionsCollect";
var FILTERS_STORAGE_KEY = "filters";
var SETTINGS_SYNC_LOCAL_META_STORAGE_KEY = "runtimeSettingsSyncLocal";
var SETTINGS_SYNC_MANIFEST_STORAGE_KEY = "runtimeSettingsSyncManifest";
var SETTINGS_SYNC_CHUNK_STORAGE_PREFIX = "runtimeSettingsSyncChunk:";
var SYNC_ALARM_NAME = "runtimePlaylistSyncFlush";
var DEFAULT_LIST_ID = "default";
var DEFAULT_LIST_NAME = "\u041E\u0441\u043D\u043E\u0432\u043D\u043E\u0439";
var SYNC_DEBOUNCE_MS = 15 * 1e3;
var SETTINGS_SYNC_TOTAL_TARGET_BYTES = 32 * 1024;
var defaultState = {
  lists: {
    [DEFAULT_LIST_ID]: {
      id: DEFAULT_LIST_ID,
      name: DEFAULT_LIST_NAME,
      freeze: false,
      queue: [],
      currentIndex: null,
      revision: 0
    }
  },
  listOrder: [DEFAULT_LIST_ID],
  currentListId: DEFAULT_LIST_ID,
  currentVideoId: null,
  history: [],
  deletedHistory: [],
  currentTabId: null,
  autoCollect: {
    lastRunAt: 0,
    lastAdded: 0,
    lastFetched: 0,
    nextAutoCollectAt: 0,
    seenIds: []
  },
  videoProgress: {}
};

// src/store/state/syncSnapshot.js
function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
function normalizeSyncTimestamp(value) {
  const ts = Number(value);
  return Number.isFinite(ts) && ts > 0 ? Math.trunc(ts) : 0;
}

// src/store/state/storage.js
var hasChromeStorage = typeof chrome !== "undefined" && chrome?.storage?.local;
var stateWriteQueue = Promise.resolve();

// src/store/state/settingsSyncSnapshot.js
var SETTINGS_SYNC_FORMAT_VERSION = 1;
var DEFAULT_FILTERS = Object.freeze({
  global: { noShorts: true },
  channels: {}
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
    const duration = raw.duration.map((entry) => ({
      min: Math.max(0, Number(entry?.min) || 0),
      max: entry?.max === Infinity ? Infinity : Math.max(0, Number(entry?.max) || 0)
    })).filter((entry) => entry.max === Infinity || entry.max >= entry.min);
    if (duration.length) result.duration = duration;
  }
  return result;
}
function normalizeSettingsFilters(raw) {
  if (!raw || typeof raw !== "object") return cloneDefaultFilters();
  const normalized = cloneDefaultFilters();
  normalized.global = {
    ...normalized.global,
    ...normalizeRuleSet(raw.global || {})
  };
  if (raw.channels && typeof raw.channels === "object") {
    Object.entries(raw.channels).forEach(([channelId, rules]) => {
      const id = typeof channelId === "string" ? channelId.trim() : "";
      if (id) normalized.channels[id] = normalizeRuleSet(rules);
    });
  }
  return normalized;
}
function settingsFingerprint(filters) {
  return hashString(JSON.stringify(normalizeSettingsFilters(filters)));
}
function getSettingsChunkKey(index) {
  return `${SETTINGS_SYNC_CHUNK_STORAGE_PREFIX}${index}`;
}
function parseSettingsSnapshot(manifest, chunks) {
  if (!manifest || typeof manifest !== "object" || manifest.version !== SETTINGS_SYNC_FORMAT_VERSION || !Number.isInteger(manifest.chunkCount) || manifest.chunkCount <= 0 || manifest.chunkCount > 100 || !Array.isArray(chunks) || chunks.some((chunk) => typeof chunk !== "string")) {
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
      hash
    };
  } catch {
    return null;
  }
}

// src/store/state/settingsSync.js
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
function createDeviceId() {
  const random = typeof crypto !== "undefined" && crypto?.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
  return `device_${Date.now().toString(36)}_${random}`;
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
      deviceId: typeof meta.deviceId === "string" && meta.deviceId ? meta.deviceId : createDeviceId()
    }
  });
}
async function ensureDeviceId(meta = null) {
  const current = meta || await readLocalMeta();
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
async function readRemoteSettingsSyncSnapshot() {
  const storedManifest = await storageGet("sync", SETTINGS_SYNC_MANIFEST_STORAGE_KEY);
  const manifest = storedManifest?.[SETTINGS_SYNC_MANIFEST_STORAGE_KEY];
  if (!manifest || !Number.isInteger(manifest.chunkCount)) return null;
  const keys = Array.from(
    { length: manifest.chunkCount },
    (_, index) => getSettingsChunkKey(index)
  );
  const storedChunks = await storageGet("sync", keys);
  return parseSettingsSnapshot(manifest, keys.map((key) => storedChunks?.[key]));
}
async function writeLocalSettingsFilters(filters) {
  await storageSet("local", {
    [FILTERS_STORAGE_KEY]: JSON.stringify(normalizeSettingsFilters(filters))
  });
}
async function scheduleSettingsSync(filtersInput, { immediate = false } = {}) {
  if (!hasChromeStorageArea("sync") || !hasChromeStorageArea("local")) return;
  const meta = await readLocalMeta();
  if (!immediate && !meta.remoteHash && !meta.syncedHash) return;
  const localHash = settingsFingerprint(filtersInput);
  if (localHash === meta.localHash && !immediate) return;
  const now = Date.now();
  const dueAt = immediate ? now : now + SYNC_DEBOUNCE_MS;
  await writeLocalMeta({
    ...meta,
    deviceId: await ensureDeviceId(meta),
    localHash,
    localUpdatedAt: now,
    baseRemoteHash: meta.pending ? meta.baseRemoteHash || null : meta.remoteHash || meta.syncedHash || null,
    pending: true,
    pendingSince: meta.pendingSince || now,
    flushAfter: dueAt,
    lastError: null
  });
  await scheduleAlarm(dueAt);
}
async function resolveRemoteSettingsSyncFilters(localFiltersInput) {
  const localFilters = normalizeSettingsFilters(localFiltersInput);
  const meta = await readLocalMeta();
  if (meta.pending) {
    await scheduleAlarm(
      normalizeSyncTimestamp(meta.flushAfter) || Date.now() + SYNC_DEBOUNCE_MS
    );
  }
  const remote = await readRemoteSettingsSyncSnapshot();
  if (!remote) {
    return { filters: localFilters, imported: false };
  }
  const localUpdatedAt = normalizeSyncTimestamp(meta.localUpdatedAt);
  const shouldImport = !meta.pending && (localUpdatedAt <= 0 || remote.updatedAt > localUpdatedAt);
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
    lastError: null
  });
  return { filters: remote.filters, imported: true };
}

// src/filterStorage.js
var STORAGE_KEYS = {
  filters: FILTERS_STORAGE_KEY,
  autoCollect: AUTO_COLLECT_STORAGE_KEY
};
var DEFAULT_FILTERS2 = Object.freeze({
  global: { noShorts: true },
  channels: {}
});
var hasChromeStorage2 = typeof chrome !== "undefined" && chrome?.storage?.local;
var filtersCache = null;
var autoCollectLastRun = null;
function asValidDate(value) {
  const candidate = value instanceof Date ? new Date(value.getTime()) : typeof value === "number" || typeof value === "string" ? new Date(value) : null;
  return candidate && !Number.isNaN(candidate.getTime()) ? candidate : null;
}
function updateAutoCollectLastRun(meta) {
  const candidate = meta && typeof meta === "object" ? meta.lastRunAt ?? meta : meta;
  autoCollectLastRun = asValidDate(candidate);
}
function cloneDefaultFilters2() {
  return {
    global: { ...DEFAULT_FILTERS2.global },
    channels: {}
  };
}
function normalizeFilters(raw) {
  return normalizeSettingsFilters(raw);
}
function parseStoredFilters(raw) {
  if (!raw) return cloneDefaultFilters2();
  try {
    return normalizeFilters(typeof raw === "string" ? JSON.parse(raw) : raw);
  } catch {
    return cloneDefaultFilters2();
  }
}
var chromeGet = (keys) => new Promise((resolve) => chrome.storage.local.get(keys, (data) => resolve(data || {})));
var chromeSet = (payload) => new Promise((resolve) => chrome.storage.local.set(payload, resolve));
if (hasChromeStorage2 && chrome.storage?.onChanged) {
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
function getFiltersLastSaved() {
  return asValidDate(autoCollectLastRun);
}
async function getFilters() {
  if (filtersCache) {
    return filtersCache;
  }
  if (!hasChromeStorage2) {
    filtersCache = cloneDefaultFilters2();
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
async function saveFilters(filters) {
  filtersCache = normalizeFilters(filters);
  if (!hasChromeStorage2) {
    return;
  }
  await chromeSet({ [STORAGE_KEYS.filters]: JSON.stringify(filtersCache) });
  await scheduleSettingsSync(filtersCache);
}

// src/settings/shared/format.js
function toTimeStr(sec) {
  if (sec === void 0 || sec === null || sec === Infinity) return "";
  const h = Math.floor(sec / 3600).toString().padStart(2, "0");
  const m = Math.floor(sec % 3600 / 60).toString().padStart(2, "0");
  const s = Math.floor(sec % 60).toString().padStart(2, "0");
  return `${h}:${m}:${s}`;
}
function parseTime(str) {
  if (!str) return 0;
  const parts = str.split(":").map((p) => parseInt(p, 10));
  if (parts.some((n) => Number.isNaN(n))) return 0;
  let sec = 0;
  if (parts.length === 3) sec = parts[0] * 3600 + parts[1] * 60 + parts[2];
  else if (parts.length === 2) sec = parts[0] * 60 + parts[1];
  else if (parts.length === 1) sec = parts[0];
  return sec;
}
function toLocalInputValue(date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 6e4);
  return local.toISOString().slice(0, 16);
}
function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "";
  return date.toLocaleString("ru");
}
function isShortVideo(info) {
  if (!info) return false;
  if (typeof info.duration === "string") {
    const sec = parseDuration(info.duration);
    if (typeof sec === "number" && sec > 0 && sec < 60) {
      return true;
    }
  }
  if (Array.isArray(info.tags) && info.tags.some((tag) => /shorts?/i.test(tag))) {
    return true;
  }
  if (typeof info.title === "string") {
    return info.title.toLowerCase().includes("#short");
  }
  return false;
}

// src/settings/shared/runtime.js
function sendRuntimeMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, resolve);
  });
}
function getSubscriptionsMeta() {
  return sendRuntimeMessage({ type: "subscriptions:getMeta" }).then(
    (res) => res?.meta || {}
  );
}
function setStartDate(date) {
  return sendRuntimeMessage({
    type: "setStartDate",
    date: date.toISOString()
  }).then((res) => Boolean(res?.ok));
}
function getVideoDate(videoId) {
  return sendRuntimeMessage({ type: "videoDate", videoId }).then(
    (response) => response?.date || null
  );
}
function getVideoInfo2(videoId) {
  return sendRuntimeMessage({ type: "videoInfo", videoId });
}
function getSyncStatus({ refreshRemote = false } = {}) {
  return sendRuntimeMessage({ type: "sync:getStatus", refreshRemote });
}
function pullRemoteSync() {
  return sendRuntimeMessage({ type: "sync:pullRemote" });
}
function pushLocalSync() {
  return sendRuntimeMessage({ type: "sync:pushLocal" });
}
function replaceLocalFromRemoteSync() {
  return sendRuntimeMessage({ type: "sync:replaceLocalFromRemote" });
}

// src/settings/shared/saveUi.js
var toastTimer = null;
function showToast(text, isError = false) {
  const toast = document.getElementById("saveToast");
  if (!toast) return;
  toast.textContent = text;
  toast.className = `notification ${isError ? "is-danger" : "is-success"} is-light`;
  toast.style.display = "";
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.style.display = "none";
    toastTimer = null;
  }, 3e3);
}
function updateLastSaveDisplay(lastSaveInfo) {
  const savedTime = getFiltersLastSaved();
  const text = savedTime ? `\u041F\u043E\u0441\u043B\u0435\u0434\u043D\u0435\u0435 \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u0438\u0435: ${savedTime.toLocaleString()}` : "\u0418\u0437\u043C\u0435\u043D\u0435\u043D\u0438\u044F \u0435\u0449\u0451 \u043D\u0435 \u0441\u043E\u0445\u0440\u0430\u043D\u044F\u043B\u0438\u0441\u044C";
  if (lastSaveInfo) {
    lastSaveInfo.textContent = text;
  }
}
function createSaveUiState(saveButtons) {
  let hasUnsavedChanges = false;
  let isSaving = false;
  let pendingChangesDuringSave = false;
  function updateSaveButtons() {
    const shouldHide = !hasUnsavedChanges;
    saveButtons.forEach((btn) => {
      if (!btn) return;
      btn.classList.toggle("is-hidden", shouldHide);
      btn.disabled = shouldHide || isSaving;
      btn.classList.toggle("is-loading", isSaving);
    });
  }
  function setUnsavedChanges(value) {
    if (!value) {
      pendingChangesDuringSave = false;
    }
    if (hasUnsavedChanges === value) return;
    hasUnsavedChanges = value;
    updateSaveButtons();
  }
  function markUnsaved() {
    if (isSaving) {
      pendingChangesDuringSave = true;
    }
    if (!hasUnsavedChanges) {
      setUnsavedChanges(true);
    }
  }
  function setSaving(value) {
    isSaving = Boolean(value);
    updateSaveButtons();
  }
  function consumePendingChangesDuringSave() {
    const pending = pendingChangesDuringSave;
    pendingChangesDuringSave = false;
    return pending;
  }
  return {
    consumePendingChangesDuringSave,
    isSaving: () => isSaving,
    markUnsaved,
    setSaving,
    setUnsavedChanges,
    updateSaveButtons
  };
}

// src/settings/shared/syncStatusView.js
function formatDate(value) {
  const ts = Number(value) || 0;
  if (ts <= 0) return "\u043D\u0435\u0442";
  const date = new Date(ts);
  return Number.isNaN(date.getTime()) ? "\u043D\u0435\u0442" : date.toLocaleString();
}
function formatOffset(value, baseValue) {
  const ts = Number(value) || 0;
  const baseTs = Number(baseValue) || 0;
  if (ts <= 0 || baseTs <= 0) return "";
  const deltaMs = ts - baseTs;
  const absSeconds = Math.round(Math.abs(deltaMs) / 1e3);
  const sign = deltaMs >= 0 ? "+" : "-";
  if (absSeconds < 60) return `${sign}${absSeconds} \u0441\u0435\u043A.`;
  const absMinutes = Math.round(absSeconds / 60);
  if (absMinutes < 60) return `${sign}${absMinutes} \u043C\u0438\u043D.`;
  const absHours = Math.round(absMinutes / 60);
  if (absHours < 24) return `${sign}${absHours} \u0447.`;
  const absDays = Math.round(absHours / 24);
  return `${sign}${absDays} \u0434\u043D.`;
}
function maxTimestamp(...values) {
  return Math.max(...values.map((value) => Number(value) || 0), 0);
}
function describeSyncState(localUpdatedAt, remoteUpdatedAt, pending) {
  if (!remoteUpdatedAt) return "\u041E\u0431\u043B\u0430\u0447\u043D\u043E\u0439 \u0432\u0435\u0440\u0441\u0438\u0438 \u043F\u043E\u043A\u0430 \u043D\u0435\u0442.";
  if (pending || localUpdatedAt > remoteUpdatedAt + 1e3) {
    return "\u0415\u0441\u0442\u044C \u043B\u043E\u043A\u0430\u043B\u044C\u043D\u044B\u0435 \u0438\u0437\u043C\u0435\u043D\u0435\u043D\u0438\u044F, \u0441\u0442\u043E\u0438\u0442 \u043E\u0442\u043F\u0440\u0430\u0432\u0438\u0442\u044C \u0438\u0445 \u0432 \u043E\u0431\u043B\u0430\u043A\u043E.";
  }
  if (remoteUpdatedAt > localUpdatedAt + 1e3) {
    return "\u041E\u0431\u043B\u0430\u0447\u043D\u0430\u044F \u0432\u0435\u0440\u0441\u0438\u044F \u0441\u0432\u0435\u0436\u0435\u0435 \u043B\u043E\u043A\u0430\u043B\u044C\u043D\u044B\u0445 \u0434\u0430\u043D\u043D\u044B\u0445.";
  }
  return "\u041B\u043E\u043A\u0430\u043B\u044C\u043D\u043E\u0435 \u0441\u043E\u0441\u0442\u043E\u044F\u043D\u0438\u0435 \u0441\u043E\u0432\u043F\u0430\u0434\u0430\u0435\u0442 \u0441 \u043E\u0431\u043B\u0430\u0447\u043D\u043E\u0439 \u0432\u0435\u0440\u0441\u0438\u0435\u0439.";
}
function createRow(doc, label, value, className = "") {
  const row = doc.createElement("div");
  row.className = `sync-status__row${className ? ` ${className}` : ""}`;
  const labelEl = doc.createElement("span");
  labelEl.className = "sync-status__label";
  labelEl.textContent = label;
  const valueEl = doc.createElement("span");
  valueEl.className = "sync-status__value";
  valueEl.textContent = value;
  row.append(labelEl, valueEl);
  return row;
}
function createDateOffsetRow(doc, label, value, baseValue) {
  const row = doc.createElement("div");
  row.className = "sync-status__row";
  const labelEl = doc.createElement("span");
  labelEl.className = "sync-status__label";
  labelEl.textContent = label;
  const valueEl = doc.createElement("span");
  valueEl.className = "sync-status__value";
  const dateEl = doc.createElement("span");
  dateEl.className = "sync-status__date";
  dateEl.textContent = formatDate(value);
  valueEl.appendChild(dateEl);
  const offsetText = formatOffset(value, baseValue);
  if (offsetText) {
    const offsetEl = doc.createElement("span");
    offsetEl.className = "sync-status__offset";
    offsetEl.textContent = `(${offsetText})`;
    valueEl.appendChild(offsetEl);
  }
  row.append(labelEl, valueEl);
  return row;
}
function friendlyErrors(status) {
  const raw = [
    status?.playlist?.lastError,
    status?.settings?.lastError,
    status?.drive?.lastError
  ].filter(Boolean);
  return raw.map((error) => {
    const text = String(error);
    if (text.includes("403")) {
      return "Google Drive \u043E\u0442\u043A\u043B\u043E\u043D\u0438\u043B \u0434\u043E\u0441\u0442\u0443\u043F. \u041F\u0440\u043E\u0432\u0435\u0440\u044C\u0442\u0435 OAuth/Drive API.";
    }
    if (text.includes("not initialized")) {
      return "\u041E\u0431\u043B\u0430\u0447\u043D\u0430\u044F \u0432\u0435\u0440\u0441\u0438\u044F \u0435\u0449\u0451 \u043D\u0435 \u0441\u043E\u0437\u0434\u0430\u043D\u0430.";
    }
    return text;
  });
}
function renderSyncStatus(target, status, message = "") {
  if (!target) return;
  const doc = target.ownerDocument;
  const playlist = status?.playlist || {};
  const settings = status?.settings || {};
  const drive = status?.drive || {};
  const localUpdatedAt = maxTimestamp(
    playlist.localUpdatedAt,
    settings.localUpdatedAt
  );
  const remoteUpdatedAt = Number(drive.remoteUpdatedAt) || 0;
  const pending = Boolean(playlist.pending || settings.pending);
  const errors = friendlyErrors(status);
  target.textContent = "";
  target.className = `sync-status${errors.length ? " sync-status--error" : ""}`;
  if (message) {
    const messageEl = doc.createElement("div");
    messageEl.className = "sync-status__message";
    messageEl.textContent = message;
    target.appendChild(messageEl);
  }
  const summary = doc.createElement("div");
  summary.className = "sync-status__summary";
  const summaryText = doc.createElement("span");
  summaryText.textContent = describeSyncState(localUpdatedAt, remoteUpdatedAt, pending);
  const refresh = doc.createElement("button");
  refresh.id = "refreshSyncStatus";
  refresh.type = "button";
  refresh.className = "sync-status__refresh";
  refresh.title = "\u041E\u0431\u043D\u043E\u0432\u0438\u0442\u044C \u0441\u0442\u0430\u0442\u0443\u0441 \u043E\u0431\u043B\u0430\u043A\u0430";
  refresh.setAttribute("aria-label", refresh.title);
  refresh.textContent = "\u21BB";
  summary.append(summaryText, refresh);
  target.appendChild(summary);
  target.append(
    createRow(doc, "\u041B\u043E\u043A\u0430\u043B\u044C\u043D\u043E", formatDate(localUpdatedAt)),
    createDateOffsetRow(doc, "\u041E\u0442\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u043E", drive.lastWriteAt, localUpdatedAt),
    createDateOffsetRow(doc, "\u0412 \u043E\u0431\u043B\u0430\u043A\u0435", remoteUpdatedAt, localUpdatedAt),
    createDateOffsetRow(doc, "\u041F\u0440\u043E\u0432\u0435\u0440\u0435\u043D\u043E", drive.lastReadAt, localUpdatedAt)
  );
  errors.forEach((error) => {
    target.appendChild(createRow(doc, "\u041F\u0440\u043E\u0431\u043B\u0435\u043C\u0430", error, "sync-status__row--error"));
  });
}

// src/settings/filters/rows.js
var playlistCache = {};
var playlistMembershipCache = /* @__PURE__ */ new Map();
function createDurationRow(min = 0, max = Infinity) {
  const template = document.getElementById("durationRowTemplate");
  const row = template.content.firstElementChild.cloneNode(true);
  if (min) row.querySelector(".from").value = toTimeStr(min);
  if (max !== Infinity) row.querySelector(".to").value = toTimeStr(max);
  return row;
}
function createTextRow(type, value = "") {
  const template = document.getElementById("textRowTemplate");
  const row = template.content.firstElementChild.cloneNode(true);
  row.dataset.type = type;
  row.querySelector("input").value = value;
  return row;
}
async function createPlaylistRow(channelId, value = "") {
  const template = document.getElementById("playlistRowTemplate");
  const row = template.content.firstElementChild.cloneNode(true);
  const select = row.querySelector("select");
  const playlists = await getChannelPlaylists(channelId);
  playlists.forEach((pl) => {
    const opt = document.createElement("option");
    opt.value = pl.id;
    opt.textContent = pl.title;
    select.appendChild(opt);
  });
  select.value = value;
  return row;
}
async function getChannelPlaylists(channelId) {
  if (!channelId) return [];
  if (!playlistCache[channelId]) {
    playlistCache[channelId] = await listChannelPlaylists(channelId);
  }
  return Array.isArray(playlistCache[channelId]) ? playlistCache[channelId] : [];
}
async function findVideoPlaylists(channelId, videoId) {
  if (!channelId || !videoId) return [];
  const key = `${channelId}:${videoId}`;
  if (playlistMembershipCache.has(key)) {
    return playlistMembershipCache.get(key);
  }
  const playlists = await getChannelPlaylists(channelId);
  const result = [];
  for (const playlist of playlists) {
    try {
      if (await isVideoInPlaylist(videoId, playlist.id)) {
        result.push(playlist);
      }
    } catch (err) {
      console.error(
        "Failed to check playlist membership",
        playlist.id,
        videoId,
        err
      );
    }
  }
  playlistMembershipCache.set(key, result);
  return result;
}
function createGroup(labelText, type, rows, createRowFn, onChanged) {
  const template = document.getElementById("filterGroupTemplate");
  const group = template.content.firstElementChild.cloneNode(true);
  group.dataset.type = type;
  const header = group.querySelector(".group-header");
  const lab = header.querySelector("span");
  const addBtn = header.querySelector(".add-row");
  const list = group.querySelector(".rows-wrap");
  lab.textContent = labelText;
  function checkHeader() {
    const hasRows = list.children.length > 0;
    header.style.display = hasRows ? "" : "none";
    group.style.display = hasRows ? "" : "none";
  }
  async function addRow(r, silent = false) {
    const node = await createRowFn(r);
    list.appendChild(node);
    checkHeader();
    if (!silent) onChanged?.();
  }
  addBtn.addEventListener("click", () => {
    addRow();
  });
  rows.forEach((r) => {
    addRow(r, true);
  });
  list.addEventListener("click", (e) => {
    if (e.target.closest(".remove-row")) {
      e.target.closest(".filter-row").remove();
      checkHeader();
      onChanged?.();
    }
  });
  checkHeader();
  group.__addRowWithData = addRow;
  return {
    group,
    list,
    add: () => {
      addBtn.click();
    }
  };
}

// src/settings/video-check/resultView.js
function renderCheckVideoResult({
  chFilters,
  checkVideoResult,
  durationSeconds,
  info,
  quickFilter,
  reason,
  tags
}) {
  const layout = document.createElement("div");
  layout.className = "quick-filter-layout";
  const infoColumn = document.createElement("div");
  infoColumn.className = "quick-filter-info";
  const builderColumn = document.createElement("div");
  builderColumn.className = "quick-filter-builder";
  layout.appendChild(infoColumn);
  layout.appendChild(builderColumn);
  checkVideoResult.appendChild(layout);
  const addLine = (label, value) => {
    if (value === void 0 || value === null) return null;
    const row = document.createElement("div");
    row.className = "mb-1";
    const b = document.createElement("b");
    b.textContent = label + ": ";
    row.appendChild(b);
    const span = document.createElement("span");
    if (Array.isArray(value)) {
      span.textContent = value.map((v) => `"${v}"`).join(", ");
    } else if (value instanceof Node) {
      span.appendChild(value);
    } else {
      span.textContent = value;
    }
    row.appendChild(span);
    infoColumn.appendChild(row);
    return span;
  };
  const reasonMap = {
    short: "\u043A\u043E\u0440\u043E\u0442\u043A\u043E\u0435 \u0432\u0438\u0434\u0435\u043E",
    broadcast: "\u0442\u0440\u0430\u043D\u0441\u043B\u044F\u0446\u0438\u044F",
    title: "\u0444\u0438\u043B\u044C\u0442\u0440 \u043F\u043E \u043D\u0430\u0437\u0432\u0430\u043D\u0438\u044E",
    tag: "\u0444\u0438\u043B\u044C\u0442\u0440 \u043F\u043E \u0442\u0435\u0433\u0443",
    duration: "\u0434\u043B\u0438\u0442\u0435\u043B\u044C\u043D\u043E\u0441\u0442\u044C",
    playlist: "\u0441\u0442\u043E\u043F-\u043B\u0438\u0441\u0442"
  };
  const verdict = document.createElement("div");
  verdict.className = `notification mb-2 ${reason ? "is-warning" : "is-info"}`;
  verdict.innerHTML = reason ? `<b>\u0411\u0443\u0434\u0435\u0442 \u043E\u0442\u0444\u0438\u043B\u044C\u0442\u0440\u043E\u0432\u0430\u043D\u043E:</b> ${reasonMap[reason] || reason}` : "<b>\u041D\u0435 \u0431\u0443\u0434\u0435\u0442 \u043E\u0442\u0444\u0438\u043B\u044C\u0442\u0440\u043E\u0432\u0430\u043D\u043E</b>";
  if (reason === "tag" && chFilters.tags?.length) {
    const d = document.createElement("div");
    d.textContent = `\u0422\u0435\u0433\u0438 \u0444\u0438\u043B\u044C\u0442\u0440\u043E\u0432: ${chFilters.tags.map((t) => `"${t}"`).join(", ")}`;
    verdict.appendChild(d);
  } else if (reason === "title" && chFilters.title?.length) {
    const d = document.createElement("div");
    d.textContent = `\u0424\u0438\u043B\u044C\u0442\u0440\u044B \u043D\u0430\u0437\u0432\u0430\u043D\u0438\u044F: ${chFilters.title.map((t) => `"${t}"`).join(", ")}`;
    verdict.appendChild(d);
  }
  infoColumn.appendChild(verdict);
  if (info.id) {
    const videoLink = document.createElement("a");
    videoLink.href = `https://www.youtube.com/watch?v=${info.id}`;
    videoLink.target = "_blank";
    videoLink.rel = "noopener noreferrer";
    videoLink.textContent = info.id;
    addLine("ID", videoLink);
  }
  if (info.channelTitle || info.channelId) {
    const fragment = document.createDocumentFragment();
    if (info.channelId) {
      const channelLink = document.createElement("a");
      channelLink.href = `https://www.youtube.com/channel/${info.channelId}`;
      channelLink.target = "_blank";
      channelLink.rel = "noopener noreferrer";
      channelLink.textContent = info.channelTitle || info.channelId;
      fragment.appendChild(channelLink);
      if (info.channelTitle && info.channelId) {
        fragment.appendChild(
          document.createTextNode(` (${info.channelId})`)
        );
      }
    } else {
      fragment.appendChild(document.createTextNode(info.channelTitle));
    }
    addLine("\u041A\u0430\u043D\u0430\u043B", fragment);
  }
  const originalTitle = typeof info.title === "string" ? info.title.trim() : "";
  if (originalTitle) {
    const titleButton = document.createElement("button");
    titleButton.type = "button";
    titleButton.className = "video-info-action";
    titleButton.textContent = info.title;
    titleButton.title = "\u0418\u0441\u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u044C \u043D\u0430\u0437\u0432\u0430\u043D\u0438\u0435 \u0432 \u0444\u0438\u043B\u044C\u0442\u0440\u0435";
    titleButton.setAttribute("aria-pressed", "false");
    let titleActive = false;
    titleButton.addEventListener("click", () => {
      if (titleActive) {
        quickFilter.setTitle("");
      } else {
        quickFilter.setTitle(info.title);
      }
    });
    quickFilter.subscribeTitle((current) => {
      const normalized = (current || "").trim().toLowerCase();
      const matches = normalized && normalized === originalTitle.toLowerCase();
      titleActive = Boolean(matches);
      titleButton.classList.toggle("is-active", Boolean(matches));
      titleButton.setAttribute(
        "aria-pressed",
        matches ? "true" : "false"
      );
    });
    addLine("\u041D\u0430\u0437\u0432\u0430\u043D\u0438\u0435", titleButton);
  } else {
    addLine("\u041D\u0430\u0437\u0432\u0430\u043D\u0438\u0435", info.title);
  }
  if (tags.length) {
    const row = document.createElement("div");
    row.className = "mb-1";
    const label = document.createElement("b");
    label.textContent = "\u0422\u0435\u0433\u0438: ";
    row.appendChild(label);
    const tagsWrap = document.createElement("span");
    tagsWrap.className = "video-info-tags";
    tags.forEach((tag) => {
      const tagBtn = document.createElement("button");
      tagBtn.type = "button";
      tagBtn.className = "video-info-action video-info-tag";
      tagBtn.textContent = tag;
      tagBtn.title = "\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u0442\u0435\u0433 \u0432 \u0444\u0438\u043B\u044C\u0442\u0440";
      tagBtn.setAttribute("aria-pressed", "false");
      const toggle = () => {
        const selected = quickFilter.toggleTag(tag);
        tagBtn.classList.toggle("is-active", selected);
        tagBtn.setAttribute("aria-pressed", selected ? "true" : "false");
      };
      tagBtn.addEventListener("click", toggle);
      quickFilter.subscribeTag(tag, (selected) => {
        tagBtn.classList.toggle("is-active", selected);
        tagBtn.setAttribute("aria-pressed", selected ? "true" : "false");
      });
      tagsWrap.appendChild(tagBtn);
    });
    row.appendChild(tagsWrap);
    infoColumn.appendChild(row);
  }
  if (durationSeconds) {
    const durationRow = document.createElement("div");
    durationRow.className = "mb-1";
    const label = document.createElement("b");
    label.textContent = "\u0414\u043B\u0438\u0442\u0435\u043B\u044C\u043D\u043E\u0441\u0442\u044C: ";
    durationRow.appendChild(label);
    const durationButton = document.createElement("button");
    durationButton.type = "button";
    durationButton.className = "video-info-action";
    const durationStr = toTimeStr(durationSeconds);
    durationButton.textContent = durationStr;
    durationButton.setAttribute("aria-pressed", "false");
    let durationActive = false;
    durationButton.addEventListener("click", () => {
      if (durationActive) {
        quickFilter.clearDuration();
      } else {
        quickFilter.setDurationFromSeconds(durationSeconds);
      }
    });
    quickFilter.subscribeDuration(({ min, max }) => {
      const active = Number.isFinite(min) && Number.isFinite(max) && min === durationSeconds && max === durationSeconds;
      durationActive = Boolean(active);
      durationButton.classList.toggle("is-active", Boolean(active));
      durationButton.setAttribute(
        "aria-pressed",
        active ? "true" : "false"
      );
    });
    durationRow.appendChild(durationButton);
    infoColumn.appendChild(durationRow);
  } else if (info.duration) {
    const parsed = parseDuration(info.duration);
    addLine(
      "\u0414\u043B\u0438\u0442\u0435\u043B\u044C\u043D\u043E\u0441\u0442\u044C",
      Number.isFinite(parsed) && parsed > 0 ? toTimeStr(parsed) : info.duration
    );
  }
  if (info.publishedAt)
    addLine("\u041E\u043F\u0443\u0431\u043B\u0438\u043A\u043E\u0432\u0430\u043D\u043E", formatDateTime(info.publishedAt));
  addLine("Shorts", isShortVideo(info) ? "\u0414\u0430" : "\u041D\u0435\u0442");
  const isBroadcast = typeof info.liveBroadcastContent === "string" && info.liveBroadcastContent !== "none" || Boolean(info.liveStreamingDetails?.actualStartTime);
  addLine("\u0422\u0440\u0430\u043D\u0441\u043B\u044F\u0446\u0438\u044F", isBroadcast ? "\u0414\u0430" : "\u041D\u0435\u0442");
  const scheduled = info.liveStreamingDetails?.scheduledStartTime;
  if (scheduled) addLine("\u0417\u0430\u043F\u043B\u0430\u043D\u0438\u0440\u043E\u0432\u0430\u043D\u043E", formatDateTime(scheduled));
  const actual = info.liveStreamingDetails?.actualStartTime;
  if (actual) addLine("\u041D\u0430\u0447\u0430\u043B\u043E \u0442\u0440\u0430\u043D\u0441\u043B\u044F\u0446\u0438\u0438", formatDateTime(actual));
  if (info.description) {
    const descriptionRow = document.createElement("div");
    descriptionRow.className = "mb-1 video-description-row";
    const label = document.createElement("b");
    label.textContent = "\u041E\u043F\u0438\u0441\u0430\u043D\u0438\u0435:";
    descriptionRow.appendChild(label);
    descriptionRow.appendChild(document.createTextNode(" "));
    const toggle = document.createElement("span");
    toggle.className = "video-description-toggle";
    toggle.textContent = "[\u043F\u043E\u043A\u0430\u0437\u0430\u0442\u044C]";
    toggle.style.cursor = "pointer";
    toggle.style.userSelect = "none";
    toggle.style.marginLeft = "0";
    toggle.style.fontWeight = "normal";
    toggle.style.color = "#3273dc";
    toggle.style.textDecoration = "underline";
    descriptionRow.appendChild(toggle);
    const descriptionBody = document.createElement("pre");
    descriptionBody.textContent = info.description;
    descriptionBody.className = "video-description-body";
    descriptionBody.style.whiteSpace = "pre-wrap";
    descriptionBody.style.margin = "0";
    descriptionBody.style.display = "none";
    descriptionRow.appendChild(descriptionBody);
    let isOpen = false;
    const updateToggle = () => {
      toggle.textContent = isOpen ? "[\u0441\u043A\u0440\u044B\u0442\u044C]" : "[\u043F\u043E\u043A\u0430\u0437\u0430\u0442\u044C]";
      descriptionBody.style.display = isOpen ? "block" : "none";
    };
    toggle.addEventListener("click", () => {
      isOpen = !isOpen;
      updateToggle();
    });
    toggle.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        isOpen = !isOpen;
        updateToggle();
      }
    });
    toggle.setAttribute("role", "button");
    toggle.setAttribute("tabindex", "0");
    updateToggle();
    infoColumn.appendChild(descriptionRow);
  }
  if (quickFilter?.element) {
    builderColumn.appendChild(quickFilter.element);
  }
  if (info.channelId) {
    quickFilter.setPlaylistOptions([], "\u0417\u0430\u0433\u0440\u0443\u0437\u043A\u0430 \u043F\u043B\u0435\u0439\u043B\u0438\u0441\u0442\u043E\u0432...");
    getChannelPlaylists(info.channelId).then((allPlaylists) => {
      if (Array.isArray(allPlaylists) && allPlaylists.length) {
        quickFilter.setPlaylistOptions(allPlaylists);
      } else {
        quickFilter.setPlaylistOptions([], "\u041F\u043B\u0435\u0439\u043B\u0438\u0441\u0442\u044B \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u044B");
      }
    }).catch((err) => {
      console.error("Failed to load channel playlists", err);
      quickFilter.setPlaylistOptions(
        [],
        "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044C \u043F\u043B\u0435\u0439\u043B\u0438\u0441\u0442\u044B"
      );
    });
  } else {
    quickFilter.setPlaylistOptions(
      [],
      "\u041F\u043B\u0435\u0439\u043B\u0438\u0441\u0442\u044B \u0434\u043E\u0441\u0442\u0443\u043F\u043D\u044B \u0442\u043E\u043B\u044C\u043A\u043E \u0434\u043B\u044F \u043A\u0430\u043D\u0430\u043B\u043E\u0432"
    );
  }
  const playlistsContainer = document.createElement("span");
  playlistsContainer.className = "video-info-playlists";
  const initialPlaylistLabel = document.createElement("span");
  initialPlaylistLabel.textContent = info.channelId ? "\u0417\u0430\u0433\u0440\u0443\u0437\u043A\u0430..." : "\u041D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u043D\u043E";
  playlistsContainer.appendChild(initialPlaylistLabel);
  addLine("\u0421\u043E\u0441\u0442\u043E\u0438\u0442 \u0432 \u043F\u043B\u0435\u0439\u043B\u0438\u0441\u0442\u0430\u0445", playlistsContainer);
  if (info.channelId && info.id) {
    findVideoPlaylists(info.channelId, info.id).then((playlists) => {
      playlistsContainer.innerHTML = "";
      if (!playlists.length) {
        const none = document.createElement("span");
        none.textContent = "\u041D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u043E";
        playlistsContainer.appendChild(none);
        return;
      }
      playlists.forEach((playlist) => {
        const item = document.createElement("span");
        item.className = "video-info-playlist";
        const link = document.createElement("a");
        link.href = `https://www.youtube.com/playlist?list=${playlist.id}`;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = playlist.title || playlist.id;
        item.appendChild(link);
        const useBtn = document.createElement("button");
        useBtn.type = "button";
        useBtn.className = "video-info-action video-info-action--icon";
        useBtn.title = "\u0418\u0441\u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u044C \u043F\u043B\u0435\u0439\u043B\u0438\u0441\u0442 \u0432 \u0444\u0438\u043B\u044C\u0442\u0440\u0435";
        useBtn.setAttribute(
          "aria-label",
          "\u0418\u0441\u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u044C \u043F\u043B\u0435\u0439\u043B\u0438\u0441\u0442 \u0432 \u0444\u0438\u043B\u044C\u0442\u0440\u0435"
        );
        useBtn.innerHTML = '<span class="icon"><svg width="1.25em" height="1.25em"><use href="icons.svg#icon-plus"></use></svg></span>';
        useBtn.setAttribute("aria-pressed", "false");
        useBtn.addEventListener("click", () => {
          quickFilter.usePlaylist(playlist.id);
        });
        quickFilter.subscribePlaylist(playlist.id, (selected) => {
          useBtn.classList.toggle("is-active", selected);
          useBtn.setAttribute("aria-pressed", selected ? "true" : "false");
        });
        item.appendChild(useBtn);
        playlistsContainer.appendChild(item);
      });
    }).catch((err) => {
      console.error("Failed to load channel playlists", err);
      playlistsContainer.innerHTML = "";
      const error = document.createElement("span");
      error.textContent = "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044C";
      playlistsContainer.appendChild(error);
    });
  }
}

// src/settings/filters/mutations.js
async function addTextFilterToSection(section, type, value) {
  if (!section || !value) return false;
  const group = section.querySelector(`.filter-group[data-type="${type}"]`);
  if (!group) return false;
  const list = group.querySelector(".rows-wrap");
  if (!list) return false;
  const normalized = value.trim();
  if (!normalized) return false;
  const normalizedLower = normalized.toLowerCase();
  const existingRows = Array.from(list.querySelectorAll(".filter-row")).filter((row) => row.dataset.type === type);
  if (existingRows.some(
    (row) => row.querySelector("input")?.value.trim().toLowerCase() === normalizedLower
  )) {
    return false;
  }
  const addRowFn = group.__addRowWithData;
  if (typeof addRowFn === "function") {
    await addRowFn(normalized);
  } else {
    group.querySelector(".add-row")?.click();
  }
  const newRows = Array.from(list.querySelectorAll(".filter-row")).filter((row) => row.dataset.type === type);
  const newRow = newRows[newRows.length - 1];
  if (!newRow) return false;
  const input = newRow.querySelector("input");
  if (!input) return false;
  if (input.value.trim().toLowerCase() !== normalizedLower) {
    input.value = normalized;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }
  return true;
}
async function addDurationFilterToSection(section, minSeconds, maxSeconds) {
  if (!section) return false;
  const group = section.querySelector('.filter-group[data-type="duration"]');
  if (!group) return false;
  const list = group.querySelector(".rows-wrap");
  if (!list) return false;
  let normalizedMin = Number.isFinite(minSeconds) && minSeconds > 0 ? Math.max(minSeconds, 0) : 0;
  let normalizedMax = Number.isFinite(maxSeconds) && maxSeconds >= 0 ? Math.max(maxSeconds, 0) : Infinity;
  if (normalizedMax !== Infinity && normalizedMax < normalizedMin) {
    const temp = normalizedMax;
    normalizedMax = normalizedMin;
    normalizedMin = temp;
  }
  if (normalizedMin === 0 && normalizedMax === Infinity) {
    return false;
  }
  const rows = Array.from(
    list.querySelectorAll('.filter-row[data-type="duration"]')
  );
  const hasSame = rows.some((row) => {
    const fromInput2 = row.querySelector(".from");
    const toInput2 = row.querySelector(".to");
    if (!fromInput2 || !toInput2) return false;
    const existingMin = fromInput2.value ? parseTime(fromInput2.value) : 0;
    const toValue = toInput2.value;
    const existingMax = toValue ? parseTime(toValue) : Infinity;
    return existingMin === normalizedMin && existingMax === normalizedMax;
  });
  if (hasSame) {
    return false;
  }
  const addRowFn = group.__addRowWithData;
  if (typeof addRowFn === "function") {
    await addRowFn({ min: normalizedMin, max: normalizedMax });
  } else {
    group.querySelector(".add-row")?.click();
  }
  const newRows = Array.from(
    list.querySelectorAll('.filter-row[data-type="duration"]')
  );
  const newRow = newRows[newRows.length - 1];
  if (!newRow) return false;
  const fromInput = newRow.querySelector(".from");
  const toInput = newRow.querySelector(".to");
  if (!fromInput || !toInput) return false;
  const expectedMin = normalizedMin ? toTimeStr(normalizedMin) : "";
  const expectedMax = normalizedMax !== Infinity ? toTimeStr(normalizedMax) : "";
  if (fromInput.value !== expectedMin) {
    fromInput.value = expectedMin;
    fromInput.dispatchEvent(new Event("input", { bubbles: true }));
  }
  if (toInput.value !== expectedMax) {
    toInput.value = expectedMax;
    toInput.dispatchEvent(new Event("input", { bubbles: true }));
  }
  return true;
}
async function addPlaylistFilterToSection(section, playlistId) {
  if (!section || !playlistId) return false;
  const group = section.querySelector('.filter-group[data-type="playlist"]');
  if (!group) return false;
  const list = group.querySelector(".rows-wrap");
  if (!list) return false;
  const existingRows = Array.from(
    list.querySelectorAll('.filter-row[data-type="playlist"]')
  );
  if (existingRows.some((row) => {
    const select2 = row.querySelector("select");
    return select2?.value === playlistId;
  })) {
    return false;
  }
  const addRowFn = group.__addRowWithData;
  if (typeof addRowFn === "function") {
    await addRowFn(playlistId);
  } else {
    group.querySelector(".add-row")?.click();
  }
  const newRows = Array.from(
    list.querySelectorAll('.filter-row[data-type="playlist"]')
  );
  const newRow = newRows[newRows.length - 1];
  if (!newRow) return false;
  const select = newRow.querySelector("select");
  if (!select) return false;
  if (select.value !== playlistId) {
    select.value = playlistId;
  }
  select.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

// src/settings/filters/sections.js
function createFilterSection({
  addChannelSelect,
  channels = {},
  title,
  data = {},
  channelId,
  markUnsaved,
  updateCheckboxVisibility
}) {
  const template = document.getElementById("filterCardTemplate");
  const box = template.content.firstElementChild.cloneNode(true);
  box.dataset.channel = channelId || "";
  const heading = box.querySelector(".channel-heading");
  const link = box.querySelector(".channel-link");
  const removeBtn = box.querySelector(".remove-btn");
  const groupsWrap = box.querySelector(".groups-container");
  const chkShorts = box.querySelector(".nos");
  const chkBroadcast = box.querySelector(".nob");
  const btnDur = box.querySelector(".add-duration");
  const btnTitle = box.querySelector(".add-title");
  const btnTag = box.querySelector(".add-tag");
  const btnPlaylist = box.querySelector(".add-playlist");
  if (channelId) {
    link.href = `https://www.youtube.com/channel/${channelId}`;
    link.textContent = title;
    removeBtn.addEventListener("click", () => {
      box.remove();
      const opt = document.createElement("option");
      opt.value = channelId;
      opt.textContent = channels[channelId]?.title || channelId;
      addChannelSelect.appendChild(opt);
      updateCheckboxVisibility();
      markUnsaved();
    });
  } else {
    heading.style.display = "none";
    removeBtn.style.display = "none";
    box.classList.remove("box");
    box.classList.add("wide");
  }
  if (data.noShorts) chkShorts.checked = true;
  if (data.noBroadcasts) chkBroadcast.checked = true;
  const durGroup = createGroup(
    "\u0414\u043B\u0438\u0442\u0435\u043B\u044C\u043D\u043E\u0441\u0442\u044C",
    "duration",
    data.duration || [],
    (r = {}) => createDurationRow(r.min, r.max),
    markUnsaved
  );
  const titleGroup = createGroup(
    "\u0417\u0430\u0433\u043E\u043B\u043E\u0432\u043E\u043A",
    "title",
    data.title || [],
    (t = "") => createTextRow("title", t),
    markUnsaved
  );
  const tagGroup = createGroup(
    "\u0422\u0435\u0433",
    "tag",
    data.tags || [],
    (t = "") => createTextRow("tag", t),
    markUnsaved
  );
  const playlistGroup = createGroup(
    "\u041F\u043B\u0435\u0439\u043B\u0438\u0441\u0442",
    "playlist",
    data.playlists || [],
    (id = "") => createPlaylistRow(channelId, id),
    markUnsaved
  );
  groupsWrap.appendChild(durGroup.group);
  groupsWrap.appendChild(titleGroup.group);
  groupsWrap.appendChild(tagGroup.group);
  groupsWrap.appendChild(playlistGroup.group);
  btnDur.addEventListener("click", durGroup.add);
  btnTitle.addEventListener("click", titleGroup.add);
  btnTag.addEventListener("click", tagGroup.add);
  btnPlaylist.addEventListener("click", playlistGroup.add);
  return box;
}

// src/settings/filters/persistence.js
function collectFiltersFromSections(documentRef = document) {
  const sections = documentRef.querySelectorAll(".filter-card:not(.add-card)");
  const result = { global: {}, channels: {} };
  sections.forEach((sec) => {
    const ch = sec.dataset.channel || null;
    const obj = {};
    if (sec.querySelector(".nos").checked) obj.noShorts = true;
    if (sec.querySelector(".nob").checked) obj.noBroadcasts = true;
    const durs = [];
    const titles = [];
    const tags = [];
    const playlists = [];
    sec.querySelectorAll(".filter-row").forEach((row) => {
      const type = row.dataset.type;
      if (type === "duration") {
        const min = parseTime(row.querySelector(".from").value);
        const maxStr = row.querySelector(".to").value;
        const max = maxStr ? parseTime(maxStr) : Infinity;
        durs.push({ min, max });
      } else if (type === "title") {
        const val = row.querySelector("input").value.trim();
        if (val) titles.push(val);
      } else if (type === "tag") {
        const val = row.querySelector("input").value.trim();
        if (val) tags.push(val);
      } else if (type === "playlist") {
        const val = row.querySelector("select").value;
        if (val) playlists.push(val);
      }
    });
    if (durs.length) obj.duration = durs;
    if (titles.length) obj.title = titles;
    if (tags.length) obj.tags = tags;
    if (playlists.length) obj.playlists = playlists;
    if (ch) result.channels[ch] = obj;
    else result.global = obj;
  });
  return result;
}
function bindFilterPersistence({
  exportBtn,
  floatingSaveBtn,
  importInput,
  lastSaveInfo,
  saveFiltersBtn,
  saveUi,
  setUnsavedChanges,
  showToast: showToast2,
  updateLastSaveDisplay: updateLastSaveDisplay2
}) {
  async function handleSaveClick() {
    if (saveUi.isSaving()) return;
    const result = collectFiltersFromSections();
    try {
      saveUi.setSaving(true);
      await saveFilters(result);
      updateLastSaveDisplay2(lastSaveInfo);
      if (saveUi.consumePendingChangesDuringSave()) {
        setUnsavedChanges(true);
      } else {
        setUnsavedChanges(false);
      }
      showToast2("\u0424\u0438\u043B\u044C\u0442\u0440\u044B \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u044B");
    } catch (err) {
      console.error("Failed to save filters", err);
      showToast2("\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0441\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C \u0444\u0438\u043B\u044C\u0442\u0440\u044B", true);
    } finally {
      saveUi.setSaving(false);
    }
  }
  saveFiltersBtn?.addEventListener("click", handleSaveClick);
  floatingSaveBtn?.addEventListener("click", handleSaveClick);
  exportBtn?.addEventListener("click", async () => {
    const data = await getFilters();
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json"
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "filters.json";
    a.click();
    URL.revokeObjectURL(url);
  });
  importInput?.addEventListener("change", () => {
    const file = importInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const obj = JSON.parse(reader.result);
        saveFilters(obj).then(() => window.location.reload());
      } catch {
        alert("Invalid JSON");
      }
    };
    reader.readAsText(file);
  });
}

// src/settings/quick-filter/dom.js
function createQuickFilterDom(info) {
  const container = document.createElement("div");
  container.className = "quick-filter-controls";
  const heading = document.createElement("h4");
  heading.className = "title is-5";
  heading.textContent = "\u0421\u043E\u0437\u0434\u0430\u0442\u044C \u0444\u0438\u043B\u044C\u0442\u0440";
  container.appendChild(heading);
  const lead = document.createElement("p");
  lead.className = "mb-3";
  lead.textContent = "\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0434\u0430\u043D\u043D\u044B\u0435 \u0432\u044B\u0448\u0435 \u0438\u043B\u0438 \u0437\u0430\u043F\u043E\u043B\u043D\u0438\u0442\u0435 \u043F\u043E\u043B\u044F \u0432\u0440\u0443\u0447\u043D\u0443\u044E, \u0437\u0430\u0442\u0435\u043C \u0441\u043E\u0437\u0434\u0430\u0439\u0442\u0435 \u0444\u0438\u043B\u044C\u0442\u0440 \u0438 \u0441\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u0435 \u0438\u0437\u043C\u0435\u043D\u0435\u043D\u0438\u044F.";
  container.appendChild(lead);
  const titleField = document.createElement("div");
  titleField.className = "field";
  const titleLabel = document.createElement("label");
  titleLabel.className = "label";
  titleLabel.textContent = "\u041D\u0430\u0437\u0432\u0430\u043D\u0438\u0435";
  titleField.appendChild(titleLabel);
  const titleControl = document.createElement("div");
  titleControl.className = "control";
  const titleInput = document.createElement("input");
  titleInput.type = "text";
  titleInput.className = "input";
  titleInput.placeholder = "\u041F\u043E\u0434\u0441\u0442\u0440\u043E\u043A\u0430 \u0432 \u043D\u0430\u0437\u0432\u0430\u043D\u0438\u0438";
  titleControl.appendChild(titleInput);
  titleField.appendChild(titleControl);
  container.appendChild(titleField);
  const tagsField = document.createElement("div");
  tagsField.className = "field";
  const tagsLabel = document.createElement("label");
  tagsLabel.className = "label";
  tagsLabel.textContent = "\u0422\u0435\u0433\u0438";
  tagsField.appendChild(tagsLabel);
  const tagsControl = document.createElement("div");
  tagsControl.className = "field has-addons mt-2";
  const tagInputControl = document.createElement("div");
  tagInputControl.className = "control";
  const customTagInput = document.createElement("input");
  customTagInput.type = "text";
  customTagInput.className = "input quick-filter-tag-input";
  customTagInput.placeholder = "\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u0442\u0435\u0433";
  tagInputControl.appendChild(customTagInput);
  tagsControl.appendChild(tagInputControl);
  const tagBtnControl = document.createElement("div");
  tagBtnControl.className = "control";
  const customTagBtn = document.createElement("button");
  customTagBtn.type = "button";
  customTagBtn.className = "button is-light quick-filter-tag-add";
  customTagBtn.textContent = "\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C";
  tagBtnControl.appendChild(customTagBtn);
  tagsControl.appendChild(tagBtnControl);
  tagsField.appendChild(tagsControl);
  const selectedTagsContainer = document.createElement("div");
  selectedTagsContainer.className = "quick-filter-selected-tags";
  tagsField.appendChild(selectedTagsContainer);
  container.appendChild(tagsField);
  const durationField = document.createElement("div");
  durationField.className = "field";
  const durationLabel = document.createElement("label");
  durationLabel.className = "label";
  durationLabel.textContent = "\u0414\u043B\u0438\u0442\u0435\u043B\u044C\u043D\u043E\u0441\u0442\u044C";
  durationField.appendChild(durationLabel);
  const durationInputs = document.createElement("div");
  durationInputs.className = "field has-addons";
  const minControl = document.createElement("div");
  minControl.className = "control";
  const minInput = document.createElement("input");
  minInput.type = "time";
  minInput.className = "input from";
  minInput.placeholder = "\u041E\u0442";
  minControl.appendChild(minInput);
  durationInputs.appendChild(minControl);
  const dashControl = document.createElement("div");
  dashControl.className = "control";
  const dash = document.createElement("span");
  dash.className = "button is-static";
  dash.textContent = "\u2014";
  dashControl.appendChild(dash);
  durationInputs.appendChild(dashControl);
  const maxControl = document.createElement("div");
  maxControl.className = "control";
  const maxInput = document.createElement("input");
  maxInput.type = "time";
  maxInput.className = "input to";
  maxInput.placeholder = "\u0414\u043E";
  maxControl.appendChild(maxInput);
  durationInputs.appendChild(maxControl);
  durationField.appendChild(durationInputs);
  container.appendChild(durationField);
  const playlistField = document.createElement("div");
  playlistField.className = "field";
  const playlistLabel = document.createElement("label");
  playlistLabel.className = "label";
  playlistLabel.textContent = "\u041F\u043B\u0435\u0439\u043B\u0438\u0441\u0442\u044B \u043A\u0430\u043D\u0430\u043B\u0430";
  playlistField.appendChild(playlistLabel);
  const playlistSelectedContainer = document.createElement("div");
  playlistSelectedContainer.className = "quick-filter-selected-playlists";
  playlistField.appendChild(playlistSelectedContainer);
  const playlistStatus = document.createElement("p");
  playlistStatus.className = "help quick-filter-playlist-status";
  playlistField.appendChild(playlistStatus);
  const playlistPicker = document.createElement("div");
  playlistPicker.className = "field has-addons quick-filter-playlist-picker";
  const playlistSelectControl = document.createElement("div");
  playlistSelectControl.className = "control is-expanded";
  const playlistSelectWrapper = document.createElement("div");
  playlistSelectWrapper.className = "select is-fullwidth";
  const playlistSelect = document.createElement("select");
  playlistSelectWrapper.appendChild(playlistSelect);
  playlistSelectControl.appendChild(playlistSelectWrapper);
  playlistPicker.appendChild(playlistSelectControl);
  const playlistAddControl = document.createElement("div");
  playlistAddControl.className = "control";
  const playlistAddBtn = document.createElement("button");
  playlistAddBtn.type = "button";
  playlistAddBtn.className = "button is-info is-light quick-filter-playlist-add";
  playlistAddBtn.disabled = true;
  playlistAddBtn.title = "\u041D\u0435\u0442 \u0434\u043E\u0441\u0442\u0443\u043F\u043D\u044B\u0445 \u043F\u043B\u0435\u0439\u043B\u0438\u0441\u0442\u043E\u0432";
  playlistAddBtn.setAttribute("aria-label", "\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u043F\u043B\u0435\u0439\u043B\u0438\u0441\u0442");
  playlistAddBtn.innerHTML = '<span class="icon"><svg width="1.25em" height="1.25em"><use href="icons.svg#icon-plus"></use></svg></span>';
  playlistAddControl.appendChild(playlistAddBtn);
  playlistPicker.appendChild(playlistAddControl);
  playlistField.appendChild(playlistPicker);
  playlistField.style.display = "none";
  container.appendChild(playlistField);
  const actions = document.createElement("div");
  actions.className = "quick-filter-actions";
  const channelBtn = document.createElement("button");
  channelBtn.type = "button";
  channelBtn.className = "button is-link";
  channelBtn.textContent = "\u0421\u043E\u0437\u0434\u0430\u0442\u044C \u0434\u043B\u044F \u043A\u0430\u043D\u0430\u043B\u0430";
  if (!info.channelId) {
    channelBtn.disabled = true;
    channelBtn.title = "\u041D\u0435\u0442 ID \u043A\u0430\u043D\u0430\u043B\u0430";
  }
  const globalBtn = document.createElement("button");
  globalBtn.type = "button";
  globalBtn.className = "button is-link is-light";
  globalBtn.textContent = "\u0421\u043E\u0437\u0434\u0430\u0442\u044C \u0433\u043B\u043E\u0431\u0430\u043B\u044C\u043D\u043E";
  actions.appendChild(channelBtn);
  actions.appendChild(globalBtn);
  container.appendChild(actions);
  const message = document.createElement("p");
  message.className = "quick-filter-message";
  container.appendChild(message);
  return {
    container,
    titleInput,
    customTagInput,
    customTagBtn,
    selectedTagsContainer,
    minInput,
    maxInput,
    playlistField,
    playlistSelectedContainer,
    playlistStatus,
    playlistSelect,
    playlistAddBtn,
    channelBtn,
    globalBtn,
    message
  };
}

// src/settings/quick-filter/apply.js
async function applyQuickFilters({
  addDurationFilterToSection: addDurationFilterToSection2,
  addPlaylistFilterToSection: addPlaylistFilterToSection2,
  addTextFilterToSection: addTextFilterToSection2,
  ensureFilterSection,
  filtersContainer,
  getGlobalSection,
  info,
  markUnsaved,
  maxInput,
  minInput,
  selectedPlaylists,
  selectedTags,
  setMessage,
  showToast: showToast2,
  scope,
  titleInput
}) {
  const titleValue = titleInput.value.trim();
  const tagsValues = Array.from(selectedTags);
  const minValue = minInput.value;
  const maxValue = maxInput.value;
  if (!titleValue && !tagsValues.length && !minValue && !maxValue && !selectedPlaylists.size) {
    setMessage("\u0414\u043E\u0431\u0430\u0432\u044C\u0442\u0435 \u0437\u043D\u0430\u0447\u0435\u043D\u0438\u0435 \u0444\u0438\u043B\u044C\u0442\u0440\u0430 \u043F\u0435\u0440\u0435\u0434 \u0441\u043E\u0437\u0434\u0430\u043D\u0438\u0435\u043C.", true);
    return;
  }
  let targetSection = scope === "channel" ? filtersContainer?.querySelector(
    `.filter-card[data-channel="${info.channelId}"]`
  ) : getGlobalSection?.();
  if (!targetSection) {
    targetSection = ensureFilterSection(
      scope === "channel" ? info.channelId : null,
      info.channelTitle || info.channelId
    );
  }
  if (!targetSection) {
    setMessage("\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043D\u0430\u0439\u0442\u0438 \u0440\u0430\u0437\u0434\u0435\u043B \u0434\u043B\u044F \u0434\u043E\u0431\u0430\u0432\u043B\u0435\u043D\u0438\u044F \u0444\u0438\u043B\u044C\u0442\u0440\u0430.", true);
    return;
  }
  let added = 0;
  if (titleValue) {
    if (await addTextFilterToSection2(targetSection, "title", titleValue)) {
      added += 1;
    }
  }
  for (const tag of tagsValues) {
    if (await addTextFilterToSection2(targetSection, "tag", tag)) {
      added += 1;
    }
  }
  if (minValue || maxValue) {
    const minSeconds = minValue ? parseTime(minValue) : null;
    const maxSeconds = maxValue ? parseTime(maxValue) : null;
    if (await addDurationFilterToSection2(
      targetSection,
      minSeconds,
      maxSeconds
    )) {
      added += 1;
    }
  }
  if (selectedPlaylists.size) {
    for (const playlistId of Array.from(selectedPlaylists)) {
      if (await addPlaylistFilterToSection2(targetSection, playlistId)) {
        added += 1;
      }
    }
  }
  if (!added) {
    setMessage(
      "\u0422\u0430\u043A\u0438\u0435 \u0444\u0438\u043B\u044C\u0442\u0440\u044B \u0443\u0436\u0435 \u0435\u0441\u0442\u044C \u0438\u043B\u0438 \u0437\u043D\u0430\u0447\u0435\u043D\u0438\u044F \u0441\u043E\u0432\u043F\u0430\u0434\u0430\u044E\u0442 \u0441 \u0441\u0443\u0449\u0435\u0441\u0442\u0432\u0443\u044E\u0449\u0438\u043C\u0438.",
      true
    );
    return;
  }
  setMessage(
    scope === "channel" ? "\u0424\u0438\u043B\u044C\u0442\u0440 \u0434\u043B\u044F \u043A\u0430\u043D\u0430\u043B\u0430 \u0434\u043E\u0431\u0430\u0432\u043B\u0435\u043D. \u041D\u0435 \u0437\u0430\u0431\u0443\u0434\u044C\u0442\u0435 \u0441\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C \u0438\u0437\u043C\u0435\u043D\u0435\u043D\u0438\u044F." : "\u0413\u043B\u043E\u0431\u0430\u043B\u044C\u043D\u044B\u0439 \u0444\u0438\u043B\u044C\u0442\u0440 \u0434\u043E\u0431\u0430\u0432\u043B\u0435\u043D. \u041D\u0435 \u0437\u0430\u0431\u0443\u0434\u044C\u0442\u0435 \u0441\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C \u0438\u0437\u043C\u0435\u043D\u0435\u043D\u0438\u044F.",
    false
  );
  showToast2("\u0424\u0438\u043B\u044C\u0442\u0440\u044B \u043E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u044B, \u043D\u0435 \u0437\u0430\u0431\u0443\u0434\u044C\u0442\u0435 \u0441\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C \u0438\u0437\u043C\u0435\u043D\u0435\u043D\u0438\u044F");
  markUnsaved();
}

// src/settings/quick-filter/renderers.js
function renderSelectedTags({ container, onRemove, selectedTags }) {
  container.innerHTML = "";
  if (!selectedTags.size) {
    const empty = document.createElement("p");
    empty.className = "quick-filter-empty";
    empty.textContent = "\u0422\u0435\u0433\u0438 \u043D\u0435 \u0432\u044B\u0431\u0440\u0430\u043D\u044B";
    container.appendChild(empty);
    return;
  }
  selectedTags.forEach((tag) => {
    const tagEl = document.createElement("span");
    tagEl.className = "tag is-info is-light";
    tagEl.appendChild(document.createTextNode(tag));
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "delete is-small";
    removeBtn.setAttribute("aria-label", `\u0423\u0434\u0430\u043B\u0438\u0442\u044C \u0442\u0435\u0433 ${tag}`);
    removeBtn.addEventListener("click", () => onRemove(tag));
    tagEl.appendChild(removeBtn);
    container.appendChild(tagEl);
  });
}
function renderSelectedPlaylists({
  container,
  onRemove,
  playlistOptions,
  refreshPlaylistSelectOptions,
  selectedPlaylists
}) {
  container.innerHTML = "";
  if (!selectedPlaylists.size) {
    const empty = document.createElement("p");
    empty.className = "quick-filter-empty";
    empty.textContent = "\u041F\u043B\u0435\u0439\u043B\u0438\u0441\u0442\u044B \u043D\u0435 \u0432\u044B\u0431\u0440\u0430\u043D\u044B";
    container.appendChild(empty);
    refreshPlaylistSelectOptions();
    return;
  }
  selectedPlaylists.forEach((id) => {
    const playlistInfo = playlistOptions.get(id) || { id };
    const card = document.createElement("div");
    card.className = "quick-filter-playlist-card";
    const link = document.createElement("a");
    link.className = "quick-filter-playlist-link";
    link.textContent = playlistInfo.title || playlistInfo.id || id;
    link.href = `https://www.youtube.com/playlist?list=${id}`;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    card.appendChild(link);
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "button is-light quick-filter-playlist-remove";
    removeBtn.title = "\u0423\u0434\u0430\u043B\u0438\u0442\u044C \u043F\u043B\u0435\u0439\u043B\u0438\u0441\u0442 \u0438\u0437 \u0444\u0438\u043B\u044C\u0442\u0440\u0430";
    removeBtn.setAttribute(
      "aria-label",
      `\u0423\u0434\u0430\u043B\u0438\u0442\u044C \u043F\u043B\u0435\u0439\u043B\u0438\u0441\u0442 ${playlistInfo.title || id}`
    );
    removeBtn.innerHTML = '<span class="icon"><svg width="1.25em" height="1.25em"><use href="icons.svg#icon-x"></use></svg></span>';
    removeBtn.addEventListener("click", () => onRemove(id));
    card.appendChild(removeBtn);
    container.appendChild(card);
  });
  refreshPlaylistSelectOptions();
}

// src/settings/quick-filter/builder.js
function createQuickFilterBuilder({
  addDurationFilterToSection: addDurationFilterToSection2,
  addPlaylistFilterToSection: addPlaylistFilterToSection2,
  addTextFilterToSection: addTextFilterToSection2,
  ensureFilterSection,
  filtersContainer,
  getGlobalSection,
  info,
  markUnsaved,
  showToast: showToast2
}) {
  const {
    container,
    titleInput,
    customTagInput,
    customTagBtn,
    selectedTagsContainer,
    minInput,
    maxInput,
    playlistField,
    playlistSelectedContainer,
    playlistStatus,
    playlistSelect,
    playlistAddBtn,
    channelBtn,
    globalBtn,
    message
  } = createQuickFilterDom(info);
  const selectedTags = /* @__PURE__ */ new Set();
  const titleSubscribers = /* @__PURE__ */ new Set();
  const tagSubscribers = /* @__PURE__ */ new Map();
  const durationSubscribers = /* @__PURE__ */ new Set();
  const playlistSubscribers = /* @__PURE__ */ new Map();
  const selectedPlaylists = /* @__PURE__ */ new Set();
  const playlistOptions = /* @__PURE__ */ new Map();
  let playlistEmptyMessage = "\u041F\u043B\u0435\u0439\u043B\u0438\u0441\u0442\u044B \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u043D\u044B";
  const playlistPickerHint = "\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u043F\u043B\u0435\u0439\u043B\u0438\u0441\u0442 \u0438\u0437 \u0441\u043F\u0438\u0441\u043A\u0430 \u0438 \u043D\u0430\u0436\u043C\u0438\u0442\u0435 \xAB+\xBB.";
  playlistSelect.disabled = true;
  playlistSelect.title = "\u041D\u0435\u0442 \u0434\u043E\u0441\u0442\u0443\u043F\u043D\u044B\u0445 \u043F\u043B\u0435\u0439\u043B\u0438\u0441\u0442\u043E\u0432";
  playlistStatus.textContent = "";
  function refreshPlaylistSelectOptions() {
    const previous = playlistSelect.value;
    playlistSelect.innerHTML = "";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = playlistOptions.size ? "\u0412\u044B\u0431\u0440\u0430\u0442\u044C \u043F\u043B\u0435\u0439\u043B\u0438\u0441\u0442" : playlistEmptyMessage;
    playlistSelect.appendChild(placeholder);
    playlistOptions.forEach((opt) => {
      if (!opt?.id) return;
      const optionEl = document.createElement("option");
      optionEl.value = opt.id;
      optionEl.textContent = opt.title || opt.id;
      optionEl.disabled = selectedPlaylists.has(opt.id);
      playlistSelect.appendChild(optionEl);
    });
    if (previous && playlistOptions.has(previous) && !selectedPlaylists.has(previous)) {
      playlistSelect.value = previous;
    } else {
      playlistSelect.value = "";
    }
    playlistAddBtn.disabled = playlistSelect.disabled || !playlistSelect.value;
  }
  const clearMessage = () => {
    message.textContent = "";
    message.classList.remove("has-text-danger", "has-text-success");
  };
  const setMessage = (text, isError = false) => {
    message.textContent = text;
    message.classList.remove("has-text-danger", "has-text-success");
    if (text) {
      message.classList.add(
        isError ? "has-text-danger" : "has-text-success"
      );
    }
  };
  function setPlaylistSelected(id, shouldSelect, { silentMessage = false } = {}) {
    if (!id) return { changed: false };
    const has = selectedPlaylists.has(id);
    if (shouldSelect) {
      if (has) {
        return { changed: false, reason: "exists" };
      }
      selectedPlaylists.add(id);
    } else {
      if (!has) {
        return { changed: false, reason: "missing" };
      }
      selectedPlaylists.delete(id);
    }
    if (!silentMessage) {
      clearMessage();
    }
    updateSelectedPlaylistsView();
    updateActionButtons();
    notifyPlaylistSubscribers();
    return { changed: true };
  }
  function togglePlaylist(id) {
    if (!id) return false;
    const shouldSelect = !selectedPlaylists.has(id);
    const result = setPlaylistSelected(id, shouldSelect);
    if (!result.changed && shouldSelect && result.reason === "exists") {
      setMessage("\u042D\u0442\u043E\u0442 \u043F\u043B\u0435\u0439\u043B\u0438\u0441\u0442 \u0443\u0436\u0435 \u0432\u044B\u0431\u0440\u0430\u043D.", true);
    }
    return selectedPlaylists.has(id);
  }
  playlistSelect.addEventListener("change", () => {
    clearMessage();
    playlistAddBtn.disabled = playlistSelect.disabled || !playlistSelect.value;
  });
  playlistAddBtn.addEventListener("click", () => {
    if (playlistAddBtn.disabled) return;
    const id = playlistSelect.value;
    if (!id) return;
    const result = setPlaylistSelected(id, true);
    if (!result.changed && result.reason === "exists") {
      setMessage("\u042D\u0442\u043E\u0442 \u043F\u043B\u0435\u0439\u043B\u0438\u0441\u0442 \u0443\u0436\u0435 \u0432\u044B\u0431\u0440\u0430\u043D.", true);
      return;
    }
    playlistSelect.value = "";
    playlistAddBtn.disabled = true;
  });
  const updateActionButtons = () => {
    const hasValues = Boolean(titleInput.value.trim()) || selectedTags.size > 0 || Boolean(minInput.value) || Boolean(maxInput.value) || selectedPlaylists.size > 0;
    globalBtn.disabled = !hasValues;
    if (info.channelId) {
      channelBtn.disabled = !hasValues;
    }
  };
  const updateSelectedTagsView = () => {
    renderSelectedTags({
      container: selectedTagsContainer,
      selectedTags,
      onRemove: (tag) => {
        selectedTags.delete(tag);
        updateSelectedTagsView();
        updateActionButtons();
        clearMessage();
        notifyTagSubscribers();
      }
    });
  };
  const updateSelectedPlaylistsView = () => {
    renderSelectedPlaylists({
      container: playlistSelectedContainer,
      playlistOptions,
      refreshPlaylistSelectOptions,
      selectedPlaylists,
      onRemove: (id) => {
        setPlaylistSelected(id, false);
      }
    });
  };
  const notifyTitleSubscribers = () => {
    const value = titleInput.value.trim();
    titleSubscribers.forEach((fn) => fn(value));
  };
  const notifyTagSubscribers = () => {
    tagSubscribers.forEach((fn, tag) => {
      fn(selectedTags.has(tag));
    });
  };
  const toSeconds = (value) => {
    if (!value) return null;
    const seconds = parseTime(value);
    return Number.isFinite(seconds) ? seconds : null;
  };
  const readDuration = () => ({
    min: toSeconds(minInput.value),
    max: toSeconds(maxInput.value)
  });
  const notifyDurationSubscribers = () => {
    const current = readDuration();
    durationSubscribers.forEach((fn) => fn(current));
  };
  const notifyPlaylistSubscribers = () => {
    playlistSubscribers.forEach((fn, id) => {
      fn(selectedPlaylists.has(id));
    });
  };
  const addCustomTag = () => {
    const value = customTagInput.value.trim();
    if (!value) return;
    selectedTags.add(value);
    customTagInput.value = "";
    updateSelectedTagsView();
    updateActionButtons();
    clearMessage();
    notifyTagSubscribers();
  };
  customTagBtn.addEventListener("click", addCustomTag);
  customTagInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addCustomTag();
    }
  });
  titleInput.addEventListener("input", () => {
    clearMessage();
    updateActionButtons();
    notifyTitleSubscribers();
  });
  minInput.addEventListener("input", () => {
    clearMessage();
    updateActionButtons();
    notifyDurationSubscribers();
  });
  maxInput.addEventListener("input", () => {
    clearMessage();
    updateActionButtons();
    notifyDurationSubscribers();
  });
  const applyFilters = (scope) => applyQuickFilters({
    addDurationFilterToSection: addDurationFilterToSection2,
    addPlaylistFilterToSection: addPlaylistFilterToSection2,
    addTextFilterToSection: addTextFilterToSection2,
    ensureFilterSection,
    filtersContainer,
    getGlobalSection,
    info,
    markUnsaved,
    maxInput,
    minInput,
    selectedPlaylists,
    selectedTags,
    setMessage,
    showToast: showToast2,
    scope,
    titleInput
  });
  channelBtn.addEventListener("click", () => {
    applyFilters("channel").catch((error) => {
      console.error("Failed to apply channel filters", error);
      setMessage("\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0434\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u0444\u0438\u043B\u044C\u0442\u0440\u044B.", true);
    });
  });
  globalBtn.addEventListener("click", () => {
    applyFilters("global").catch((error) => {
      console.error("Failed to apply global filters", error);
      setMessage("\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0434\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u0444\u0438\u043B\u044C\u0442\u0440\u044B.", true);
    });
  });
  updateSelectedTagsView();
  updateSelectedPlaylistsView();
  updateActionButtons();
  return {
    element: container,
    setTitle(value) {
      titleInput.value = value || "";
      titleInput.focus();
      clearMessage();
      updateActionButtons();
      notifyTitleSubscribers();
    },
    subscribeTitle(fn) {
      if (typeof fn !== "function") return () => {
      };
      titleSubscribers.add(fn);
      fn(titleInput.value.trim());
      return () => titleSubscribers.delete(fn);
    },
    toggleTag(tag) {
      if (!tag) return selectedTags.has(tag);
      if (selectedTags.has(tag)) {
        selectedTags.delete(tag);
      } else {
        selectedTags.add(tag);
      }
      updateSelectedTagsView();
      updateActionButtons();
      clearMessage();
      notifyTagSubscribers();
      return selectedTags.has(tag);
    },
    subscribeTag(tag, fn) {
      if (!tag || typeof fn !== "function") return () => {
      };
      tagSubscribers.set(tag, fn);
      fn(selectedTags.has(tag));
      return () => tagSubscribers.delete(tag);
    },
    setDurationFromSeconds(seconds) {
      if (!Number.isFinite(seconds)) return;
      const timeStr = toTimeStr(seconds);
      minInput.value = timeStr;
      maxInput.value = timeStr;
      clearMessage();
      updateActionButtons();
      notifyDurationSubscribers();
    },
    clearDuration() {
      minInput.value = "";
      maxInput.value = "";
      clearMessage();
      updateActionButtons();
      notifyDurationSubscribers();
    },
    subscribeDuration(fn) {
      if (typeof fn !== "function") return () => {
      };
      durationSubscribers.add(fn);
      fn(readDuration());
      return () => durationSubscribers.delete(fn);
    },
    setPlaylistOptions(options, emptyMessage = "\u041F\u043B\u0435\u0439\u043B\u0438\u0441\u0442\u044B \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u043D\u044B") {
      playlistOptions.clear();
      if (Array.isArray(options) && options.length) {
        options.forEach((opt) => {
          if (!opt?.id) return;
          playlistOptions.set(opt.id, opt);
        });
      }
      if (emptyMessage) {
        playlistEmptyMessage = emptyMessage;
      }
      playlistField.style.display = "";
      const hasOptions = playlistOptions.size > 0;
      playlistStatus.textContent = hasOptions ? playlistPickerHint : playlistEmptyMessage;
      playlistSelect.disabled = !hasOptions;
      playlistSelect.title = hasOptions ? "" : playlistEmptyMessage;
      playlistSelect.value = "";
      playlistAddBtn.disabled = true;
      playlistAddBtn.title = hasOptions ? "\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u0432\u044B\u0431\u0440\u0430\u043D\u043D\u044B\u0439 \u043F\u043B\u0435\u0439\u043B\u0438\u0441\u0442" : playlistEmptyMessage;
      Array.from(selectedPlaylists).forEach((id) => {
        if (!playlistOptions.has(id)) {
          setPlaylistSelected(id, false, { silentMessage: true });
        }
      });
      updateSelectedPlaylistsView();
      updateActionButtons();
      notifyPlaylistSubscribers();
    },
    usePlaylist(id) {
      if (!id) return;
      if (!playlistOptions.has(id)) {
        playlistOptions.set(id, { id });
      }
      if (playlistOptions.size > 0) {
        playlistStatus.textContent = playlistPickerHint;
        playlistSelect.disabled = false;
        playlistSelect.title = "";
        playlistAddBtn.title = "\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u0432\u044B\u0431\u0440\u0430\u043D\u043D\u044B\u0439 \u043F\u043B\u0435\u0439\u043B\u0438\u0441\u0442";
      }
      togglePlaylist(id);
    },
    subscribePlaylist(id, fn) {
      if (!id || typeof fn !== "function") return () => {
      };
      playlistSubscribers.set(id, fn);
      fn(selectedPlaylists.has(id));
      return () => playlistSubscribers.delete(id);
    }
  };
}

// src/youtube-api/channels.js
var channelCache;
async function getSubscriptionsId(pageToken) {
  const data = await callApi("subscriptions", {
    part: "snippet,contentDetails",
    maxResults: 50,
    mine: true,
    pageToken
  });
  const subs = data.items.map((el) => ({
    title: el.snippet.title,
    id: el.snippet.resourceId.channelId,
    videos: el.contentDetails.totalItemCount
  }));
  if (data.nextPageToken) {
    const next = await getSubscriptionsId(data.nextPageToken);
    return subs.concat(next);
  }
  return subs;
}
async function getChannelInfos(ids) {
  if (!ids || ids.length === 0) return [];
  const data = await callApi("channels", {
    part: "snippet,contentDetails",
    id: ids.join(","),
    maxResults: 50
  });
  const items = Array.isArray(data?.items) ? data.items : [];
  return items.map((el) => ({
    id: el.id,
    title: el.snippet.title,
    uploads: el.contentDetails.relatedPlaylists.uploads
  }));
}
async function getChannelMap(extraIds = []) {
  if (!channelCache) {
    const data = await new Promise(
      (r) => chrome.storage.local.get(["channelCache"], r)
    );
    channelCache = data.channelCache || {};
  }
  const cache = channelCache;
  const subs = await getSubscriptionsId();
  const missing = [];
  for (const { id, title } of subs) {
    if (!cache[id]) cache[id] = {};
    cache[id].title = title;
    if (!cache[id].uploads) missing.push(id);
  }
  extraIds.forEach((id) => {
    if (!cache[id] || !cache[id].uploads) missing.push(id);
  });
  let ids = missing.slice();
  while (ids.length) {
    const chunk = ids.splice(0, 50);
    const infos = await getChannelInfos(chunk);
    for (const info of infos) {
      cache[info.id] = cache[info.id] || {};
      cache[info.id].title = cache[info.id].title || info.title;
      cache[info.id].uploads = info.uploads;
    }
  }
  channelCache = cache;
  chrome.storage.local.set({ channelCache: cache });
  return cache;
}

// src/settings/index.js
document.addEventListener("DOMContentLoaded", async () => {
  const startInput = document.getElementById("startDate");
  const saveBtn = document.getElementById("saveStartDate");
  const videoInput = document.getElementById("videoId");
  const useBtn = document.getElementById("useVideoId");
  const checkVideoInput = document.getElementById("checkVideoInput");
  const checkVideoBtn = document.getElementById("checkVideoBtn");
  const checkVideoResult = document.getElementById("checkVideoResult");
  const filtersContainer = document.getElementById("filtersContainer");
  const globalContainer = document.getElementById("globalFilters");
  const saveFiltersBtn = document.getElementById("saveFilters");
  const lastSaveInfo = document.getElementById("lastSave");
  const exportBtn = document.getElementById("exportFilters");
  const importInput = document.getElementById("importFilters");
  const addChannelSelect = document.getElementById("addChannelSelect");
  const addChannelBtn = document.getElementById("addChannel");
  const addCard = document.getElementById("addChannelCard");
  const floatingSaveBtn = document.getElementById("floatingSave");
  const pullSyncBtn = document.getElementById("pullSync");
  const pushSyncBtn = document.getElementById("pushSync");
  const replaceFromSyncBtn = document.getElementById("replaceFromSync");
  const syncStatus = document.getElementById("syncStatus");
  const saveButtons = [saveFiltersBtn, floatingSaveBtn].filter(Boolean);
  let globalSec;
  let globalShortsChk;
  let globalBroadcastChk;
  let channels = {};
  const saveUi = createSaveUiState(saveButtons);
  const { markUnsaved, setUnsavedChanges, updateSaveButtons } = saveUi;
  [globalContainer, filtersContainer].forEach((target) => {
    target?.addEventListener("input", markUnsaved, true);
    target?.addEventListener("change", markUnsaved, true);
  });
  updateSaveButtons();
  function setSyncBusy(busy) {
    [
      pullSyncBtn,
      pushSyncBtn,
      replaceFromSyncBtn
    ].forEach((button) => {
      if (!button) return;
      button.disabled = busy;
      button.classList.toggle("is-loading", busy);
    });
  }
  async function refreshSyncStatus(message = "", { refreshRemote = false } = {}) {
    try {
      const status = await getSyncStatus({ refreshRemote });
      renderSyncStatus(syncStatus, status, message);
    } catch (err) {
      console.error("Failed to load sync status", err);
      renderSyncStatus(syncStatus, null, "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043F\u043E\u043B\u0443\u0447\u0438\u0442\u044C \u0441\u0442\u0430\u0442\u0443\u0441 \u0441\u0438\u043D\u0445\u0440\u043E\u043D\u0438\u0437\u0430\u0446\u0438\u0438.");
    }
  }
  pullSyncBtn?.addEventListener("click", async () => {
    try {
      setSyncBusy(true);
      const result = await pullRemoteSync();
      const changed = result?.playlistImported || result?.settingsImported;
      await refreshSyncStatus(changed ? "\u041B\u043E\u043A\u0430\u043B\u044C\u043D\u044B\u0435 \u0434\u0430\u043D\u043D\u044B\u0435 \u0441\u043B\u0438\u0442\u044B \u0441 \u043E\u0431\u043B\u0430\u0447\u043D\u043E\u0439 \u0432\u0435\u0440\u0441\u0438\u0435\u0439." : "\u041E\u0431\u043B\u0430\u0447\u043D\u043E\u0439 \u0432\u0435\u0440\u0441\u0438\u0438 \u043F\u043E\u043A\u0430 \u043D\u0435\u0442.");
      if (result?.settingsImported) {
        window.setTimeout(() => window.location.reload(), 700);
      }
    } catch (err) {
      console.error("Failed to pull account sync", err);
      showToast("\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0441\u043B\u0438\u044F\u0442\u044C \u0434\u0430\u043D\u043D\u044B\u0435 \u0441 \u043E\u0431\u043B\u0430\u043A\u043E\u043C", true);
    } finally {
      setSyncBusy(false);
    }
  });
  pushSyncBtn?.addEventListener("click", async () => {
    if (saveFiltersBtn && !saveFiltersBtn.classList.contains("is-hidden")) {
      showToast("\u0421\u043D\u0430\u0447\u0430\u043B\u0430 \u0441\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u0435 \u0438\u0437\u043C\u0435\u043D\u0435\u043D\u0438\u044F \u0444\u0438\u043B\u044C\u0442\u0440\u043E\u0432", true);
      return;
    }
    try {
      setSyncBusy(true);
      const result = await pushLocalSync();
      const pushed = result?.drivePushed || result?.playlistPushed || result?.settingsPushed;
      const message = result?.drivePushed ? "\u0414\u0430\u043D\u043D\u044B\u0435 \u043E\u0442\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u044B \u0432 \u043E\u0431\u043B\u0430\u043A\u043E." : pushed ? "\u0414\u0430\u043D\u043D\u044B\u0435 \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u044B \u0442\u043E\u043B\u044C\u043A\u043E \u0432 \u0440\u0435\u0437\u0435\u0440\u0432\u043D\u043E\u0435 \u0445\u0440\u0430\u043D\u0438\u043B\u0438\u0449\u0435 Chrome." : "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043E\u0442\u043F\u0440\u0430\u0432\u0438\u0442\u044C \u0434\u0430\u043D\u043D\u044B\u0435 \u0432 \u043E\u0431\u043B\u0430\u043A\u043E.";
      await refreshSyncStatus(message);
    } catch (err) {
      console.error("Failed to push local account sync", err);
      showToast("\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043E\u0442\u043F\u0440\u0430\u0432\u0438\u0442\u044C \u0434\u0430\u043D\u043D\u044B\u0435", true);
    } finally {
      setSyncBusy(false);
    }
  });
  replaceFromSyncBtn?.addEventListener("click", async () => {
    const ok = window.confirm(
      "\u041F\u043E\u043B\u043D\u043E\u0441\u0442\u044C\u044E \u0437\u0430\u043C\u0435\u043D\u0438\u0442\u044C \u043B\u043E\u043A\u0430\u043B\u044C\u043D\u043E\u0435 \u0441\u043E\u0441\u0442\u043E\u044F\u043D\u0438\u0435 \u0438 \u0441\u043F\u0438\u0441\u043A\u0438 \u043E\u0431\u043B\u0430\u0447\u043D\u043E\u0439 \u0432\u0435\u0440\u0441\u0438\u0435\u0439?"
    );
    if (!ok) return;
    try {
      setSyncBusy(true);
      const result = await replaceLocalFromRemoteSync();
      const changed = result?.playlistImported || result?.settingsImported;
      await refreshSyncStatus(changed ? "\u041B\u043E\u043A\u0430\u043B\u044C\u043D\u044B\u0435 \u0434\u0430\u043D\u043D\u044B\u0435 \u0437\u0430\u043C\u0435\u043D\u0435\u043D\u044B \u043E\u0431\u043B\u0430\u0447\u043D\u043E\u0439 \u0432\u0435\u0440\u0441\u0438\u0435\u0439." : "\u041E\u0431\u043B\u0430\u0447\u043D\u043E\u0439 \u0432\u0435\u0440\u0441\u0438\u0438 \u043F\u043E\u043A\u0430 \u043D\u0435\u0442.");
      if (changed) {
        window.setTimeout(() => window.location.reload(), 700);
      }
    } catch (err) {
      console.error("Failed to replace local data from account sync", err);
      showToast("\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0437\u0430\u043C\u0435\u043D\u0438\u0442\u044C \u043B\u043E\u043A\u0430\u043B\u044C\u043D\u044B\u0435 \u0434\u0430\u043D\u043D\u044B\u0435", true);
    } finally {
      setSyncBusy(false);
    }
  });
  syncStatus?.addEventListener("click", async (event) => {
    if (!event.target.closest("#refreshSyncStatus")) return;
    try {
      setSyncBusy(true);
      const refreshButton = syncStatus.querySelector("#refreshSyncStatus");
      refreshButton?.classList.add("is-loading");
      await refreshSyncStatus("\u0421\u0442\u0430\u0442\u0443\u0441 \u043E\u0431\u043B\u0430\u043A\u0430 \u043E\u0431\u043D\u043E\u0432\u043B\u0451\u043D.", { refreshRemote: true });
    } catch (err) {
      console.error("Failed to refresh sync status", err);
      showToast("\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043E\u0431\u043D\u043E\u0432\u0438\u0442\u044C \u0441\u0442\u0430\u0442\u0443\u0441 \u043E\u0431\u043B\u0430\u043A\u0430", true);
    } finally {
      setSyncBusy(false);
    }
  });
  refreshSyncStatus();
  getSubscriptionsMeta().then((meta) => {
    const ts = Number(meta?.lastRunAt) || 0;
    if (ts <= 0) return;
    const d = new Date(ts);
    if (!Number.isNaN(d.getTime())) {
      startInput.value = toLocalInputValue(d);
    }
  });
  saveBtn?.addEventListener("click", () => {
    const val = startInput.value;
    const dt = new Date(val);
    if (!Number.isNaN(dt.getTime())) {
      setStartDate(dt).then((ok) => {
        if (ok) {
          startInput.value = toLocalInputValue(dt);
        }
      });
    }
  });
  useBtn?.addEventListener("click", () => {
    const id = parseVideoId(videoInput.value);
    if (!id) return;
    getVideoDate(id).then((date) => {
      if (date) {
        const d = new Date(date);
        startInput.value = toLocalInputValue(d);
      }
    });
  });
  const hideCheckVideoResult = () => {
    if (!checkVideoResult) return;
    checkVideoResult.innerHTML = "";
    checkVideoResult.classList.add("is-hidden");
  };
  const showCheckVideoResult = () => {
    if (!checkVideoResult) return;
    checkVideoResult.classList.remove("is-hidden");
  };
  hideCheckVideoResult();
  checkVideoBtn?.addEventListener("click", async () => {
    const id = parseVideoId(checkVideoInput.value);
    if (!id) {
      hideCheckVideoResult();
      return;
    }
    checkVideoResult.textContent = "Loading...";
    showCheckVideoResult();
    getVideoInfo2(id).then(async (resp) => {
      checkVideoResult.innerHTML = "";
      showCheckVideoResult();
      if (resp && resp.info) {
        const info = resp.info;
        const reason = resp.filterReason;
        const filters2 = await getFilters();
        const chFilters = {
          ...filters2.global || {},
          ...filters2.channels[info.channelId] || {}
        };
        const tags = Array.isArray(info.tags) ? info.tags.filter(Boolean) : [];
        let durationSeconds = null;
        if (typeof info.duration === "string") {
          const parsedDuration = parseDuration(info.duration);
          if (Number.isFinite(parsedDuration) && parsedDuration > 0) {
            durationSeconds = parsedDuration;
          }
        } else if (typeof info.duration === "number" && Number.isFinite(info.duration) && info.duration > 0) {
          durationSeconds = info.duration;
        }
        const quickFilter = createQuickFilterBuilder({
          addDurationFilterToSection,
          addPlaylistFilterToSection,
          addTextFilterToSection,
          ensureFilterSection,
          filtersContainer,
          getGlobalSection: () => globalSec,
          info,
          markUnsaved,
          showToast
        });
        renderCheckVideoResult({
          chFilters,
          checkVideoResult,
          durationSeconds,
          info,
          quickFilter,
          reason,
          tags
        });
      } else {
        checkVideoResult.textContent = "Error: " + (resp?.error || "unknown");
      }
    });
  });
  const searchParams = new URLSearchParams(window.location.search);
  const quickFilterVideo = parseVideoId(searchParams.get("quickFilterVideo"));
  if (quickFilterVideo && checkVideoInput) {
    const quickFilterUrl = `https://www.youtube.com/watch?v=${quickFilterVideo}`;
    checkVideoInput.value = quickFilterUrl;
    setTimeout(() => {
      if (typeof checkVideoBtn?.click === "function") {
        checkVideoBtn.click();
      }
    }, 0);
  }
  const filters = await getFilters();
  updateLastSaveDisplay(lastSaveInfo);
  channels = await getChannelMap(Object.keys(filters.channels));
  Object.keys(channels).forEach((id) => {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = channels[id].title || id;
    addChannelSelect.appendChild(opt);
  });
  function createSection(title, data = {}, channelId) {
    return createFilterSection({
      addChannelSelect,
      channels,
      channelId,
      data,
      markUnsaved,
      title,
      updateCheckboxVisibility
    });
  }
  function ensureFilterSection(channelId, channelTitle) {
    if (!channelId) {
      return globalSec || globalContainer?.querySelector(".filter-card");
    }
    if (!filtersContainer) {
      return null;
    }
    let section = filtersContainer.querySelector(
      `.filter-card[data-channel="${channelId}"]`
    );
    if (section) {
      return section;
    }
    const resolvedTitle = channelTitle || channels[channelId]?.title || channelId;
    channels[channelId] = channels[channelId] || { title: resolvedTitle };
    section = createSection(resolvedTitle, {}, channelId);
    filtersContainer.insertBefore(section, addCard);
    const opt = addChannelSelect?.querySelector(
      `option[value="${channelId}"]`
    );
    opt?.remove();
    updateCheckboxVisibility();
    return section;
  }
  globalSec = createSection("\u0413\u043B\u043E\u0431\u0430\u043B\u044C\u043D\u044B\u0435", filters.global, null);
  globalContainer.appendChild(globalSec);
  globalShortsChk = globalSec.querySelector(".nos");
  globalBroadcastChk = globalSec.querySelector(".nob");
  function updateCheckboxVisibility() {
    const hideShorts = globalShortsChk?.checked;
    const hideBroadcasts = globalBroadcastChk?.checked;
    document.querySelectorAll("#filtersContainer .filter-card[data-channel]").forEach((sec) => {
      const s = sec.querySelector(".nos")?.closest("label");
      if (s) s.style.display = hideShorts ? "none" : "";
      const b = sec.querySelector(".nob")?.closest("label");
      if (b) b.style.display = hideBroadcasts ? "none" : "";
    });
  }
  globalShortsChk?.addEventListener("change", updateCheckboxVisibility);
  globalBroadcastChk?.addEventListener("change", updateCheckboxVisibility);
  for (const id of Object.keys(filters.channels)) {
    const chName = channels[id]?.title || id;
    const sec = createSection(chName, filters.channels[id], id);
    filtersContainer.insertBefore(sec, addCard);
  }
  updateCheckboxVisibility();
  Object.keys(filters.channels).forEach((id) => {
    const opt = addChannelSelect.querySelector(`option[value="${id}"]`);
    if (opt) opt.remove();
  });
  addChannelBtn?.addEventListener("click", () => {
    const id = addChannelSelect.value;
    if (!id) return;
    const sec = createSection(channels[id]?.title || id, {}, id);
    filtersContainer.insertBefore(sec, addCard);
    const opt = addChannelSelect.querySelector(`option[value="${id}"]`);
    opt?.remove();
    updateCheckboxVisibility();
    markUnsaved();
  });
  bindFilterPersistence({
    exportBtn,
    floatingSaveBtn,
    importInput,
    lastSaveInfo,
    saveFiltersBtn,
    saveUi,
    setUnsavedChanges,
    showToast,
    updateLastSaveDisplay
  });
});
