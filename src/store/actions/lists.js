// Store actions for list metadata. Contains create, rename, freeze, remove, import/export, and current-list selection logic.
import {
  getState,
  ensureDefaultList,
  ensureListExists,
  sanitizeEntry,
  DEFAULT_LIST_ID,
  DEFAULT_LIST_NAME,
} from "../state/index.js";
import { addVideos } from "./queue.js";
import {
  bumpListRevision,
  ensureDefaultRefreshFlag,
  ensureNotificationQueue,
  generateListId,
  markListEmpty,
  rememberAutoCollectSeenIds,
  resolveList,
  withState,
} from "./core.js";

export async function addList({ name, freeze = false } = {}) {
  return withState((state) => {
    const id = generateListId();
    state.lists[id] = {
      id,
      name: name?.trim() || "Новый список",
      freeze: Boolean(freeze),
      queue: [],
      currentIndex: null,
      revision: 0,
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
  if (state.currentListId === DEFAULT_LIST_ID) {
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

export async function setCurrentList(listId) {
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
    const queue = entries
      .map((item) => {
        try {
          return sanitizeEntry(item);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    state.lists[id] = {
      id,
      name: data.name?.trim() || "Импортированный список",
      freeze: Boolean(data.freeze),
      queue,
      currentIndex: 0,
      revision: queue.length,
    };
    state.listOrder.push(id);
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
    revision: Number.isInteger(list.revision) ? list.revision : 0,
  };
}

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
