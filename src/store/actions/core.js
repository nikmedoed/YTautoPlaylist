// Shared store mutation helpers. Contains withState, list resolution, history appenders, notification queues, and index adjustment.
import {
  mutateState,
  ensureDefaultList,
  ensureListExists,
  sanitizeHistoryEntry,
  sanitizeDeletedHistoryEntry,
  HISTORY_LIMIT,
  DEFAULT_LIST_ID,
  sanitizeAutoCollectSeenIds,
} from "../state/index.js";
import { normalizeAutoCollectTimestamp } from "../state/autoCollectTimestamp.js";

export const AUTO_COLLECT_COOLDOWN_MS = 60 * 60 * 1000;

export function withState(mutator) {
  return mutateState((state) => {
    ensureDefaultList(state);
    return mutator(state);
  });
}

export function resolveList(state, listId, { fallback = true } = {}) {
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

export function ensureNotificationQueue(state) {
  if (!Array.isArray(state.pendingNotifications)) {
    state.pendingNotifications = [];
  }
  return state.pendingNotifications;
}

export function ensureAutoCollectMeta(state) {
  if (!state.autoCollect || typeof state.autoCollect !== "object") {
    state.autoCollect = {
      lastRunAt: 0,
      lastAdded: 0,
      lastFetched: 0,
      nextAutoCollectAt: 0,
      seenIds: [],
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

export function cloneAutoCollectMeta(meta) {
  return {
    lastRunAt: normalizeAutoCollectTimestamp(meta.lastRunAt),
    lastAdded: Math.max(0, Number(meta.lastAdded) || 0),
    lastFetched: Math.max(0, Number(meta.lastFetched) || 0),
    nextAutoCollectAt: normalizeAutoCollectTimestamp(meta.nextAutoCollectAt),
  };
}

export function rememberAutoCollectSeenIds(state, ids = []) {
  if (!state || typeof state !== "object" || !Array.isArray(ids) || !ids.length) {
    return;
  }
  const meta = ensureAutoCollectMeta(state);
  meta.seenIds = sanitizeAutoCollectSeenIds([...(meta.seenIds || []), ...ids]);
}

export function bumpListRevision(list) {
  if (!list || typeof list !== "object") {
    return;
  }
  const current = Number.isInteger(list.revision) ? list.revision : 0;
  list.revision = current + 1;
}

export function toTimestamp(value) {
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

export function markListEmpty(state, list) {
  const notifications = ensureNotificationQueue(state);
  notifications.push({
    type: "listEmpty",
    listId: list.id,
    name: list.name,
  });
}

export function adjustIndexAfterRemoval(list, removedIndex) {
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
  } else if (
    list.currentIndex === null ||
    list.currentIndex < 0 ||
    list.currentIndex >= list.queue.length
  ) {
    list.currentIndex = 0;
  }
}

export function findVideo(state, videoId, { preferListId = null } = {}) {
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

export function appendHistory(state, entry, listId) {
  state.history.unshift(
    sanitizeHistoryEntry({ ...entry, listId, watchedAt: Date.now() })
  );
  state.history = state.history.slice(0, HISTORY_LIMIT);
}

export function ensureDeletedHistory(state) {
  if (!Array.isArray(state.deletedHistory)) {
    state.deletedHistory = [];
  }
  return state.deletedHistory;
}

export function appendDeletedHistory(state, entry, listId) {
  try {
    const history = ensureDeletedHistory(state);
    const sanitized = sanitizeDeletedHistoryEntry({
      ...entry,
      listId,
      deletedAt: Date.now(),
    });
    state.deletedHistory = history.filter((item) => item.id !== sanitized.id);
    state.deletedHistory.unshift(sanitized);
    state.deletedHistory = state.deletedHistory.slice(0, HISTORY_LIMIT);
  } catch {
    /* ignore invalid entry */
  }
}

export function ensureDefaultRefreshFlag(state) {
  const defaultList = state.lists[DEFAULT_LIST_ID];
  if (!defaultList) return;
  if (defaultList.queue.length <= 2) {
    state.pendingDefaultRefresh = true;
  } else {
    state.pendingDefaultRefresh = false;
  }
}

export function generateListId() {
  return `list_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 6)}`;
}
