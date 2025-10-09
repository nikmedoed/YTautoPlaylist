import {
  mutateState,
  getState,
  replaceState,
  ensureDefaultList,
  ensureListExists,
  sanitizeEntry,
  sanitizeHistoryEntry,
  sanitizeState,
  HISTORY_LIMIT,
  DEFAULT_LIST_ID,
  DEFAULT_LIST_NAME,
} from "./state.js";

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
  const targetId =
    state.currentListId && state.lists[state.currentListId]
      ? state.currentListId
      : DEFAULT_LIST_ID;
  ensureListExists(state, targetId);
  return state.lists[targetId];
}

function ensureNotificationQueue(state) {
  if (!Array.isArray(state.pendingNotifications)) {
    state.pendingNotifications = [];
  }
  return state.pendingNotifications;
}

function markListEmpty(state, list) {
  const notifications = ensureNotificationQueue(state);
  notifications.push({
    type: "listEmpty",
    listId: list.id,
    name: list.name,
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
  if (!list.queue.length) {
    list.currentIndex = null;
  } else if (
    list.currentIndex === null ||
    list.currentIndex < 0 ||
    list.currentIndex >= list.queue.length
  ) {
    list.currentIndex = 0;
  }
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

function appendHistory(state, entry, listId) {
  state.history.unshift(
    sanitizeHistoryEntry({ ...entry, listId, watchedAt: Date.now() })
  );
  state.history = state.history.slice(0, HISTORY_LIMIT);
}

function ensureDefaultRefreshFlag(state) {
  const defaultList = state.lists[DEFAULT_LIST_ID];
  if (!defaultList) return;
  if (defaultList.queue.length <= 1) {
    state.pendingDefaultRefresh = true;
  } else {
    state.pendingDefaultRefresh = false;
  }
}

function generateListId() {
  return `list_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 6)}`;
}

export async function addList({ name, freeze = false } = {}) {
  return withState((state) => {
    const id = generateListId();
    state.lists[id] = {
      id,
      name: name?.trim() || "Новый список",
      freeze: Boolean(freeze),
      queue: [],
      currentIndex: null,
    };
    state.listOrder.push(id);
    if (!state.currentListId) {
      state.currentListId = id;
    }
    return state;
  });
}

export async function renameList(listId, newName) {
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

export async function setListFreeze(listId, freeze) {
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
  if (state.activeListId === listId) {
    state.activeListId = null;
    state.currentVideoId = null;
  }
  return list;
}

export async function removeList(
  listId,
  { mode = "move", targetListId = DEFAULT_LIST_ID } = {}
) {
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
    for (const entry of list.queue) {
      if (!existingIds.has(entry.id)) {
        target.queue.push(entry);
        existingIds.add(entry.id);
      }
    }
    if (target.currentIndex === null && target.queue.length) {
      target.currentIndex = 0;
    }
    return state;
  });
}

export async function setCurrentList(listId) {
  if (!listId) return getState();
  return withState((state) => {
    ensureListExists(state, listId);
    state.currentListId = listId;
    return state;
  });
}

export async function addVideos(entries = [], listId = null) {
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
    if (list.id === DEFAULT_LIST_ID) {
      ensureDefaultRefreshFlag(state);
    }
    return state;
  });
}

export async function removeVideo(videoId, { listId = null } = {}) {
  if (!videoId) return getState();
  return withState((state) => {
    const targets = listId
      ? [resolveList(state, listId, { fallback: false })].filter(Boolean)
      : Object.values(state.lists);
    for (const list of targets) {
      const index = list.queue.findIndex((item) => item.id === videoId);
      if (index === -1) continue;
      list.queue.splice(index, 1);
      adjustIndexAfterRemoval(list, index);
      if (state.activeListId === list.id && state.currentVideoId === videoId) {
        state.currentVideoId = null;
        state.activeListId = null;
      }
      if (list.id === DEFAULT_LIST_ID) {
        ensureDefaultRefreshFlag(state);
      } else if (!list.queue.length) {
        markListEmpty(state, list);
      }
      break;
    }
    state.history = state.history.filter((item) => item.id !== videoId);
    return state;
  });
}

export async function setCurrentVideo(videoId, listId = null) {
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
    state.activeListId = targetList.id;
    state.currentVideoId = videoId;
    state.currentListId = targetList.id;
    return state;
  });
}

export async function suspendPlayback() {
  return withState((state) => {
    state.activeListId = null;
    return state;
  });
}

export async function setCurrentTab(tabId) {
  return withState((state) => {
    state.currentTabId =
      typeof tabId === "number" && Number.isInteger(tabId) ? tabId : null;
    return state;
  });
}

export async function clearCurrentTab(tabId) {
  return withState((state) => {
    if (state.currentTabId === tabId) {
      state.currentTabId = null;
    }
    return state;
  });
}

