// src/background/constants.js
var MESSAGE_SOURCE = "background";
var MAX_API_BATCH = 50;
var COLLECTION_WINDOW_MS = 7 * 24 * 60 * 60 * 1e3;
var COLLECTION_FETCH_OVERLAP_MS = 48 * 60 * 60 * 1e3;

// src/store/state/constants.js
var LEGACY_STORAGE_KEY = "runtimePlaylistState";
var LISTS_STORAGE_KEY = "runtimePlaylistLists";
var META_STORAGE_KEY = "runtimePlaylistMeta";
var RUNTIME_STORAGE_KEY = "runtimePlaylistRuntime";
var VIDEO_PROGRESS_STORAGE_KEY = "runtimePlaylistProgress";
var DELETED_HISTORY_STORAGE_KEY = "runtimePlaylistDeletedHistory";
var AUTO_COLLECT_STORAGE_KEY = "subscriptionsCollect";
var LEGACY_AUTO_COLLECT_STORAGE_KEY = "runtimePlaylistAutoCollect";
var FILTERS_STORAGE_KEY = "filters";
var SYNC_LOCAL_META_STORAGE_KEY = "runtimePlaylistSyncLocal";
var SYNC_MANIFEST_STORAGE_KEY = "runtimePlaylistSyncManifest";
var SYNC_CHUNK_STORAGE_PREFIX = "runtimePlaylistSyncChunk:";
var SETTINGS_SYNC_LOCAL_META_STORAGE_KEY = "runtimeSettingsSyncLocal";
var SETTINGS_SYNC_MANIFEST_STORAGE_KEY = "runtimeSettingsSyncManifest";
var SETTINGS_SYNC_CHUNK_STORAGE_PREFIX = "runtimeSettingsSyncChunk:";
var SYNC_ALARM_NAME = "runtimePlaylistSyncFlush";
var LIST_CONTENT_PREFIX = "runtimePlaylistList:";
var HISTORY_LIMIT = 10;
var DEFAULT_LIST_ID = "default";
var DEFAULT_LIST_NAME = "\u041E\u0441\u043D\u043E\u0432\u043D\u043E\u0439";
var VIDEO_PROGRESS_LIMIT = 500;
var AUTO_COLLECT_SEEN_IDS_LIMIT = 2e3;
var SYNC_DEBOUNCE_MS = 15 * 1e3;
var SYNC_CHUNK_TARGET_BYTES = 7600;
var SYNC_TOTAL_TARGET_BYTES = 98 * 1024;
var SETTINGS_SYNC_TOTAL_TARGET_BYTES = 32 * 1024;
var VIDEO_ID_PATTERN = /^[\w-]{11}$/;
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
function getListStorageKey(id) {
  return `${LIST_CONTENT_PREFIX}${id}`;
}

// src/progress.js
function clampProgressPercent(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  const percent = Math.round(value);
  if (!Number.isFinite(percent)) {
    return null;
  }
  if (percent <= 0) return 0;
  return percent >= 100 ? 100 : percent;
}

// src/store/state/videoProgress.js
function sanitizeVideoProgressEntry(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }
  const percent = clampProgressPercent(entry.percent);
  if (percent === null || percent <= 0) {
    return null;
  }
  const updatedAt = Number.isFinite(entry.updatedAt) ? Math.max(0, Math.trunc(entry.updatedAt)) : Date.now();
  return { percent, updatedAt };
}
function sanitizeVideoProgressMap(raw) {
  const entries = [];
  if (raw && typeof raw === "object") {
    Object.entries(raw).forEach(([key, value]) => {
      if (!VIDEO_ID_PATTERN.test(key)) {
        return;
      }
      const sanitized = sanitizeVideoProgressEntry(value);
      if (!sanitized) {
        return;
      }
      entries.push([key, sanitized]);
    });
  }
  entries.sort((a, b) => {
    const aTime = a[1]?.updatedAt || 0;
    const bTime = b[1]?.updatedAt || 0;
    return bTime - aTime;
  });
  const limited = entries.slice(0, VIDEO_PROGRESS_LIMIT);
  const map = {};
  limited.forEach(([id, value]) => {
    map[id] = { percent: value.percent, updatedAt: value.updatedAt };
  });
  return map;
}
function ensureVideoProgress(state) {
  if (!state || typeof state !== "object") {
    throw new TypeError("State is required to ensure video progress");
  }
  if (!state.videoProgress || typeof state.videoProgress !== "object") {
    state.videoProgress = {};
  }
  return state.videoProgress;
}
function collectTrackedVideoIds(state) {
  const ids = /* @__PURE__ */ new Set();
  if (!state || typeof state !== "object") {
    return ids;
  }
  const lists = state.lists && typeof state.lists === "object" ? state.lists : {};
  Object.values(lists).forEach((list) => {
    if (!list || typeof list !== "object") {
      return;
    }
    const queue = Array.isArray(list.queue) ? list.queue : [];
    queue.forEach((entry) => {
      if (!entry || typeof entry !== "object") {
        return;
      }
      const id = typeof entry.id === "string" ? entry.id.trim() : "";
      if (VIDEO_ID_PATTERN.test(id)) {
        ids.add(id);
      }
    });
  });
  return ids;
}
function enforceVideoProgressLimit(state) {
  const map = ensureVideoProgress(state);
  const keys = Object.keys(map);
  if (keys.length <= VIDEO_PROGRESS_LIMIT) {
    return;
  }
  const overflow = keys.length - VIDEO_PROGRESS_LIMIT;
  const trackedIds = collectTrackedVideoIds(state);
  const entries = keys.map((id) => ({
    id,
    updatedAt: Number(map[id]?.updatedAt) || 0,
    tracked: trackedIds.has(id)
  })).sort((a, b) => a.updatedAt - b.updatedAt);
  let remaining = overflow;
  for (const entry of entries) {
    if (remaining <= 0) {
      break;
    }
    if (entry.tracked) {
      continue;
    }
    if (map[entry.id]) {
      delete map[entry.id];
      remaining -= 1;
    }
  }
  if (remaining <= 0) {
    return;
  }
  for (const entry of entries) {
    if (remaining <= 0) {
      break;
    }
    if (!map[entry.id]) {
      continue;
    }
    delete map[entry.id];
    remaining -= 1;
  }
}
function applyVideoProgress(state, videoId, percent, options = {}) {
  if (!state || typeof state !== "object") {
    return false;
  }
  if (typeof videoId !== "string" || !VIDEO_ID_PATTERN.test(videoId)) {
    return false;
  }
  const clamped = clampProgressPercent(percent);
  const progressMap = ensureVideoProgress(state);
  const existing = progressMap[videoId] || null;
  if (clamped === null || clamped <= 0) {
    if (existing) {
      delete progressMap[videoId];
      return true;
    }
    return false;
  }
  const timestampCandidate = Number(options.timestamp);
  const timestamp = Number.isFinite(timestampCandidate) ? Math.max(0, Math.trunc(timestampCandidate)) : Date.now();
  if (existing) {
    const noChange = existing.percent === clamped && timestamp <= existing.updatedAt;
    if (noChange) {
      return false;
    }
    if (timestamp < existing.updatedAt && clamped <= existing.percent) {
      return false;
    }
  }
  progressMap[videoId] = { percent: clamped, updatedAt: timestamp };
  enforceVideoProgressLimit(state);
  return !existing || existing.percent !== clamped || timestamp !== existing.updatedAt;
}

