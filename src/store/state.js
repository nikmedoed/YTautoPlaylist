const LEGACY_STORAGE_KEY = "runtimePlaylistState";
const LISTS_STORAGE_KEY = "runtimePlaylistLists";
const META_STORAGE_KEY = "runtimePlaylistMeta";
const RUNTIME_STORAGE_KEY = "runtimePlaylistRuntime";
const VIDEO_PROGRESS_STORAGE_KEY = "runtimePlaylistProgress";
const DELETED_HISTORY_STORAGE_KEY = "runtimePlaylistDeletedHistory";
const AUTO_COLLECT_STORAGE_KEY = "subscriptionsCollect";
const LEGACY_AUTO_COLLECT_STORAGE_KEY = "runtimePlaylistAutoCollect";
const LIST_CONTENT_PREFIX = "runtimePlaylistList:";
const HISTORY_LIMIT = 10;
const DEFAULT_LIST_ID = "default";
const DEFAULT_LIST_NAME = "Основной";
const VIDEO_PROGRESS_LIMIT = 500;

const VIDEO_ID_PATTERN = /^[\w-]{11}$/;

const defaultState = {
  lists: {
    [DEFAULT_LIST_ID]: {
      id: DEFAULT_LIST_ID,
      name: DEFAULT_LIST_NAME,
      freeze: false,
      queue: [],
      currentIndex: null,
      revision: 0,
    },
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
  },
  videoProgress: {},
};

const hasChromeStorage =
  typeof chrome !== "undefined" && chrome?.storage?.local;
let memoryState = null;

function deepClone(value) {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value !== "object") {
    return value;
  }
  return JSON.parse(JSON.stringify(value));
}

function clampPercent(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  const rounded = Math.round(value);
  if (!Number.isFinite(rounded)) {
    return null;
  }
  if (rounded <= 0) {
    return 0;
  }
  if (rounded >= 100) {
    return 100;
  }
  return rounded;
}

function sanitizeVideoProgressEntry(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }
  const percent = clampPercent(entry.percent);
  if (percent === null || percent <= 0) {
    return null;
  }
  const updatedAt = Number.isFinite(entry.updatedAt)
    ? Math.max(0, Math.trunc(entry.updatedAt))
    : Date.now();
  return { percent, updatedAt };
}

