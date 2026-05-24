// Playback progress watchdog. Samples player progress and reports watched percent to the background store.
import {
  determinePageContext,
  getCurrentVideoId,
  inlinePlaylistState,
  progressTracker,
  sendMessage,
  state,
  ytaDiagMeasure,
} from "../core/base.js";
import { clampProgressPercent } from "../../progress.js";

const PROGRESS_UPDATE_INTERVAL_MS = 5000;
const PLAYBACK_WATCHDOG_INTERVAL_MS = 3000;
const PLAYBACK_START_TIMEOUT_MS = 15000;
const PLAYBACK_NO_SOURCE_TIMEOUT_MS = 7000;
const VIDEO_END_FALLBACK_STABILITY_MS = 450;
const VIDEO_END_NAVIGATION_PROGRESS = 97;
const VIDEO_END_NAVIGATION_REMAINING_SECONDS = 2.5;
const END_NEAR_PROGRESS = 99;
const END_NEAR_REMAINING_SECONDS = 1.25;

const videoEndState = {
  videoId: null,
  handled: false,
};

const videoEndFallbackState = {
  videoId: null,
  matchedAt: 0,
};

const playbackWatchdog = {
  timerId: null,
  lastVideoId: null,
  pendingSince: 0,
  lastVideoSeenAt: 0,
  playStarted: false,
};

function shouldMonitorPlayback() {
  if (determinePageContext() !== "watch") {
    return false;
  }
  const currentId = getCurrentVideoId();
  if (!currentId) {
    return false;
  }
  const inQueue =
    inlinePlaylistState?.videoIds?.has(currentId) ||
    inlinePlaylistState?.currentVideoId === currentId;
  return Boolean(inQueue);
}

export function resetPlaybackWatchdog(videoId = null) {
  playbackWatchdog.lastVideoId = videoId;
  playbackWatchdog.pendingSince = videoId ? Date.now() : 0;
  playbackWatchdog.lastVideoSeenAt = 0;
  playbackWatchdog.playStarted = false;
}

export function markPlaybackStarted() {
  playbackWatchdog.playStarted = true;
}

export function stopPlaybackWatchdog() {
  if (playbackWatchdog.timerId !== null) {
    window.clearInterval(playbackWatchdog.timerId);
    playbackWatchdog.timerId = null;
  }
}

function playbackWatchdogTick(context = {}) {
  const run = () => {
    if (!shouldMonitorPlayback()) {
      stopPlaybackWatchdog();
      resetPlaybackWatchdog(null);
      return;
    }
    if (context.detectUnavailableWatchState?.()) {
      return;
    }
    const currentId = getCurrentVideoId();
    if (!currentId) {
      resetPlaybackWatchdog(null);
      return;
    }
    if (playbackWatchdog.lastVideoId !== currentId) {
      resetPlaybackWatchdog(currentId);
    }
    const now = Date.now();
    if (!playbackWatchdog.pendingSince) {
      playbackWatchdog.pendingSince = now;
    }
    const video = state.videoElement || document.querySelector("video");
    if (!video) {
      if (now - playbackWatchdog.pendingSince > PLAYBACK_START_TIMEOUT_MS) {
        context.handleVideoUnavailable?.({ reason: "Плеер не загрузился" });
      }
      return;
    }
    if (!playbackWatchdog.lastVideoSeenAt) {
      playbackWatchdog.lastVideoSeenAt = now;
    }
    const mediaNoSource =
      typeof HTMLMediaElement !== "undefined" &&
      video.networkState === HTMLMediaElement.NETWORK_NO_SOURCE;
    if (mediaNoSource && !playbackWatchdog.playStarted) {
      const elapsed = now - (playbackWatchdog.lastVideoSeenAt || now);
      if (elapsed > PLAYBACK_NO_SOURCE_TIMEOUT_MS) {
        context.handleVideoUnavailable?.({ reason: "MEDIA_NO_SOURCE" });
      }
      return;
    }
    if (video?.error) {
      const code =
        typeof video.error.code === "number"
          ? `MEDIA_ERROR_${video.error.code}`
          : "MEDIA_ERROR";
      context.handleVideoUnavailable?.({ reason: code });
      return;
    }
    if (!playbackWatchdog.playStarted) {
      const active = !video.paused || video.currentTime > 0;
      if (active) {
        markPlaybackStarted();
        return;
      }
      const elapsed = now - (playbackWatchdog.lastVideoSeenAt || now);
      if (elapsed > PLAYBACK_START_TIMEOUT_MS) {
        context.handleVideoUnavailable?.({ reason: "Видео не запускается" });
      }
    }
    handleVideoProgressUpdate(context, { source: "watchdog" });
  };
  if (typeof ytaDiagMeasure === "function") {
    ytaDiagMeasure("player.playbackWatchdogTick", run);
    return;
  }
  run();
}

export function ensurePlaybackWatchdog(context = {}) {
  if (!shouldMonitorPlayback()) {
    stopPlaybackWatchdog();
    return;
  }
  if (playbackWatchdog.timerId !== null) {
    return;
  }
  playbackWatchdog.timerId = window.setInterval(
    () => playbackWatchdogTick(context),
    PLAYBACK_WATCHDOG_INTERVAL_MS
  );
  playbackWatchdogTick(context);
}

export function resetVideoEndState(videoId = null) {
  videoEndState.videoId = videoId;
  videoEndState.handled = false;
  videoEndFallbackState.videoId = videoId;
  videoEndFallbackState.matchedAt = 0;
}

function markVideoEndHandled(videoId) {
  videoEndState.videoId = videoId;
  videoEndState.handled = true;
  videoEndFallbackState.videoId = videoId;
  videoEndFallbackState.matchedAt = 0;
}

