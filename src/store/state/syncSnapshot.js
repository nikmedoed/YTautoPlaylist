// Pure playlist sync snapshot helpers. Contains portable state selection,
// fingerprinting, chunking, and remote/local runtime merge behavior.
import {
  AUTO_COLLECT_SEEN_IDS_LIMIT,
  DEFAULT_LIST_ID,
  HISTORY_LIMIT,
  SYNC_CHUNK_TARGET_BYTES,
  SYNC_MANIFEST_STORAGE_KEY,
} from "./constants.js";
import { sanitizeState } from "./sanitizers.js";
import { deepClone } from "../../utils.js";

export const SYNC_FORMAT_VERSION = 1;
const SYNC_MAX_CHUNKS = 2000;

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

export function getSyncChunkKey(index) {
  return `${SYNC_MANIFEST_STORAGE_KEY}:chunk:${index}`;
}

function normalizeListForSync(list) {
  const normalized = deepClone(list);
  const queue = Array.isArray(normalized.queue) ? normalized.queue : [];
  normalized.currentIndex = queue.length ? 0 : null;
  return normalized;
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
    currentListId: DEFAULT_LIST_ID,
    currentVideoId: null,
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
    currentVideoId: null,
    currentListId: DEFAULT_LIST_ID,
  });

  if (local.currentListId && merged.lists[local.currentListId]) {
    merged.currentListId = local.currentListId;
  }

  const locatedCurrent = findVideoInLists(merged.lists, local.currentVideoId);
  if (locatedCurrent) {
    merged.currentListId = locatedCurrent.listId;
    merged.currentVideoId = local.currentVideoId;
    merged.lists[locatedCurrent.listId].currentIndex = locatedCurrent.index;
  } else if (!merged.lists[merged.currentListId]) {
    merged.currentListId = DEFAULT_LIST_ID;
  }

  return sanitizeState(merged);
}

function splitStringByStorageBytes(value) {
  const chunks = [];
  let offset = 0;
  while (offset < value.length) {
    let low = 1;
    let high = value.length - offset;
    let best = 1;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const candidate = value.slice(offset, offset + mid);
      const bytes = storageItemBytes(getSyncChunkKey(chunks.length), candidate);
      if (bytes <= SYNC_CHUNK_TARGET_BYTES) {
        best = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    chunks.push(value.slice(offset, offset + best));
    offset += best;
  }
  return chunks;
}

export function buildSyncSnapshot(
  stateInput,
  { updatedAt, deviceId, maxTotalBytes = Number.POSITIVE_INFINITY } = {}
) {
  const payload = buildSyncState(stateInput);
  const json = JSON.stringify(payload);
  const hash = hashString(json);
  const chunks = splitStringByStorageBytes(json);
  const manifest = {
    version: SYNC_FORMAT_VERSION,
    updatedAt: normalizeSyncTimestamp(updatedAt) || Date.now(),
    deviceId: typeof deviceId === "string" && deviceId ? deviceId : null,
    hash,
    chunkCount: chunks.length,
  };
  const totalBytes =
    storageItemBytes(SYNC_MANIFEST_STORAGE_KEY, manifest) +
    chunks.reduce(
      (sum, chunk, index) => sum + storageItemBytes(getSyncChunkKey(index), chunk),
      0
    );
  if (Number.isFinite(maxTotalBytes) && totalBytes > maxTotalBytes) {
    throw new Error(
      `Playlist sync snapshot is too large (${totalBytes} bytes)`
    );
  }
  return { manifest, chunks, hash, totalBytes };
}

export function parseSyncSnapshot(manifest, chunks) {
  if (
    !manifest ||
    typeof manifest !== "object" ||
    manifest.version !== SYNC_FORMAT_VERSION ||
    !Number.isInteger(manifest.chunkCount) ||
    manifest.chunkCount <= 0 ||
    manifest.chunkCount > SYNC_MAX_CHUNKS ||
    !Array.isArray(chunks) ||
    chunks.some((chunk) => typeof chunk !== "string")
  ) {
    return null;
  }
  const json = chunks.join("");
  const hash = hashString(json);
  if (hash !== manifest.hash) {
    return null;
  }
  try {
    const parsed = JSON.parse(json);
    return {
      manifest,
      state: buildSyncState(parsed),
      updatedAt: normalizeSyncTimestamp(manifest.updatedAt),
      hash,
    };
  } catch {
    return null;
  }
}
