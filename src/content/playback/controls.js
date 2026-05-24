// Content playback controller. Contains injected control wiring, player event tracking, Media Session handlers, and queue-state sync.
import {
  canHandlePlaybackActions,
  getCurrentVideoId,
  inlinePlaylistState,
  sendMessage,
  state,
} from "../core/base.js";
import { parseVideoId } from "../../utils.js";
import {
  updateInlinePlaylistState,
  updateInlineQueueUI,
} from "../inline-queue/index.js";
import {
  handleAddCurrentFromPage,
  updatePageActions,
} from "../page-actions/index.js";
import {
  ensurePlayerControls as ensurePlayerControlsView,
  updatePlayerControlsUI as updatePlayerControlsUIView,
} from "./controlsView.js";
import { hidePlaybackNotification } from "./notification.js";
import {
  detectUnavailableWatchState as detectUnavailableWatchStateBase,
  ensurePlayerErrorMonitoring as ensurePlayerErrorMonitoringBase,
  handleVideoUnavailable as handleVideoUnavailableBase,
} from "./errorMonitoring.js";
import {
  recoverVideoEnded,
  requestNext as requestNextBase,
  requestPostpone as requestPostponeBase,
  requestPrevious as requestPreviousBase,
  requestStartPlayback as requestStartPlaybackBase,
} from "./actions.js";
import {
  ensurePlaybackWatchdog as ensurePlaybackWatchdogBase,
  beginVideoEndHandling,
  handleVideoProgressUpdate as handleVideoProgressUpdateBase,
  markPlaybackStarted,
  maybeFinalizeVideoEndedBeforeNavigation as maybeFinalizeVideoEndedBeforeNavigationBase,
  maybeSendVideoProgress,
  resetProgressTracker,
  resetVideoEndFallbackMatch,
  resetVideoEndState,
} from "./progressWatchdog.js";
import {
  clearQueueEndAnnouncement,
  ensureUserActionListeners,
  hasRecentUserAction,
  maybeShowQueueEndAnnouncement,
  queueQueueEndAnnouncement,
} from "./queueEnd.js";

const playerErrorContext = {
  handlePlaybackAdvanceResponse,
  setControlsActive,
};

const playbackActionContext = {
  handlePlaybackAdvanceResponse,
  updateInlinePlaylistState,
};

const playerControlsViewContext = {
  handleAddCurrentFromPage,
  requestNext,
  requestPostpone,
  requestPrevious,
  requestStartPlayback,
};

function handleVideoUnavailable(details = {}) {
  return handleVideoUnavailableBase(details, playerErrorContext);
}

const playbackProgressContext = {
  handleVideoEnded,
  hasRecentUserAction,
};

const playbackWatchdogContext = {
  ...playbackProgressContext,
  detectUnavailableWatchState: () =>
    detectUnavailableWatchStateBase(playerErrorContext),
  handleVideoUnavailable,
};

export function ensurePlaybackWatchdog() {
  ensurePlaybackWatchdogBase(playbackWatchdogContext);
}

export function maybeFinalizeVideoEndedBeforeNavigation() {
  maybeFinalizeVideoEndedBeforeNavigationBase(playbackProgressContext);
}

function handleVideoProgressUpdate() {
  handleVideoProgressUpdateBase(playbackProgressContext);
}

function handleVideoSeeked() {
  handleVideoProgressUpdateBase(playbackProgressContext, { source: "seeked" });
}

function handlePlaybackAdvanceResponse(response, context = {}) {
  if (response?.state && typeof response.state === "object") {
    updateInlinePlaylistState(response.state);
  }
  if (response && response.handled === false && response.state) {
    if (context.origin === "auto") {
      queueQueueEndAnnouncement(response.state, context);
    } else {
      clearQueueEndAnnouncement();
    }
  }
  return response;
}

function shouldKeepControlsAfterAdvanceFailure(sourceVideoId = null) {
  const currentId = getCurrentVideoId();
  if (
    currentId &&
    (inlinePlaylistState.videoIds?.has(currentId) ||
      inlinePlaylistState.currentVideoId === currentId)
  ) {
    return true;
  }
  if (
    sourceVideoId &&
    (inlinePlaylistState.videoIds?.has(sourceVideoId) ||
      inlinePlaylistState.currentVideoId === sourceVideoId)
  ) {
    return true;
  }
  return false;
}

export function ensurePlayerControls() {
  ensurePlayerControlsView(playerControlsViewContext);
}

export function updatePlayerControlsUI() {
  updatePlayerControlsUIView(playerControlsViewContext);
}

export function setControlsActive(active) {
  const value = Boolean(active);
  if (state.controlsActive === value) return;
  state.controlsActive = value;
  ensurePlayerControls();
  updateMediaSessionHandlers();
  updatePlayerControlsUI();
  updatePageActions();
  updateInlineQueueUI();
}