export async function markVideoWatched(videoId, { listId = null } = {}) {
  if (!videoId) return getState();
  return withState((state) => {
    const located = findVideo(state, videoId);
    if (!located) {
      return state;
    }
    const { list, index } = located;
    const entry = list.queue[index];
    appendHistory(state, entry, list.id);
    const shouldRemove = list.id === DEFAULT_LIST_ID || !list.freeze;
    if (shouldRemove) {
      list.queue.splice(index, 1);
      adjustIndexAfterRemoval(list, index);
    } else if (list.currentIndex === index && list.queue.length > 1) {
      list.currentIndex = (index + 1) % list.queue.length;
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
      ensureDefaultRefreshFlag(state);
    } else if (!list.queue.length) {
      markListEmpty(state, list);
    }
    return state;
  });
}

export async function shouldAutoRefreshDefault() {
  const state = await getState();
  const defaultList = state.lists[DEFAULT_LIST_ID];
  return (
    Boolean(state.pendingDefaultRefresh) ||
    (defaultList && defaultList.queue.length <= 1)
  );
}

export async function clearPendingDefaultRefresh() {
  return withState((state) => {
    delete state.pendingDefaultRefresh;
    return state;
  });
}

export async function consumePendingNotifications() {
  const state = await getState();
  const notifications = Array.isArray(state.pendingNotifications)
    ? state.pendingNotifications.slice()
    : [];
  if (notifications.length) {
    state.pendingNotifications = [];
    await replaceState(state);
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
  return list.queue[nextIndex];
}

export function getHistoryLimit() {
  return HISTORY_LIMIT;
}

export async function playHistoryEntry(position = 0, options = {}) {
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
    const preferredListId =
      entry.listId && state.lists[entry.listId] ? entry.listId : null;
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
      insertIndex =
        list.currentIndex !== null ? Math.max(list.currentIndex, 0) : 0;
    } else if (placement === "end") {
      insertIndex = list.queue.length;
    }
    list.queue.splice(insertIndex, 0, revived);
    list.currentIndex = insertIndex;
    state.currentListId = list.id;
    state.activeListId = list.id;
    state.currentVideoId = revived.id;
    if (list.id === DEFAULT_LIST_ID) {
      ensureDefaultRefreshFlag(state);
    }
    return state;
  });
}

export async function reorderQueue(videoId, targetIndex, listId = null) {
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
    } else if (
      fromIndex < list.currentIndex &&
      toIndex >= list.currentIndex
    ) {
      list.currentIndex -= 1;
    } else if (
      fromIndex > list.currentIndex &&
      toIndex <= list.currentIndex
    ) {
      list.currentIndex += 1;
    }
    return state;
  });
}

export async function moveVideoToList(videoId, targetListId) {
  if (!videoId || !targetListId) return getState();
  return withState((state) => {
    ensureListExists(state, targetListId);
    const located = findVideo(state, videoId);
    if (!located) return state;
    const { list, index } = located;
    if (list.id === targetListId) return state;
    const [entry] = list.queue.splice(index, 1);
    adjustIndexAfterRemoval(list, index);
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
    }
    target.queue.push(entry);
    if (target.currentIndex === null) {
      target.currentIndex = 0;
    }
    if (target.id === DEFAULT_LIST_ID) {
      ensureDefaultRefreshFlag(state);
    }
    if (state.activeListId === list.id && state.currentVideoId === videoId) {
      state.currentVideoId = null;
      state.activeListId = null;
    }
    return state;
  });
}

export async function exportList(listId) {
  const state = await getState();
  const list = resolveList(state, listId);
  return {
    id: list.id,
    name: list.name,
    freeze: list.freeze,
    queue: list.queue,
  };
}

export async function importList(
  data,
  { mode = "new", targetListId = null } = {}
) {
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
  return withState((state) => {
    ensureListExists(state, sourceListId);
    ensureListExists(state, targetListId);
    const source = state.lists[sourceListId];
    const target = state.lists[targetListId];
    if (!source.queue.length) {
      return state;
    }
    const existingIds = new Set(target.queue.map((item) => item.id));
    for (const entry of source.queue) {
      if (!existingIds.has(entry.id)) {
        target.queue.push(entry);
      }
    }
    if (target.currentIndex === null && target.queue.length) {
      target.currentIndex = 0;
    }
    if (state.activeListId === source.id && state.currentVideoId) {
      state.currentVideoId = null;
      state.activeListId = null;
    }
    const sourceWasDefault = sourceListId === DEFAULT_LIST_ID;
    source.queue = [];
    source.currentIndex = null;
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

export {
  getState,
  replaceState,
  mutateState, // exported for advanced flows if needed
};
