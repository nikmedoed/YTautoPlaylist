// Popup playback metadata helpers. Derives active item labels and button availability from presentation state.
export function computePlaybackMeta(state) {
  const queue = Array.isArray(state?.currentQueue?.queue)
    ? state.currentQueue.queue
    : [];
  const queueIds = queue
    .map((entry) => (entry && typeof entry === "object" ? entry.id : null))
    .filter((id) => typeof id === "string" && id);
  const queueId = state?.currentQueue?.id || null;
  const activeListId = state?.currentListId || null;
  const queueMatchesActive = Boolean(
    activeListId && queueId && queueId === activeListId
  );
  const pointerIndex =
    Number.isInteger(state?.currentQueue?.currentIndex) &&
    state.currentQueue.currentIndex >= 0 &&
    state.currentQueue.currentIndex < queueIds.length
      ? state.currentQueue.currentIndex
      : queueIds.length
      ? 0
      : -1;
  const currentId = queueMatchesActive ? state?.currentVideoId || null : null;
  const currentIndex = currentId ? queueIds.indexOf(currentId) : -1;
  const inQueue = currentIndex !== -1;
  const historyLength = Array.isArray(state?.history)
    ? state.history.length
    : 0;
  const controlling = queueMatchesActive && inQueue;
  return {
    queue,
    queueIds,
    pointerIndex,
    currentIndex,
    inQueue,
    queueMatchesActive,
    controlling,
    frozen: Boolean(state?.currentQueue?.freeze),
    hasPrev: controlling && (currentIndex > 0 || historyLength > 0),
    hasNext: controlling && currentIndex < queueIds.length - 1,
  };
}