// src/store/state/sanitizers.js
var SECOND_TS_MIN = 1e9;
var SECOND_TS_MAX = 1e10;
function normalizeAutoCollectTimestamp(value) {
  let ts = Number(value);
  if (!Number.isFinite(ts) || ts <= 0) {
    return 0;
  }
  ts = Math.trunc(ts);
  if (ts >= SECOND_TS_MIN && ts < SECOND_TS_MAX) {
    ts *= 1e3;
  }
  return ts;
}
function sanitizeAutoCollectSeenIds(raw) {
  const source = Array.isArray(raw) ? raw : [];
  const seen = /* @__PURE__ */ new Set();
  const result = [];
  for (let index = source.length - 1; index >= 0; index -= 1) {
    const value = typeof source[index] === "string" ? source[index].trim() : "";
    if (!VIDEO_ID_PATTERN.test(value) || seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
    if (result.length >= AUTO_COLLECT_SEEN_IDS_LIMIT) {
      break;
    }
  }
  return result.reverse();
}
function sanitizeEntry(entry) {
  if (!entry || typeof entry !== "object") {
    throw new TypeError("Invalid playlist entry");
  }
  const {
    id,
    title = "",
    channelId = "",
    channelTitle = "",
    thumbnail = "",
    publishedAt = null,
    duration = null,
    addedAt = Date.now()
  } = entry;
  if (!id) {
    throw new TypeError("Playlist entry must include id");
  }
  return {
    id,
    title,
    channelId,
    channelTitle,
    thumbnail,
    publishedAt: publishedAt instanceof Date ? publishedAt.toISOString() : typeof publishedAt === "string" ? publishedAt : null,
    duration,
    addedAt
  };
}
function sanitizeHistoryEntry(entry) {
  const base = sanitizeEntry(entry);
  return {
    ...base,
    watchedAt: entry?.watchedAt || Date.now(),
    listId: entry?.listId || null
  };
}
function sanitizeDeletedHistoryEntry(entry) {
  const base = sanitizeEntry(entry);
  return {
    ...base,
    deletedAt: entry?.deletedAt || Date.now(),
    listId: entry?.listId || null
  };
}
function ensureDefaultList(state) {
  if (!state.lists[DEFAULT_LIST_ID]) {
    state.lists[DEFAULT_LIST_ID] = {
      id: DEFAULT_LIST_ID,
      name: DEFAULT_LIST_NAME,
      freeze: false,
      queue: [],
      currentIndex: null,
      revision: 0
    };
  } else {
    state.lists[DEFAULT_LIST_ID].name = DEFAULT_LIST_NAME;
    state.lists[DEFAULT_LIST_ID].freeze = false;
    if (!Number.isInteger(state.lists[DEFAULT_LIST_ID].revision)) {
      state.lists[DEFAULT_LIST_ID].revision = 0;
    }
  }
  if (!Array.isArray(state.listOrder) || !state.listOrder.length) {
    state.listOrder = [DEFAULT_LIST_ID];
  } else if (!state.listOrder.includes(DEFAULT_LIST_ID)) {
    state.listOrder.unshift(DEFAULT_LIST_ID);
  }
  if (!state.currentListId || !state.lists[state.currentListId]) {
    state.currentListId = DEFAULT_LIST_ID;
  }
  return state;
}
function sanitizeList(rawList, id) {
  if (!rawList || typeof rawList !== "object") {
    return {
      id,
      name: id === DEFAULT_LIST_ID ? DEFAULT_LIST_NAME : "\u0421\u043F\u0438\u0441\u043E\u043A",
      freeze: false,
      queue: [],
      currentIndex: null,
      revision: 0
    };
  }
  const list = {
    id: rawList.id || id,
    name: rawList.name || (id === DEFAULT_LIST_ID ? DEFAULT_LIST_NAME : "\u0421\u043F\u0438\u0441\u043E\u043A"),
    freeze: id === DEFAULT_LIST_ID ? false : Boolean(rawList.freeze),
    queue: Array.isArray(rawList.queue) ? rawList.queue.map((item) => {
      try {
        return sanitizeEntry(item);
      } catch {
        return null;
      }
    }).filter(Boolean) : [],
    currentIndex: Number.isInteger(rawList.currentIndex) ? rawList.currentIndex : null,
    revision: Number.isInteger(rawList.revision) ? rawList.revision : 0
  };
  if (list.currentIndex === null || list.currentIndex < 0 || list.currentIndex >= list.queue.length) {
    list.currentIndex = list.queue.length ? 0 : null;
  }
  return list;
}
function sanitizeState(raw) {
  if (!raw || typeof raw !== "object") {
    return JSON.parse(JSON.stringify(defaultState));
  }
  const state = {
    lists: {},
    listOrder: Array.isArray(raw.listOrder) ? raw.listOrder.filter((id) => typeof id === "string" && id) : [],
    currentListId: typeof raw.currentListId === "string" && raw.currentListId ? raw.currentListId : DEFAULT_LIST_ID,
    currentVideoId: typeof raw.currentVideoId === "string" ? raw.currentVideoId : null,
    history: Array.isArray(raw.history) ? raw.history.map((item) => {
      try {
        return sanitizeHistoryEntry(item);
      } catch {
        return null;
      }
    }).filter(Boolean).slice(0, HISTORY_LIMIT) : [],
    deletedHistory: Array.isArray(raw.deletedHistory) ? raw.deletedHistory.map((item) => {
      try {
        return sanitizeDeletedHistoryEntry(item);
      } catch {
        return null;
      }
    }).filter(Boolean).slice(0, HISTORY_LIMIT) : [],
    currentTabId: typeof raw.currentTabId === "number" && Number.isInteger(raw.currentTabId) ? raw.currentTabId : null,
    autoCollect: raw.autoCollect && typeof raw.autoCollect === "object" ? {
      lastRunAt: normalizeAutoCollectTimestamp(raw.autoCollect.lastRunAt),
      lastAdded: Math.max(0, Number(raw.autoCollect.lastAdded) || 0),
      lastFetched: Math.max(0, Number(raw.autoCollect.lastFetched) || 0),
      nextAutoCollectAt: normalizeAutoCollectTimestamp(
        raw.autoCollect.nextAutoCollectAt
      ),
      seenIds: sanitizeAutoCollectSeenIds(raw.autoCollect.seenIds)
    } : {
      lastRunAt: 0,
      lastAdded: 0,
      lastFetched: 0,
      nextAutoCollectAt: 0,
      seenIds: []
    },
    videoProgress: sanitizeVideoProgressMap(
      raw && typeof raw === "object" && raw.videoProgress || (raw?.runtime && typeof raw.runtime === "object" ? raw.runtime.videoProgress : null)
    )
  };
  const rawLists = raw.lists && typeof raw.lists === "object" ? raw.lists : {};
  const listIds = new Set(state.listOrder);
  Object.keys(rawLists).forEach((id) => {
    const sanitized = sanitizeList(rawLists[id], id);
    state.lists[id] = sanitized;
    listIds.add(id);
  });
  if (!state.lists[DEFAULT_LIST_ID]) {
    state.lists[DEFAULT_LIST_ID] = sanitizeList(
      rawLists[DEFAULT_LIST_ID],
      DEFAULT_LIST_ID
    );
    listIds.add(DEFAULT_LIST_ID);
  }
  state.listOrder = Array.from(listIds);
  ensureDefaultList(state);
  if (!state.lists[state.currentListId]) {
    state.currentListId = DEFAULT_LIST_ID;
  }
  return state;
}
function ensureListExists(state, listId) {
  if (!listId || !state.lists[listId]) {
    throw new Error(`List ${listId} not found`);
  }
}

// src/utils.js
var YOUTUBE_ID_PATTERN = /[\w-]{11}/;
var PLAYLIST_ID_PATTERN = /[\w-]{13,64}/;
var THUMBNAIL_PRIORITY = ["maxres", "standard", "high", "medium", "default"];
function logMessage(level, context, count, message) {
  const text = `[${context}] item ${count}: ${message}`;
  if (level === "warn") {
    console.warn(text);
  } else {
    console.error(text);
  }
}
function deepClone(value) {
  if (value == null) {
    return value;
  }
  return JSON.parse(JSON.stringify(value));
}
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
function parsePlaylistId(input) {
  if (!input) return "";
  const str = String(input).trim();
  if (str.length === 11) {
    return "";
  }
  if (/^[\w-]{13,64}$/.test(str)) {
    return str;
  }
  try {
    const url = new URL(str, "https://www.youtube.com");
    const listParam = url.searchParams.get("list");
    if (listParam && listParam.length !== 11 && /^[\w-]{13,64}$/.test(listParam)) {
      return listParam;
    }
    const segments = url.pathname.split("/");
    for (const segment of segments) {
      if (segment.length !== 11 && /^[\w-]{13,64}$/.test(segment)) {
        return segment;
      }
    }
  } catch {
  }
  const match = String(input).replace(/content-id-/gi, "").match(PLAYLIST_ID_PATTERN);
  if (!match) {
    return "";
  }
  const candidate = match[0];
  return candidate.length === 11 ? "" : candidate;
}
function pickThumbnailValue(value) {
  if (typeof value === "string" && value) {
    return value;
  }
  if (!value || typeof value !== "object") {
    return "";
  }
  return value.url || value.fallback || value.defaultSrc || "";
}
function pickThumbnailSet(thumbnails) {
  if (!thumbnails || typeof thumbnails !== "object") {
    return "";
  }
  for (const key of THUMBNAIL_PRIORITY) {
    const url = pickThumbnailValue(thumbnails[key]);
    if (url) {
      return url;
    }
  }
  return "";
}
function resolveThumbnailUrl(entry, fallback = "") {
  if (!entry || typeof entry !== "object") {
    return fallback || "";
  }
  return pickThumbnailValue(entry.thumbnail) || pickThumbnailSet(entry.thumbnails) || fallback || "";
}

// src/store/state/serialization.js
function composeRawState(rawMeta, rawRuntime, rawLists, rawAutoCollect, rawDeletedHistory, rawVideoProgress) {
  const meta = rawMeta && typeof rawMeta === "object" ? rawMeta : {};
  const metaLists = meta.lists && typeof meta.lists === "object" ? meta.lists : {};
  const runtime = rawRuntime && typeof rawRuntime === "object" ? rawRuntime : {};
  const runtimeIndices = runtime.listIndices && typeof runtime.listIndices === "object" ? runtime.listIndices : {};
  const listEntries = rawLists && typeof rawLists === "object" ? rawLists : {};
  const listIds = /* @__PURE__ */ new Set([
    ...Object.keys(metaLists),
    ...Object.keys(listEntries),
    ...Object.keys(runtimeIndices)
  ]);
  const lists = {};
  listIds.forEach((id) => {
    const metaEntry = metaLists[id] && typeof metaLists[id] === "object" ? metaLists[id] : {};
    const listEntry = listEntries[id] && typeof listEntries[id] === "object" ? listEntries[id] : {};
    const queueSource = Array.isArray(listEntry.queue) ? listEntry.queue : Array.isArray(listEntry) ? listEntry : [];
    let currentIndex = null;
    if (Number.isInteger(metaEntry.currentIndex)) {
      currentIndex = metaEntry.currentIndex;
    } else if (Number.isInteger(runtimeIndices[id])) {
      currentIndex = runtimeIndices[id];
    } else if (Number.isInteger(listEntry.currentIndex)) {
      currentIndex = listEntry.currentIndex;
    }
    lists[id] = {
      id,
      name: typeof metaEntry.name === "string" && metaEntry.name ? metaEntry.name : typeof listEntry.name === "string" && listEntry.name ? listEntry.name : void 0,
      freeze: typeof metaEntry.freeze === "boolean" ? metaEntry.freeze : typeof listEntry.freeze === "boolean" ? listEntry.freeze : void 0,
      queue: queueSource,
      currentIndex,
      revision: Number.isInteger(metaEntry.revision) ? metaEntry.revision : Number.isInteger(listEntry.revision) ? listEntry.revision : 0
    };
  });
  const metaClone = deepClone(meta);
  delete metaClone.lists;
  const runtimeClone = deepClone(runtime);
  delete runtimeClone.listIndices;
  delete runtimeClone.autoCollect;
  delete runtimeClone.activeListId;
  delete runtimeClone.videoProgress;
  let autoCollect = {};
  if (rawAutoCollect && typeof rawAutoCollect === "object") {
    autoCollect = deepClone(rawAutoCollect);
  } else if (runtime.autoCollect && typeof runtime.autoCollect === "object") {
    autoCollect = deepClone(runtime.autoCollect);
  }
  const deletedHistory = Array.isArray(rawDeletedHistory) ? deepClone(rawDeletedHistory) : Array.isArray(runtime?.deletedHistory) ? deepClone(runtime.deletedHistory) : [];
  const progressSource = rawVideoProgress && typeof rawVideoProgress === "object" ? rawVideoProgress : rawRuntime && typeof rawRuntime === "object" && typeof rawRuntime.videoProgress === "object" ? rawRuntime.videoProgress : null;
  return {
    ...metaClone,
    ...runtimeClone,
    autoCollect,
    lists: deepClone(lists),
    deletedHistory,
    videoProgress: sanitizeVideoProgressMap(progressSource)
  };
}
function splitStateForStorage(state) {
  const listsMeta = {};
  const listContents = {};
  Object.entries(state.lists).forEach(([id, list]) => {
    listsMeta[id] = {
      id: list.id,
      name: list.name,
      freeze: Boolean(list.freeze && id !== DEFAULT_LIST_ID),
      currentIndex: Number.isInteger(list.currentIndex) ? list.currentIndex : null,
      revision: Number.isInteger(list.revision) ? list.revision : 0
    };
    listContents[id] = {
      queue: deepClone(list.queue)
    };
  });
  const meta = deepClone({
    lists: listsMeta,
    listOrder: state.listOrder
  });
  const runtime = deepClone({
    currentListId: state.currentListId,
    currentVideoId: state.currentVideoId,
    history: state.history,
    currentTabId: state.currentTabId
  });
  const autoCollect = deepClone(state.autoCollect);
  const deletedHistory = Array.isArray(state.deletedHistory) ? deepClone(state.deletedHistory) : [];
  const videoProgress = sanitizeVideoProgressMap(state.videoProgress);
  return {
    listContents,
    meta,
    runtime,
    autoCollect,
    deletedHistory,
    videoProgress
  };
}

// src/store/state/syncPayload.js
var COMPACT_SYNC_VERSION = 2;
function compactEntry(entry, extraField = null) {
  const id = typeof entry?.id === "string" ? entry.id.trim() : "";
  if (!id) return null;
  const result = [id];
  if (entry?.addedAt) result.push(entry.addedAt);
  if (entry?.publishedAt) result.push(entry.publishedAt);
  if (extraField) result.push(entry?.[extraField] || 0, entry?.listId || null);
  return result;
}
function expandEntry(entry, extraField = null) {
  const source = Array.isArray(entry) ? entry : [entry?.id];
  const id = typeof source[0] === "string" ? source[0] : "";
  if (!id) return null;
  const expanded = {
    id,
    title: "",
    channelId: "",
    channelTitle: "",
    thumbnail: "",
    publishedAt: typeof source[2] === "string" ? source[2] : null,
    duration: null,
    addedAt: source[1] || Date.now()
  };
  if (extraField) {
    expanded[extraField] = source[3] || Date.now();
    expanded.listId = source[4] || null;
  }
  return expanded;
}
function compactList(list) {
  return {
    n: list.name,
    f: list.freeze && list.id !== DEFAULT_LIST_ID ? 1 : 0,
    r: Number.isInteger(list.revision) ? list.revision : 0,
    q: (list.queue || []).map((entry) => compactEntry(entry)).filter(Boolean)
  };
}
function expandList(id, list) {
  const queue = Array.isArray(list?.q) ? list.q.map((entry) => expandEntry(entry)).filter(Boolean) : [];
  return {
    id,
    name: list?.n || void 0,
    freeze: Boolean(list?.f),
    queue,
    currentIndex: queue.length ? 0 : null,
    revision: Number.isInteger(list?.r) ? list.r : 0
  };
}
function compactProgress(progress = {}) {
  const result = {};
  Object.entries(progress || {}).forEach(([id, value]) => {
    result[id] = [Number(value?.percent) || 0, Number(value?.updatedAt) || 0];
  });
  return result;
}
function expandProgress(progress = {}) {
  const result = {};
  Object.entries(progress || {}).forEach(([id, value]) => {
    const source = Array.isArray(value) ? value : [];
    result[id] = { percent: Number(source[0]) || 0, updatedAt: Number(source[1]) || 0 };
  });
  return result;
}
function buildCompactSyncPayload(stateInput) {
  const state = sanitizeState(stateInput);
  const lists = {};
  Object.entries(state.lists || {}).forEach(([id, list]) => {
    lists[id] = compactList(list);
  });
  return {
    v: COMPACT_SYNC_VERSION,
    l: lists,
    o: state.listOrder,
    h: state.history.map((entry) => compactEntry(entry, "watchedAt")).filter(Boolean),
    d: state.deletedHistory.map((entry) => compactEntry(entry, "deletedAt")).filter(Boolean),
    a: state.autoCollect,
    p: compactProgress(state.videoProgress)
  };
}
function expandCompactSyncPayload(payload) {
  if (!payload || payload.v !== COMPACT_SYNC_VERSION) return null;
  const lists = {};
  Object.entries(payload.l || {}).forEach(([id, list]) => {
    lists[id] = expandList(id, list);
  });
  return sanitizeState({
    lists,
    listOrder: Array.isArray(payload.o) ? payload.o : [DEFAULT_LIST_ID],
    currentListId: DEFAULT_LIST_ID,
    currentVideoId: null,
    currentTabId: null,
    history: Array.isArray(payload.h) ? payload.h.map((entry) => expandEntry(entry, "watchedAt")).filter(Boolean) : [],
    deletedHistory: Array.isArray(payload.d) ? payload.d.map((entry) => expandEntry(entry, "deletedAt")).filter(Boolean) : [],
    autoCollect: payload.a || {},
    videoProgress: expandProgress(payload.p)
  });
}

// src/store/state/syncSnapshot.js
var SYNC_FORMAT_VERSION = 1;
function byteLength(value) {
  return new TextEncoder().encode(String(value)).length;
}
function storageItemBytes(key, value) {
  return byteLength(key) + byteLength(JSON.stringify(value));
}
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
function getSyncChunkKey(index) {
  return `${SYNC_CHUNK_STORAGE_PREFIX}${index}`;
}
function normalizeListForSync(list) {
  const normalized = deepClone(list);
  const queue = Array.isArray(normalized.queue) ? normalized.queue : [];
  normalized.currentIndex = queue.length ? 0 : null;
  return normalized;
}
function normalizeListsForSync(lists) {
  const normalized = {};
  Object.entries(lists || {}).forEach(([id, list]) => {
    normalized[id] = normalizeListForSync(list);
  });
  return normalized;
}
function buildSyncState(stateInput) {
  const state = sanitizeState(stateInput);
  return sanitizeState({
    lists: normalizeListsForSync(state.lists),
    listOrder: deepClone(state.listOrder),
    currentListId: DEFAULT_LIST_ID,
    currentVideoId: null,
    currentTabId: null,
    history: deepClone(state.history),
    deletedHistory: deepClone(state.deletedHistory),
    autoCollect: deepClone(state.autoCollect),
    videoProgress: deepClone(state.videoProgress)
  });
}
function getSyncStateFingerprint(stateInput) {
  return hashString(JSON.stringify(buildCompactSyncPayload(buildSyncState(stateInput))));
}
function hasSyncableUserData(stateInput) {
  const state = sanitizeState(stateInput);
  const listIds = Object.keys(state.lists || {});
  if (listIds.some((id) => id !== DEFAULT_LIST_ID)) {
    return true;
  }
  const hasQueuedVideos = listIds.some((id) => {
    const queue = state.lists[id]?.queue;
    return Array.isArray(queue) && queue.length > 0;
  });
  return hasQueuedVideos || Boolean(state.history?.length) || Boolean(state.deletedHistory?.length) || Boolean(Object.keys(state.videoProgress || {}).length) || Boolean(state.autoCollect?.lastRunAt) || Boolean(state.autoCollect?.seenIds?.length);
}
function findVideoInLists(lists, videoId) {
  if (!videoId || !lists || typeof lists !== "object") {
    return null;
  }
  for (const [listId, list] of Object.entries(lists)) {
    const queue = Array.isArray(list?.queue) ? list.queue : [];
    const index = queue.findIndex((entry) => entry?.id === videoId);
    if (index !== -1) {
      return { listId, index };
    }
  }
  return null;
}
function mergeUniqueQueue(primaryQueue = [], secondaryQueue = []) {
  const seen = /* @__PURE__ */ new Set();
  const merged = [];
  [...primaryQueue, ...secondaryQueue].forEach((entry) => {
    const id = typeof entry?.id === "string" ? entry.id : "";
    if (!id || seen.has(id)) {
      return;
    }
    seen.add(id);
    merged.push(deepClone(entry));
  });
  return merged;
}
function mergeList(primaryList, secondaryList, id) {
  const primary = primaryList || {};
  const secondary = secondaryList || {};
  const queue = mergeUniqueQueue(primary.queue, secondary.queue);
  return normalizeListForSync({
    ...secondary,
    ...primary,
    id,
    queue,
    revision: Math.max(
      Number.isInteger(primary.revision) ? primary.revision : 0,
      Number.isInteger(secondary.revision) ? secondary.revision : 0
    )
  });
}
function mergeLists(primaryLists, secondaryLists) {
  const ids = /* @__PURE__ */ new Set([
    ...Object.keys(primaryLists || {}),
    ...Object.keys(secondaryLists || {})
  ]);
  const merged = {};
  ids.forEach((id) => {
    merged[id] = mergeList(primaryLists?.[id], secondaryLists?.[id], id);
  });
  return merged;
}
function mergeListOrder(primaryOrder = [], secondaryOrder = [], lists = {}) {
  const result = [];
  [...primaryOrder, ...secondaryOrder, DEFAULT_LIST_ID].forEach((id) => {
    if (typeof id === "string" && lists[id] && !result.includes(id)) {
      result.push(id);
    }
  });
  return result;
}
function mergeDatedEntries(primary = [], secondary = [], timestampField) {
  const byId = /* @__PURE__ */ new Map();
  [...primary, ...secondary].forEach((entry) => {
    const id = typeof entry?.id === "string" ? entry.id : "";
    if (!id) {
      return;
    }
    const current = byId.get(id);
    const currentTime = Number(current?.[timestampField]) || 0;
    const nextTime = Number(entry?.[timestampField]) || 0;
    if (!current || nextTime >= currentTime) {
      byId.set(id, deepClone(entry));
    }
  });
  return Array.from(byId.values()).sort((a, b) => (Number(b?.[timestampField]) || 0) - (Number(a?.[timestampField]) || 0)).slice(0, HISTORY_LIMIT);
}
function mergeAutoCollect(primary = {}, secondary = {}) {
  const primaryLastRunAt = normalizeSyncTimestamp(primary.lastRunAt);
  const secondaryLastRunAt = normalizeSyncTimestamp(secondary.lastRunAt);
  const preferPrimaryRun = primaryLastRunAt >= secondaryLastRunAt;
  const seenIds = [
    ...Array.isArray(secondary.seenIds) ? secondary.seenIds : [],
    ...Array.isArray(primary.seenIds) ? primary.seenIds : []
  ];
  return {
    lastRunAt: Math.max(primaryLastRunAt, secondaryLastRunAt),
    lastAdded: Math.max(0, Number((preferPrimaryRun ? primary : secondary).lastAdded) || 0),
    lastFetched: Math.max(0, Number((preferPrimaryRun ? primary : secondary).lastFetched) || 0),
    nextAutoCollectAt: Math.max(
      normalizeSyncTimestamp(primary.nextAutoCollectAt),
      normalizeSyncTimestamp(secondary.nextAutoCollectAt)
    ),
    seenIds: Array.from(new Set(seenIds)).slice(-AUTO_COLLECT_SEEN_IDS_LIMIT)
  };
}
function mergeVideoProgress(primary = {}, secondary = {}) {
  const merged = {};
  const ids = /* @__PURE__ */ new Set([
    ...Object.keys(secondary || {}),
    ...Object.keys(primary || {})
  ]);
  ids.forEach((id) => {
    const a = primary?.[id] || null;
    const b = secondary?.[id] || null;
    if (!a && !b) {
      return;
    }
    merged[id] = {
      percent: Math.max(Number(a?.percent) || 0, Number(b?.percent) || 0),
      updatedAt: Math.max(Number(a?.updatedAt) || 0, Number(b?.updatedAt) || 0)
    };
  });
  return merged;
}
function mergeSyncStatesConservatively(localInput, remoteInput) {
  const local = buildSyncState(localInput);
  const remote = buildSyncState(remoteInput);
  const lists = mergeLists(remote.lists, local.lists);
  return buildSyncState({
    lists,
    listOrder: mergeListOrder(remote.listOrder, local.listOrder, lists),
    history: mergeDatedEntries(remote.history, local.history, "watchedAt"),
    deletedHistory: mergeDatedEntries(
      remote.deletedHistory,
      local.deletedHistory,
      "deletedAt"
    ),
    autoCollect: mergeAutoCollect(remote.autoCollect, local.autoCollect),
    videoProgress: mergeVideoProgress(remote.videoProgress, local.videoProgress)
  });
}
function mergeRemoteSyncState(localInput, remoteInput) {
  const local = sanitizeState(localInput);
  const remote = sanitizeState(remoteInput);
  const merged = sanitizeState({
    ...remote,
    currentTabId: local.currentTabId,
    currentVideoId: null,
    currentListId: DEFAULT_LIST_ID
  });
  if (local.currentListId && merged.lists[local.currentListId]) {
    merged.currentListId = local.currentListId;
  }
  const locatedCurrent = findVideoInLists(merged.lists, local.currentVideoId);
  if (locatedCurrent) {
    merged.currentListId = locatedCurrent.listId;
    merged.currentVideoId = local.currentVideoId;
    merged.lists[locatedCurrent.listId].currentIndex = locatedCurrent.index;
  } else if (!merged.lists[merged.currentListId]) {
    merged.currentListId = DEFAULT_LIST_ID;
  }
  return sanitizeState(merged);
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
      const bytes = storageItemBytes(getSyncChunkKey(chunks.length), candidate);
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
function buildSyncSnapshot(stateInput, { updatedAt, deviceId } = {}) {
  const payload = buildCompactSyncPayload(buildSyncState(stateInput));
  const json = JSON.stringify(payload);
  const hash = hashString(json);
  const chunks = splitStringByStorageBytes(json);
  const manifest = {
    version: SYNC_FORMAT_VERSION,
    updatedAt: normalizeSyncTimestamp(updatedAt) || Date.now(),
    deviceId: typeof deviceId === "string" && deviceId ? deviceId : null,
    hash,
    chunkCount: chunks.length
  };
  const totalBytes = storageItemBytes(SYNC_MANIFEST_STORAGE_KEY, manifest) + chunks.reduce(
    (sum, chunk, index) => sum + storageItemBytes(getSyncChunkKey(index), chunk),
    0
  );
  if (totalBytes > SYNC_TOTAL_TARGET_BYTES) {
    throw new Error(
      `Playlist sync snapshot is too large (${totalBytes} bytes)`
    );
  }
  return { manifest, chunks, hash, totalBytes };
}
function parseSyncSnapshot(manifest, chunks) {
  if (!manifest || typeof manifest !== "object" || manifest.version !== SYNC_FORMAT_VERSION || !Number.isInteger(manifest.chunkCount) || manifest.chunkCount <= 0 || manifest.chunkCount > 100 || !Array.isArray(chunks) || chunks.some((chunk) => typeof chunk !== "string")) {
    return null;
  }
  const json = chunks.join("");
  const hash = hashString(json);
  if (hash !== manifest.hash) {
    return null;
  }
  try {
    const parsed = JSON.parse(json);
    return {
      manifest,
      state: expandCompactSyncPayload(parsed) || buildSyncState(parsed),
      updatedAt: normalizeSyncTimestamp(manifest.updatedAt),
      hash
    };
  } catch {
    return null;
  }
}

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
function defaultSettingsFingerprint() {
  return settingsFingerprint(DEFAULT_FILTERS);
}
function settingsFingerprint(filters) {
  return hashString(JSON.stringify(normalizeSettingsFilters(filters)));
}
function getSettingsChunkKey(index) {
  return `${SETTINGS_SYNC_CHUNK_STORAGE_PREFIX}${index}`;
}
function splitStringByStorageBytes2(value) {
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
  const chunks = splitStringByStorageBytes2(json);
  const manifest = {
    version: SETTINGS_SYNC_FORMAT_VERSION,
    updatedAt: normalizeSyncTimestamp(updatedAt) || Date.now(),
    deviceId: typeof deviceId === "string" && deviceId ? deviceId : null,
    hash,
    chunkCount: chunks.length
  };
  const totalBytes = storageItemBytes(SETTINGS_SYNC_MANIFEST_STORAGE_KEY, manifest) + chunks.reduce(
    (sum, chunk, index) => sum + storageItemBytes(getSettingsChunkKey(index), chunk),
    0
  );
  if (totalBytes > SETTINGS_SYNC_TOTAL_TARGET_BYTES) {
    throw new Error(`Settings sync snapshot is too large (${totalBytes} bytes)`);
  }
  return { manifest, chunks, hash, totalBytes };
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
function mergeArrays(primary = [], secondary = []) {
  return Array.from(/* @__PURE__ */ new Set([...primary, ...secondary]));
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
  const ids = /* @__PURE__ */ new Set([
    ...Object.keys(remote.channels || {}),
    ...Object.keys(local.channels || {})
  ]);
  ids.forEach((id) => {
    channels[id] = mergeRuleSet(remote.channels[id], local.channels[id]);
  });
  return normalizeSettingsFilters({
    global: mergeRuleSet(remote.global, local.global),
    channels
  });
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
async function storageRemove(area, keys) {
  if (hasChromeStorageArea(area) && keys.length) {
    await chrome.storage[area].remove(keys);
  }
}
function createDeviceId() {
  const random = typeof crypto !== "undefined" && crypto?.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
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
function isSettingsSyncStorageChange(changes = {}) {
  return Object.keys(changes).some(
    (key) => key === SETTINGS_SYNC_MANIFEST_STORAGE_KEY || key.startsWith(SETTINGS_SYNC_CHUNK_STORAGE_PREFIX)
  );
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
async function readLocalSettingsFilters() {
  const stored = await storageGet("local", FILTERS_STORAGE_KEY);
  return parseStoredFilters(stored?.[FILTERS_STORAGE_KEY]);
}
async function writeLocalSettingsFilters(filters) {
  await storageSet("local", {
    [FILTERS_STORAGE_KEY]: JSON.stringify(normalizeSettingsFilters(filters))
  });
}
async function scheduleSettingsSync(filtersInput, { immediate = false } = {}) {
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
    baseRemoteHash: meta.pending ? meta.baseRemoteHash || null : meta.remoteHash || meta.syncedHash || null,
    pending: true,
    pendingSince: meta.pendingSince || now,
    flushAfter: dueAt,
    lastError: null
  });
  await scheduleAlarm(dueAt);
}
async function flushPendingSettingsSync({ force = false } = {}) {
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
  const filtersToWrite = conflict ? mergeFiltersConservatively(localFilters, remote.filters) : localFilters;
  const updatedAt = conflict ? now : normalizeSyncTimestamp(meta.localUpdatedAt) || now;
  let snapshot;
  try {
    snapshot = buildSettingsSnapshot(filtersToWrite, { updatedAt, deviceId });
  } catch (err) {
    await writeLocalMeta({
      ...meta,
      pending: false,
      lastError: err?.message || String(err),
      lastErrorAt: now
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
    lastBytes: snapshot.totalBytes
  });
  return { wrote: true, conflictMerged: conflict, updatedAt };
}
async function pushLocalSettingsSyncNow() {
  const filters = await readLocalSettingsFilters();
  await scheduleSettingsSync(filters, { immediate: true });
  const result = await flushPendingSettingsSync({ force: true });
  return { ...result, pushed: Boolean(result?.wrote) };
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
    if (settingsFingerprint(localFilters) !== defaultSettingsFingerprint()) {
      await scheduleSettingsSync(localFilters);
    }
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
async function importRemoteSettingsSync({ force = false } = {}) {
  const localFilters = await readLocalSettingsFilters();
  const remote = await readRemoteSettingsSyncSnapshot();
  if (!remote) return { imported: false, reason: "no-remote" };
  const meta = await readLocalMeta();
  const localUpdatedAt = normalizeSyncTimestamp(meta.localUpdatedAt);
  const shouldImport = force || !meta.pending || remote.updatedAt > localUpdatedAt;
  if (!shouldImport) return { imported: false, reason: "local-pending" };
  const filters = force ? remote.filters : mergeFiltersConservatively(localFilters, remote.filters);
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
    lastError: null
  });
  if (!force && settingsFingerprint(filters) !== remote.hash) {
    await scheduleSettingsSync(filters);
  }
  return { imported: true, force, updatedAt: remote.updatedAt };
}
async function getSettingsSyncStatus() {
  const [meta, remote] = await Promise.all([
    readLocalMeta(),
    readRemoteSettingsSyncSnapshot()
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
    remoteAvailable: Boolean(remote)
  };
}

// src/store/state/sync.js
function hasChromeStorageArea2(area) {
  return typeof chrome !== "undefined" && chrome?.storage && chrome.storage[area];
}
async function storageGet2(area, keys) {
  if (!hasChromeStorageArea2(area)) {
    return {};
  }
  return chrome.storage[area].get(keys);
}
async function storageSet2(area, payload) {
  if (!hasChromeStorageArea2(area)) {
    return;
  }
  await chrome.storage[area].set(payload);
}
async function storageRemove2(area, keys) {
  if (!hasChromeStorageArea2(area) || !keys.length) {
    return;
  }
  await chrome.storage[area].remove(keys);
}
function createDeviceId2() {
  const random = typeof crypto !== "undefined" && crypto?.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
  return `device_${Date.now().toString(36)}_${random}`;
}
async function readLocalSyncMeta() {
  const stored = await storageGet2("local", SYNC_LOCAL_META_STORAGE_KEY);
  const meta = stored?.[SYNC_LOCAL_META_STORAGE_KEY];
  return meta && typeof meta === "object" ? meta : {};
}
async function writeLocalSyncMeta(meta) {
  await storageSet2("local", {
    [SYNC_LOCAL_META_STORAGE_KEY]: {
      ...meta,
      deviceId: typeof meta.deviceId === "string" && meta.deviceId ? meta.deviceId : createDeviceId2()
    }
  });
}
async function ensureLocalDeviceId(meta = null) {
  const current = meta || await readLocalSyncMeta();
  if (typeof current.deviceId === "string" && current.deviceId) {
    return current.deviceId;
  }
  const deviceId = createDeviceId2();
  await writeLocalSyncMeta({ ...current, deviceId });
  return deviceId;
}
async function readRemotePlaylistSyncSnapshot() {
  if (!hasChromeStorageArea2("sync")) {
    return null;
  }
  const storedManifest = await storageGet2("sync", SYNC_MANIFEST_STORAGE_KEY);
  const manifest = storedManifest?.[SYNC_MANIFEST_STORAGE_KEY];
  if (!manifest || !Number.isInteger(manifest.chunkCount)) {
    return null;
  }
  const keys = Array.from(
    { length: manifest.chunkCount },
    (_, index) => getSyncChunkKey(index)
  );
  const storedChunks = await storageGet2("sync", keys);
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
async function configurePlaylistSyncAccess() {
  if (!hasChromeStorageArea2("sync")) return;
  try {
    await chrome.storage.sync.setAccessLevel?.({
      accessLevel: "TRUSTED_CONTEXTS"
    });
  } catch {
  }
}
function isPlaylistSyncStorageChange(changes = {}) {
  return Object.keys(changes).some(
    (key) => key === SYNC_MANIFEST_STORAGE_KEY || key.startsWith(SYNC_CHUNK_STORAGE_PREFIX)
  );
}
async function resolveRemotePlaylistSyncState(localStateInput) {
  const localState = sanitizeState(localStateInput);
  const localMeta = await readLocalSyncMeta();
  const remote = await readRemotePlaylistSyncSnapshot();
  if (localMeta.pending) {
    const flushAfter = normalizeSyncTimestamp(localMeta.flushAfter) || Date.now() + SYNC_DEBOUNCE_MS;
    await scheduleSyncAlarm(flushAfter);
  }
  if (!remote) {
    if (hasChromeStorageArea2("sync") && !localMeta.localHash && hasSyncableUserData(localState)) {
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
        lastError: null
      });
      await scheduleSyncAlarm(dueAt);
    }
    return { state: localState, imported: false };
  }
  const localUpdatedAt = normalizeSyncTimestamp(localMeta.localUpdatedAt);
  const shouldImport = !localMeta.pending && (!hasSyncableUserData(localState) && remote.updatedAt > 0 || localUpdatedAt > 0 && remote.updatedAt > localUpdatedAt);
  if (!shouldImport) {
    await writeLocalSyncMeta({
      ...localMeta,
      remoteUpdatedAt: remote.updatedAt,
      remoteHash: remote.hash
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
    lastError: null
  });
  return { state: merged, imported: true, remoteUpdatedAt: remote.updatedAt };
}
async function forceRemotePlaylistSyncState(localStateInput) {
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
    lastError: null
  });
  return { state: merged, imported: true, remoteUpdatedAt: remote.updatedAt };
}
async function getPlaylistSyncStatus() {
  const [meta, remote] = await Promise.all([
    readLocalSyncMeta(),
    readRemotePlaylistSyncSnapshot()
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
    remoteAvailable: Boolean(remote)
  };
}
async function schedulePlaylistSync(stateInput, { immediate = false } = {}) {
  if (!hasChromeStorageArea2("sync") || !hasChromeStorageArea2("local")) {
    return;
  }
  const localMeta = await readLocalSyncMeta();
  const localHash = getSyncStateFingerprint(stateInput);
  if (localHash === localMeta.localHash && !immediate) {
    if (localMeta.pending) {
      const flushAfter = normalizeSyncTimestamp(localMeta.flushAfter) || Date.now() + SYNC_DEBOUNCE_MS;
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
    baseRemoteHash: localMeta.pending ? localMeta.baseRemoteHash || null : localMeta.remoteHash || localMeta.syncedHash || null,
    baseRemoteUpdatedAt: localMeta.pending ? normalizeSyncTimestamp(localMeta.baseRemoteUpdatedAt) : normalizeSyncTimestamp(localMeta.remoteUpdatedAt) || normalizeSyncTimestamp(localMeta.syncedUpdatedAt),
    pending: true,
    pendingSince: localMeta.pendingSince || now,
    flushAfter: dueAt,
    lastError: null
  });
  await scheduleSyncAlarm(dueAt);
}
async function writePendingPlaylistSync(stateInput, { force = false } = {}) {
  if (!hasChromeStorageArea2("sync") || !hasChromeStorageArea2("local")) {
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
      lastErrorAt: now
    });
    return { wrote: false, reason: "too-large" };
  }
  const previousRemote = await readRemotePlaylistSyncSnapshot();
  const remoteFromOtherDevice = previousRemote && previousRemote.manifest?.deviceId !== deviceId;
  const baseRemoteHash = typeof localMeta.baseRemoteHash === "string" && localMeta.baseRemoteHash ? localMeta.baseRemoteHash : null;
  const remoteChangedSinceBase = remoteFromOtherDevice && previousRemote && (baseRemoteHash ? previousRemote.hash !== baseRemoteHash : true);
  const remoteNewerThanLocal = remoteFromOtherDevice && previousRemote.updatedAt > updatedAt;
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
        deviceId
      });
    } catch (err) {
      await writeLocalSyncMeta({
        ...localMeta,
        pending: false,
        lastError: err?.message || String(err),
        lastErrorAt: now
      });
      return { wrote: false, reason: "merged-too-large" };
    }
  }
  const payload = { [SYNC_MANIFEST_STORAGE_KEY]: snapshot.manifest };
  snapshot.chunks.forEach((chunk, index) => {
    payload[getSyncChunkKey(index)] = chunk;
  });
  await storageSet2("sync", payload);
  const previousCount = previousRemote?.manifest?.chunkCount || 0;
  const staleKeys = [];
  for (let index = snapshot.chunks.length; index < previousCount; index += 1) {
    staleKeys.push(getSyncChunkKey(index));
  }
  await storageRemove2("sync", staleKeys);
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
    lastBytes: snapshot.totalBytes
  });
  return {
    wrote: true,
    updatedAt: snapshotUpdatedAt,
    chunkCount: snapshot.chunks.length,
    conflictMerged,
    mergedState: conflictMerged ? stateToWrite : null
  };
}