export function updateMediaSessionHandlers() {
  if (!("mediaSession" in navigator)) {
    return;
  }
  try {
    if (canHandlePlaybackActions()) {
      navigator.mediaSession.setActionHandler("nexttrack", requestNext);
      navigator.mediaSession.setActionHandler("previoustrack", requestPrevious);
    } else {
      navigator.mediaSession.setActionHandler("nexttrack", null);
      navigator.mediaSession.setActionHandler("previoustrack", null);
    }
  } catch (err) {
    console.warn("Failed to update media session handlers", err);
  }
}

export function requestNext() {
  requestNextBase(playbackActionContext);
}

export function requestPrevious() {
  requestPreviousBase();
}

function requestPostpone() {
  requestPostponeBase(playbackActionContext);
}

function requestStartPlayback() {
  requestStartPlaybackBase(playbackActionContext);
}

function handleVideoStarted() {
  ensureUserActionListeners();
  hidePlaybackNotification(true);
  const videoId = parseVideoId(window.location.href);
  if (!videoId) return;
  resetVideoEndState(videoId);
  state.currentVideoId = videoId;
  state.lastUnavailableVideoId = null;
  resetProgressTracker(videoId);
  if (state.videoElement && !state.videoElement.paused) {
    markPlaybackStarted();
  }
  ensurePlaybackWatchdog();
  handleVideoProgressUpdate();
  if (state.lastReportedVideoId === videoId) return;
  state.lastReportedVideoId = videoId;
  sendMessage("player:videoStarted", { videoId }).then((resp) => {
    if (resp && typeof resp === "object") {
      const presentation =
        resp.state && typeof resp.state === "object" ? resp.state : null;
      if (presentation) {
        updateInlinePlaylistState(presentation);
      }
    }
    setControlsActive(Boolean(resp?.controlled));
    maybeShowQueueEndAnnouncement(videoId);
  });
}

function handleVideoError(event) {
  const mediaError = event?.target?.error;
  if (mediaError && typeof mediaError === "object") {
    const detail = {};
    if (typeof mediaError.message === "string") {
      detail.message = mediaError.message;
    }
    if (typeof mediaError.code === "number") {
      detail.reason = `MEDIA_ERROR_${mediaError.code}`;
    }
    handleVideoUnavailable(detail);
    return;
  }
  if (event?.detail) {
    handleVideoUnavailable(event.detail);
    return;
  }
  handleVideoUnavailable(event || {});
}

function handleVideoPaused() {
  resetVideoEndFallbackMatch();
}

function handleVideoEnded() {
  const videoId = getCurrentVideoId();
  if (!videoId) return;
  if (!beginVideoEndHandling(videoId)) {
    return;
  }
  maybeSendVideoProgress(100, { force: true });
  sendMessage(
    "player:videoEnded",
    { videoId },
    {
      onDisconnect: () => recoverVideoEnded(videoId, playbackActionContext),
    }
  ).then((resp) => {
    const result = handlePlaybackAdvanceResponse(resp, {
      origin: "auto",
      sourceVideoId: videoId,
    });
    if (!result || result.handled === false) {
      setControlsActive(shouldKeepControlsAfterAdvanceFailure(videoId));
    }
  });
}

export function detachVideoListeners() {
  if (!state.videoElement) return;
  state.videoElement.removeEventListener("ended", handleVideoEnded);
  state.videoElement.removeEventListener("play", handleVideoStarted);
  state.videoElement.removeEventListener("playing", handleVideoStarted);
  state.videoElement.removeEventListener("loadeddata", handleVideoStarted);
  state.videoElement.removeEventListener("timeupdate", handleVideoProgressUpdate);
  state.videoElement.removeEventListener("durationchange", handleVideoProgressUpdate);
  state.videoElement.removeEventListener("seeked", handleVideoSeeked);
  state.videoElement.removeEventListener("pause", handleVideoPaused);
  state.videoElement.removeEventListener("error", handleVideoError);
  state.videoElement = null;
  resetProgressTracker(null);
  resetVideoEndState(null);
}

function attachVideoListeners(video) {
  if (state.videoElement === video) return;
  detachVideoListeners();
  state.videoElement = video;
  video.addEventListener("ended", handleVideoEnded);
  video.addEventListener("play", handleVideoStarted);
  video.addEventListener("playing", handleVideoStarted);
  video.addEventListener("loadeddata", handleVideoStarted);
  video.addEventListener("timeupdate", handleVideoProgressUpdate);
  video.addEventListener("durationchange", handleVideoProgressUpdate);
  video.addEventListener("seeked", handleVideoSeeked);
  video.addEventListener("pause", handleVideoPaused);
  video.addEventListener("error", handleVideoError);
  handleVideoStarted();
}

export function scanForVideo() {
  ensurePlayerErrorMonitoringBase(playerErrorContext);
  const video = document.querySelector("video");
  if (video) {
    attachVideoListeners(video);
    ensurePlayerControls();
    ensurePlaybackWatchdog();
    return true;
  }
  detectUnavailableWatchStateBase(playerErrorContext);
  ensurePlaybackWatchdog();
  return false;
}
