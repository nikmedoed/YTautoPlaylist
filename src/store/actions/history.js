// Store actions for playback and deletion history. Contains restore, previous-video selection, and history limit behavior.
import { sanitizeEntry, DEFAULT_LIST_ID } from "../state/index.js";
import {
  adjustIndexAfterRemoval,
  bumpListRevision,
  ensureDefaultRefreshFlag,
  ensureDeletedHistory,
  rememberAutoCollectSeenIds,
  resolveList,
  withState,
} from "./core.js";

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

export async function restoreDeletedEntry(position = 0) {
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
    const preferredListId =
      entry.listId && state.lists[entry.listId] ? entry.listId : null;
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