// src/store/state/storage.js
var hasChromeStorage = typeof chrome !== "undefined" && chrome?.storage?.local;
var memoryState = null;
var stateWriteQueue = Promise.resolve();
var checkedRemotePlaylistSync = false;
function enqueueStateWrite(operation) {
  const result = stateWriteQueue.then(operation, operation);
  stateWriteQueue = result.catch(() => {
  });
  return result;
}
async function loadLocalRawState() {
  if (!hasChromeStorage) {
    const source = memoryState ?? defaultState;
    return deepClone(source);
  }
  const stored = await chrome.storage.local.get([
    META_STORAGE_KEY,
    RUNTIME_STORAGE_KEY,
    VIDEO_PROGRESS_STORAGE_KEY,
    LISTS_STORAGE_KEY,
    LEGACY_STORAGE_KEY,
    AUTO_COLLECT_STORAGE_KEY,
    LEGACY_AUTO_COLLECT_STORAGE_KEY,
    DELETED_HISTORY_STORAGE_KEY
  ]);
  if (stored?.[LEGACY_STORAGE_KEY]) {
    const migrated = sanitizeState(stored[LEGACY_STORAGE_KEY]);
    const {
      listContents,
      meta: meta2,
      runtime: runtime2,
      autoCollect: autoCollect2,
      deletedHistory,
      videoProgress
    } = splitStateForStorage(migrated);
    const payload = {
      [META_STORAGE_KEY]: meta2,
      [RUNTIME_STORAGE_KEY]: runtime2,
      [AUTO_COLLECT_STORAGE_KEY]: autoCollect2,
      [DELETED_HISTORY_STORAGE_KEY]: deletedHistory,
      [VIDEO_PROGRESS_STORAGE_KEY]: videoProgress
    };
    Object.entries(listContents).forEach(([id, content]) => {
      payload[getListStorageKey(id)] = content;
    });
    await chrome.storage.local.set(payload);
    await chrome.storage.local.remove([
      LEGACY_STORAGE_KEY,
      LISTS_STORAGE_KEY,
      LEGACY_AUTO_COLLECT_STORAGE_KEY
    ]);
    return composeRawState(
      meta2,
      runtime2,
      listContents,
      autoCollect2,
      deletedHistory,
      videoProgress
    );
  }
  if (stored?.[LISTS_STORAGE_KEY]) {
    const migrated = composeRawState(
      stored?.[META_STORAGE_KEY],
      stored?.[RUNTIME_STORAGE_KEY],
      stored?.[LISTS_STORAGE_KEY],
      stored?.[AUTO_COLLECT_STORAGE_KEY] || stored?.[LEGACY_AUTO_COLLECT_STORAGE_KEY],
      stored?.[DELETED_HISTORY_STORAGE_KEY]
    );
    const sanitized = sanitizeState(migrated);
    const {
      listContents,
      meta: meta2,
      runtime: runtime2,
      autoCollect: autoCollect2,
      deletedHistory,
      videoProgress
    } = splitStateForStorage(sanitized);
    const payload = {
      [META_STORAGE_KEY]: meta2,
      [RUNTIME_STORAGE_KEY]: runtime2,
      [AUTO_COLLECT_STORAGE_KEY]: autoCollect2,
      [DELETED_HISTORY_STORAGE_KEY]: deletedHistory,
      [VIDEO_PROGRESS_STORAGE_KEY]: videoProgress
    };
    Object.entries(listContents).forEach(([id, content]) => {
      payload[getListStorageKey(id)] = content;
    });
    await chrome.storage.local.set(payload);
    await chrome.storage.local.remove([
      LISTS_STORAGE_KEY,
      LEGACY_AUTO_COLLECT_STORAGE_KEY
    ]);
    return composeRawState(
      meta2,
      runtime2,
      listContents,
      autoCollect2,
      deletedHistory,
      videoProgress
    );
  }
  const meta = stored?.[META_STORAGE_KEY] && typeof stored[META_STORAGE_KEY] === "object" ? stored[META_STORAGE_KEY] : {};
  const runtime = stored?.[RUNTIME_STORAGE_KEY] && typeof stored[RUNTIME_STORAGE_KEY] === "object" ? stored[RUNTIME_STORAGE_KEY] : {};
  const autoCollectSource = (stored?.[AUTO_COLLECT_STORAGE_KEY] && typeof stored[AUTO_COLLECT_STORAGE_KEY] === "object" ? stored[AUTO_COLLECT_STORAGE_KEY] : null) || (stored?.[LEGACY_AUTO_COLLECT_STORAGE_KEY] && typeof stored[LEGACY_AUTO_COLLECT_STORAGE_KEY] === "object" ? stored[LEGACY_AUTO_COLLECT_STORAGE_KEY] : null) || runtime?.autoCollect;
  const autoCollect = autoCollectSource;
  const deletedHistorySource = Array.isArray(
    stored?.[DELETED_HISTORY_STORAGE_KEY]
  ) ? stored[DELETED_HISTORY_STORAGE_KEY] : runtime?.deletedHistory;
  const videoProgressSource = stored?.[VIDEO_PROGRESS_STORAGE_KEY] && typeof stored[VIDEO_PROGRESS_STORAGE_KEY] === "object" ? stored[VIDEO_PROGRESS_STORAGE_KEY] : runtime?.videoProgress;
  const listIds = Object.keys(
    meta.lists && typeof meta.lists === "object" ? meta.lists : {}
  );
  const listKeys = listIds.map(getListStorageKey);
  let listEntries = {};
  if (listKeys.length) {
    const storedLists = await chrome.storage.local.get(listKeys);
    listEntries = listIds.reduce((acc, id) => {
      const key = getListStorageKey(id);
      if (storedLists && storedLists[key]) {
        acc[id] = storedLists[key];
      }
      return acc;
    }, {});
  }
  return composeRawState(
    meta,
    runtime,
    listEntries,
    autoCollect,
    deletedHistorySource,
    videoProgressSource
  );
}
async function loadRawState({ checkRemoteSync = true } = {}) {
  const localRaw = await loadLocalRawState();
  if (!hasChromeStorage || !checkRemoteSync || checkedRemotePlaylistSync) {
    return localRaw;
  }
  checkedRemotePlaylistSync = true;
  const resolved = await resolveRemotePlaylistSyncState(localRaw);
  if (resolved.imported) {
    await persistState(resolved.state, { scheduleSync: false });
  }
  return resolved.state;
}
async function persistState(state, { scheduleSync = true } = {}) {
  if (!hasChromeStorage) {
    memoryState = deepClone(state);
    return state;
  }
  const {
    listContents,
    meta,
    runtime,
    autoCollect,
    deletedHistory,
    videoProgress
  } = splitStateForStorage(state);
  const payload = {
    [META_STORAGE_KEY]: meta,
    [RUNTIME_STORAGE_KEY]: runtime,
    [AUTO_COLLECT_STORAGE_KEY]: autoCollect,
    [DELETED_HISTORY_STORAGE_KEY]: deletedHistory,
    [VIDEO_PROGRESS_STORAGE_KEY]: videoProgress
  };
  Object.entries(listContents).forEach(([id, content]) => {
    payload[getListStorageKey(id)] = content;
  });
  const existingMeta = await chrome.storage.local.get(META_STORAGE_KEY);
  const previousLists = existingMeta?.[META_STORAGE_KEY]?.lists && typeof existingMeta[META_STORAGE_KEY].lists === "object" ? existingMeta[META_STORAGE_KEY].lists : {};
  const nextListIds = Object.keys(listContents);
  const toRemove = Object.keys(previousLists).filter((id) => !nextListIds.includes(id)).map(getListStorageKey);
  if (toRemove.length) {
    await chrome.storage.local.remove(toRemove);
  }
  await chrome.storage.local.set(payload);
  if (LEGACY_AUTO_COLLECT_STORAGE_KEY !== AUTO_COLLECT_STORAGE_KEY) {
    await chrome.storage.local.remove(LEGACY_AUTO_COLLECT_STORAGE_KEY);
  }
  if (scheduleSync) {
    await schedulePlaylistSync(state);
  }
  return state;
}
async function getState() {
  const raw = await loadRawState();
  return sanitizeState(raw);
}
async function replaceState(newState) {
  return enqueueStateWrite(async () => {
    const sanitized = sanitizeState(newState);
    await persistState(sanitized);
    return sanitized;
  });
}
async function mutateState(mutator) {
  return enqueueStateWrite(async () => {
    const current = await getState();
    const updated = await Promise.resolve(mutator(current));
    if (!updated || typeof updated !== "object") {
      throw new TypeError("State mutator must return updated state");
    }
    const sanitized = sanitizeState(updated);
    await persistState(sanitized);
    return sanitized;
  });
}
async function importRemotePlaylistSyncIfNewer() {
  return enqueueStateWrite(async () => {
    const localRaw = await loadLocalRawState();
    const resolved = await resolveRemotePlaylistSyncState(localRaw);
    if (resolved.imported) {
      await persistState(resolved.state, { scheduleSync: false });
      return { imported: true, state: sanitizeState(resolved.state) };
    }
    return { imported: false, state: sanitizeState(localRaw) };
  });
}
async function replaceLocalPlaylistSyncFromRemote() {
  return enqueueStateWrite(async () => {
    const localRaw = await loadLocalRawState();
    const resolved = await forceRemotePlaylistSyncState(localRaw);
    if (resolved.imported) {
      await persistState(resolved.state, { scheduleSync: false });
      return { imported: true, state: sanitizeState(resolved.state) };
    }
    return { imported: false, reason: resolved.reason || "no-remote" };
  });
}
async function pushLocalPlaylistSyncNow() {
  return enqueueStateWrite(async () => {
    const localRaw = await loadRawState({ checkRemoteSync: false });
    await schedulePlaylistSync(localRaw, { immediate: true });
    const result = await writePendingPlaylistSync(localRaw, { force: true });
    return { ...result, pushed: Boolean(result?.wrote) };
  });
}
async function getPlaylistSyncStorageStatus() {
  return getPlaylistSyncStatus();
}
async function flushPendingPlaylistSync() {
  return enqueueStateWrite(async () => {
    const localRaw = await loadRawState({ checkRemoteSync: false });
    const result = await writePendingPlaylistSync(localRaw);
    if (result?.mergedState) {
      await persistState(result.mergedState, { scheduleSync: false });
    }
    return result;
  });
}

