// Store actions for queue contents. Contains add, remove, reorder, move, postpone, watch, and next-entry operations.
import {
  getState,
  ensureListExists,
  sanitizeEntry,
  sanitizeState,
  applyVideoProgress,
  DEFAULT_LIST_ID,
} from "../state/index.js";
import {
  adjustIndexAfterRemoval,
  appendDeletedHistory,
  appendHistory,
  bumpListRevision,
  ensureDefaultRefreshFlag,
  findVideo,
  markListEmpty,
  rememberAutoCollectSeenIds,
  resolveList,
  withState,
} from "./core.js";

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

export async function removeVideos(videoIds, { listId = null } = {}) {
  const ids = Array.isArray(videoIds) ? videoIds : [videoIds];
  const uniqueIds = Array.from(
    new Set(
      ids
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter((id) => id.length > 0)
    )
  );
  if (!uniqueIds.length) {
    return getState();
  }
  return withState((state) => {
    const targets = listId
      ? [resolveList(state, listId, { fallback: false })].filter(Boolean)
      : Object.values(state.lists);
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

export async function markVideoWatched(videoId, { listId = null } = {}) {
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

export async function postponeVideo(videoId, { listId = null } = {}) {
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
    const wasCurrentVideo =
      list.currentIndex === index &&
      state.currentListId === list.id &&
      state.currentVideoId === videoId;
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
      const nextEntry =
        list.currentIndex !== null ? list.queue[list.currentIndex] : null;
      state.currentVideoId = nextEntry ? nextEntry.id : null;
      state.currentListId = nextEntry ? list.id : state.currentListId;
    }
    return state;
  });
}

export async function getNextQueueEntry(stateInput = null) {
  const state = stateInput ? sanitizeState(stateInput) : await getState();
  const list = state.currentListId ? state.lists[state.currentListId] : null;
  if (!list || list.currentIndex === null) return null;
  const nextIndex = list.currentIndex + 1;
  if (nextIndex >= list.queue.length) return null;
  return list.queue[nextIndex];
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

export async function moveVideoToList(videoId, targetListId) {
  if (!videoId || !targetListId) return getState();
  return withState((state) => {
    moveVideoInState(state, videoId, targetListId);
    return state;
  });
}

// Moves several videos in one state transaction instead of reloading and
// persisting chrome.storage once per id.
export async function moveVideosToList(videoIds, targetListId) {
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
