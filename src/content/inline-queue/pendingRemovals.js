// Tracks optimistic removals until the background has committed them. State
// broadcasts can arrive before the matching response, so pending ids are
// filtered per list to prevent a removed row from briefly reappearing.
const pendingRemovalIdsByList = new Map();
const renderLockedListIds = new Set();

function normalizeListId(listId) {
  return typeof listId === "string" && listId ? listId : null;
}

export function markInlineQueueRemovalPending(listId, videoId) {
  const normalizedListId = normalizeListId(listId);
  if (!normalizedListId || typeof videoId !== "string" || !videoId) {
    return;
  }
  let ids = pendingRemovalIdsByList.get(normalizedListId);
  if (!ids) {
    ids = new Set();
    pendingRemovalIdsByList.set(normalizedListId, ids);
  }
  ids.add(videoId);
  renderLockedListIds.add(normalizedListId);
}

export function finishInlineQueueRemovals(listId, videoIds) {
  const normalizedListId = normalizeListId(listId);
  const ids = pendingRemovalIdsByList.get(normalizedListId);
  if (!ids) {
    return;
  }
  videoIds.forEach((videoId) => ids.delete(videoId));
  if (!ids.size) {
    pendingRemovalIdsByList.delete(normalizedListId);
  }
}

export function filterPendingInlineQueueRemovals(entries, listId) {
  const ids = pendingRemovalIdsByList.get(normalizeListId(listId));
  if (!ids?.size) {
    return entries;
  }
  return entries.filter((entry) => !ids.has(entry?.id));
}

export function isInlineQueueRenderLocked(listId) {
  const normalizedListId = normalizeListId(listId);
  return Boolean(normalizedListId && renderLockedListIds.has(normalizedListId));
}

export function releaseInlineQueueRenderLock(listId) {
  const normalizedListId = normalizeListId(listId);
  if (normalizedListId) {
    renderLockedListIds.delete(normalizedListId);
  }
}

export function clearInlineQueueRemovalState() {
  pendingRemovalIdsByList.clear();
  renderLockedListIds.clear();
}