// src/store/actions/core.js
var AUTO_COLLECT_COOLDOWN_MS = 60 * 60 * 1e3;
function withState(mutator) {
  return mutateState((state) => {
    ensureDefaultList(state);
    return mutator(state);
  });
}
function resolveList(state, listId, { fallback = true } = {}) {
  if (listId && state.lists[listId]) {
    return state.lists[listId];
  }
  if (!fallback) {
    return null;
  }
  const targetId = state.currentListId && state.lists[state.currentListId] ? state.currentListId : DEFAULT_LIST_ID;
  ensureListExists(state, targetId);
  return state.lists[targetId];
}
function ensureNotificationQueue(state) {
  if (!Array.isArray(state.pendingNotifications)) {
    state.pendingNotifications = [];
  }
  return state.pendingNotifications;
}
function ensureAutoCollectMeta(state) {
  if (!state.autoCollect || typeof state.autoCollect !== "object") {
    state.autoCollect = {
      lastRunAt: 0,
      lastAdded: 0,
      lastFetched: 0,
      nextAutoCollectAt: 0,
      seenIds: []
    };
  } else {
    state.autoCollect.lastRunAt = normalizeAutoCollectTimestamp(
      state.autoCollect.lastRunAt
    );
    state.autoCollect.lastAdded = Math.max(
      0,
      Number(state.autoCollect.lastAdded) || 0
    );
    state.autoCollect.lastFetched = Math.max(
      0,
      Number(state.autoCollect.lastFetched) || 0
    );
    state.autoCollect.nextAutoCollectAt = normalizeAutoCollectTimestamp(
      state.autoCollect.nextAutoCollectAt
    );
    state.autoCollect.seenIds = sanitizeAutoCollectSeenIds(
      state.autoCollect.seenIds
    );
  }
  return state.autoCollect;
}
function cloneAutoCollectMeta(meta) {
  return {
    lastRunAt: normalizeAutoCollectTimestamp(meta.lastRunAt),
    lastAdded: Math.max(0, Number(meta.lastAdded) || 0),
    lastFetched: Math.max(0, Number(meta.lastFetched) || 0),
    nextAutoCollectAt: normalizeAutoCollectTimestamp(meta.nextAutoCollectAt)
  };
}
function rememberAutoCollectSeenIds(state, ids = []) {
  if (!state || typeof state !== "object" || !Array.isArray(ids) || !ids.length) {
    return;
  }
  const meta = ensureAutoCollectMeta(state);
  meta.seenIds = sanitizeAutoCollectSeenIds([...meta.seenIds || [], ...ids]);
}
function bumpListRevision(list) {
  if (!list || typeof list !== "object") {
    return;
  }
  const current = Number.isInteger(list.revision) ? list.revision : 0;
  list.revision = current + 1;
}
function toTimestamp(value) {
  if (value instanceof Date) {
    const ts = value.getTime();
    return Number.isNaN(ts) ? null : Math.max(0, Math.trunc(ts));
  }
  if (typeof value === "string") {
    const dt = new Date(value);
    const ts = dt.getTime();
    return Number.isNaN(ts) ? null : Math.max(0, Math.trunc(ts));
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.trunc(value));
  }
  return null;
}
function markListEmpty(state, list) {
  const notifications = ensureNotificationQueue(state);
  notifications.push({
    type: "listEmpty",
    listId: list.id,
    name: list.name
  });
}
function adjustIndexAfterRemoval(list, removedIndex) {
  if (list.currentIndex === null) {
    return;
  }
  if (removedIndex < list.currentIndex) {
    list.currentIndex -= 1;
  } else if (removedIndex === list.currentIndex) {
    if (list.queue.length) {
      list.currentIndex = Math.min(removedIndex, list.queue.length - 1);
      if (removedIndex >= list.queue.length && list.queue.length > 0) {
        list.currentIndex = 0;
      }
    } else {
      list.currentIndex = null;
    }
  }
  if (!list.queue.length) {
    list.currentIndex = null;
  } else if (list.currentIndex === null || list.currentIndex < 0 || list.currentIndex >= list.queue.length) {
    list.currentIndex = 0;
  }
}
function findVideo(state, videoId, { preferListId = null } = {}) {
  const searchLists = [];
  if (preferListId && state.lists[preferListId]) {
    searchLists.push(state.lists[preferListId]);
  }
  for (const list of Object.values(state.lists)) {
    if (list && list.id === preferListId) {
      continue;
    }
    searchLists.push(list);
  }
  for (const list of searchLists) {
    const index = list.queue.findIndex((item) => item.id === videoId);
    if (index !== -1) {
      return { list, index };
    }
  }
  return null;
}
function appendHistory(state, entry, listId) {
  state.history.unshift(
    sanitizeHistoryEntry({ ...entry, listId, watchedAt: Date.now() })
  );
  state.history = state.history.slice(0, HISTORY_LIMIT);
}
function ensureDeletedHistory(state) {
  if (!Array.isArray(state.deletedHistory)) {
    state.deletedHistory = [];
  }
  return state.deletedHistory;
}
function appendDeletedHistory(state, entry, listId) {
  try {
    const history = ensureDeletedHistory(state);
    const sanitized = sanitizeDeletedHistoryEntry({
      ...entry,
      listId,
      deletedAt: Date.now()
    });
    state.deletedHistory = history.filter((item) => item.id !== sanitized.id);
    state.deletedHistory.unshift(sanitized);
    state.deletedHistory = state.deletedHistory.slice(0, HISTORY_LIMIT);
  } catch {
  }
}
function ensureDefaultRefreshFlag(state) {
  const defaultList = state.lists[DEFAULT_LIST_ID];
  if (!defaultList) return;
  if (defaultList.queue.length <= 2) {
    state.pendingDefaultRefresh = true;
  } else {
    state.pendingDefaultRefresh = false;
  }
}
function generateListId() {
  return `list_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

// src/store/actions/autoCollect.js
async function setAutoCollectStartDate(value) {
  const ts = toTimestamp(value);
  if (ts === null) {
    return getAutoCollectMeta();
  }
  const state = await withState((state2) => {
    const meta = ensureAutoCollectMeta(state2);
    meta.lastRunAt = ts;
    return state2;
  });
  return cloneAutoCollectMeta(ensureAutoCollectMeta(state));
}
async function shouldAutoRefreshDefault() {
  const state = await getState();
  const defaultList = state.lists[DEFAULT_LIST_ID];
  const meta = ensureAutoCollectMeta(state);
  const queueLength = defaultList ? defaultList.queue.length : 0;
  const needRefresh = Boolean(state.pendingDefaultRefresh) || defaultList && queueLength <= 2;
  const now = Date.now();
  const onCooldown = meta.nextAutoCollectAt && meta.nextAutoCollectAt > now && needRefresh;
  return {
    shouldCollect: needRefresh && !onCooldown,
    onCooldown,
    queueLength
  };
}
async function clearPendingDefaultRefresh() {
  return withState((state) => {
    delete state.pendingDefaultRefresh;
    return state;
  });
}
async function consumePendingNotifications() {
  const state = await getState();
  const notifications = Array.isArray(state.pendingNotifications) ? state.pendingNotifications.slice() : [];
  if (notifications.length) {
    state.pendingNotifications = [];
    await replaceState(state);
  }
  return notifications;
}
async function getAutoCollectMeta() {
  const state = await getState();
  const meta = ensureAutoCollectMeta(state);
  return cloneAutoCollectMeta(meta);
}
async function recordDefaultAutoCollect({
  added = 0,
  fetched = 0,
  startedAt = null
} = {}) {
  return withState((state) => {
    const meta = ensureAutoCollectMeta(state);
    const now = Date.now();
    const runStartedAt = toTimestamp(startedAt);
    meta.lastRunAt = runStartedAt !== null ? runStartedAt : now;
    meta.lastAdded = Math.max(0, Number(added) || 0);
    meta.lastFetched = Math.max(0, Number(fetched) || 0);
    meta.nextAutoCollectAt = now + AUTO_COLLECT_COOLDOWN_MS;
    return state;
  });
}
async function queueListEmptyNotification(listId = DEFAULT_LIST_ID) {
  if (!listId) return getState();
  return withState((state) => {
    ensureListExists(state, listId);
    const list = state.lists[listId];
    markListEmpty(state, list);
    return state;
  });
}

// src/store/actions/history.js
async function playHistoryEntry(position = 0, options = {}) {
  const placement = options.placement || "front";
  return withState((state) => {
    if (!state.history.length) {
      return state;
    }
    const idx = Math.min(
      Math.max(Number(position) || 0, 0),
      state.history.length - 1
    );
    const [entry] = state.history.splice(idx, 1);
    if (!entry) return state;
    const preferredListId = entry.listId && state.lists[entry.listId] ? entry.listId : null;
    const list = resolveList(state, preferredListId);
    const revived = sanitizeEntry({ ...entry, addedAt: Date.now() });
    const existingIndex = list.queue.findIndex(
      (item) => item.id === revived.id
    );
    if (existingIndex !== -1) {
      list.queue.splice(existingIndex, 1);
      adjustIndexAfterRemoval(list, existingIndex);
    }
    let insertIndex = 0;
    if (placement === "beforeCurrent") {
      insertIndex = list.currentIndex !== null ? Math.max(list.currentIndex, 0) : 0;
    } else if (placement === "end") {
      insertIndex = list.queue.length;
    }
    list.queue.splice(insertIndex, 0, revived);
    if (list.id === DEFAULT_LIST_ID) {
      rememberAutoCollectSeenIds(state, [revived.id]);
    }
    list.currentIndex = insertIndex;
    state.currentListId = list.id;
    state.currentVideoId = revived.id;
    bumpListRevision(list);
    if (list.id === DEFAULT_LIST_ID) {
      ensureDefaultRefreshFlag(state);
    }
    return state;
  });
}
async function restoreDeletedEntry(position = 0) {
  return withState((state) => {
    const history = ensureDeletedHistory(state);
    if (!history.length) {
      return state;
    }
    const idx = Math.min(Math.max(Number(position) || 0, 0), history.length - 1);
    const [entry] = history.splice(idx, 1);
    if (!entry) {
      return state;
    }
    const preferredListId = entry.listId && state.lists[entry.listId] ? entry.listId : null;
    const list = resolveList(state, preferredListId);
    const revived = sanitizeEntry({ ...entry, addedAt: Date.now() });
    const existingIndex = list.queue.findIndex((item) => item.id === revived.id);
    if (existingIndex !== -1) {
      list.queue.splice(existingIndex, 1);
      adjustIndexAfterRemoval(list, existingIndex);
    }
    list.queue.push(revived);
    if (list.id === DEFAULT_LIST_ID) {
      rememberAutoCollectSeenIds(state, [revived.id]);
    }
    bumpListRevision(list);
    if (list.currentIndex === null) {
      list.currentIndex = 0;
    }
    if (list.id === DEFAULT_LIST_ID) {
      ensureDefaultRefreshFlag(state);
    }
    return state;
  });
}

// src/store/actions/queue.js
async function addVideos(entries = [], listId = null) {
  if (!Array.isArray(entries) || !entries.length) {
    return getState();
  }
  return withState((state) => {
    const list = resolveList(state, listId);
    const existingIds = new Set(list.queue.map((item) => item.id));
    const incoming = [];
    for (const entry of entries) {
      try {
        const sanitized = sanitizeEntry(entry);
        if (!existingIds.has(sanitized.id)) {
          existingIds.add(sanitized.id);
          incoming.push(sanitized);
        }
      } catch {
      }
    }
    if (!incoming.length) {
      return state;
    }
    list.queue = list.queue.concat(incoming);
    if (list.id === DEFAULT_LIST_ID) {
      rememberAutoCollectSeenIds(
        state,
        incoming.map((entry) => entry.id)
      );
    }
    bumpListRevision(list);
    if (list.currentIndex === null && list.queue.length) {
      list.currentIndex = 0;
    }
    if (list.id === DEFAULT_LIST_ID) {
      ensureDefaultRefreshFlag(state);
    }
    return state;
  });
}
async function removeVideos(videoIds, { listId = null } = {}) {
  const ids = Array.isArray(videoIds) ? videoIds : [videoIds];
  const uniqueIds = Array.from(
    new Set(
      ids.map((value) => typeof value === "string" ? value.trim() : "").filter((id) => id.length > 0)
    )
  );
  if (!uniqueIds.length) {
    return getState();
  }
  return withState((state) => {
    const targets = listId ? [resolveList(state, listId, { fallback: false })].filter(Boolean) : Object.values(state.lists);
    if (!targets.length) {
      return state;
    }
    const idSet = new Set(uniqueIds);
    let removedAny = false;
    let touchedDefault = false;
    const emptied = [];
    for (const list of targets) {
      if (!list || !Array.isArray(list.queue) || !list.queue.length) {
        continue;
      }
      let removedFromList = false;
      for (let index = list.queue.length - 1; index >= 0; index -= 1) {
        const entry = list.queue[index];
        if (!entry || !idSet.has(entry.id)) {
          continue;
        }
        if (list.id === DEFAULT_LIST_ID) {
          rememberAutoCollectSeenIds(state, [entry.id]);
        }
        appendDeletedHistory(state, entry, list.id);
        list.queue.splice(index, 1);
        adjustIndexAfterRemoval(list, index);
        removedAny = true;
        removedFromList = true;
        if (state.currentListId === list.id && state.currentVideoId === entry.id) {
          state.currentVideoId = null;
        }
      }
      if (!removedFromList) {
        continue;
      }
      bumpListRevision(list);
      if (list.id === DEFAULT_LIST_ID) {
        touchedDefault = true;
      } else if (!list.queue.length) {
        emptied.push(list);
      }
    }
    if (!removedAny) {
      return state;
    }
    if (touchedDefault) {
      ensureDefaultRefreshFlag(state);
    }
    emptied.forEach((list) => {
      markListEmpty(state, list);
    });
    state.history = state.history.filter((item) => !idSet.has(item.id));
    return state;
  });
}
async function markVideoWatched(videoId, { listId = null } = {}) {
  if (!videoId) return getState();
  return withState((state) => {
    const located = findVideo(state, videoId, { preferListId: listId });
    if (!located) {
      return state;
    }
    const { list, index } = located;
    if (index < 0) {
      return state;
    }
    const entry = list.queue[index];
    if (list.id === DEFAULT_LIST_ID && entry?.id) {
      rememberAutoCollectSeenIds(state, [entry.id]);
    }
    appendHistory(state, entry, list.id);
    applyVideoProgress(state, videoId, 100, { timestamp: Date.now() });
    const shouldRemove = list.id === DEFAULT_LIST_ID || !list.freeze;
    let listChanged = false;
    if (shouldRemove) {
      list.queue.splice(index, 1);
      adjustIndexAfterRemoval(list, index);
      listChanged = true;
    } else if (list.currentIndex === index && list.queue.length > 1) {
      list.currentIndex = (index + 1) % list.queue.length;
    }
    if (state.currentListId === list.id && state.currentVideoId === videoId) {
      if (list.queue.length && list.currentIndex !== null) {
        state.currentVideoId = list.queue[list.currentIndex]?.id || null;
      } else {
        state.currentVideoId = null;
      }
    }
    if (list.id === DEFAULT_LIST_ID) {
      ensureDefaultRefreshFlag(state);
    } else if (!list.queue.length) {
      markListEmpty(state, list);
    }
    if (listChanged) {
      bumpListRevision(list);
    }
    return state;
  });
}
async function postponeVideo(videoId, { listId = null } = {}) {
  if (!videoId) return getState();
  return withState((state) => {
    const located = findVideo(state, videoId, { preferListId: listId });
    if (!located) {
      return state;
    }
    const { list, index } = located;
    if (index < 0 || list.queue.length <= 1 || list.freeze) {
      return state;
    }
    const [entry] = list.queue.splice(index, 1);
    if (!entry) {
      return state;
    }
    const wasCurrentVideo = list.currentIndex === index && state.currentListId === list.id && state.currentVideoId === videoId;
    adjustIndexAfterRemoval(list, index);
    list.queue.push(entry);
    if (list.id === DEFAULT_LIST_ID) {
      rememberAutoCollectSeenIds(state, [entry.id]);
    }
    bumpListRevision(list);
    if (list.currentIndex === null && list.queue.length) {
      list.currentIndex = 0;
    }
    if (wasCurrentVideo) {
      const nextEntry = list.currentIndex !== null ? list.queue[list.currentIndex] : null;
      state.currentVideoId = nextEntry ? nextEntry.id : null;
      state.currentListId = nextEntry ? list.id : state.currentListId;
    }
    return state;
  });
}
async function getNextQueueEntry(stateInput = null) {
  const state = stateInput ? sanitizeState(stateInput) : await getState();
  const list = state.currentListId ? state.lists[state.currentListId] : null;
  if (!list || list.currentIndex === null) return null;
  const nextIndex = list.currentIndex + 1;
  if (nextIndex >= list.queue.length) return null;
  return list.queue[nextIndex];
}
async function reorderQueue(videoId, targetIndex, listId = null) {
  if (!videoId || typeof targetIndex !== "number") {
    return getState();
  }
  return withState((state) => {
    const list = resolveList(state, listId);
    const fromIndex = list.queue.findIndex((item) => item.id === videoId);
    if (fromIndex === -1) return state;
    const toIndex = Math.max(0, Math.min(list.queue.length - 1, targetIndex));
    if (fromIndex === toIndex) return state;
    const [entry] = list.queue.splice(fromIndex, 1);
    list.queue.splice(toIndex, 0, entry);
    if (list.currentIndex === fromIndex) {
      list.currentIndex = toIndex;
    } else if (fromIndex < list.currentIndex && toIndex >= list.currentIndex) {
      list.currentIndex -= 1;
    } else if (fromIndex > list.currentIndex && toIndex <= list.currentIndex) {
      list.currentIndex += 1;
    }
    bumpListRevision(list);
    return state;
  });
}
function moveVideoInState(state, videoId, targetListId) {
  ensureListExists(state, targetListId);
  const located = findVideo(state, videoId);
  if (!located) return false;
  const { list, index } = located;
  if (list.id === targetListId) return false;
  const [entry] = list.queue.splice(index, 1);
  adjustIndexAfterRemoval(list, index);
  bumpListRevision(list);
  if (list.id === DEFAULT_LIST_ID) {
    ensureDefaultRefreshFlag(state);
  } else if (!list.queue.length) {
    markListEmpty(state, list);
  }
  const target = state.lists[targetListId];
  const existingIdx = target.queue.findIndex((item) => item.id === videoId);
  if (existingIdx !== -1) {
    target.queue.splice(existingIdx, 1);
    adjustIndexAfterRemoval(target, existingIdx);
    bumpListRevision(target);
  }
  if (list.id === DEFAULT_LIST_ID || target.id === DEFAULT_LIST_ID) {
    rememberAutoCollectSeenIds(state, [entry.id]);
  }
  target.queue.push(entry);
  bumpListRevision(target);
  if (target.currentIndex === null) {
    target.currentIndex = 0;
  }
  if (target.id === DEFAULT_LIST_ID) {
    ensureDefaultRefreshFlag(state);
  }
  if (state.currentListId === list.id && state.currentVideoId === videoId) {
    state.currentVideoId = null;
  }
  return true;
}
async function moveVideoToList(videoId, targetListId) {
  if (!videoId || !targetListId) return getState();
  return withState((state) => {
    moveVideoInState(state, videoId, targetListId);
    return state;
  });
}
async function moveVideosToList(videoIds, targetListId) {
  const ids = Array.isArray(videoIds) ? videoIds : [videoIds];
  if (!ids.length || !targetListId) return getState();
  return withState((state) => {
    for (const videoId of ids) {
      if (typeof videoId === "string" && videoId) {
        moveVideoInState(state, videoId, targetListId);
      }
    }
    return state;
  });
}

// src/store/actions/lists.js
async function addList({ name, freeze = false } = {}) {
  return withState((state) => {
    const id = generateListId();
    state.lists[id] = {
      id,
      name: name?.trim() || "\u041D\u043E\u0432\u044B\u0439 \u0441\u043F\u0438\u0441\u043E\u043A",
      freeze: Boolean(freeze),
      queue: [],
      currentIndex: null,
      revision: 0
    };
    state.listOrder.push(id);
    if (!state.currentListId) {
      state.currentListId = id;
    }
    return state;
  });
}
async function renameList(listId, newName) {
  if (!listId || !newName) return getState();
  return withState((state) => {
    ensureListExists(state, listId);
    state.lists[listId].name = newName.trim();
    if (listId === DEFAULT_LIST_ID) {
      state.lists[listId].name = DEFAULT_LIST_NAME;
    }
    return state;
  });
}
async function setListFreeze(listId, freeze) {
  if (!listId) return getState();
  return withState((state) => {
    ensureListExists(state, listId);
    if (listId === DEFAULT_LIST_ID) {
      state.lists[listId].freeze = false;
      return state;
    }
    state.lists[listId].freeze = Boolean(freeze);
    return state;
  });
}
function detachList(state, listId) {
  const list = state.lists[listId];
  delete state.lists[listId];
  state.listOrder = state.listOrder.filter((id) => id !== listId);
  if (state.currentListId === listId) {
    state.currentListId = DEFAULT_LIST_ID;
  }
  if (state.currentListId === DEFAULT_LIST_ID) {
    state.currentVideoId = null;
  }
  return list;
}
async function removeList(listId, { mode = "move", targetListId = DEFAULT_LIST_ID } = {}) {
  if (!listId || listId === DEFAULT_LIST_ID) {
    return getState();
  }
  return withState((state) => {
    ensureListExists(state, listId);
    const list = detachList(state, listId);
    if (mode === "delete") {
      if (list.queue.length) {
        ensureNotificationQueue(state);
        markListEmpty(state, list);
      }
      return state;
    }
    const target = resolveList(state, targetListId || DEFAULT_LIST_ID);
    const existingIds = new Set(target.queue.map((item) => item.id));
    const appendedIds = [];
    for (const entry of list.queue) {
      if (!existingIds.has(entry.id)) {
        target.queue.push(entry);
        existingIds.add(entry.id);
        appendedIds.push(entry.id);
      }
    }
    if (target.id === DEFAULT_LIST_ID) {
      rememberAutoCollectSeenIds(state, appendedIds);
    }
    if (target.currentIndex === null && target.queue.length) {
      target.currentIndex = 0;
    }
    return state;
  });
}
async function setCurrentList(listId) {
  if (!listId) return getState();
  return withState((state) => {
    ensureListExists(state, listId);
    const previousListId = state.currentListId;
    state.currentListId = listId;
    if (previousListId === listId) {
      return state;
    }
    const list = state.lists[listId];
    if (!list) {
      state.currentVideoId = null;
      return state;
    }
    if (!Array.isArray(list.queue) || list.queue.length === 0) {
      list.currentIndex = null;
      state.currentVideoId = null;
      return state;
    }
    const indexIsNumber = typeof list.currentIndex === "number";
    if (!indexIsNumber || list.currentIndex < 0 || list.currentIndex >= list.queue.length) {
      list.currentIndex = 0;
    }
    state.currentVideoId = list.queue[list.currentIndex]?.id || null;
    return state;
  });
}
async function exportList(listId) {
  const state = await getState();
  const list = resolveList(state, listId);
  return {
    id: list.id,
    name: list.name,
    freeze: list.freeze,
    queue: list.queue
  };
}
async function importList(data, { mode = "new", targetListId = null } = {}) {
  if (!data || typeof data !== "object") {
    throw new Error("Invalid import data");
  }
  const entries = Array.isArray(data.queue) ? data.queue : [];
  if (mode === "append") {
    const listId = targetListId || DEFAULT_LIST_ID;
    return addVideos(entries, listId);
  }
  return withState((state) => {
    const id = generateListId();
    const queue = entries.map((item) => {
      try {
        return sanitizeEntry(item);
      } catch {
        return null;
      }
    }).filter(Boolean);
    state.lists[id] = {
      id,
      name: data.name?.trim() || "\u0418\u043C\u043F\u043E\u0440\u0442\u0438\u0440\u043E\u0432\u0430\u043D\u043D\u044B\u0439 \u0441\u043F\u0438\u0441\u043E\u043A",
      freeze: Boolean(data.freeze),
      queue,
      currentIndex: 0,
      revision: queue.length
    };
    state.listOrder.push(id);
    return state;
  });
}
async function getListDetails(listId) {
  const state = await getState();
  ensureDefaultList(state);
  ensureListExists(state, listId);
  const list = state.lists[listId];
  return {
    id: list.id,
    name: list.name,
    freeze: list.freeze,
    queue: list.queue,
    length: list.queue.length,
    revision: Number.isInteger(list.revision) ? list.revision : 0
  };
}
async function moveAllVideos(sourceListId, targetListId) {
  if (!sourceListId || !targetListId || sourceListId === targetListId) {
    return getState();
  }
  return withState((state) => {
    ensureListExists(state, sourceListId);
    ensureListExists(state, targetListId);
    const source = state.lists[sourceListId];
    const target = state.lists[targetListId];
    if (!source.queue.length) {
      return state;
    }
    const existingIds = new Set(target.queue.map((item) => item.id));
    let appended = false;
    const appendedIds = [];
    const sourceIds = [];
    for (const entry of source.queue) {
      if (source.id === DEFAULT_LIST_ID && entry?.id) {
        sourceIds.push(entry.id);
      }
      if (!existingIds.has(entry.id)) {
        target.queue.push(entry);
        appended = true;
        appendedIds.push(entry.id);
      }
    }
    if (source.id === DEFAULT_LIST_ID && sourceIds.length) {
      rememberAutoCollectSeenIds(state, sourceIds);
    }
    if (appended) {
      if (target.id === DEFAULT_LIST_ID) {
        rememberAutoCollectSeenIds(state, appendedIds);
      }
      bumpListRevision(target);
    }
    if (target.currentIndex === null && target.queue.length) {
      target.currentIndex = 0;
    }
    if (state.currentListId === source.id && state.currentVideoId) {
      state.currentVideoId = null;
    }
    const sourceWasDefault = sourceListId === DEFAULT_LIST_ID;
    source.queue = [];
    source.currentIndex = null;
    bumpListRevision(source);
    if (sourceWasDefault) {
      state.pendingDefaultRefresh = true;
    }
    if (targetListId === DEFAULT_LIST_ID) {
      ensureDefaultRefreshFlag(state);
    }
    if (!sourceWasDefault) {
      markListEmpty(state, source);
    }
    return state;
  });
}

// src/store/actions/playback.js
async function setCurrentVideo(videoId, listId = null) {
  if (!videoId) return getState();
  return withState((state) => {
    let targetList = listId ? state.lists[listId] : null;
    let index = -1;
    if (targetList) {
      index = targetList.queue.findIndex((item) => item.id === videoId);
    } else {
      const located = findVideo(state, videoId);
      if (located) {
        targetList = located.list;
        index = located.index;
      }
    }
    if (!targetList || index === -1) {
      return state;
    }
    targetList.currentIndex = index;
    state.currentListId = targetList.id;
    state.currentVideoId = videoId;
    return state;
  });
}
async function suspendPlayback() {
  return withState((state) => {
    state.currentVideoId = null;
    return state;
  });
}
async function setCurrentTab(tabId) {
  return withState((state) => {
    state.currentTabId = typeof tabId === "number" && Number.isInteger(tabId) ? tabId : null;
    return state;
  });
}
async function clearCurrentTab(tabId) {
  return withState((state) => {
    if (state.currentTabId === tabId) {
      state.currentTabId = null;
    }
    return state;
  });
}
async function recordVideoProgress(videoId, percent, options = {}) {
  const id = typeof videoId === "string" ? videoId.trim() : "";
  if (!id) {
    return false;
  }
  const clamped = clampProgressPercent(percent);
  if (clamped === null) {
    return false;
  }
  const timestampCandidate = Number(options.timestamp);
  const timestamp = Number.isFinite(timestampCandidate) ? Math.max(0, Math.trunc(timestampCandidate)) : Date.now();
  const current = await getState();
  const existing = current?.videoProgress && typeof current.videoProgress === "object" ? current.videoProgress[id] || null : null;
  if (clamped <= 0 && !existing) {
    return false;
  }
  if (existing && existing.percent === clamped && timestamp <= (Number(existing.updatedAt) || 0)) {
    return false;
  }
  let changed = false;
  await withState((state) => {
    changed = applyVideoProgress(state, id, clamped, { timestamp });
    return state;
  });
  return changed;
}

// src/store/actions/presentation.js
async function getPresentationState() {
  const state = await getState();
  const autoMeta = ensureAutoCollectMeta(state);
  const listsMeta = state.listOrder.map((id) => state.lists[id]).filter(Boolean).map((list) => ({
    id: list.id,
    name: list.name,
    freeze: list.freeze,
    length: list.queue.length,
    revision: Number.isInteger(list.revision) ? list.revision : 0
  }));
  const currentList = state.lists[state.currentListId];
  return {
    lists: listsMeta,
    currentListId: state.currentListId,
    activeListId: state.currentListId,
    currentVideoId: state.currentVideoId,
    currentTabId: state.currentTabId,
    videoProgress: sanitizeVideoProgressMap(state.videoProgress),
    currentQueue: currentList ? {
      id: currentList.id,
      name: currentList.name,
      freeze: currentList.freeze,
      queue: currentList.queue,
      currentIndex: currentList.currentIndex
    } : null,
    history: state.history,
    deletedHistory: state.deletedHistory,
    autoCollect: {
      lastRunAt: autoMeta.lastRunAt || 0,
      lastAdded: autoMeta.lastAdded || 0,
      lastFetched: autoMeta.lastFetched || 0,
      nextAutoCollectAt: autoMeta.nextAutoCollectAt || 0,
      cooldownMs: AUTO_COLLECT_COOLDOWN_MS
    }
  };
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
function getToken() {
  if (typeof chrome === "undefined") {
    return Promise.reject(new Error("chrome API unavailable"));
  }
  if (currentToken) return Promise.resolve(currentToken);
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: false }, async (token) => {
      if (chrome.runtime.lastError || !token) {
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
async function getPlaylistVideoIds(playlistId, { limit } = {}) {
  const max = typeof limit === "number" && Number.isInteger(limit) && limit > 0 ? limit : Infinity;
  const collected = [];
  const seen = /* @__PURE__ */ new Set();
  let pageToken;
  let hasMore = false;
  do {
    const data = await callApi("playlistItems", {
      part: "contentDetails,snippet",
      maxResults: 50,
      playlistId,
      pageToken
    });
    const items = Array.isArray(data?.items) ? data.items : [];
    for (const item of items) {
      const videoId = item?.contentDetails?.videoId || item?.snippet?.resourceId?.videoId;
      if (!videoId || seen.has(videoId)) {
        continue;
      }
      seen.add(videoId);
      collected.push(videoId);
      if (collected.length >= max) {
        hasMore = Boolean(data?.nextPageToken);
        break;
      }
    }
    if (collected.length >= max) {
      break;
    }
    pageToken = data?.nextPageToken;
    hasMore = Boolean(pageToken);
  } while (pageToken);
  return { ids: collected, total: collected.length, hasMore };
}
async function addListToWL(playlistId, list, options = {}) {
  const total = Array.isArray(list) ? list.length : 0;
  const notifyProgress = (payload) => {
    if (typeof options.onProgress !== "function") return;
    try {
      options.onProgress({
        total,
        ...payload
      });
    } catch (err) {
      console.warn("addListToWL progress listener failed", err);
    }
  };
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  let count = 0;
  while (count < total) {
    const targetVideo = list[count];
    if (!targetVideo) {
      notifyProgress({ added: count, status: "complete" });
      return count;
    }
    try {
      await addVideoToWL(targetVideo.id, playlistId);
      console.log(`OK: ${targetVideo.id}, count ${count}/${list.length}`);
      const next = count + 1;
      notifyProgress({ added: next, status: "added", videoId: targetVideo.id });
      count = next;
    } catch (err) {
      const reason = err.error?.errors?.[0]?.reason || "";
      const status = err.status;
      switch (reason) {
        case "videoAlreadyInPlaylist": {
          logMessage("warn", targetVideo.id, count, err.error.message);
          count += 1;
          notifyProgress({
            added: count,
            status: "skipped",
            videoId: targetVideo.id
          });
          break;
        }
        case "backendError":
        case "internalError": {
          logMessage(
            "warn",
            targetVideo.id,
            count,
            "Backend error, retry in 1 min"
          );
          notifyProgress({
            added: count,
            status: "retry",
            videoId: targetVideo.id,
            reason,
            delayMs: 60 * 1e3
          });
          await wait(60 * 1e3);
          break;
        }
        case "rateLimitExceeded": {
          logMessage(
            "warn",
            targetVideo.id,
            count,
            "Rate limit exceeded, 8 min pause"
          );
          notifyProgress({
            added: count,
            status: "retry",
            videoId: targetVideo.id,
            reason,
            delayMs: 8 * 60 * 1e3 + 500
          });
          await wait(8 * 60 * 1e3 + 500);
          break;
        }
        case "quotaExceeded": {
          logMessage("error", targetVideo.id, count, "Quota exceeded");
          notifyProgress({
            added: count,
            status: "quotaExceeded",
            videoId: targetVideo.id,
            reason
          });
          return count;
        }
        case "SERVICE_UNAVAILABLE": {
          logMessage(
            "warn",
            targetVideo.id,
            count,
            "Service unavailable, retry in 1 min"
          );
          notifyProgress({
            added: count,
            status: "retry",
            videoId: targetVideo.id,
            reason,
            delayMs: 60 * 1e3
          });
          await wait(60 * 1e3);
          break;
        }
        default: {
          if (status >= 500) {
            logMessage(
              "warn",
              targetVideo.id,
              count,
              "Server error, retry in 1 min"
            );
            notifyProgress({
              added: count,
              status: "retry",
              videoId: targetVideo.id,
              reason: "serverError",
              delayMs: 60 * 1e3
            });
            await wait(60 * 1e3);
            break;
          }
          logMessage(
            "error",
            targetVideo.id,
            count,
            err.error?.message || err.message
          );
          notifyProgress({
            added: count,
            status: "error",
            videoId: targetVideo.id,
            reason
          });
          return count;
        }
      }
    }
  }
  console.log("OK, added: " + count);
  notifyProgress({ added: count, status: "complete" });
  return count;
}
async function createPlayList(title) {
  return callApi("playlists", { part: "snippet,status" }, "POST", {
    snippet: { title },
    status: { privacyStatus: "unlisted" }
  });
}
async function addVideoToWL(videoId, playlistId) {
  return callApi("playlistItems", { part: "snippet" }, "POST", {
    snippet: {
      playlistId,
      resourceId: { kind: "youtube#video", videoId }
    }
  });
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
function toDate(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : new Date(value.getTime());
  }
  if (typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === "string" && value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}
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
function formatStorageTimestamp(value) {
  const date = toDate(value);
  return date ? STORAGE_TIMESTAMP_FORMATTER.format(date) : "";
}

// src/youtube-api/videos.js
function asValidDate(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
function getCollectionFetchStartDate(startDate) {
  const baseDate = asValidDate(startDate) || new Date(Date.now() - 6048e5);
  return new Date(
    Math.max(0, baseDate.getTime() - COLLECTION_FETCH_OVERLAP_MS)
  );
}
async function getRecentVideosBySearch(channelId, startDate, nextPage, origin = channelId, pages = 1) {
  const data = await callApi("search", {
    part: "snippet",
    channelId,
    type: "video",
    order: "date",
    maxResults: 50,
    pageToken: nextPage,
    publishedAfter: startDate.toISOString()
  });
  const vids = data.items.map((el) => ({
    id: el.id.videoId,
    publishedAt: new Date(el.snippet.publishedAt),
    title: el.snippet.title,
    channelId: el.snippet.channelId,
    channelTitle: el.snippet.channelTitle,
    tags: el.snippet.tags,
    playlist: origin
  }));
  if (data.nextPageToken) {
    const rest = await getRecentVideosBySearch(
      channelId,
      startDate,
      data.nextPageToken,
      origin,
      pages + 1
    );
    return { videos: vids.concat(rest.videos), pages: rest.pages };
  }
  return { videos: vids, pages };
}
async function getNewVideos(playlist, startDate = new Date(Date.now() - 6048e5)) {
  const logicalStartDate = asValidDate(startDate) || new Date(Date.now() - 6048e5);
  const fetchStartDate = getCollectionFetchStartDate(startDate);
  const videos = [];
  let nextPage;
  let pages = 0;
  while (true) {
    let data;
    try {
      data = await callApi("playlistItems", {
        part: "contentDetails",
        maxResults: 50,
        playlistId: playlist,
        pageToken: nextPage
      });
    } catch (err) {
      const reason = err.error?.error?.errors?.[0]?.reason;
      if (err.status === 404 && reason === "playlistNotFound") {
        console.warn(
          "Uploads playlist not found",
          playlist,
          "falling back to search"
        );
        const channelId = playlist.startsWith("UU") ? "UC" + playlist.slice(2) : playlist;
        const fallback = await getRecentVideosBySearch(
          channelId,
          fetchStartDate,
          void 0,
          playlist
        );
        return {
          videos: fallback.videos.filter(
            (video) => video.publishedAt > logicalStartDate
          ),
          pages: fallback.pages
        };
      }
      throw err;
    }
    pages++;
    const items = data.items.map((el) => ({
      id: el.contentDetails.videoId,
      publishedAt: new Date(el.contentDetails.videoPublishedAt),
      playlist
    }));
    for (const it of items) {
      if (it.publishedAt > logicalStartDate) videos.push(it);
    }
    const last = data.items[data.items.length - 1];
    const lastDate = last ? new Date(last.contentDetails.videoPublishedAt) : null;
    if (!data.nextPageToken || lastDate && lastDate <= fetchStartDate) break;
    nextPage = data.nextPageToken;
  }
  if (videos.length > 0 || pages > 1) {
    const msg = [`Playlist ${playlist}`];
    if (pages > 1) msg.push(`${pages} pages`);
    msg.push("new videos", videos.length);
    console.log(msg.join(" "));
  }
  return { videos, pages };
}
async function isShort(video) {
  const videoId = video.id;
  if (video.duration && parseDuration(video.duration) < 60) return true;
  if (video.tags && video.tags.some((t) => /shorts?/i.test(t))) return true;
  if (video.title && video.title.toLowerCase().includes("#short")) return true;
  try {
    const res = await fetch(`https://www.youtube.com/shorts/${videoId}`, {
      method: "HEAD",
      redirect: "manual"
    });
    return res.status === 200;
  } catch (err) {
    console.error("Failed to detect Short for", videoId, err);
    return false;
  }
}
async function getVideoInfo(idList, nextPage) {
  const data = await callApi("videos", {
    part: "snippet,contentDetails,liveStreamingDetails",
    maxResults: 50,
    id: idList.join(","),
    pageToken: nextPage
  });
  const info = data.items.map((el) => {
    return {
      id: el.id,
      ...el.snippet,
      ...el.contentDetails,
      liveStreamingDetails: el.liveStreamingDetails,
      publishedAt: new Date(el.snippet.publishedAt)
    };
  });
  if (data.nextPageToken) {
    const rest = await getVideoInfo(idList, data.nextPageToken);
    return info.concat(rest);
  }
  return info;
}

