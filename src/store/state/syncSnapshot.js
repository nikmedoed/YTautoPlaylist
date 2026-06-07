// Pure playlist sync snapshot helpers. Contains portable state selection,
// fingerprinting, and remote/local runtime merge behavior.
import {
  AUTO_COLLECT_SEEN_IDS_LIMIT,
  DEFAULT_LIST_ID,
  HISTORY_LIMIT,
} from "./constants.js";
import { sanitizeState } from "./sanitizers.js";
import { deepClone } from "../../utils.js";

export const SYNC_FORMAT_VERSION = 1;

function byteLength(value) {
  return new TextEncoder().encode(String(value)).length;
}

export function storageItemBytes(key, value) {
  return byteLength(key) + byteLength(JSON.stringify(value));
}

export function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function normalizeSyncTimestamp(value) {
  const ts = Number(value);
  return Number.isFinite(ts) && ts > 0 ? Math.trunc(ts) : 0;
}

function normalizeListForSync(list) {
  return deepClone(list);
}

function normalizeListsForSync(lists) {
  const normalized = {};
  Object.entries(lists || {}).forEach(([id, list]) => {
    normalized[id] = normalizeListForSync(list);
  });
  return normalized;
}

export function buildSyncState(stateInput) {
  const state = sanitizeState(stateInput);
  return sanitizeState({
    lists: normalizeListsForSync(state.lists),
    listOrder: deepClone(state.listOrder),
    currentListId: state.currentListId,
    currentVideoId: state.currentVideoId,
    currentTabId: null,
    history: deepClone(state.history),
    deletedHistory: deepClone(state.deletedHistory),
    autoCollect: deepClone(state.autoCollect),
    videoProgress: deepClone(state.videoProgress),
  });
}

export function getSyncStateFingerprint(stateInput) {
  return hashString(JSON.stringify(buildSyncState(stateInput)));
}

export function hasSyncableUserData(stateInput) {
  const state = sanitizeState(stateInput);
  const listIds = Object.keys(state.lists || {});
  if (listIds.some((id) => id !== DEFAULT_LIST_ID)) {
    return true;
  }
  const hasQueuedVideos = listIds.some((id) => {
    const queue = state.lists[id]?.queue;
    return Array.isArray(queue) && queue.length > 0;
  });
  return (
    hasQueuedVideos ||
    Boolean(state.history?.length) ||
    Boolean(state.deletedHistory?.length) ||
    Boolean(Object.keys(state.videoProgress || {}).length) ||
    Boolean(state.autoCollect?.lastRunAt) ||
    Boolean(state.autoCollect?.seenIds?.length)
  );
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
  const seen = new Set();
  const merged = [];
  [...primaryQueue, ...secondaryQueue].forEach((entry) => {
    const id = typeof entry?.id === "string" ? entry.id : "";
    if (!id || seen.has(id)) {
      return;
    }
    seen.add(id);
    merged.push(deepClone(entry));
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

function mergeListOrder(primaryOrder = [], secondaryOrder = [], lists = {}) {
  const result = [];
  [...primaryOrder, ...secondaryOrder, DEFAULT_LIST_ID].forEach((id) => {
    if (typeof id === "string" && lists[id] && !result.includes(id)) {
      result.push(id);
    }
  });
  return result;
}

function mergeDatedEntries(primary = [], secondary = [], timestampField) {
  const byId = new Map();
  [...primary, ...secondary].forEach((entry) => {
    const id = typeof entry?.id === "string" ? entry.id : "";
    if (!id) {
      return;
    }
    const current = byId.get(id);
    const currentTime = Number(current?.[timestampField]) || 0;
    const nextTime = Number(entry?.[timestampField]) || 0;
    if (!current || nextTime >= currentTime) {
      byId.set(id, deepClone(entry));
    }
  });
  return Array.from(byId.values())
    .sort((a, b) => (Number(b?.[timestampField]) || 0) - (Number(a?.[timestampField]) || 0))
    .slice(0, HISTORY_LIMIT);
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
  const lists = mergeLists(remote.lists, local.lists);
  return buildSyncState({
    lists,
    listOrder: mergeListOrder(remote.listOrder, local.listOrder, lists),
    currentListId: local.currentListId,
    currentVideoId: local.currentVideoId,
    history: mergeDatedEntries(remote.history, local.history, "watchedAt"),
    deletedHistory: mergeDatedEntries(
      remote.deletedHistory,
      local.deletedHistory,
      "deletedAt"
    ),
    autoCollect: mergeAutoCollect(remote.autoCollect, local.autoCollect),
    videoProgress: mergeVideoProgress(remote.videoProgress, local.videoProgress),
  });
}

export function mergeRemoteSyncState(localInput, remoteInput) {
  const local = sanitizeState(localInput);
  const remote = sanitizeState(remoteInput);
  const merged = sanitizeState({
    ...remote,
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

export function buildSyncSnapshot(
  stateInput,
  { updatedAt, deviceId, maxTotalBytes = Number.POSITIVE_INFINITY } = {}
) {
  const payload = buildSyncState(stateInput);
  const json = JSON.stringify(payload);
  const hash = hashString(json);
  const manifest = {
    version: SYNC_FORMAT_VERSION,
    updatedAt: normalizeSyncTimestamp(updatedAt) || Date.now(),
    deviceId: typeof deviceId === "string" && deviceId ? deviceId : null,
    hash,
  };
  const totalBytes = byteLength(JSON.stringify({ manifest, state: payload }));
  if (Number.isFinite(maxTotalBytes) && totalBytes > maxTotalBytes) {
    throw new Error(
      `Playlist sync snapshot is too large (${totalBytes} bytes)`
    );
  }
  return { manifest, state: payload, hash, totalBytes };
}
