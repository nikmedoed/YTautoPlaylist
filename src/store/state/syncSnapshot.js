// Pure playlist sync snapshot helpers. Contains portable state selection,
// fingerprinting, and remote/local runtime merge behavior.
import {
  AUTO_COLLECT_SEEN_IDS_LIMIT,
  DEFAULT_LIST_ID,
  HISTORY_LIMIT,
  QUEUE_REMOVAL_LOG_LIMIT,
  WATCHED_PROGRESS_THRESHOLD,
} from "./constants.js";
import { sanitizeState } from "./sanitizers.js";
import { deepClone } from "../../utils.js";
import {
  buildSyncSnapshot,
  buildSyncState,
  getSyncStateFingerprint,
  hasSyncableUserData,
  hashString,
  normalizeSyncTimestamp,
  storageItemBytes,
  SYNC_FORMAT_VERSION,
} from "./syncSnapshotCore.js";

export {
  buildSyncSnapshot,
  buildSyncState,
  getSyncStateFingerprint,
  hasSyncableUserData,
  hashString,
  normalizeSyncTimestamp,
  storageItemBytes,
  SYNC_FORMAT_VERSION,
} from "./syncSnapshotCore.js";

function normalizeListForSync(list) {
  return deepClone(list);
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
  const indexById = new Map();
  const merged = [];
  [...primaryQueue, ...secondaryQueue].forEach((entry) => {
    const id = typeof entry?.id === "string" ? entry.id : "";
    if (!id) {
      return;
    }
    const existingIndex = indexById.get(id);
    if (existingIndex === undefined) {
      indexById.set(id, merged.length);
      merged.push(deepClone(entry));
      return;
    }
    const existing = merged[existingIndex];
    const existingAddedAt = Number(existing?.addedAt) || 0;
    const nextAddedAt = Number(entry?.addedAt) || 0;
    if (nextAddedAt > existingAddedAt) {
      merged[existingIndex] = deepClone(entry);
    }
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
    ),
  });
}

function mergeLists(primaryLists, secondaryLists) {
  const ids = new Set([
    ...Object.keys(primaryLists || {}),
    ...Object.keys(secondaryLists || {}),
  ]);
  const merged = {};
  ids.forEach((id) => {
    merged[id] = mergeList(primaryLists?.[id], secondaryLists?.[id], id);
  });
  return merged;
}

function mergeDeletedLists(primary = {}, secondary = {}) {
  const merged = { ...secondary };
  Object.entries(primary || {}).forEach(([id, deletedAt]) => {
    merged[id] = Math.max(Number(merged[id]) || 0, Number(deletedAt) || 0);
  });
  return merged;
}

function applyDeletedLists(lists, deletedLists) {
  Object.keys(deletedLists || {}).forEach((id) => {
    if (id !== DEFAULT_LIST_ID) delete lists[id];
  });
  return lists;
}

function rememberTimestamp(map, id, timestamp) {
  map.set(id, Math.max(Number(map.get(id)) || 0, timestamp));
}

function ensureListTimestampMap(root, listId) {
  if (!root.has(listId)) {
    root.set(listId, new Map());
  }
  return root.get(listId);
}

