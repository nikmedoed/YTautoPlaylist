// Construction, sizing, and fingerprinting of portable playlist snapshots.
import { DEFAULT_LIST_ID } from "./constants.js";
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
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp > 0 ? Math.trunc(timestamp) : 0;
}

export function buildSyncState(stateInput) {
  const state = sanitizeState(stateInput);
  return sanitizeState({
    lists: deepClone(state.lists),
    listOrder: deepClone(state.listOrder),
    currentListId: state.currentListId,
    currentVideoId: state.currentVideoId,
    currentTabId: null,
    history: deepClone(state.history),
    deletedHistory: deepClone(state.deletedHistory),
    deletedLists: deepClone(state.deletedLists),
    queueRemovals: deepClone(state.queueRemovals),
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
  const hasCustomList = listIds.some((id) => id !== DEFAULT_LIST_ID);
  const hasQueuedVideos = listIds.some((id) => state.lists[id]?.queue?.length);
  return Boolean(
    hasCustomList ||
      hasQueuedVideos ||
      state.history?.length ||
      state.deletedHistory?.length ||
      state.queueRemovals?.length ||
      Object.keys(state.videoProgress || {}).length ||
      state.autoCollect?.lastRunAt ||
      state.autoCollect?.seenIds?.length
  );
}

export function buildSyncSnapshot(
  stateInput,
  { updatedAt, deviceId, maxTotalBytes = Number.POSITIVE_INFINITY } = {}
) {
  const state = buildSyncState(stateInput);
  const hash = hashString(JSON.stringify(state));
  const manifest = {
    version: SYNC_FORMAT_VERSION,
    updatedAt: normalizeSyncTimestamp(updatedAt) || Date.now(),
    deviceId: typeof deviceId === "string" && deviceId ? deviceId : null,
    hash,
  };
  const totalBytes = byteLength(JSON.stringify({ manifest, state }));
  if (Number.isFinite(maxTotalBytes) && totalBytes > maxTotalBytes) {
    throw new Error(`Playlist sync snapshot is too large (${totalBytes} bytes)`);
  }
  return { manifest, state, hash, totalBytes };
}