// src/background/collector.js
function normalizeLiveStreamingDetails(details) {
  if (!details || typeof details !== "object") {
    return null;
  }
  return {
    actualStartTime: details.actualStartTime || null,
    scheduledStartTime: details.scheduledStartTime || null,
    actualEndTime: details.actualEndTime || null
  };
}
function toQueueEntry(video, overrides = {}) {
  const published = video.publishedAt instanceof Date ? video.publishedAt.toISOString() : typeof video.publishedAt === "string" ? video.publishedAt : null;
  const description = typeof video.description === "string" ? video.description : "";
  const tags = Array.isArray(video.tags) ? video.tags.slice() : [];
  const liveStreamingDetails = normalizeLiveStreamingDetails(
    video.liveStreamingDetails
  );
  const liveBroadcastContent = typeof video.liveBroadcastContent === "string" ? video.liveBroadcastContent : null;
  return {
    id: video.id,
    title: video.title || "",
    channelId: video.channelId || "",
    channelTitle: video.channelTitle || "",
    thumbnail: overrides.thumbnail ?? resolveThumbnailUrl(video),
    publishedAt: published,
    duration: video.duration || null,
    addedAt: Date.now(),
    description,
    tags,
    liveStreamingDetails,
    liveBroadcastContent
  };
}
async function fetchVideoEntries(videoIds) {
  const ids = Array.from(
    new Set(
      (Array.isArray(videoIds) ? videoIds : []).map(parseVideoId).filter((id) => typeof id === "string" && id.length === 11)
    )
  );
  if (!ids.length) return [];
  const result = [];
  for (let i = 0; i < ids.length; i += MAX_API_BATCH) {
    const chunk = ids.slice(i, i + MAX_API_BATCH);
    const info = await getVideoInfo(chunk);
    const map = /* @__PURE__ */ new Map();
    info.forEach((video) => {
      map.set(video.id, video);
    });
    chunk.forEach((id) => {
      const data = map.get(id);
      if (data) {
        result.push(toQueueEntry(data));
      }
    });
  }
  return result;
}
async function fetchPlaylistVideoIds(playlistId, options = {}) {
  const parsed = parsePlaylistId(playlistId);
  if (!parsed) {
    return { ids: [], total: 0, hasMore: false };
  }
  const result = await getPlaylistVideoIds(parsed, options);
  return {
    ids: Array.isArray(result?.ids) ? result.ids : [],
    total: typeof result?.total === "number" && result.total >= 0 ? result.total : Array.isArray(result?.ids) ? result.ids.length : 0,
    hasMore: Boolean(result?.hasMore)
  };
}
async function requestVideoIdsFromActiveTab(scope) {
  const [activeTab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });
  if (!activeTab) {
    return { videoIds: [], error: "ACTIVE_TAB_NOT_FOUND" };
  }
  try {
    const response = await chrome.tabs.sendMessage(
      activeTab.id,
      {
        type: "collector:collect",
        scope
      },
      { frameId: 0 }
    );
    if (!response || !Array.isArray(response.videoIds)) {
      return { videoIds: [], error: "NO_DATA" };
    }
    return { videoIds: response.videoIds, tabId: activeTab.id };
  } catch (err) {
    return {
      videoIds: [],
      error: err && typeof err.message === "string" ? err.message : "COLLECTOR_FAILED"
    };
  }
}

