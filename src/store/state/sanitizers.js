// State schema sanitizers. Contains normalization for lists, queue entries, history, deleted history, and full persisted state.
import {
  AUTO_COLLECT_SEEN_IDS_LIMIT,
  DEFAULT_LIST_ID,
  DEFAULT_LIST_NAME,
  HISTORY_LIMIT,
  VIDEO_ID_PATTERN,
  defaultState,
} from "./constants.js";
import { sanitizeVideoProgressMap } from "./videoProgress.js";

const SECOND_TS_MIN = 1_000_000_000;
const SECOND_TS_MAX = 10_000_000_000;

export function normalizeAutoCollectTimestamp(value) {
  let ts = Number(value);
  if (!Number.isFinite(ts) || ts <= 0) {
    return 0;
  }
  ts = Math.trunc(ts);
  if (ts >= SECOND_TS_MIN && ts < SECOND_TS_MAX) {
    ts *= 1000;
  }
  return ts;
}

export function sanitizeAutoCollectSeenIds(raw) {
  const source = Array.isArray(raw) ? raw : [];
  const seen = new Set();
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
  return state;
}

function sanitizeList(rawList, id) {
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
        : Boolean(rawList.freeze),
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

// Converts raw chrome.storage data into the full normalized state shape expected by actions and UI.
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
            lastRunAt: normalizeAutoCollectTimestamp(raw.autoCollect.lastRunAt),
            lastAdded: Math.max(0, Number(raw.autoCollect.lastAdded) || 0),
            lastFetched: Math.max(0, Number(raw.autoCollect.lastFetched) || 0),
            nextAutoCollectAt: normalizeAutoCollectTimestamp(
              raw.autoCollect.nextAutoCollectAt
            ),
            seenIds: sanitizeAutoCollectSeenIds(raw.autoCollect.seenIds),
          }
        : {
            lastRunAt: 0,
            lastAdded: 0,
            lastFetched: 0,
            nextAutoCollectAt: 0,
            seenIds: [],
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
