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

function sanitizeHistoryEntry(entry) {
  const base = sanitizeEntry(entry);
  return {
    ...base,
    watchedAt: entry?.watchedAt || Date.now(),
    listId: entry?.listId || null,
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
    };
  } else {
    // ensure name/freeze stay enforced
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

function sanitizeList(rawList, id) {
  if (!rawList || typeof rawList !== "object") {
    return {
      id,
      name: id === DEFAULT_LIST_ID ? DEFAULT_LIST_NAME : "Список",
      freeze: id === DEFAULT_LIST_ID ? false : false,
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
      id === DEFAULT_LIST_ID ? false : Boolean(rawList.freeze && id !== DEFAULT_LIST_ID),
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

function sanitizeState(raw) {
  if (!raw || typeof raw !== "object") {
    return { ...defaultState };
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
      typeof raw.currentTabId === "number" && Number.isInteger(raw.currentTabId)
        ? raw.currentTabId
        : null,
  };

  const listIds = new Set(state.listOrder);
  const rawLists = raw.lists && typeof raw.lists === "object" ? raw.lists : {};

  Object.keys(rawLists).forEach((id) => {
    const sanitized = sanitizeList(rawLists[id], id);
    state.lists[id] = sanitized;
    listIds.add(id);
  });

  if (!state.lists[DEFAULT_LIST_ID]) {
    state.lists[DEFAULT_LIST_ID] = sanitizeList(rawLists[DEFAULT_LIST_ID], DEFAULT_LIST_ID);
    listIds.add(DEFAULT_LIST_ID);
  }

  state.listOrder = Array.from(listIds);
  ensureDefaultList(state);

  // ensure active list id valid
  if (state.activeListId && !state.lists[state.activeListId]) {
    state.activeListId = null;
  }
  // ensure currentListId exists
  if (!state.lists[state.currentListId]) {
    state.currentListId = DEFAULT_LIST_ID;
  }

  return state;
}

async function loadRawState() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return stored[STORAGE_KEY];
}

async function storeState(state) {
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
  return state;
}

export async function getState() {
  const raw = await loadRawState();
  return sanitizeState(raw);
}

export async function replaceState(newState) {
  const sanitized = sanitizeState(newState);
  await storeState(sanitized);
  return sanitized;
}

async function mutateState(mutator) {
  const current = await getState();
  const updated = await Promise.resolve(mutator(current));
  if (!updated || typeof updated !== "object") {
    throw new TypeError("State mutator must return updated state");
  }
  const sanitized = sanitizeState(updated);
  await storeState(sanitized);
  return sanitized;
}

function ensureListExists(state, listId) {
  if (!state.lists[listId]) {
    throw new Error(`List ${listId} not found`);
  }
}

export async function addList({ name, freeze = false } = {}) {
  return mutateState((state) => {
    const id = `list_${Date.now().toString(36)}_${Math.random()
      .toString(36)
      .slice(2, 6)}`;
    state.lists[id] = {
      id,
      name: name?.trim() || "Новый список",
      freeze: Boolean(freeze),
      queue: [],
      currentIndex: null,
    };
    state.listOrder.push(id);
    return state;
  });
}

export async function renameList(listId, newName) {
  if (listId === DEFAULT_LIST_ID) {
    return getState(); // default is immutable
  }
  return mutateState((state) => {
    ensureListExists(state, listId);
    state.lists[listId].name = newName?.trim() || state.lists[listId].name;
    return state;
  });
}

export async function setListFreeze(listId, freeze) {
  if (listId === DEFAULT_LIST_ID) {
    return getState();
  }
  return mutateState((state) => {
    ensureListExists(state, listId);
    state.lists[listId].freeze = Boolean(freeze);
    return state;
  });
}

export async function removeList(listId, { mode = "move" } = {}) {
  if (listId === DEFAULT_LIST_ID) {
    return getState();
  }
  return mutateState((state) => {
    ensureListExists(state, listId);
    const list = state.lists[listId];
    if (mode === "move" && list.queue.length) {
      const defaultList = state.lists[DEFAULT_LIST_ID];
      defaultList.queue = defaultList.queue.concat(list.queue);
      if (defaultList.currentIndex === null && defaultList.queue.length) {
        defaultList.currentIndex = 0;
      }
    }
    delete state.lists[listId];
    state.listOrder = state.listOrder.filter((id) => id !== listId);
    if (state.currentListId === listId) {
      state.currentListId = DEFAULT_LIST_ID;
    }
    if (state.activeListId === listId) {
      state.activeListId = null;
      state.currentVideoId = null;
    }
    state.history = state.history.map((entry) =>
      entry.listId === listId ? { ...entry, listId: mode === "move" ? DEFAULT_LIST_ID : null } : entry
    );
    ensureDefaultList(state);
    return state;
  });
}

export async function setCurrentList(listId) {
  return mutateState((state) => {
    ensureDefaultList(state);
    if (!state.lists[listId]) {
      throw new Error(`List ${listId} not found`);
    }
    state.currentListId = listId;
    return state;
  });
}

function getCurrentList(state) {
  return state.lists[state.currentListId] || state.lists[DEFAULT_LIST_ID];
}

export async function addVideos(entries = [], listId = null) {
  if (!Array.isArray(entries) || !entries.length) {
    return getState();
  }
  return mutateState((state) => {
    ensureDefaultList(state);
    const targetId = listId || state.currentListId || DEFAULT_LIST_ID;
    ensureListExists(state, targetId);
    const list = state.lists[targetId];
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
        // skip invalid entry
      }
    }
    if (!incoming.length) {
      return state;
    }
    list.queue = list.queue.concat(incoming);
    if (list.currentIndex === null && list.queue.length) {
      list.currentIndex = 0;
    }
    return state;
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
    } else {
      list.currentIndex = null;
    }
  }
  if (list.queue.length === 0) {
    list.currentIndex = null;
  } else if (
    list.currentIndex === null ||
    list.currentIndex < 0 ||
    list.currentIndex >= list.queue.length
  ) {
    list.currentIndex = 0;
  }
}

export async function removeVideo(videoId, { listId = null } = {}) {
  if (!videoId) return getState();
  return mutateState((state) => {
    ensureDefaultList(state);
    const lists = listId ? [state.lists[listId]].filter(Boolean) : Object.values(state.lists);
    for (const list of lists) {
      const idx = list.queue.findIndex((item) => item.id === videoId);
      if (idx !== -1) {
        list.queue.splice(idx, 1);
        adjustIndexAfterRemoval(list, idx);
        if (state.activeListId === list.id && state.currentVideoId === videoId) {
          state.currentVideoId = null;
          state.activeListId = null;
        }
        if (list.id !== DEFAULT_LIST_ID && list.queue.length === 0) {
          state.pendingNotifications = state.pendingNotifications || [];
          state.pendingNotifications.push({
            type: "listEmpty",
            listId: list.id,
            name: list.name,
          });
        }
        break;
      }
    }
    state.history = state.history.filter((item) => item.id !== videoId);
    return state;
  });
}

function findVideo(state, videoId) {
  for (const list of Object.values(state.lists)) {
    const index = list.queue.findIndex((item) => item.id === videoId);
    if (index !== -1) {
      return { list, index };
    }
  }
  return null;
}

export async function setCurrentVideo(videoId, listId = null) {
  if (!videoId) return getState();
  return mutateState((state) => {
    ensureDefaultList(state);
    let targetList = listId ? state.lists[listId] : null;
    let index = -1;
    if (!targetList) {
      const located = findVideo(state, videoId);
      if (located) {
        targetList = located.list;
        index = located.index;
      }
    } else {
      index = targetList.queue.findIndex((item) => item.id === videoId);
    }
    if (!targetList || index === -1) {
      return state;
    }
    targetList.currentIndex = index;
    state.activeListId = targetList.id;
    state.currentVideoId = videoId;
    state.currentListId = targetList.id;
    return state;
  });
}

export async function suspendPlayback() {
  return mutateState((state) => {
    ensureDefaultList(state);
    state.activeListId = null;
    return state;
  });
}

export async function setCurrentTab(tabId) {
  return mutateState((state) => {
    state.currentTabId =
      typeof tabId === "number" && Number.isInteger(tabId) ? tabId : null;
    return state;
  });
}

export async function clearCurrentTab(tabId) {
  return mutateState((state) => {
    if (state.currentTabId === tabId) {
      state.currentTabId = null;
    }
    return state;
  });
}

function appendHistory(state, entry, listId) {
  state.history.unshift(
    sanitizeHistoryEntry({ ...entry, listId, watchedAt: Date.now() })
  );
  state.history = state.history.slice(0, HISTORY_LIMIT);
}

async function maybeAutoCollect(state) {
  return state;
}

export async function markVideoWatched(videoId, { listId = null } = {}) {
  if (!videoId) return getState();
  return mutateState((state) => {
    ensureDefaultList(state);
    const located = findVideo(state, videoId);
    if (!located) {
      return state;
    }
    const list = located.list;
    const index = located.index;
    const entry = list.queue[index];
    appendHistory(state, entry, list.id);
    const shouldRemove = list.id === DEFAULT_LIST_ID || !list.freeze;
    if (shouldRemove) {
      list.queue.splice(index, 1);
      adjustIndexAfterRemoval(list, index);
    } else {
      // keep current index pointing to next item if exists
      if (list.currentIndex === index && list.queue.length > 1) {
        list.currentIndex = (index + 1) % list.queue.length;
      }
    }
    if (state.activeListId === list.id && state.currentVideoId === videoId) {
      if (list.queue.length && list.currentIndex !== null) {
        state.currentVideoId = list.queue[list.currentIndex]?.id || null;
      } else {
        state.currentVideoId = null;
        state.activeListId = null;
      }
    }
    if (list.id === DEFAULT_LIST_ID) {
      const remaining = list.queue.length;
      if (remaining <= 1) {
        state.pendingDefaultRefresh = true;
      } else {
        state.pendingDefaultRefresh = false;
      }
    } else if (list.queue.length === 0) {
      state.pendingNotifications = state.pendingNotifications || [];
      state.pendingNotifications.push({
        type: "listEmpty",
        listId: list.id,
        name: list.name,
      });
    }
    return state;
  });
}

export async function shouldAutoRefreshDefault() {
  const state = await getState();
  const defaultList = state.lists[DEFAULT_LIST_ID];
  return Boolean(state.pendingDefaultRefresh) || (defaultList && defaultList.queue.length <= 1);
}

export async function clearPendingDefaultRefresh() {
  return mutateState((state) => {
    delete state.pendingDefaultRefresh;
    return state;
  });
}

export async function consumePendingNotifications() {
  const state = await getState();
  const notifications = state.pendingNotifications || [];
  if (notifications.length) {
    state.pendingNotifications = [];
    await storeState(state);
  }
  return notifications;
}

export async function getNextQueueEntry(stateInput = null) {
  const state = stateInput ? sanitizeState(stateInput) : await getState();
  const list = state.activeListId
    ? state.lists[state.activeListId]
    : state.lists[state.currentListId];
  if (!list || list.currentIndex === null) return null;
  const nextIndex = list.currentIndex + 1;
  if (nextIndex >= list.queue.length) return null;
  return {
    entry: list.queue[nextIndex],
    index: nextIndex,
    listId: list.id,
  };
}

export function getHistoryLimit() {
  return HISTORY_LIMIT;
}

export async function playHistoryEntry(position = 0, options = {}) {
  const placement = options.placement || "front";
  return mutateState((state) => {
    ensureDefaultList(state);
    if (!state.history.length) {
      return state;
    }
    const idx = Math.min(
      Math.max(Number(position) || 0, 0),
      state.history.length - 1
    );
    const [entry] = state.history.splice(idx, 1);
    if (!entry) return state;
    const listId = entry.listId && state.lists[entry.listId]
      ? entry.listId
      : state.currentListId;
    const list = state.lists[listId];
    const revived = sanitizeEntry({ ...entry, addedAt: Date.now() });
    const existingIndex = list.queue.findIndex((item) => item.id === revived.id);
    if (existingIndex !== -1) {
      list.queue.splice(existingIndex, 1);
      adjustIndexAfterRemoval(list, existingIndex);
    }
    let insertIndex = 0;
    if (placement === "beforeCurrent") {
      if (list.currentIndex !== null) {
        insertIndex = Math.max(list.currentIndex, 0);
      } else {
        insertIndex = 0;
      }
    } else if (placement === "end") {
      insertIndex = list.queue.length;
    } else {
      insertIndex = 0;
    }
    list.queue.splice(insertIndex, 0, revived);
    list.currentIndex = insertIndex;
    state.currentListId = list.id;
    state.activeListId = list.id;
    state.currentVideoId = revived.id;
    return state;
  });
}

export async function reorderQueue(videoId, targetIndex, listId = null) {
  if (!videoId) return getState();
  return mutateState((state) => {
    ensureDefaultList(state);
    const located = findVideo(state, videoId);
    if (!located) {
      return state;
    }
    const list = located.list;
    if (listId && list.id !== listId) {
      return state;
    }
    let toIndex = Number(targetIndex);
    if (!Number.isInteger(toIndex)) {
      return state;
    }
    toIndex = Math.max(0, Math.min(toIndex, list.queue.length));
    const fromIndex = located.index;
    if (fromIndex === toIndex || fromIndex === toIndex - 1) {
      return state;
    }
    const [entry] = list.queue.splice(fromIndex, 1);
    if (fromIndex < toIndex) {
      toIndex -= 1;
    }
    list.queue.splice(toIndex, 0, entry);
    if (list.currentIndex !== null) {
      if (list.currentIndex === fromIndex) {
        list.currentIndex = toIndex;
      } else if (fromIndex < list.currentIndex && toIndex >= list.currentIndex) {
        list.currentIndex -= 1;
      } else if (
        fromIndex > list.currentIndex &&
        toIndex <= list.currentIndex
      ) {
        list.currentIndex += 1;
      }
      list.currentIndex = Math.max(
        0,
        Math.min(list.currentIndex, list.queue.length - 1)
      );
    }
    return state;
  });
}

export async function moveVideoToList(videoId, targetListId) {
  if (!videoId || !targetListId) return getState();
  return mutateState((state) => {
    ensureDefaultList(state);
    ensureListExists(state, targetListId);
    const located = findVideo(state, videoId);
    if (!located) return state;
    const sourceList = located.list;
    const targetList = state.lists[targetListId];
    const [entry] = sourceList.queue.splice(located.index, 1);
    adjustIndexAfterRemoval(sourceList, located.index);
    if (sourceList.id !== DEFAULT_LIST_ID && sourceList.queue.length === 0) {
      state.pendingNotifications = state.pendingNotifications || [];
      state.pendingNotifications.push({
        type: "listEmpty",
        listId: sourceList.id,
        name: sourceList.name,
      });
    }
    const existingIdx = targetList.queue.findIndex((item) => item.id === videoId);
    if (existingIdx !== -1) {
      // already exists; reinsert to end
      targetList.queue.splice(existingIdx, 1);
      adjustIndexAfterRemoval(targetList, existingIdx);
    }
    targetList.queue.push(entry);
    if (targetList.currentIndex === null) {
      targetList.currentIndex = 0;
    }
    if (state.activeListId === sourceList.id && state.currentVideoId === videoId) {
      state.currentVideoId = null;
      state.activeListId = null;
    }
    return state;
  });
}

export async function exportList(listId) {
  const state = await getState();
  ensureDefaultList(state);
  ensureListExists(state, listId);
  const list = state.lists[listId];
  return {
    id: list.id,
    name: list.name,
    freeze: list.freeze,
    queue: list.queue,
  };
}

export async function importList(data, { mode = "new", targetListId = null } = {}) {
  if (!data || typeof data !== "object") {
    throw new Error("Invalid import data");
  }
  const entries = Array.isArray(data.queue) ? data.queue : [];
  if (mode === "append") {
    const listId = targetListId || DEFAULT_LIST_ID;
    return addVideos(entries, listId);
  }
  return mutateState((state) => {
    ensureDefaultList(state);
    const id = `list_${Date.now().toString(36)}_${Math.random()
      .toString(36)
      .slice(2, 6)}`;
    state.lists[id] = {
      id,
      name: data.name?.trim() || "Импортированный список",
      freeze: Boolean(data.freeze),
      queue: entries
        .map((item) => {
          try {
            return sanitizeEntry(item);
          } catch {
            return null;
          }
        })
        .filter(Boolean),
      currentIndex: 0,
    };
    state.listOrder.push(id);
    return state;
  });
}

export async function getPresentationState() {
  const state = await getState();
  const listsMeta = state.listOrder
    .map((id) => state.lists[id])
    .filter(Boolean)
    .map((list) => ({
      id: list.id,
      name: list.name,
      freeze: list.freeze,
      length: list.queue.length,
    }));
  const currentList = state.lists[state.currentListId];
  return {
    lists: listsMeta,
    currentListId: state.currentListId,
    activeListId: state.activeListId,
    currentVideoId: state.currentVideoId,
    currentTabId: state.currentTabId,
    currentQueue: currentList
      ? {
          id: currentList.id,
          name: currentList.name,
          freeze: currentList.freeze,
          queue: currentList.queue,
          currentIndex: currentList.currentIndex,
        }
      : null,
    history: state.history,
  };
}

export const DEFAULT_LIST = DEFAULT_LIST_ID;
export async function moveAllVideos(sourceListId, targetListId) {
  if (!sourceListId || !targetListId || sourceListId === targetListId) {
    return getState();
  }
  return mutateState((state) => {
    ensureDefaultList(state);
    ensureListExists(state, sourceListId);
    ensureListExists(state, targetListId);
    const source = state.lists[sourceListId];
    const target = state.lists[targetListId];
    if (!source.queue.length) {
      return state;
    }
    target.queue = target.queue.concat(source.queue);
    if (target.currentIndex === null && target.queue.length) {
      target.currentIndex = 0;
    }
    if (state.activeListId === source.id && state.currentVideoId) {
      state.currentVideoId = null;
      state.activeListId = null;
    }
    source.queue = [];
    source.currentIndex = null;
    if (sourceListId === DEFAULT_LIST_ID) {
      state.pendingDefaultRefresh = true;
    }
    if (targetListId === DEFAULT_LIST_ID && target.queue.length > 1) {
      state.pendingDefaultRefresh = false;
    }
    if (source.id !== DEFAULT_LIST_ID) {
      state.pendingNotifications = state.pendingNotifications || [];
      state.pendingNotifications.push({
        type: "listEmpty",
        listId: source.id,
        name: source.name,
      });
    }
    return state;
  });
}

export async function getListDetails(listId) {
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
  };
}