// src/background/channel.js
async function safeSendMessage(payload) {
  try {
    await chrome.runtime.sendMessage(payload);
  } catch (err) {
    if (!err || typeof err.message !== "string" || !/receiving end/i.test(err.message)) {
      console.warn("Runtime message failed", err);
    }
  }
}
async function notifyState() {
  const presentation = await getPresentationState();
  await safeSendMessage({
    source: MESSAGE_SOURCE,
    type: "playlist:stateUpdated",
    state: presentation
  });
  return presentation;
}
function sendCollectionProgress(event) {
  if (!event || typeof event !== "object") return;
  void safeSendMessage({
    source: MESSAGE_SOURCE,
    type: "playlist:collectProgress",
    event
  });
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
function asValidDate2(value) {
  const candidate = value instanceof Date ? new Date(value.getTime()) : typeof value === "number" || typeof value === "string" ? new Date(value) : null;
  return candidate && !Number.isNaN(candidate.getTime()) ? candidate : null;
}
function updateAutoCollectLastRun(meta) {
  const candidate = meta && typeof meta === "object" ? meta.lastRunAt ?? meta : meta;
  autoCollectLastRun = asValidDate2(candidate);
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
function parseStoredFilters2(raw) {
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
      filtersCache = parseStoredFilters2(changes[STORAGE_KEYS.filters].newValue);
    }
    if (changes[STORAGE_KEYS.autoCollect]) {
      updateAutoCollectLastRun(changes[STORAGE_KEYS.autoCollect].newValue);
    }
  });
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
  filtersCache = parseStoredFilters2(data?.[STORAGE_KEYS.filters]);
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

// src/filter.js
async function fetchInfo(list) {
  const ids = Array.from(
    new Set(
      list.filter(
        (video) => !video.duration || !video.title || !video.channelId || !video.tags
      ).map((video) => video.id).filter(Boolean)
    )
  );
  if (!ids.length) {
    return list;
  }
  const infoMap = /* @__PURE__ */ new Map();
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    try {
      const response = await getVideoInfo(chunk);
      response.forEach((video) => infoMap.set(video.id, video));
    } catch (err) {
      console.error("Failed to fetch video info chunk", chunk, err);
    }
  }
  return list.map((video) => {
    const extra = infoMap.get(video.id) || {};
    return { ...video, ...extra };
  });
}
async function isInPlaylists(videoId, playlistIds = []) {
  for (const playlistId of playlistIds) {
    try {
      if (await isVideoInPlaylist(videoId, playlistId)) {
        return true;
      }
    } catch (err) {
      console.error("Playlist check failed", playlistId, videoId, err);
    }
  }
  return false;
}
function buildStats(videos) {
  const stats = /* @__PURE__ */ new Map();
  for (const video of videos) {
    const channelId = video.channelId || "unknown";
    if (!stats.has(channelId)) {
      stats.set(channelId, {
        name: (video.channelTitle || channelId).slice(0, 60),
        title: (video.channelTitle || channelId).padEnd(30).slice(0, 30),
        new: 0,
        filtered: 0,
        shorts: 0,
        broadcasts: 0,
        add: 0,
        stoplists: 0
      });
    }
    stats.get(channelId).new += 1;
  }
  return stats;
}
function normalizeNeedles(values, normalize, keyFn = (v) => v) {
  if (!Array.isArray(values)) return [];
  const seen = /* @__PURE__ */ new Set();
  const result = [];
  values.forEach((value) => {
    const normalized = normalize(value);
    if (normalized == null) return;
    const key = keyFn(normalized);
    if (seen.has(key)) return;
    seen.add(key);
    result.push(normalized);
  });
  return result;
}
function normalizeDurationRange(range = {}) {
  const min = Number.isFinite(range.min) ? range.min : 0;
  const max = Number.isFinite(range.max) ? range.max : Infinity;
  return { min, max };
}
function createRulesResolver(filters) {
  const normalized = normalizeFilters(filters);
  const cache = /* @__PURE__ */ new Map();
  return (channelId) => {
    const key = channelId || "unknown";
    if (cache.has(key)) return cache.get(key);
    const local = normalized.channels[key] || {};
    const rules = {
      noShorts: local.noShorts ?? normalized.global.noShorts,
      noBroadcasts: local.noBroadcasts ?? normalized.global.noBroadcasts,
      title: normalizeNeedles(
        [...normalized.global.title || [], ...local.title || []],
        (text) => {
          const str = String(text || "").trim().toLowerCase();
          return str || null;
        }
      ),
      tags: normalizeNeedles(
        [...normalized.global.tags || [], ...local.tags || []],
        (tag) => {
          const str = String(tag || "").toLowerCase().replace(/\s+/g, "");
          return str || null;
        }
      ),
      duration: normalizeNeedles(
        [...normalized.global.duration || [], ...local.duration || []],
        normalizeDurationRange,
        ({ min, max }) => `${min}-${max}`
      ),
      playlists: normalizeNeedles(
        [...normalized.global.playlists || [], ...local.playlists || []],
        (pl) => pl || null
      )
    };
    cache.set(key, rules);
    return rules;
  };
}
function normalizeVideoTags(video) {
  const tags = (video.tags || []).map(
    (tag) => String(tag || "").toLowerCase().replace(/\s+/g, "")
  );
  const titleTags = (video.title || "").match(/#[^\s#]+/g)?.map((tag) => tag.slice(1).toLowerCase().replace(/\s+/g, "")) || [];
  return Array.from(/* @__PURE__ */ new Set([...tags, ...titleTags]));
}
function isBroadcast(video) {
  return video.liveStreamingDetails && video.liveStreamingDetails.actualStartTime !== video.liveStreamingDetails.scheduledStartTime;
}
async function applyFilters(video, rules, durationSeconds) {
  if (rules.noBroadcasts && isBroadcast(video)) {
    return "broadcast";
  }
  if (rules.title.length) {
    const lowerTitle = (video.title || "").toLowerCase();
    if (rules.title.some((needle) => lowerTitle.includes(needle))) {
      return "title";
    }
  }
  if (rules.tags.length) {
    const allTags = normalizeVideoTags(video);
    if (rules.tags.some((needle) => allTags.includes(needle))) {
      return "tag";
    }
  }
  if (rules.duration.length) {
    const parsedDuration = typeof durationSeconds === "number" ? durationSeconds : parseDuration(video.duration);
    if (typeof parsedDuration === "number" && !rules.duration.some(
      ({ min = 0, max = Infinity }) => parsedDuration >= min && parsedDuration <= max
    )) {
      return "duration";
    }
  }
  if (rules.noShorts) {
    try {
      if (await isShort(video)) {
        return "short";
      }
    } catch (err) {
      console.error("Failed short check", err);
    }
  }
  return void 0;
}
async function determineFilterReason(video, rules) {
  const durationSeconds = parseDuration(video.duration);
  if (!video.duration || typeof durationSeconds !== "number" || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return "missingDuration";
  }
  let reason = await applyFilters(video, rules, durationSeconds);
  if (!reason && rules.playlists?.length) {
    if (await isInPlaylists(video.id, rules.playlists)) {
      reason = "playlist";
    }
  }
  return reason;
}
async function filterVideos(list, progress) {
  console.log("Fetching info for", list.length, "videos");
  const filters = await getFilters();
  const rulesForChannel = createRulesResolver(filters);
  const videos = await fetchInfo(list);
  const stats = buildStats(videos);
  const result = [];
  const concurrency = 5;
  let processed = 0;
  let index = 0;
  const notifyProgress = typeof progress === "function" ? progress : null;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (true) {
        const current = index++;
        if (current >= videos.length) break;
        const video = videos[current];
        const channelId = video.channelId || "unknown";
        const reason = await determineFilterReason(
          video,
          rulesForChannel(channelId)
        );
        const channelStats = stats.get(channelId);
        if (reason) {
          switch (reason) {
            case "short":
              channelStats.shorts += 1;
              break;
            case "broadcast":
              channelStats.broadcasts += 1;
              break;
            case "playlist":
              channelStats.stoplists += 1;
              break;
            default:
              channelStats.filtered += 1;
          }
        } else {
          channelStats.add += 1;
          result.push(video);
        }
        processed += 1;
        if (processed % 5 === 0 || processed === videos.length) {
          console.log("Filter progress", processed, "/", videos.length);
        }
        if (notifyProgress && (processed % 10 === 0 || processed === videos.length)) {
          notifyProgress({
            phase: "filterProgress",
            processed,
            total: videos.length
          });
        }
      }
    })
  );
  const totals = Array.from(stats.values()).reduce(
    (acc, channelStats) => {
      acc.filtered += channelStats.filtered;
      acc.shorts += channelStats.shorts;
      acc.broadcasts += channelStats.broadcasts;
      acc.stoplists += channelStats.stoplists;
      acc.passed += channelStats.add;
      return acc;
    },
    { filtered: 0, shorts: 0, broadcasts: 0, stoplists: 0, passed: 0 }
  );
  const channelEntries = Array.from(stats.values()).map((channelStats) => ({
    name: (channelStats.name || channelStats.title || "").trim(),
    title: channelStats.title,
    new: channelStats.new,
    filtered: channelStats.filtered,
    broadcasts: channelStats.broadcasts,
    shorts: channelStats.shorts,
    add: channelStats.add,
    stoplists: channelStats.stoplists
  }));
  const sortedChannels = channelEntries.slice().sort((a, b) => {
    if (b.add !== a.add) return b.add - a.add;
    if (b.new !== a.new) return b.new - a.new;
    return a.name.localeCompare(b.name, "ru");
  });
  const logEntries = sortedChannels.map((channel) => {
    const baseTitle = (channel.title || channel.name || "").trimEnd();
    const paddedTitle = baseTitle.padEnd(30).slice(0, 30);
    return `${paddedTitle} new ${channel.new}, filtered ${channel.filtered}, broadcasts ${channel.broadcasts}, shorts ${channel.shorts}, to playlist ${channel.add}, stoplists ${channel.stoplists}`;
  });
  if (notifyProgress) {
    notifyProgress({
      phase: "filterStats",
      videoCount: result.length,
      totals,
      channels: sortedChannels,
      logEntries,
      total: videos.length,
      initialCount: list.length,
      readyPotential: totals.passed
    });
  }
  for (const channelStats of stats.values()) {
    console.log(
      `${channelStats.title} new ${channelStats.new}, filtered ${channelStats.filtered}, broadcasts ${channelStats.broadcasts}, shorts ${channelStats.shorts}, to playlist ${channelStats.add}, stoplists ${channelStats.stoplists}`
    );
  }
  console.log(
    `${list.length} videos filter stats: filtered ${totals.filtered}, broadcasts ${totals.broadcasts}, shorts ${totals.shorts}, stoplists ${totals.stoplists}, passed ${totals.passed}`
  );
  return result;
}

// src/playlist.js
async function collectVideos(startDate = new Date(Date.now() - 6048e5), progress = () => {
}, options = {}) {
  const excludeIds = new Set(
    Array.isArray(options?.excludeIds) ? options.excludeIds.filter(Boolean) : options?.excludeIds instanceof Set ? Array.from(options.excludeIds).filter(Boolean) : []
  );
  const channels = await getChannelMap();
  const sources = Object.entries(channels).map(([channelId, info]) => ({
    channelId,
    channelTitle: info?.title || "",
    playlistId: info?.uploads
  })).filter((entry) => Boolean(entry.playlistId));
  console.log("Subscriptions count:", Object.keys(channels).length);
  console.log("Loading videos from", sources.length, "playlists");
  progress({
    phase: "channelsLoaded",
    channelCount: Object.keys(channels).length,
    playlistCount: sources.length
  });
  const results = new Array(sources.length);
  const concurrency = Math.min(sources.length, 6) || 1;
  let cursor = 0;
  const workers = Array.from(
    { length: concurrency },
    () => (async () => {
      while (cursor < sources.length) {
        const current = cursor++;
        const { playlistId: pl, channelId, channelTitle } = sources[current];
        progress({
          phase: "playlistFetch",
          index: current + 1,
          total: sources.length,
          playlistId: pl,
          channelId,
          channelTitle
        });
        const r = await getNewVideos(pl, startDate);
        results[current] = {
          playlist: pl,
          videos: r.videos,
          pages: r.pages,
          channelId,
          channelTitle
        };
        progress({
          phase: "playlistFetched",
          index: current + 1,
          total: sources.length,
          playlistId: pl,
          channelId,
          channelTitle,
          videoCount: r.videos.length
        });
      }
    })()
  );
  await Promise.all(workers);
  const videoMap = /* @__PURE__ */ new Map();
  for (const r of results) {
    for (const v of r.videos) {
      if (!excludeIds.has(v.id) && !videoMap.has(v.id)) {
        videoMap.set(v.id, v);
      }
    }
  }
  let videos = Array.from(videoMap.values());
  console.log("Fetched", videos.length, "videos");
  progress({ phase: "aggregate", videoCount: videos.length });
  progress({ phase: "filtering", videoCount: videos.length });
  videos = await filterVideos(videos, progress);
  progress({ phase: "filtered", videoCount: videos.length });
  videos.sort((a, b) => a.publishedAt - b.publishedAt);
  return videos;
}

// src/background/collectionSync.js
var defaultAutoCollectRunning = false;
var defaultAutoCollectPromise = null;
function addEntryIds(target, entries) {
  if (!(target instanceof Set) || !Array.isArray(entries)) {
    return target;
  }
  for (const entry of entries) {
    const id = typeof entry === "string" ? entry.trim() : entry && typeof entry === "object" && typeof entry.id === "string" ? entry.id.trim() : "";
    if (id) {
      target.add(id);
    }
  }
  return target;
}
function collectAutoCollectSeenIds(state, { listId = DEFAULT_LIST_ID } = {}) {
  const seenIds = /* @__PURE__ */ new Set();
  addEntryIds(seenIds, state?.autoCollect?.seenIds || []);
  addEntryIds(seenIds, state?.lists?.[listId]?.queue || []);
  const history = Array.isArray(state?.history) ? state.history : [];
  for (const entry of history) {
    if (entry?.listId === listId || !entry?.listId && listId === DEFAULT_LIST_ID) {
      addEntryIds(seenIds, [entry]);
    }
  }
  const deletedHistory = Array.isArray(state?.deletedHistory) ? state.deletedHistory : [];
  for (const entry of deletedHistory) {
    if (entry?.listId === listId || !entry?.listId && listId === DEFAULT_LIST_ID) {
      addEntryIds(seenIds, [entry]);
    }
  }
  return seenIds;
}
async function dispatchNotifications() {
  const notifications = await consumePendingNotifications();
  if (!notifications?.length) return;
  for (const note of notifications) {
    if (note.type !== "listEmpty") continue;
    const title = "\u0421\u043F\u0438\u0441\u043E\u043A \u0437\u0430\u043A\u043E\u043D\u0447\u0438\u043B\u0441\u044F";
    const message = note.name ? `\u041E\u0447\u0435\u0440\u0435\u0434\u044C \xAB${note.name}\xBB \u043F\u0443\u0441\u0442\u0430\u044F` : "\u0414\u043E\u043F\u043E\u043B\u043D\u0438\u0442\u0435\u043B\u044C\u043D\u044B\u0439 \u0441\u043F\u0438\u0441\u043E\u043A \u043F\u0443\u0441\u0442\u043E\u0439";
    try {
      chrome.notifications.create(
        `yta_list_empty_${note.listId || Date.now()}`,
        {
          type: "basic",
          iconUrl: chrome.runtime.getURL("icon/icon.png"),
          title,
          message
        }
      );
    } catch (err) {
      console.warn("Failed to show notification", err);
    }
  }
}
async function resolveCollectionStartDate() {
  const meta = await getAutoCollectMeta();
  const cursorTs = meta?.lastRunAt || 0;
  if (cursorTs > 0) {
    const dt = new Date(cursorTs);
    if (!Number.isNaN(dt.getTime())) {
      return dt;
    }
  }
  return new Date(Date.now() - COLLECTION_WINDOW_MS);
}
async function collectAndAppendSubscriptions({ origin = "auto" } = {}) {
  const context = { origin };
  const runStartedAt = Date.now();
  const startDate = await resolveCollectionStartDate();
  const before = await getState();
  const queueBefore = before.lists?.[DEFAULT_LIST_ID]?.queue?.length || 0;
  const existingIds = collectAutoCollectSeenIds(before);
  sendCollectionProgress({
    ...context,
    phase: "start",
    startDate: startDate.toISOString()
  });
  try {
    const entries = await collectVideos(
      startDate,
      (event) => sendCollectionProgress({ ...context, ...event }),
      { excludeIds: existingIds }
    );
    const uniqueEntries = [];
    let skippedExisting = 0;
    for (const entry of entries) {
      if (!entry?.id) continue;
      if (existingIds.has(entry.id)) {
        skippedExisting += 1;
        continue;
      }
      existingIds.add(entry.id);
      const thumbnail = resolveThumbnailUrl(entry);
      uniqueEntries.push({ ...entry, thumbnail });
    }
    sendCollectionProgress({
      ...context,
      phase: "readyToAdd",
      videoCount: uniqueEntries.length,
      skippedExisting,
      sourceTotal: entries.length
    });
    sendCollectionProgress({
      ...context,
      phase: "adding",
      addCount: uniqueEntries.length,
      queueBefore
    });
    if (uniqueEntries.length) {
      await addVideos(uniqueEntries, DEFAULT_LIST_ID);
    }
    const afterAdd = await getState();
    const newLength = afterAdd.lists?.[DEFAULT_LIST_ID]?.queue?.length || 0;
    const added = Math.max(0, newLength - queueBefore);
    await recordDefaultAutoCollect({
      added,
      fetched: uniqueEntries.length,
      startedAt: runStartedAt
    });
    await notifyState();
    await dispatchNotifications();
    const presentation = await getPresentationState();
    sendCollectionProgress({
      ...context,
      phase: "complete",
      added,
      fetched: uniqueEntries.length,
      queueLength: newLength,
      skippedExisting
    });
    return {
      origin,
      added,
      fetched: uniqueEntries.length,
      state: presentation
    };
  } catch (err) {
    sendCollectionProgress({
      ...context,
      phase: "error",
      message: err?.message || "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0441\u043E\u0431\u0440\u0430\u0442\u044C \u043F\u043E\u0434\u043F\u0438\u0441\u043A\u0438"
    });
    throw err;
  }
}
async function runDefaultAutoCollect(queueLengthHint = 0) {
  try {
    await clearPendingDefaultRefresh();
    const result = await collectAndAppendSubscriptions({ origin: "auto" });
    if (!result?.added) {
      const queueSize = Array.isArray(result?.state?.lists) ? result.state.lists.find((list) => list.id === DEFAULT_LIST_ID)?.length ?? queueLengthHint : queueLengthHint;
      if (!queueSize) {
        await queueListEmptyNotification(DEFAULT_LIST_ID);
        await notifyState();
        await dispatchNotifications();
      }
    }
  } finally {
    defaultAutoCollectRunning = false;
    defaultAutoCollectPromise = null;
  }
}
async function ensureDefaultQueueFilled(options = {}) {
  const awaitCompletion = options?.awaitCompletion === true;
  if (defaultAutoCollectRunning && defaultAutoCollectPromise) {
    if (awaitCompletion) {
      try {
        await defaultAutoCollectPromise;
      } catch (err) {
        console.error("Auto-collection failed", err);
      }
    }
    return;
  }
  const { shouldCollect, onCooldown, queueLength } = await shouldAutoRefreshDefault();
  if (!shouldCollect && !onCooldown) {
    return;
  }
  if (onCooldown) {
    if (queueLength === 0) {
      await queueListEmptyNotification(DEFAULT_LIST_ID);
      await notifyState();
      await dispatchNotifications();
    }
    await clearPendingDefaultRefresh();
    return;
  }
  defaultAutoCollectRunning = true;
  defaultAutoCollectPromise = runDefaultAutoCollect(queueLength);
  if (awaitCompletion) {
    try {
      await defaultAutoCollectPromise;
    } catch (err) {
      console.error("Auto-collection failed", err);
    }
  } else {
    defaultAutoCollectPromise.catch((err) => {
      console.error("Auto-collection failed", err);
    });
  }
}

