// Keeps popup rows stable while removals are being committed. Removed ids stay
// tombstoned for the current view so stale responses cannot resurrect them.
export function createRemovalGuard() {
  const removedIdsByList = new Map();

  function mark(listId, videoIds) {
    if (!listId) return;
    let ids = removedIdsByList.get(listId);
    if (!ids) {
      ids = new Set();
      removedIdsByList.set(listId, ids);
    }
    for (const videoId of videoIds) {
      if (videoId) ids.add(videoId);
    }
  }

  function filter(listId, entries) {
    const source = Array.isArray(entries) ? entries : [];
    const ids = removedIdsByList.get(listId);
    return ids?.size
      ? source.filter((entry) => !ids.has(entry?.id))
      : source;
  }

  function unmark(listId, videoIds) {
    const ids = removedIdsByList.get(listId);
    if (!ids) return;
    for (const videoId of videoIds) ids.delete(videoId);
    if (!ids.size) removedIdsByList.delete(listId);
  }

  return {
    clear: () => removedIdsByList.clear(),
    filter,
    isLocked: (listId) => Boolean(removedIdsByList.get(listId)?.size),
    mark,
    release: (listId) => removedIdsByList.delete(listId),
    unmark,
  };
}