export function beginVideoEndHandling(videoId) {
  if (!videoId) {
    return false;
  }
  if (videoEndState.videoId !== videoId) {
    resetVideoEndState(videoId);
  }
  if (videoEndState.handled) {
    return false;
  }
  markVideoEndHandled(videoId);
  return true;
}

// Fallback for missed ended events. It only advances when progress is near the
// end, the same video is still active, and duplicate handling is suppressed.
function maybeTriggerVideoEndFallback(percent = null, context = {}, options = {}) {
  const source =
    options && typeof options.source === "string" ? options.source : "unknown";
  const video = state.videoElement;
  const videoId = getCurrentVideoId();
  if (!video || !videoId) {
    resetVideoEndState(null);
    return;
  }
  if (videoEndState.videoId !== videoId) {
    resetVideoEndState(videoId);
  }
  if (videoEndState.handled) {
    return;
  }
  if (video.seeking) {
    videoEndFallbackState.matchedAt = 0;
    return;
  }
  if (source === "pause") {
    videoEndFallbackState.matchedAt = 0;
    return;
  }
  if (video.ended) {
    context.handleVideoEnded?.();
    return;
  }
  const duration = Number(video.duration);
  const current = Number(video.currentTime);
  const remaining =
    Number.isFinite(duration) && Number.isFinite(current) ? duration - current : null;
  const normalizedPercent =
    percent !== null && percent !== undefined ? clampProgressPercent(percent) : null;
  const reachedProgress =
    normalizedPercent !== null && normalizedPercent >= END_NEAR_PROGRESS;
  const reachedRemaining =
    Number.isFinite(remaining) && remaining <= END_NEAR_REMAINING_SECONDS;
  const reachedNavigationProgress =
    normalizedPercent !== null && normalizedPercent >= VIDEO_END_NAVIGATION_PROGRESS;
  const reachedNavigationRemaining =
    Number.isFinite(remaining) && remaining <= VIDEO_END_NAVIGATION_REMAINING_SECONDS;
  const acceptsNavigationThreshold =
    source === "navigation" || source === "seeked";
  const likelyVideoEnd =
    acceptsNavigationThreshold
      ? reachedNavigationProgress || reachedNavigationRemaining
      : reachedProgress && reachedRemaining;
  if (!likelyVideoEnd) {
    videoEndFallbackState.matchedAt = 0;
    return;
  }
  if (context.hasRecentUserAction?.()) {
    videoEndFallbackState.matchedAt = 0;
    return;
  }
  if (acceptsNavigationThreshold) {
    context.handleVideoEnded?.();
    return;
  }
  const now = Date.now();
  if (videoEndFallbackState.videoId !== videoId) {
    videoEndFallbackState.videoId = videoId;
    videoEndFallbackState.matchedAt = 0;
  }
  if (!videoEndFallbackState.matchedAt) {
    videoEndFallbackState.matchedAt = now;
    return;
  }
  if (now - videoEndFallbackState.matchedAt < VIDEO_END_FALLBACK_STABILITY_MS) {
    return;
  }
  context.handleVideoEnded?.();
}

export function resetProgressTracker(videoId) {
  progressTracker.videoId = videoId || null;
  progressTracker.lastSentPercent = null;
  progressTracker.lastSentAt = 0;
}

export function maybeSendVideoProgress(rawPercent, { force = false } = {}) {
  const videoId = getCurrentVideoId();
  if (!videoId) {
    return;
  }
  if (progressTracker.videoId !== videoId) {
    resetProgressTracker(videoId);
  }
  const percent = clampProgressPercent(rawPercent);
  if (percent === null) {
    return;
  }
  const now = Date.now();
  if (!force) {
    if (percent <= 0) {
      return;
    }
    if (progressTracker.lastSentPercent !== null) {
      if (percent === progressTracker.lastSentPercent) {
        return;
      }
      const elapsed = now - (progressTracker.lastSentAt || 0);
      if (percent < progressTracker.lastSentPercent && percent < 100) {
        if (elapsed < PROGRESS_UPDATE_INTERVAL_MS) {
          return;
        }
      } else if (elapsed < PROGRESS_UPDATE_INTERVAL_MS && percent < 100) {
        return;
      }
    }
  }
  progressTracker.videoId = videoId;
  progressTracker.lastSentPercent = percent;
  progressTracker.lastSentAt = now;
  sendMessage("player:progress", {
    videoId,
    percent,
    timestamp: now,
  }).catch((err) => {
    console.debug("Failed to report playback progress", err);
  });
}

export function handleVideoProgressUpdate(context = {}, options = {}) {
  const video = state.videoElement;
  if (!video) {
    return;
  }
  const duration = Number(video.duration);
  const current = Number(video.currentTime);
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(current)) {
    return;
  }
  if (current > 0) {
    markPlaybackStarted();
  }
  const ratio = duration > 0 ? (current / duration) * 100 : 0;
  maybeSendVideoProgress(ratio);
  const source =
    options && typeof options.source === "string" ? options.source : "progress";
  maybeTriggerVideoEndFallback(ratio, context, { source });
}

export function maybeFinalizeVideoEndedBeforeNavigation(context = {}) {
  const video = state.videoElement;
  if (!video) {
    return;
  }
  if (video.ended) {
    maybeTriggerVideoEndFallback(100, context, { source: "navigation" });
    return;
  }
  const duration = Number(video.duration);
  const current = Number(video.currentTime);
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(current)) {
    return;
  }
  const ratio = (current / duration) * 100;
  maybeTriggerVideoEndFallback(ratio, context, { source: "navigation" });
}

export function resetVideoEndFallbackMatch() {
  videoEndFallbackState.matchedAt = 0;
}