// src/background/services.js
function normalizeVideoIdList(values) {
  const source = Array.isArray(values) ? values : [];
  return Array.from(
    new Set(source.map((value) => parseVideoId(value)).filter(Boolean))
  );
}
function normalizeStringIdList(values) {
  const source = Array.isArray(values) ? values : [values];
  return Array.from(
    new Set(
      source.map((value) => typeof value === "string" ? value.trim() : "").filter((value) => value.length > 0)
    )
  );
}
function resolveAddTargetListId(state, requestedListId) {
  const lists = state?.lists || {};
  if (requestedListId && lists[requestedListId]) {
    return requestedListId;
  }
  if (state?.currentListId && lists[state.currentListId]) {
    return state.currentListId;
  }
  if (lists[DEFAULT_LIST_ID]) {
    return DEFAULT_LIST_ID;
  }
  const ids = Object.keys(lists);
  return ids.length ? ids[0] : DEFAULT_LIST_ID;
}
function countAddedEntriesInQueue(nextState, listId, beforeState) {
  const previousIds = new Set(
    (beforeState?.lists?.[listId]?.queue || []).map((entry) => entry.id)
  );
  const list = nextState?.lists?.[listId];
  return (list?.queue || []).filter((entry) => !previousIds.has(entry.id)).length;
}
async function applyMutation(mutator, options = {}) {
  const {
    notify = true,
    dispatch = false,
    ensureDefault = false
  } = options;
  const result = await mutator();
  if (notify) {
    await notifyState();
  }
  if (dispatch) {
    await dispatchNotifications();
  }
  if (ensureDefault) {
    await ensureDefaultQueueFilled();
  }
  return result;
}
async function mutateAndPresent(mutator, options = {}) {
  await applyMutation(mutator, options);
  return getPresentationState();
}
async function addEntries(entries, listId = null, options = {}) {
  if (!Array.isArray(entries) || !entries.length) {
    return getPresentationState();
  }
  const { ensureDefault = true } = options;
  return mutateAndPresent(() => addVideos(entries, listId), {
    dispatch: true,
    ensureDefault
  });
}
async function handleAddByIds(message, sender = null) {
  const uniqueIds = normalizeVideoIdList(message?.videoIds);
  if (!uniqueIds.length) {
    const state2 = await getPresentationState();
    return {
      state: state2,
      requested: 0,
      fetched: 0,
      missing: 0,
      added: 0
    };
  }
  const beforeState = await getState();
  const requestedListId = sender?.tab ? null : message?.listId || null;
  const targetListId = resolveAddTargetListId(beforeState, requestedListId);
  const entries = await fetchVideoEntries(uniqueIds);
  const fetchedIds = new Set(entries.map((entry) => entry?.id).filter(Boolean));
  const missing = uniqueIds.filter((id) => !fetchedIds.has(id)).length;
  const afterState = await applyMutation(() => addVideos(entries, targetListId), {
    dispatch: true,
    ensureDefault: Boolean(message?.ensureDefault)
  });
  const state = await getPresentationState();
  const added = countAddedEntriesInQueue(afterState, targetListId, beforeState);
  return {
    state,
    requested: uniqueIds.length,
    fetched: entries.length,
    missing,
    added
  };
}
async function handleRemoveVideos(videoIds, listId = null) {
  const filtered = normalizeStringIdList(videoIds);
  if (!filtered.length) {
    return getPresentationState();
  }
  return mutateAndPresent(
    () => removeVideos(filtered, { listId }),
    { dispatch: true, ensureDefault: true }
  );
}
async function handleMoveVideos(videoIds, targetListId) {
  if (!targetListId) {
    return getPresentationState();
  }
  const ids = normalizeStringIdList(videoIds);
  if (!ids.length) {
    return getPresentationState();
  }
  return mutateAndPresent(
    () => moveVideosToList(ids, targetListId),
    { dispatch: true, ensureDefault: true }
  );
}
async function handleVideoMetadata(message) {
  const videoId = parseVideoId(message?.videoId);
  if (!videoId) {
    return { error: "Invalid video ID" };
  }
  try {
    const entries = await fetchVideoEntries([videoId]);
    if (!entries.length) {
      return { error: "Video not found" };
    }
    return entries[0];
  } catch (err) {
    return { error: err?.message || "Failed to load video info" };
  }
}
function findVideoInState(state, videoId) {
  if (!state || !state.lists || !videoId) {
    return null;
  }
  const currentListId = state.currentListId;
  if (currentListId && state.lists[currentListId]) {
    const list = state.lists[currentListId];
    const idx = list.queue.findIndex((item) => item.id === videoId);
    if (idx !== -1) {
      return { list, index: idx };
    }
  }
  for (const list of Object.values(state.lists)) {
    const idx = list.queue.findIndex((item) => item.id === videoId);
    if (idx !== -1) {
      return { list, index: idx };
    }
  }
  return null;
}
function coerceDate(value) {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date;
}
function buildDefaultPlaylistTitle(queue) {
  let minTs = null;
  let maxTs = null;
  for (const entry of queue) {
    const date = coerceDate(entry?.publishedAt) || coerceDate(entry?.addedAt);
    if (!date) {
      continue;
    }
    const ts = date.getTime();
    if (minTs === null || ts < minTs) {
      minTs = ts;
    }
    if (maxTs === null || ts > maxTs) {
      maxTs = ts;
    }
  }
  if (minTs === null) {
    minTs = Date.now();
  }
  if (maxTs === null) {
    maxTs = minTs;
  }
  return `WL ${formatStorageTimestamp(minTs)} - ${formatStorageTimestamp(maxTs)}`;
}
async function pingActivePlaybackTab(payload) {
  const state = await getPresentationState();
  const tabId = state?.currentTabId;
  const tabIdIsValid = typeof tabId === "number" && Number.isInteger(tabId);
  if (!tabIdIsValid) {
    return { ok: false, reason: "NO_ACTIVE_TAB", state };
  }
  try {
    const response = await chrome.tabs.sendMessage(tabId, payload);
    return { ok: true, tabId, state, response };
  } catch (err) {
    console.warn("Failed to reach playback tab", err);
    await clearCurrentTab(tabId);
    await notifyState();
    const updated = await getPresentationState();
    return { ok: false, reason: "TAB_UNREACHABLE", state: updated };
  }
}
async function getTabPlaybackStatus(tabId) {
  const tabIdIsValid = typeof tabId === "number" && Number.isInteger(tabId);
  if (!tabIdIsValid) {
    return { ok: false, reason: "INVALID_TAB" };
  }
  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: "player:getPlaybackStatus"
    });
    if (!response || response.hasVideo === false) {
      return { ok: true, tabId, hasVideo: false, playing: false };
    }
    return {
      ok: true,
      tabId,
      hasVideo: true,
      playing: response.playing === true
    };
  } catch (err) {
    return { ok: false, reason: "TAB_UNREACHABLE", tabId, error: err };
  }
}

// src/background/handlers/collection.js
var collectionHandlers = {
  async "subscriptions:getMeta"() {
    const meta = await getAutoCollectMeta();
    return { meta };
  },
  async "playlist:collectSubscriptions"() {
    const meta = await getAutoCollectMeta();
    const nextRunAt = Number(meta?.nextAutoCollectAt) || 0;
    const now = Date.now();
    if (nextRunAt && nextRunAt > now) {
      const presentation2 = await getPresentationState();
      return {
        error: "ON_COOLDOWN",
        nextRunAt,
        remainingMs: nextRunAt - now,
        state: presentation2
      };
    }
    const result = await collectAndAppendSubscriptions({ origin: "manual" });
    if (result?.state) {
      return result;
    }
    const presentation = await getPresentationState();
    return { ...result, state: presentation };
  },
  async "collector:collect"(message) {
    return requestVideoIdsFromActiveTab(message.scope || "current");
  },
  async setStartDate(message) {
    if (message?.date) {
      try {
        const dt = new Date(message.date);
        if (!Number.isNaN(dt.getTime())) {
          const meta2 = await setAutoCollectStartDate(dt);
          return { ok: true, lastRunAt: meta2.lastRunAt };
        }
      } catch {
      }
    }
    const meta = await getAutoCollectMeta();
    return { ok: true, lastRunAt: meta.lastRunAt };
  },
  async videoDate(message) {
    const info = await handleVideoMetadata(message);
    if (info.error) return info;
    if (info.publishedAt) {
      await setAutoCollectStartDate(info.publishedAt);
    }
    return { date: info.publishedAt || null };
  },
  async videoInfo(message) {
    const info = await handleVideoMetadata(message);
    if (info.error) return info;
    return { info };
  }
};

// src/background/handlers/lists.js
function buildPlaylistProgressToken() {
  if (typeof crypto?.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `pl-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
function createPlaylistProgressSender(token, listId) {
  return (payload = {}) => {
    try {
      chrome.runtime.sendMessage(
        {
          type: "playlist:createYouTubePlaylist:progress",
          token,
          listId,
          ...payload
        },
        () => {
          const lastError = chrome.runtime.lastError;
          if (lastError && lastError.message !== "The message port closed before a response was received.") {
            console.debug("Playlist progress message error", lastError);
          }
        }
      );
    } catch (err) {
      console.debug("Failed to send playlist progress", err);
    }
  };
}
function extractPlaylistErrorReason(err) {
  return err?.error?.error?.errors?.[0]?.reason || err?.error?.errors?.[0]?.reason || err?.error?.error?.message || err?.error?.message || err?.message || "PLAYLIST_CREATE_FAILED";
}
var listHandlers = {
  async "playlist:createList"(message) {
    return mutateAndPresent(
      () => addList({
        name: message?.name,
        freeze: Boolean(message?.freeze)
      })
    );
  },
  async "playlist:renameList"(message) {
    if (!message?.listId || !message?.name) {
      return getPresentationState();
    }
    return mutateAndPresent(() => renameList(message.listId, message.name));
  },
  async "playlist:setFreeze"(message) {
    if (!message?.listId) return getPresentationState();
    return mutateAndPresent(
      () => setListFreeze(message.listId, Boolean(message.freeze))
    );
  },
  async "playlist:removeList"(message) {
    if (!message?.listId) return getPresentationState();
    return mutateAndPresent(
      () => removeList(message.listId, {
        mode: message.mode === "discard" ? "delete" : "move"
      }),
      { dispatch: true }
    );
  },
  async "playlist:getList"(message) {
    if (!message?.listId) return { error: "listId required" };
    return getListDetails(message.listId);
  },
  async "playlist:exportList"(message) {
    if (!message?.listId) return { error: "listId required" };
    const data = await exportList(message.listId);
    return { data };
  },
  async "playlist:createYouTubePlaylist"(message) {
    const listId = message?.listId;
    if (!listId) {
      return { error: "listId required" };
    }
    const token = buildPlaylistProgressToken();
    const sendProgress = createPlaylistProgressSender(token, listId);
    try {
      sendProgress({ stage: "start" });
      const details = await getListDetails(listId);
      const queue = Array.isArray(details?.queue) ? details.queue : [];
      if (!queue.length) {
        sendProgress({ stage: "error", reason: "LIST_EMPTY" });
        return { error: "LIST_EMPTY" };
      }
      const title = details?.id === DEFAULT_LIST_ID ? buildDefaultPlaylistTitle(queue) : details?.name?.trim() || "\u0421\u043F\u0438\u0441\u043E\u043A";
      const playlist = await createPlayList(title);
      const playlistId = playlist?.id;
      if (!playlistId) {
        sendProgress({ stage: "error", reason: "PLAYLIST_CREATE_FAILED" });
        return { error: "PLAYLIST_CREATE_FAILED" };
      }
      sendProgress({ stage: "playlistCreated", title });
      const items = queue.map((entry) => ({ id: entry?.id })).filter((item) => item.id);
      if (!items.length) {
        sendProgress({ stage: "error", reason: "LIST_EMPTY" });
        return { error: "LIST_EMPTY" };
      }
      const total = items.length;
      sendProgress({ stage: "adding", total, added: 0 });
      const added = await addListToWL(playlistId, items, {
        onProgress: ({ added: current, status, reason, delayMs }) => {
          sendProgress({
            stage: "adding",
            total,
            added: current,
            status,
            reason,
            delayMs
          });
        }
      });
      sendProgress({ stage: "finalizing", total, added });
      const url = `https://www.youtube.com/playlist?list=${playlistId}`;
      sendProgress({ stage: "done", total, added, url, title });
      return { playlistId, url, title, added, total, progressToken: token };
    } catch (err) {
      console.error("Failed to create YouTube playlist", err);
      const reason = extractPlaylistErrorReason(err);
      sendProgress({ stage: "error", reason });
      return { error: reason };
    }
  },
  async "playlist:importList"(message) {
    if (!message?.data) return { error: "data required" };
    return mutateAndPresent(
      () => importList(message.data, {
        mode: message.mode === "append" ? "append" : "new",
        targetListId: message.targetListId || null
      }),
      { dispatch: true, ensureDefault: true }
    );
  }
};

// src/background/handlers/options.js
var optionsHandlers = {
  async "options:openQuickFilter"(message) {
    const videoId = parseVideoId(message?.videoId);
    if (!videoId) {
      return { error: "INVALID_VIDEO_ID" };
    }
    try {
      const base = chrome.runtime.getURL("src/settings/settings.html");
      const url = new URL(base);
      url.searchParams.set("quickFilterVideo", videoId);
      await chrome.tabs.create({ url: url.toString() });
      return { ok: true };
    } catch (err) {
      console.error("Failed to open quick filter page", err);
      return { error: err?.message || "FAILED_TO_OPEN_QUICK_FILTER" };
    }
  },
  async "options:openListSettings"(message) {
    const listId = typeof message?.listId === "string" ? message.listId.trim() : "";
    if (!listId) {
      return { error: "INVALID_LIST_ID" };
    }
    try {
      const base = chrome.runtime.getURL("src/popup/lists.html");
      const url = new URL(base);
      url.searchParams.set("listId", listId);
      const listName = typeof message?.listName === "string" ? message.listName.trim() : "";
      if (listName) {
        url.searchParams.set("listName", listName);
      }
      await chrome.tabs.create({ url: url.toString() });
      return { ok: true };
    } catch (err) {
      console.error("Failed to open list settings page", err);
      return { error: err?.message || "FAILED_TO_OPEN_LIST_SETTINGS" };
    }
  },
  async "sync:getStatus"() {
    const [playlist, settings] = await Promise.all([
      getPlaylistSyncStorageStatus(),
      getSettingsSyncStatus()
    ]);
    const syncKeys = Object.keys(await chrome.storage.sync.get(null));
    return {
      ok: true,
      extensionId: chrome.runtime.id,
      playlist,
      settings,
      syncKeyCount: syncKeys.length,
      hasPlaylistManifest: syncKeys.includes(SYNC_MANIFEST_STORAGE_KEY),
      hasSettingsManifest: syncKeys.includes(SETTINGS_SYNC_MANIFEST_STORAGE_KEY)
    };
  },
  async "sync:pullRemote"() {
    const [playlist, settings] = await Promise.all([
      importRemotePlaylistSyncIfNewer(),
      importRemoteSettingsSync()
    ]);
    return {
      ok: true,
      playlistImported: Boolean(playlist?.imported),
      settingsImported: Boolean(settings?.imported),
      settingsReason: settings?.reason || null
    };
  },
  async "sync:replaceLocalFromRemote"() {
    const [playlist, settings] = await Promise.all([
      replaceLocalPlaylistSyncFromRemote(),
      importRemoteSettingsSync({ force: true })
    ]);
    return {
      ok: true,
      playlistImported: Boolean(playlist?.imported),
      playlistReason: playlist?.reason || null,
      settingsImported: Boolean(settings?.imported),
      settingsReason: settings?.reason || null
    };
  },
  async "sync:pushLocal"() {
    const [playlist, settings] = await Promise.all([
      pushLocalPlaylistSyncNow(),
      pushLocalSettingsSyncNow()
    ]);
    return {
      ok: true,
      playlistPushed: Boolean(playlist?.pushed),
      playlistReason: playlist?.reason || null,
      settingsPushed: Boolean(settings?.pushed),
      settingsReason: settings?.reason || null
    };
  }
};

