chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message.type !== "string") return;
  if (message.type === "player:getPlaybackStatus") {
    const video = state.videoElement || document.querySelector("video");
    if (!video) {
      sendResponse({ hasVideo: false });
      return false;
    }
    sendResponse({ hasVideo: true, playing: !video.paused && !video.ended });
    return false;
  }
  if (message.type === "player:togglePlayback") {
    const video = state.videoElement || document.querySelector("video");
    if (!video) {
      sendResponse({ handled: false, hasVideo: false });
      return false;
    }
    const mode = message?.mode || message?.action || "toggle";
    const wantsPlay =
      mode === "play" || (mode === "toggle" && (video.paused || video.ended));
    if (mode === "pause" || (mode === "toggle" && !wantsPlay)) {
      video.pause();
      sendResponse({ handled: true, playing: false, hasVideo: true });
      return false;
    }
    try {
      const result = video.play();
      if (result && typeof result.then === "function") {
        result
          .then(() => {
            sendResponse({ handled: true, playing: true, hasVideo: true });
          })
          .catch((err) => {
            console.warn("Failed to resume playback", err);
            sendResponse({
              handled: false,
              playing: !video.paused && !video.ended,
              hasVideo: true,
              error: err?.message,
            });
          });
        return true;
      }
      sendResponse({ handled: true, playing: true, hasVideo: true });
    } catch (err) {
      console.warn("Failed to resume playback", err);
      sendResponse({
        handled: false,
        playing: !video.paused && !video.ended,
        hasVideo: true,
        error: err?.message,
      });
    }
    return false;
  }
  if (message.type === "collector:getCapabilities") {
    const context = determinePageContext();
    const caps = getContextCapabilities(context);
    sendResponse({ context, ...caps, controlling: Boolean(state.controlsActive) });
    return false;
  }
  if (message.type === "collector:collect") {
    const scope = message.scope || "current";
    const caps = getContextCapabilities();
    if (
      (scope === "current" && !caps.canAddCurrent) ||
      (scope === "page" && !caps.canAddAll) ||
      (scope === "visible" && !caps.canAddVisible)
    ) {
      sendResponse({ videoIds: [], error: "NOT_ALLOWED" });
      return false;
    }
    if (scope === "page") {
      collectPageVideosWithContinuation()
        .then((result) => {
          const videoIds = Array.isArray(result?.videoIds)
            ? result.videoIds
            : Array.isArray(result)
            ? result
            : [];
          sendResponse({
            videoIds,
            aborted: Boolean(result?.aborted),
            total: Number.isInteger(result?.total)
              ? result.total
              : videoIds.length,
          });
        })
        .catch((err) => {
          console.error("Failed to collect page videos", err);
          sendResponse({
            videoIds: [],
            error: err?.message || "FAILED_TO_COLLECT",
          });
        });
      return true;
    }
    const videoIds = collectVideoIds(scope);
    sendResponse({ videoIds });
    return false;
  }
  if (message.type === "playlist:collectProgress") {
    if (typeof handleCollectionProgressEvent === "function") {
      handleCollectionProgressEvent(message.event || message);
    }
    return false;
  }
  if (message.type === "playlist:stateUpdated") {
    if (message.state && typeof message.state === "object") {
      updateInlinePlaylistState(message.state);
      if (typeof maybeAnnounceQueueFinished === "function") {
        maybeAnnounceQueueFinished(message.state);
      }
    }
    const current = getCurrentVideoId();
    const playlistState = message.state || {};
    if (current && playlistState.currentVideoId === current) {
      setControlsActive(true);
    } else if (
      !playlistState.queue ||
      !Array.isArray(playlistState.queue) ||
      !playlistState.queue.some((item) => item.id === current)
    ) {
      setControlsActive(false);
    }
  }
  return false;
});