function applyRemovalMarkersToLists(
  lists,
  { queueRemovals = [], deletedHistory = [], history = [], videoProgress = {} } = {}
) {
  const globalDeletedAtById = new Map();
  const deletedAtByList = new Map();
  const watchedAtByList = new Map();
  queueRemovals.forEach((entry) => {
    const id = typeof entry?.id === "string" ? entry.id : "";
    const listId = typeof entry?.listId === "string" ? entry.listId : "";
    const removedAt = Number(entry?.removedAt) || 0;
    if (!id || !removedAt) return;
    if (listId) {
      rememberTimestamp(
        ensureListTimestampMap(deletedAtByList, listId),
        id,
        removedAt
      );
    } else {
      rememberTimestamp(globalDeletedAtById, id, removedAt);
    }
  });
  deletedHistory.forEach((entry) => {
    const id = typeof entry?.id === "string" ? entry.id : "";
    const deletedAt = Number(entry?.deletedAt) || 0;
    if (!id) return;
    if (typeof entry?.listId === "string" && entry.listId) {
      rememberTimestamp(
        ensureListTimestampMap(deletedAtByList, entry.listId),
        id,
        deletedAt
      );
    } else {
      rememberTimestamp(globalDeletedAtById, id, deletedAt);
    }
  });
  history.forEach((entry) => {
    const id = typeof entry?.id === "string" ? entry.id : "";
    const listId = typeof entry?.listId === "string" ? entry.listId : "";
    const watchedAt = Number(entry?.watchedAt) || 0;
    if (!id || !listId || !watchedAt) return;
    rememberTimestamp(
      ensureListTimestampMap(watchedAtByList, listId),
      id,
      watchedAt
    );
  });
  const watchedProgressById = new Map();
  Object.entries(videoProgress || {}).forEach(([id, progress]) => {
    const percent = Number(progress?.percent) || 0;
    const updatedAt = Number(progress?.updatedAt) || 0;
    if (percent > WATCHED_PROGRESS_THRESHOLD && updatedAt > 0) {
      rememberTimestamp(watchedProgressById, id, updatedAt);
    }
  });
  Object.values(lists || {}).forEach((list) => {
    if (!Array.isArray(list?.queue) || !list.queue.length) return;
    list.queue = list.queue.filter((entry) => {
      const listDeletedAt =
        Number(deletedAtByList.get(list.id)?.get(entry?.id)) || 0;
      const globalDeletedAt = Number(globalDeletedAtById.get(entry?.id)) || 0;
      const watchedAt =
        list.freeze
          ? 0
          : Number(watchedAtByList.get(list.id)?.get(entry?.id)) || 0;
      const progressWatchedAt =
        !list.freeze && list.id === DEFAULT_LIST_ID
          ? Number(watchedProgressById.get(entry?.id)) || 0
          : 0;
      const deletedAt = Math.max(
        listDeletedAt,
        globalDeletedAt,
        watchedAt,
        progressWatchedAt
      );
      const addedAt = Number(entry?.addedAt) || 0;
      return !deletedAt || (addedAt && addedAt > deletedAt);
    });
    if (!list.queue.length) {
      list.currentIndex = null;
    } else if (
      list.currentIndex === null ||
      list.currentIndex < 0 ||
      list.currentIndex >= list.queue.length
    ) {
      list.currentIndex = 0;
    }
  });
  return lists;
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

function datedEntryIdKey(entry) {
  return typeof entry?.id === "string" ? entry.id : "";
}

function listScopedDatedEntryKey(entry) {
  const id = datedEntryIdKey(entry);
  const listId = typeof entry?.listId === "string" ? entry.listId : "";
  return id ? `${listId}\0${id}` : "";
}

function mergeDatedEntries(
  primary = [],
  secondary = [],
  timestampField,
  { limit = HISTORY_LIMIT, keyFn = datedEntryIdKey } = {}
) {
  const byId = new Map();
  [...primary, ...secondary].forEach((entry) => {
    const key = keyFn(entry);
    if (!key) {
      return;
    }
    const current = byId.get(key);
    const currentTime = Number(current?.[timestampField]) || 0;
    const nextTime = Number(entry?.[timestampField]) || 0;
    if (!current || nextTime >= currentTime) {
      byId.set(key, deepClone(entry));
    }
  });
  return Array.from(byId.values())
    .sort((a, b) => (Number(b?.[timestampField]) || 0) - (Number(a?.[timestampField]) || 0))
    .slice(0, limit);
}

function mergeQueueRemovals(primary = [], secondary = []) {
  return mergeDatedEntries(primary, secondary, "removedAt", {
    limit: QUEUE_REMOVAL_LOG_LIMIT,
    keyFn: listScopedDatedEntryKey,
  });
}

function mergeAutoCollect(primary = {}, secondary = {}) {
  const primaryLastRunAt = normalizeSyncTimestamp(primary.lastRunAt);
  const secondaryLastRunAt = normalizeSyncTimestamp(secondary.lastRunAt);
  const preferPrimaryRun = primaryLastRunAt >= secondaryLastRunAt;
  const seenIds = [
    ...(Array.isArray(secondary.seenIds) ? secondary.seenIds : []),
    ...(Array.isArray(primary.seenIds) ? primary.seenIds : []),
  ];
  return {
    lastRunAt: Math.max(primaryLastRunAt, secondaryLastRunAt),
    lastAdded: Math.max(0, Number((preferPrimaryRun ? primary : secondary).lastAdded) || 0),
    lastFetched: Math.max(0, Number((preferPrimaryRun ? primary : secondary).lastFetched) || 0),
    nextAutoCollectAt: Math.max(
      normalizeSyncTimestamp(primary.nextAutoCollectAt),
      normalizeSyncTimestamp(secondary.nextAutoCollectAt)
    ),
    seenIds: Array.from(new Set(seenIds)).slice(-AUTO_COLLECT_SEEN_IDS_LIMIT),
  };
}

function mergeVideoProgress(primary = {}, secondary = {}) {
  const merged = {};
  const ids = new Set([
    ...Object.keys(secondary || {}),
    ...Object.keys(primary || {}),
  ]);
  ids.forEach((id) => {
    const a = primary?.[id] || null;
    const b = secondary?.[id] || null;
    if (!a && !b) {
      return;
    }
    merged[id] = {
      percent: Math.max(Number(a?.percent) || 0, Number(b?.percent) || 0),
      updatedAt: Math.max(Number(a?.updatedAt) || 0, Number(b?.updatedAt) || 0),
    };
  });
  return merged;
}

export function mergeSyncStatesConservatively(localInput, remoteInput) {
  const local = buildSyncState(localInput);
  const remote = buildSyncState(remoteInput);
  const history = mergeDatedEntries(remote.history, local.history, "watchedAt");
  const deletedHistory = mergeDatedEntries(
    remote.deletedHistory,
    local.deletedHistory,
    "deletedAt"
  );
  const queueRemovals = mergeQueueRemovals(
    remote.queueRemovals,
    local.queueRemovals
  );
  const videoProgress = mergeVideoProgress(
    remote.videoProgress,
    local.videoProgress
  );
  const deletedLists = mergeDeletedLists(remote.deletedLists, local.deletedLists);
  const lists = applyRemovalMarkersToLists(applyDeletedLists(
    mergeLists(remote.lists, local.lists),
    deletedLists
  ), {
    queueRemovals,
    deletedHistory,
    deletedLists,
    history,
    videoProgress,
  });
  return buildSyncState({
    lists,
    listOrder: mergeListOrder(remote.listOrder, local.listOrder, lists),
    currentListId: local.currentListId,
    currentVideoId: local.currentVideoId,
    history,
    deletedHistory,
    deletedLists,
    queueRemovals,
    autoCollect: mergeAutoCollect(remote.autoCollect, local.autoCollect),
    videoProgress,
  });
}

export function mergeRemoteSyncState(localInput, remoteInput) {
  const local = sanitizeState(localInput);
  const remote = sanitizeState(remoteInput);
  const deletedLists = mergeDeletedLists(remote.deletedLists, local.deletedLists);
  const merged = sanitizeState({
    ...remote,
    lists: applyDeletedLists(deepClone(remote.lists), deletedLists),
    listOrder: remote.listOrder.filter((id) => !deletedLists[id]),
    deletedLists,
    currentTabId: local.currentTabId,
  });

  if (local.currentListId && merged.lists[local.currentListId]) {
    merged.currentListId = local.currentListId;
  }

  const locatedCurrent = findVideoInLists(merged.lists, local.currentVideoId);
  if (locatedCurrent) {
    merged.currentListId = locatedCurrent.listId;
    merged.currentVideoId = local.currentVideoId;
    merged.lists[locatedCurrent.listId].currentIndex = locatedCurrent.index;
  } else {
    const locatedRemoteCurrent = findVideoInLists(
      merged.lists,
      remote.currentVideoId
    );
    if (locatedRemoteCurrent) {
      merged.currentListId = locatedRemoteCurrent.listId;
      merged.currentVideoId = remote.currentVideoId;
      merged.lists[locatedRemoteCurrent.listId].currentIndex =
        locatedRemoteCurrent.index;
    }
  }

  if (!merged.lists[merged.currentListId]) {
    merged.currentListId = DEFAULT_LIST_ID;
  }

  return sanitizeState(merged);
}