// src/background/playback.js
function buildWatchUrl(videoId) {
  return `https://www.youtube.com/watch?v=${videoId}`;
}
function extractTabUrl(tab) {
  if (!tab || typeof tab !== "object") {
    return null;
  }
  if (typeof tab.url === "string" && tab.url) {
    return tab.url;
  }
  if (typeof tab.pendingUrl === "string" && tab.pendingUrl) {
    return tab.pendingUrl;
  }
  return null;
}
function isYouTubeUrl(url) {
  if (typeof url !== "string" || !url) {
    return false;
  }
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host === "youtu.be" || host === "www.youtu.be") {
      return true;
    }
    return host === "youtube.com" || host.endsWith(".youtube.com");
  } catch {
    return false;
  }
}
function isSameVideoInTab(tab, videoId) {
  const currentId = parseVideoId(extractTabUrl(tab));
  return Boolean(currentId && currentId === videoId);
}
async function ensureTab(tabId) {
  if (typeof tabId !== "number" || !Number.isInteger(tabId)) return null;
  try {
    return await chrome.tabs.get(tabId);
  } catch {
    return null;
  }
}
async function resolvePreferredTab(preferredIds = []) {
  for (const id of preferredIds) {
    const tab = await ensureTab(id);
    if (tab) return tab;
  }
  return null;
}
function findVideoLocation(state, videoId) {
  if (!state || !videoId || !state.lists) {
    return null;
  }
  for (const [listId, list] of Object.entries(state.lists)) {
    const queue = Array.isArray(list?.queue) ? list.queue : [];
    const index = queue.findIndex((entry) => entry?.id === videoId);
    if (index !== -1) {
      return { listId, index };
    }
  }
  return null;
}
async function openVideo(videoId, options = {}) {
  const stateHint = options.stateHint || null;
  const forceNewTab = Boolean(options.forceNewTab);
  const activate = options.activate !== false;
  const url = buildWatchUrl(videoId);
  let targetTab = null;
  if (!forceNewTab) {
    const preferred = [];
    if (typeof options.tabId === "number") preferred.push(options.tabId);
    if (stateHint && typeof stateHint.currentTabId === "number" && !preferred.includes(stateHint.currentTabId)) {
      preferred.push(stateHint.currentTabId);
    }
    const resolved = await resolvePreferredTab(preferred);
    if (resolved) {
      try {
        if (isSameVideoInTab(resolved, videoId)) {
          targetTab = activate ? await chrome.tabs.update(resolved.id, { active: true }) : resolved;
        } else {
          targetTab = await chrome.tabs.update(resolved.id, {
            url,
            active: activate
          });
        }
      } catch (err) {
        console.warn("Failed to reuse tab, opening new one", err);
        targetTab = null;
      }
    }
  }
  if (!targetTab && !forceNewTab) {
    try {
      const [activeTab] = await chrome.tabs.query({
        active: true,
        lastFocusedWindow: true
      });
      if (activeTab && isYouTubeUrl(extractTabUrl(activeTab))) {
        try {
          if (isSameVideoInTab(activeTab, videoId)) {
            targetTab = activate ? await chrome.tabs.update(activeTab.id, { active: true }) : activeTab;
          } else {
            targetTab = await chrome.tabs.update(activeTab.id, {
              url,
              active: activate
            });
          }
        } catch (err) {
          console.warn("Failed to reuse active YouTube tab", err);
          targetTab = null;
        }
      }
    } catch (err) {
      console.warn("Failed to query active tab", err);
    }
  }
  if (!targetTab) {
    targetTab = await chrome.tabs.create({ url, active: activate });
  }
  if (activate && targetTab?.windowId) {
    try {
      await chrome.windows.update(targetTab.windowId, { focused: true });
    } catch (err) {
      console.warn("Failed to focus window", err);
    }
  }
  await setCurrentTab(targetTab.id);
  return targetTab;
}
async function selectPreviousFromQueue(stateHint = null) {
  const workingState = stateHint || await getState();
  if (!workingState || typeof workingState !== "object") {
    return null;
  }
  const lists = workingState.lists || {};
  const candidateIds = [];
  if (workingState.currentListId && lists[workingState.currentListId]) {
    candidateIds.push(workingState.currentListId);
  }
  for (const id of Object.keys(lists)) {
    if (!candidateIds.includes(id)) {
      candidateIds.push(id);
    }
  }
  for (const id of candidateIds) {
    const list = lists[id];
    if (!list || !Array.isArray(list.queue) || list.queue.length === 0) {
      continue;
    }
    let currentIndex = typeof list.currentIndex === "number" && list.currentIndex >= 0 && list.currentIndex < list.queue.length ? list.currentIndex : null;
    if (currentIndex === null && workingState.currentVideoId) {
      const locatedIndex = list.queue.findIndex(
        (entry) => entry?.id === workingState.currentVideoId
      );
      if (locatedIndex !== -1) {
        currentIndex = locatedIndex;
      }
    }
    if (currentIndex === null || currentIndex <= 0) {
      continue;
    }
    const previousEntry = list.queue[currentIndex - 1];
    if (!previousEntry || !previousEntry.id) {
      continue;
    }
    await setCurrentVideo(previousEntry.id, list.id);
    return previousEntry.id;
  }
  return null;
}
async function playVideo(videoId, options = {}) {
  let workingState = options.stateHint || null;
  if (options.ensureCurrent !== false) {
    workingState = await setCurrentVideo(videoId);
  } else if (!workingState) {
    workingState = await getState();
  }
  await openVideo(videoId, {
    tabId: options.tabId,
    stateHint: workingState,
    forceNewTab: options.forceNewTab,
    activate: options.activate
  });
  await notifyState();
  return workingState ? workingState : await getState();
}
async function advanceToNext(options = {}) {
  const before = await getState();
  const requestedId = options.videoId || null;
  const currentId = before.currentVideoId || null;
  let targetId = currentId || requestedId;
  let listId = before.currentListId || null;
  const senderTabMatchesCurrent = typeof options.tabId === "number" && Number.isInteger(options.tabId) && options.tabId === before.currentTabId;
  if (requestedId && requestedId !== currentId) {
    const requestedLocation = findVideoLocation(before, requestedId);
    if (!requestedLocation) {
      if (!currentId || !senderTabMatchesCurrent) {
        return {
          handled: false,
          reason: "VIDEO_MISMATCH",
          state: await getPresentationState()
        };
      }
    } else {
      await setCurrentVideo(requestedId, requestedLocation.listId);
      targetId = requestedId;
      listId = requestedLocation.listId;
    }
  }
  if (!targetId) {
    const presentation = await getPresentationState();
    return { handled: false, state: presentation };
  }
  const currentLocation = findVideoLocation(before, targetId);
  if (!currentLocation) {
    return {
      handled: false,
      reason: "TARGET_NOT_IN_QUEUE",
      state: await getPresentationState()
    };
  }
  if (!listId) {
    listId = currentLocation.listId;
  }
  await markVideoWatched(targetId, { listId });
  await notifyState();
  await dispatchNotifications();
  const afterPresentation = await getPresentationState();
  if (!afterPresentation.currentVideoId || afterPresentation.currentVideoId === targetId) {
    return { handled: false, state: afterPresentation };
  }
  ensureDefaultQueueFilled().catch((err) => {
    console.error("Auto collection after advancing failed", err);
  });
  await playVideo(afterPresentation.currentVideoId, {
    tabId: options.tabId || before.currentTabId,
    ensureCurrent: false
  });
  const finalPresentation = await getPresentationState();
  return { handled: true, state: finalPresentation };
}
async function playFromHistory(options = {}) {
  const initialState = await getState();
  const hasHistory = Array.isArray(initialState?.history) ? initialState.history.length > 0 : false;
  if (hasHistory) {
    await playHistoryEntry(options.position || 0, {
      placement: options.placement || "front"
    });
  } else {
    const fallbackId = await selectPreviousFromQueue(initialState);
    if (!fallbackId) {
      const presentation2 = await getPresentationState();
      return { handled: false, state: presentation2 };
    }
  }
  await notifyState();
  await dispatchNotifications();
  const presentation = await getPresentationState();
  if (!presentation.currentVideoId) {
    return { handled: false, state: presentation };
  }
  await playVideo(presentation.currentVideoId, {
    tabId: options.tabId,
    ensureCurrent: false
  });
  const finalPresentation = await getPresentationState();
  return { handled: true, state: finalPresentation };
}
async function postponeCurrent(options = {}) {
  const requestedId = options.videoId || null;
  let workingState = await getState();
  if (requestedId && workingState.currentVideoId !== requestedId) {
    const updated = await setCurrentVideo(requestedId);
    workingState = updated || await getState();
    if (workingState.currentVideoId !== requestedId) {
      const presentation = await getPresentationState();
      return { handled: false, state: presentation };
    }
  }
  if (typeof options.tabId === "number" && workingState.currentTabId !== options.tabId) {
    workingState = await setCurrentTab(options.tabId);
  }
  const targetId = requestedId || workingState.currentVideoId;
  if (!targetId) {
    const presentation = await getPresentationState();
    return { handled: false, state: presentation };
  }
  const currentList = workingState?.currentListId && workingState?.lists ? workingState.lists[workingState.currentListId] : null;
  if (currentList?.freeze) {
    const presentation = await getPresentationState();
    return { handled: false, state: presentation };
  }
  const previousCurrentId = workingState.currentVideoId;
  await postponeVideo(targetId, { listId: workingState.currentListId });
  await notifyState();
  await dispatchNotifications();
  await ensureDefaultQueueFilled();
  const afterPresentation = await getPresentationState();
  const nextId = afterPresentation.currentVideoId;
  if (!nextId || nextId === previousCurrentId) {
    return { handled: false, state: afterPresentation };
  }
  await playVideo(nextId, {
    tabId: typeof options.tabId === "number" ? options.tabId : workingState.currentTabId,
    ensureCurrent: false
  });
  const finalPresentation = await getPresentationState();
  return { handled: true, state: finalPresentation };
}

// src/background/handlers/playback.js
async function rejectInvalidVideo() {
  return {
    handled: false,
    reason: "INVALID_VIDEO",
    state: await getPresentationState()
  };
}
var playbackHandlers = {
  async "playlist:play"(message, sender) {
    if (!message?.videoId) {
      return getPresentationState();
    }
    const messageTabId = typeof message.tabId === "number" && Number.isInteger(message.tabId) ? message.tabId : void 0;
    const senderTabId = sender?.tab?.id;
    await applyMutation(
      () => setCurrentVideo(message.videoId, message.listId || null),
      { dispatch: false }
    );
    await playVideo(message.videoId, {
      tabId: messageTabId ?? senderTabId,
      ensureCurrent: false,
      forceNewTab: Boolean(message.forceNewTab),
      activate: message.activate
    });
    return getPresentationState();
  },
  async "playlist:playNext"(message) {
    const videoId = parseVideoId(message?.videoId);
    if (!videoId) {
      return rejectInvalidVideo();
    }
    return advanceToNext({
      tabId: message.tabId,
      videoId
    });
  },
  async "playlist:postpone"(message) {
    const videoId = message?.videoId ? parseVideoId(message.videoId) : void 0;
    return postponeCurrent({
      tabId: message.tabId,
      videoId
    });
  },
  async "playlist:playPrevious"(message) {
    const position = typeof message.position === "number" && Number.isInteger(message.position) ? message.position : 0;
    const placement = message.placement === "beforeCurrent" ? "beforeCurrent" : "front";
    return playFromHistory({
      position,
      tabId: message.tabId,
      placement
    });
  },
  async "player:videoStarted"(message, sender) {
    const videoId = parseVideoId(message.videoId);
    if (!videoId) return { controlled: false };
    let state = await getState();
    const tabId = sender?.tab?.id;
    const hasSenderTabId = typeof tabId === "number" && Number.isInteger(tabId);
    const hasCurrentTabId = typeof state.currentTabId === "number" && Number.isInteger(state.currentTabId);
    if (hasSenderTabId && hasCurrentTabId && tabId !== state.currentTabId) {
      const activeStatus = await getTabPlaybackStatus(state.currentTabId);
      if (!activeStatus.ok || !activeStatus.hasVideo) {
        await clearCurrentTab(state.currentTabId);
        await notifyState();
        state = await getState();
      } else if (state.currentVideoId) {
        return {
          controlled: false,
          reason: "OTHER_TAB_OWNS_PLAYBACK",
          state: await getPresentationState()
        };
      } else if (activeStatus.playing) {
        return {
          controlled: false,
          reason: "OTHER_TAB_PLAYING",
          state: await getPresentationState()
        };
      }
    }
    const isCurrentTab = typeof tabId === "number" && Number.isInteger(tabId) ? tabId === state.currentTabId : false;
    const located = findVideoInState(state, videoId);
    const inHistory = state.history.find((item) => item.id === videoId);
    if (!located && !inHistory) {
      if (isCurrentTab && state.currentListId && state.currentVideoId) {
        await suspendPlayback();
        const presentation3 = await notifyState();
        return { controlled: false, state: presentation3 };
      }
      const presentation2 = await getPresentationState();
      return { controlled: false, state: presentation2 };
    }
    const currentListId = state.currentListId;
    const lists = state.lists || {};
    const currentListExists = typeof currentListId === "string" && Boolean(lists[currentListId]);
    const locatedListId = located?.list?.id && lists[located.list.id] ? located.list.id : null;
    const shouldAdoptPlayback = locatedListId && (isCurrentTab || !hasCurrentTabId || !state.currentVideoId || locatedListId === currentListId || !currentListExists);
    if (shouldAdoptPlayback) {
      await setCurrentVideo(videoId, locatedListId);
      if (typeof tabId === "number") {
        await setCurrentTab(tabId);
      }
      const presentation2 = await notifyState();
      return { controlled: true, state: presentation2 };
    }
    let presentation = null;
    if (state.currentVideoId) {
      await suspendPlayback();
      presentation = await notifyState();
    } else {
      presentation = await getPresentationState();
    }
    return { controlled: false, state: presentation };
  },
  async "player:progress"(message) {
    const videoId = parseVideoId(message.videoId);
    if (!videoId) {
      return { ok: false, reason: "INVALID_VIDEO" };
    }
    const percent = Number(message.percent);
    if (!Number.isFinite(percent)) {
      return { ok: false, reason: "INVALID_PERCENT" };
    }
    const timestamp = Number.isFinite(Number(message.timestamp)) ? Number(message.timestamp) : Date.now();
    const changed = await recordVideoProgress(videoId, percent, { timestamp });
    if (changed) {
      await notifyState();
    }
    return { ok: true, changed };
  },
  async "player:videoEnded"(message, sender) {
    const videoId = parseVideoId(message.videoId);
    if (!videoId) {
      return rejectInvalidVideo();
    }
    const tabId = sender?.tab?.id;
    let state = await getState();
    const hasSenderTabId = typeof tabId === "number" && Number.isInteger(tabId);
    const hasCurrentTabId = typeof state?.currentTabId === "number" && Number.isInteger(state.currentTabId);
    if (hasSenderTabId && hasCurrentTabId && state.currentTabId !== tabId) {
      const activeStatus = await getTabPlaybackStatus(state.currentTabId);
      if (!activeStatus.ok || !activeStatus.hasVideo) {
        await clearCurrentTab(state.currentTabId);
        await setCurrentTab(tabId);
        await notifyState();
        state = await getState();
      } else if (activeStatus.playing) {
        return {
          handled: false,
          reason: "OTHER_TAB_OWNS_PLAYBACK",
          state: await getPresentationState()
        };
      }
    }
    return advanceToNext({
      tabId,
      videoId
    });
  },
  async "player:videoUnavailable"(message, sender) {
    const tabId = sender?.tab?.id;
    const videoId = parseVideoId(message.videoId);
    if (!videoId) {
      return { handled: false, reason: "NO_VIDEO" };
    }
    const state = await getState();
    const located = findVideoInState(state, videoId);
    if (!located) {
      return {
        handled: false,
        reason: "NOT_IN_QUEUE",
        state: await getPresentationState()
      };
    }
    const reason = typeof message.reason === "string" && message.reason.trim() ? message.reason.trim() : null;
    if (reason) {
      console.warn("Video unavailable, skipping", videoId, reason);
    } else {
      console.warn("Video unavailable, skipping", videoId);
    }
    if (state.currentVideoId !== videoId) {
      const presentation = await handleRemoveVideos(
        [videoId],
        located.list?.id || null
      );
      return { handled: true, skipped: true, state: presentation };
    }
    const response = await advanceToNext({
      tabId,
      videoId
    });
    return { ...response, skipped: true };
  },
  async "player:requestNext"(message, sender) {
    const videoId = parseVideoId(message.videoId);
    if (!videoId) {
      return rejectInvalidVideo();
    }
    const tabId = sender?.tab?.id;
    return advanceToNext({
      tabId,
      videoId
    });
  },
  async "player:requestPrevious"(message, sender) {
    const tabId = sender?.tab?.id;
    return playFromHistory({
      tabId,
      position: 0,
      placement: "beforeCurrent"
    });
  },
  async "player:requestPostpone"(message, sender) {
    const tabId = sender?.tab?.id;
    return postponeCurrent({
      tabId,
      videoId: parseVideoId(message.videoId)
    });
  },
  async "player:getPlaybackStatus"() {
    const result = await pingActivePlaybackTab({
      type: "player:getPlaybackStatus"
    });
    if (!result.ok) {
      return { active: false, playing: false, reason: result.reason };
    }
    const response = result.response || {};
    if (!response || response.hasVideo === false) {
      await clearCurrentTab(result.tabId);
      await notifyState();
      return { active: false, playing: false, reason: "NO_VIDEO" };
    }
    return { active: true, playing: response.playing === true };
  },
  async "player:togglePlayback"(message) {
    const result = await pingActivePlaybackTab({
      type: "player:togglePlayback",
      mode: message?.mode || message?.action || "toggle"
    });
    if (!result.ok) {
      return { handled: false, reason: result.reason };
    }
    const response = result.response || {};
    if (!response || response.hasVideo === false) {
      await clearCurrentTab(result.tabId);
      await notifyState();
      return { handled: false, reason: "NO_VIDEO" };
    }
    return {
      handled: response.handled !== false,
      playing: response.playing === true
    };
  }
};

// src/background/handlers/queue.js
var queueHandlers = {
  "playlist:getState": getPresentationState,
  async "playlist:setCurrentList"(message) {
    if (!message?.listId) return getPresentationState();
    return mutateAndPresent(() => setCurrentList(message.listId));
  },
  async "playlist:addByIds"(message, sender) {
    return handleAddByIds(message, sender);
  },
  async "playlist:addPlaylist"(message, sender) {
    const rawId = message?.playlistId || message?.id || message?.listId || message?.videoId;
    const playlistId = parsePlaylistId(rawId);
    if (!playlistId) {
      return {
        state: await getPresentationState(),
        requested: 0,
        fetched: 0,
        missing: 0,
        added: 0,
        error: "INVALID_PLAYLIST_ID"
      };
    }
    try {
      const { ids, total } = await fetchPlaylistVideoIds(playlistId, {
        limit: message?.limit
      });
      if (!Array.isArray(ids) || !ids.length) {
        return {
          state: await getPresentationState(),
          requested: total || 0,
          fetched: 0,
          missing: total || 0,
          added: 0
        };
      }
      return handleAddByIds({ ...message, videoIds: ids, playlistId }, sender);
    } catch (err) {
      console.warn("Failed to add playlist", playlistId, err);
      return {
        state: await getPresentationState(),
        requested: 0,
        fetched: 0,
        missing: 0,
        added: 0,
        error: err?.message || "PLAYLIST_ADD_FAILED"
      };
    }
  },
  async "playlist:addEntries"(message) {
    const entries = Array.isArray(message.entries) ? message.entries : [];
    return addEntries(entries, message.listId || null, {
      ensureDefault: message?.ensureDefault !== false
    });
  },
  async "playlist:remove"(message) {
    const ids = Array.isArray(message.videoIds) ? message.videoIds : [message.videoId];
    return handleRemoveVideos(ids, message.listId || null);
  },
  async "playlist:postponeVideo"(message) {
    const videoId = message?.videoId ? parseVideoId(message.videoId) : null;
    if (!videoId) {
      return getPresentationState();
    }
    return mutateAndPresent(
      () => postponeVideo(videoId, { listId: message.listId || null }),
      { notify: true }
    );
  },
  async "playlist:restoreDeleted"(message) {
    const position = typeof message?.position === "number" && Number.isInteger(message.position) ? message.position : 0;
    return mutateAndPresent(() => restoreDeletedEntry(position), {
      dispatch: true,
      ensureDefault: true
    });
  },
  async "playlist:getNext"() {
    const state = await getState();
    return getNextQueueEntry(state);
  },
  async "playlist:getHistoryLimit"() {
    return { limit: HISTORY_LIMIT };
  },
  async "playlist:reorder"(message) {
    if (!message?.videoId) {
      return getPresentationState();
    }
    return mutateAndPresent(
      () => reorderQueue(message.videoId, message.targetIndex, message.listId || null)
    );
  },
  async "playlist:moveVideo"(message) {
    if (!message?.videoId || !message?.targetListId) {
      return getPresentationState();
    }
    return mutateAndPresent(
      () => moveVideoToList(message.videoId, message.targetListId),
      { dispatch: true, ensureDefault: true }
    );
  },
  async "playlist:moveVideos"(message) {
    return handleMoveVideos(message?.videoIds, message?.targetListId);
  },
  async "playlist:moveAll"(message) {
    if (!message?.sourceListId || !message?.targetListId) {
      return getPresentationState();
    }
    return mutateAndPresent(
      () => moveAllVideos(message.sourceListId, message.targetListId),
      { dispatch: true, ensureDefault: true }
    );
  }
};

// src/background/messages.js
var messageHandlers = {
  ...collectionHandlers,
  ...optionsHandlers,
  ...queueHandlers,
  ...listHandlers,
  ...playbackHandlers
};

// src/background.js
configurePlaylistSyncAccess();
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== "string") {
    return false;
  }
  if (message.source === MESSAGE_SOURCE) {
    return false;
  }
  const handler = messageHandlers[message.type];
  if (!handler) {
    return false;
  }
  Promise.resolve(handler(message, sender)).then((result) => sendResponse(result)).catch((err) => {
    console.error("Message handler failed", message.type, err);
    sendResponse({
      error: err && err.message ? err.message : String(err)
    });
  });
  return true;
});
chrome.tabs.onRemoved.addListener((tabId) => {
  clearCurrentTab(tabId).then(() => notifyState());
});
if (chrome.alarms?.onAlarm) {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm?.name !== SYNC_ALARM_NAME) {
      return;
    }
    Promise.all([flushPendingPlaylistSync(), flushPendingSettingsSync()]).catch(
      (err) => {
        console.error("Account sync flush failed", err);
      }
    );
  });
}
chrome.storage?.onChanged?.addListener((changes, area) => {
  if (area !== "sync") {
    return;
  }
  const tasks = [];
  if (isPlaylistSyncStorageChange(changes)) {
    tasks.push(importRemotePlaylistSyncIfNewer().then(() => notifyState()));
  }
  if (isSettingsSyncStorageChange(changes)) {
    tasks.push(importRemoteSettingsSync());
  }
  if (!tasks.length) {
    return;
  }
  Promise.all(tasks).catch((err) => {
    console.error("Account sync import failed", err);
  });
});