export function sanitizeVideoProgressMap(raw) {
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

export function ensureVideoProgress(state) {
  if (!state || typeof state !== "object") {
    throw new TypeError("State is required to ensure video progress");
  }
  if (!state.videoProgress || typeof state.videoProgress !== "object") {
    state.videoProgress = {};
  }
  return state.videoProgress;
}

function collectTrackedVideoIds(state) {
  const ids = new Set();
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
  const entries = keys
    .map((id) => ({
      id,
      updatedAt: Number(map[id]?.updatedAt) || 0,
      tracked: trackedIds.has(id),
    }))
    .sort((a, b) => a.updatedAt - b.updatedAt);

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

export function applyVideoProgress(state, videoId, percent, options = {}) {
  if (!state || typeof state !== "object") {
    return false;
  }
  if (typeof videoId !== "string" || !VIDEO_ID_PATTERN.test(videoId)) {
    return false;
  }
  const clamped = clampPercent(percent);
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
  const timestamp = Number.isFinite(timestampCandidate)
    ? Math.max(0, Math.trunc(timestampCandidate))
    : Date.now();
  if (existing) {
    const noChange =
      existing.percent === clamped && timestamp <= existing.updatedAt;
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

export function cloneVideoProgress(state) {
  if (!state || typeof state !== "object") {
    return {};
  }
  const sanitized = sanitizeVideoProgressMap(state.videoProgress);
  return JSON.parse(JSON.stringify(sanitized));
}

function getListStorageKey(id) {
  return `${LIST_CONTENT_PREFIX}${id}`;
}

function composeRawState(
  rawMeta,
  rawRuntime,
  rawLists,
  rawAutoCollect,
  rawDeletedHistory,
  rawVideoProgress
) {
  const meta = rawMeta && typeof rawMeta === "object" ? rawMeta : {};
  const metaLists =
    meta.lists && typeof meta.lists === "object" ? meta.lists : {};
  const runtime =
    rawRuntime && typeof rawRuntime === "object" ? rawRuntime : {};
  const runtimeIndices =
    runtime.listIndices && typeof runtime.listIndices === "object"
      ? runtime.listIndices
      : {};
  const listEntries =
    rawLists && typeof rawLists === "object" ? rawLists : {};
  const listIds = new Set([
    ...Object.keys(metaLists),
    ...Object.keys(listEntries),
    ...Object.keys(runtimeIndices),
  ]);
  const lists = {};

  listIds.forEach((id) => {
    const metaEntry =
      metaLists[id] && typeof metaLists[id] === "object" ? metaLists[id] : {};
    const listEntry =
      listEntries[id] && typeof listEntries[id] === "object"
        ? listEntries[id]
        : {};
    const queueSource = Array.isArray(listEntry.queue)
      ? listEntry.queue
      : Array.isArray(listEntry)
      ? listEntry
      : [];
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
      name:
        typeof metaEntry.name === "string" && metaEntry.name
          ? metaEntry.name
          : typeof listEntry.name === "string" && listEntry.name
          ? listEntry.name
          : undefined,
      freeze:
        typeof metaEntry.freeze === "boolean"
          ? metaEntry.freeze
          : typeof listEntry.freeze === "boolean"
          ? listEntry.freeze
          : undefined,
      queue: queueSource,
      currentIndex,
      revision: Number.isInteger(metaEntry.revision)
        ? metaEntry.revision
        : Number.isInteger(listEntry.revision)
        ? listEntry.revision
        : 0,
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

  const deletedHistory = Array.isArray(rawDeletedHistory)
    ? deepClone(rawDeletedHistory)
    : Array.isArray(runtime?.deletedHistory)
    ? deepClone(runtime.deletedHistory)
    : [];

  const progressSource =
    rawVideoProgress && typeof rawVideoProgress === "object"
      ? rawVideoProgress
      : rawRuntime &&
          typeof rawRuntime === "object" &&
          typeof rawRuntime.videoProgress === "object"
        ? rawRuntime.videoProgress
        : null;

  return {
    ...metaClone,
    ...runtimeClone,
    autoCollect,
    lists: deepClone(lists),
    deletedHistory,
    videoProgress: sanitizeVideoProgressMap(progressSource),
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
      currentIndex: Number.isInteger(list.currentIndex)
        ? list.currentIndex
        : null,
      revision: Number.isInteger(list.revision) ? list.revision : 0,
    };
    listContents[id] = {
      queue: deepClone(list.queue),
    };
  });

  const meta = deepClone({
    lists: listsMeta,
    listOrder: state.listOrder,
  });

  const runtime = deepClone({
    currentListId: state.currentListId,
    currentVideoId: state.currentVideoId,
    history: state.history,
    currentTabId: state.currentTabId,
  });

  const autoCollect = deepClone(state.autoCollect);

  const deletedHistory = Array.isArray(state.deletedHistory)
    ? deepClone(state.deletedHistory)
    : [];

  const videoProgress = sanitizeVideoProgressMap(state.videoProgress);

  return {
    listContents,
    meta,
    runtime,
    autoCollect,
    deletedHistory,
    videoProgress,
  };
}

export function sanitizeEntry(entry) {
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
    addedAt = Date.now(),
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
    publishedAt:
      publishedAt instanceof Date
        ? publishedAt.toISOString()
        : typeof publishedAt === "string"
        ? publishedAt
        : null,
    duration,
    addedAt,
  };
}

export function sanitizeHistoryEntry(entry) {
  const base = sanitizeEntry(entry);
  return {
    ...base,
    watchedAt: entry?.watchedAt || Date.now(),
    listId: entry?.listId || null,
  };
}

export function sanitizeDeletedHistoryEntry(entry) {
  const base = sanitizeEntry(entry);
  return {
    ...base,
    deletedAt: entry?.deletedAt || Date.now(),
    listId: entry?.listId || null,
  };
}

export function ensureDefaultList(state) {
  if (!state.lists[DEFAULT_LIST_ID]) {
    state.lists[DEFAULT_LIST_ID] = {
      id: DEFAULT_LIST_ID,
      name: DEFAULT_LIST_NAME,
      freeze: false,
      queue: [],
      currentIndex: null,
      revision: 0,
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
  if (!state.lists[state.currentListId]) {
    state.currentListId = DEFAULT_LIST_ID;
  }
  return state;
}

export function sanitizeList(rawList, id) {
  if (!rawList || typeof rawList !== "object") {
    return {
      id,
      name: id === DEFAULT_LIST_ID ? DEFAULT_LIST_NAME : "Список",
      freeze: false,
      queue: [],
      currentIndex: null,
      revision: 0,
    };
  }
  const list = {
    id: rawList.id || id,
    name:
      rawList.name ||
      (id === DEFAULT_LIST_ID ? DEFAULT_LIST_NAME : "Список"),
    freeze:
      id === DEFAULT_LIST_ID
        ? false
        : Boolean(rawList.freeze && id !== DEFAULT_LIST_ID),
    queue: Array.isArray(rawList.queue)
      ? rawList.queue
          .map((item) => {
            try {
              return sanitizeEntry(item);
            } catch {
              return null;
            }
          })
          .filter(Boolean)
      : [],
    currentIndex: Number.isInteger(rawList.currentIndex)
      ? rawList.currentIndex
      : null,
    revision: Number.isInteger(rawList.revision) ? rawList.revision : 0,
  };
  if (
    list.currentIndex === null ||
    list.currentIndex < 0 ||
    list.currentIndex >= list.queue.length
  ) {
    list.currentIndex = list.queue.length ? 0 : null;
  }
  return list;
}

export function sanitizeState(raw) {
  if (!raw || typeof raw !== "object") {
    return JSON.parse(JSON.stringify(defaultState));
  }
  const state = {
    lists: {},
    listOrder: Array.isArray(raw.listOrder)
      ? raw.listOrder.filter((id) => typeof id === "string" && id)
      : [],
    currentListId:
      typeof raw.currentListId === "string" && raw.currentListId
        ? raw.currentListId
        : DEFAULT_LIST_ID,
    currentVideoId:
      typeof raw.currentVideoId === "string" ? raw.currentVideoId : null,
    history: Array.isArray(raw.history)
      ? raw.history
          .map((item) => {
            try {
              return sanitizeHistoryEntry(item);
            } catch {
              return null;
            }
          })
          .filter(Boolean)
          .slice(0, HISTORY_LIMIT)
      : [],
    deletedHistory: Array.isArray(raw.deletedHistory)
      ? raw.deletedHistory
          .map((item) => {
            try {
              return sanitizeDeletedHistoryEntry(item);
            } catch {
              return null;
            }
          })
          .filter(Boolean)
          .slice(0, HISTORY_LIMIT)
      : [],
    currentTabId:
      typeof raw.currentTabId === "number" &&
      Number.isInteger(raw.currentTabId)
        ? raw.currentTabId
        : null,
    autoCollect:
      raw.autoCollect && typeof raw.autoCollect === "object"
        ? {
            lastRunAt: Number(raw.autoCollect.lastRunAt) || 0,
            lastAdded: Math.max(0, Number(raw.autoCollect.lastAdded) || 0),
            lastFetched: Math.max(0, Number(raw.autoCollect.lastFetched) || 0),
            nextAutoCollectAt:
              Number(raw.autoCollect.nextAutoCollectAt) > 0
                ? Number(raw.autoCollect.nextAutoCollectAt)
                : 0,
          }
        : {
            lastRunAt: 0,
            lastAdded: 0,
            lastFetched: 0,
            nextAutoCollectAt: 0,
          },
    videoProgress: sanitizeVideoProgressMap(
      (raw && typeof raw === "object" && raw.videoProgress) ||
        (raw?.runtime && typeof raw.runtime === "object"
          ? raw.runtime.videoProgress
          : null)
    ),
  };

  const rawLists =
    raw.lists && typeof raw.lists === "object" ? raw.lists : {};
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

export function ensureListExists(state, listId) {
  if (!listId || !state.lists[listId]) {
    throw new Error(`List ${listId} not found`);
  }
}

async function loadRawState() {
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
    DELETED_HISTORY_STORAGE_KEY,
  ]);

  if (stored?.[LEGACY_STORAGE_KEY]) {
    const migrated = sanitizeState(stored[LEGACY_STORAGE_KEY]);
    const {
      listContents,
      meta,
      runtime,
      autoCollect,
      deletedHistory,
      videoProgress,
    } = splitStateForStorage(migrated);
    const payload = {
      [META_STORAGE_KEY]: meta,
      [RUNTIME_STORAGE_KEY]: runtime,
      [AUTO_COLLECT_STORAGE_KEY]: autoCollect,
      [DELETED_HISTORY_STORAGE_KEY]: deletedHistory,
      [VIDEO_PROGRESS_STORAGE_KEY]: videoProgress,
    };
    Object.entries(listContents).forEach(([id, content]) => {
      payload[getListStorageKey(id)] = content;
    });
    await chrome.storage.local.set(payload);
    await chrome.storage.local.remove([
      LEGACY_STORAGE_KEY,
      LISTS_STORAGE_KEY,
      LEGACY_AUTO_COLLECT_STORAGE_KEY,
    ]);
    return composeRawState(
      meta,
      runtime,
      listContents,
      autoCollect,
      deletedHistory,
      videoProgress
    );
  }

  if (stored?.[LISTS_STORAGE_KEY]) {
    const migrated = composeRawState(
      stored?.[META_STORAGE_KEY],
      stored?.[RUNTIME_STORAGE_KEY],
      stored?.[LISTS_STORAGE_KEY],
      stored?.[AUTO_COLLECT_STORAGE_KEY] ||
        stored?.[LEGACY_AUTO_COLLECT_STORAGE_KEY],
      stored?.[DELETED_HISTORY_STORAGE_KEY]
    );
    const sanitized = sanitizeState(migrated);
    const {
      listContents,
      meta,
      runtime,
      autoCollect,
      deletedHistory,
      videoProgress,
    } = splitStateForStorage(sanitized);
    const payload = {
      [META_STORAGE_KEY]: meta,
      [RUNTIME_STORAGE_KEY]: runtime,
      [AUTO_COLLECT_STORAGE_KEY]: autoCollect,
      [DELETED_HISTORY_STORAGE_KEY]: deletedHistory,
      [VIDEO_PROGRESS_STORAGE_KEY]: videoProgress,
    };
    Object.entries(listContents).forEach(([id, content]) => {
      payload[getListStorageKey(id)] = content;
    });
    await chrome.storage.local.set(payload);
    await chrome.storage.local.remove([
      LISTS_STORAGE_KEY,
      LEGACY_AUTO_COLLECT_STORAGE_KEY,
    ]);
    return composeRawState(
      meta,
      runtime,
      listContents,
      autoCollect,
      deletedHistory,
      videoProgress
    );
  }

  const meta = stored?.[META_STORAGE_KEY] &&
    typeof stored[META_STORAGE_KEY] === "object"
      ? stored[META_STORAGE_KEY]
      : {};
  const runtime = stored?.[RUNTIME_STORAGE_KEY] &&
    typeof stored[RUNTIME_STORAGE_KEY] === "object"
      ? stored[RUNTIME_STORAGE_KEY]
      : {};
  const autoCollectSource =
    (stored?.[AUTO_COLLECT_STORAGE_KEY] &&
      typeof stored[AUTO_COLLECT_STORAGE_KEY] === "object"
      ? stored[AUTO_COLLECT_STORAGE_KEY]
      : null) ||
    (stored?.[LEGACY_AUTO_COLLECT_STORAGE_KEY] &&
      typeof stored[LEGACY_AUTO_COLLECT_STORAGE_KEY] === "object"
      ? stored[LEGACY_AUTO_COLLECT_STORAGE_KEY]
      : null) ||
    runtime?.autoCollect;
  const autoCollect = autoCollectSource;

  const deletedHistorySource = Array.isArray(
    stored?.[DELETED_HISTORY_STORAGE_KEY]
  )
    ? stored[DELETED_HISTORY_STORAGE_KEY]
    : runtime?.deletedHistory;

  const videoProgressSource =
    stored?.[VIDEO_PROGRESS_STORAGE_KEY] &&
    typeof stored[VIDEO_PROGRESS_STORAGE_KEY] === "object"
      ? stored[VIDEO_PROGRESS_STORAGE_KEY]
      : runtime?.videoProgress;

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

async function persistState(state) {
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
    videoProgress,
  } = splitStateForStorage(state);
  const payload = {
    [META_STORAGE_KEY]: meta,
    [RUNTIME_STORAGE_KEY]: runtime,
    [AUTO_COLLECT_STORAGE_KEY]: autoCollect,
    [DELETED_HISTORY_STORAGE_KEY]: deletedHistory,
    [VIDEO_PROGRESS_STORAGE_KEY]: videoProgress,
  };

  Object.entries(listContents).forEach(([id, content]) => {
    payload[getListStorageKey(id)] = content;
  });

  const existingMeta = await chrome.storage.local.get(META_STORAGE_KEY);
  const previousLists =
    existingMeta?.[META_STORAGE_KEY]?.lists &&
    typeof existingMeta[META_STORAGE_KEY].lists === "object"
      ? existingMeta[META_STORAGE_KEY].lists
      : {};
  const nextListIds = Object.keys(listContents);
  const toRemove = Object.keys(previousLists)
    .filter((id) => !nextListIds.includes(id))
    .map(getListStorageKey);

  if (toRemove.length) {
    await chrome.storage.local.remove(toRemove);
  }

  await chrome.storage.local.set(payload);
  if (LEGACY_AUTO_COLLECT_STORAGE_KEY !== AUTO_COLLECT_STORAGE_KEY) {
    await chrome.storage.local.remove(LEGACY_AUTO_COLLECT_STORAGE_KEY);
  }
  return state;
}

export async function getState() {
  const raw = await loadRawState();
  return sanitizeState(raw);
}

export async function replaceState(newState) {
  const sanitized = sanitizeState(newState);
  await persistState(sanitized);
  return sanitized;
}

export async function mutateState(mutator) {
  const current = await getState();
  const updated = await Promise.resolve(mutator(current));
  if (!updated || typeof updated !== "object") {
    throw new TypeError("State mutator must return updated state");
  }
  const sanitized = sanitizeState(updated);
  await persistState(sanitized);
  return sanitized;
}

export {
  LEGACY_STORAGE_KEY,
  LISTS_STORAGE_KEY,
  META_STORAGE_KEY,
  RUNTIME_STORAGE_KEY,
  AUTO_COLLECT_STORAGE_KEY,
  DELETED_HISTORY_STORAGE_KEY,
  LIST_CONTENT_PREFIX,
  getListStorageKey,
  HISTORY_LIMIT,
  DEFAULT_LIST_ID,
  DEFAULT_LIST_NAME,
};
