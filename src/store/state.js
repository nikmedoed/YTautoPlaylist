const STORAGE_KEY = "runtimePlaylistState";
const HISTORY_LIMIT = 10;
const DEFAULT_LIST_ID = "default";
const DEFAULT_LIST_NAME = "Основной";

const defaultState = {
  lists: {
    [DEFAULT_LIST_ID]: {
      id: DEFAULT_LIST_ID,
      name: DEFAULT_LIST_NAME,
      freeze: false,
      queue: [],
      currentIndex: null,
    },
  },
  listOrder: [DEFAULT_LIST_ID],
  currentListId: DEFAULT_LIST_ID,
  activeListId: null,
  currentVideoId: null,
  history: [],
  currentTabId: null,
};

const hasChromeStorage =
  typeof chrome !== "undefined" && chrome?.storage?.local;
let memoryState = null;

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

export function ensureDefaultList(state) {
  if (!state.lists[DEFAULT_LIST_ID]) {
    state.lists[DEFAULT_LIST_ID] = {
      id: DEFAULT_LIST_ID,
      name: DEFAULT_LIST_NAME,
      freeze: false,
      queue: [],
      currentIndex: null,
    };
  } else {
    state.lists[DEFAULT_LIST_ID].name = DEFAULT_LIST_NAME;
    state.lists[DEFAULT_LIST_ID].freeze = false;
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

export function sanitizeList(rawList, id) {
  if (!rawList || typeof rawList !== "object") {
    return {
      id,
      name: id === DEFAULT_LIST_ID ? DEFAULT_LIST_NAME : "Список",
      freeze: false,
      queue: [],
      currentIndex: null,
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
    activeListId:
      typeof raw.activeListId === "string" && raw.activeListId
        ? raw.activeListId
        : null,
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
    currentTabId:
      typeof raw.currentTabId === "number" &&
      Number.isInteger(raw.currentTabId)
        ? raw.currentTabId
        : null,
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

  if (state.activeListId && !state.lists[state.activeListId]) {
    state.activeListId = null;
  }
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
    return memoryState ?? JSON.parse(JSON.stringify(defaultState));
  }
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return stored?.[STORAGE_KEY];
}

async function persistState(state) {
  if (!hasChromeStorage) {
    memoryState = JSON.parse(JSON.stringify(state));
    return state;
  }
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
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

export { STORAGE_KEY, HISTORY_LIMIT, DEFAULT_LIST_ID, DEFAULT_LIST_NAME };
