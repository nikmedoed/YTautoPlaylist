// YouTube playback error monitor. Detects unavailable videos and reports skip-worthy player errors to the background.
import {
  determinePageContext,
  getCurrentVideoId,
  sendMessage,
  state,
  ytaDiagMeasure,
} from "../core/base.js";
import { showPlaybackNotification } from "./notification.js";

const playerErrorObserverState = {
  observer: null,
  host: null,
};
let playerErrorEventsBound = false;

function extractPlayerErrorMessage(details) {
  if (!details) {
    return "";
  }
  if (typeof details === "string") {
    return details;
  }
  if (typeof details.message === "string" && details.message.trim()) {
    return details.message;
  }
  if (typeof details.errorMessage === "string" && details.errorMessage.trim()) {
    return details.errorMessage;
  }
  if (typeof details.reason === "string" && details.reason.trim()) {
    return details.reason;
  }
  if (typeof details.status === "string" && details.status.trim()) {
    return details.status;
  }
  if (typeof details.errorCode === "string" && details.errorCode.trim()) {
    return details.errorCode;
  }
  if (typeof details.data === "object" && details.data !== null) {
    return extractPlayerErrorMessage(details.data);
  }
  return "";
}

function readPlayerResponseCandidates() {
  const candidates = [];
  if (
    window.ytInitialPlayerResponse &&
    typeof window.ytInitialPlayerResponse === "object"
  ) {
    candidates.push(window.ytInitialPlayerResponse);
  }
  const rawResponse = window.ytplayer?.config?.args?.player_response;
  if (rawResponse) {
    if (typeof rawResponse === "object") {
      candidates.push(rawResponse);
    } else if (typeof rawResponse === "string") {
      try {
        const parsed = JSON.parse(rawResponse);
        if (parsed && typeof parsed === "object") {
          candidates.push(parsed);
        }
      } catch {
        /* ignore malformed player_response */
      }
    }
  }
  return candidates;
}

function extractPlayabilityIssue() {
  const responses = readPlayerResponseCandidates();
  for (const response of responses) {
    const status = String(response?.playabilityStatus?.status || "").trim();
    if (!status || status === "OK") {
      continue;
    }
    const reason =
      response?.playabilityStatus?.reason ||
      response?.playabilityStatus?.errorScreen?.playerErrorMessage?.simpleText ||
      response?.playabilityStatus?.messages?.[0] ||
      status;
    return { status, reason };
  }
  return null;
}

function isElementVisible(element) {
  if (!element || element.nodeType !== Node.ELEMENT_NODE) {
    return false;
  }
  if (element.hasAttribute("hidden")) {
    return false;
  }
  const style = window.getComputedStyle(element);
  if (!style || style.display === "none" || style.visibility === "hidden") {
    return false;
  }
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

// Detects YouTube watch pages that cannot play the current video and tells the
// background queue to skip only when that unavailable video is still active.
export function detectUnavailableWatchState(context = {}) {
  const run = () => {
    if (determinePageContext() !== "watch") {
      return false;
    }
    const playabilityIssue = extractPlayabilityIssue();
    if (playabilityIssue) {
      handleVideoUnavailable(
        { reason: playabilityIssue.reason || playabilityIssue.status },
        context
      );
      return true;
    }
    const host = document.querySelector("ytd-watch-flexy");
    if (host && host.hasAttribute("player-unavailable")) {
      const reason = host.getAttribute("player-unavailable") || "";
      const message = host.getAttribute("player-error-message") || reason;
      if (message && message.trim()) {
        handleVideoUnavailable({ reason: message }, context);
        return true;
      }
    }
    const offlineSlate = document.querySelector(".ytp-offline-slate");
    if (offlineSlate && isElementVisible(offlineSlate)) {
      const mainTextElement = offlineSlate.querySelector(
        ".ytp-offline-slate-main-text"
      );
      const subtitleTextElement = offlineSlate.querySelector(
        ".ytp-offline-slate-subtitle-text"
      );
      const mainText = (
        (mainTextElement?.textContent || mainTextElement?.getAttribute("aria-label") || "")
      ).trim();
      const subtitleText = (
        subtitleTextElement?.textContent ||
        subtitleTextElement?.getAttribute("aria-label") ||
        ""
      ).trim();
      handleVideoUnavailable({
        reason: [mainText, subtitleText].filter(Boolean).join(". ") || "OFFLINE_SLATE",
      }, context);
      return true;
    }
    const promo = document.querySelector("ytd-background-promo-renderer");
    if (promo && isElementVisible(promo)) {
      const title = promo.querySelector(".promo-title");
      const body = promo.querySelector(".promo-body-text");
      const text =
        (body && body.textContent && body.textContent.trim()) ||
        (title && title.textContent && title.textContent.trim()) ||
        "";
      handleVideoUnavailable({ reason: text }, context);
      return true;
    }
    const errorRenderer = document.querySelector("ytd-player-error-message-renderer");
    if (errorRenderer && isElementVisible(errorRenderer)) {
      const text = errorRenderer.textContent ? errorRenderer.textContent.trim() : "";
      handleVideoUnavailable({ reason: text }, context);
      return true;
    }
    const playabilityError = document.querySelector(
      "yt-playability-error-supported-renderers"
    );
    if (playabilityError && isElementVisible(playabilityError)) {
      const text = playabilityError.textContent ? playabilityError.textContent.trim() : "";
      if (text) {
        handleVideoUnavailable({ reason: text }, context);
        return true;
      }
    }
    return false;
  };
  return ytaDiagMeasure("player.detectUnavailableWatchState", run);
}

export function handleVideoUnavailable(details = {}, context = {}) {
  const videoId = getCurrentVideoId();
  if (!videoId) {
    return;
  }
  if (state.lastUnavailableVideoId === videoId) {
    return;
  }
  state.lastUnavailableVideoId = videoId;
  const reason = extractPlayerErrorMessage(details) || "";
  const trimmedReason = reason.trim();
  const body = trimmedReason
    ? `Видео недоступно (${trimmedReason}). Перехожу к следующему`
    : "Видео недоступно. Перехожу к следующему";
  showPlaybackNotification({
    title: "Видео недоступно",
    body,
    duration: 6000,
  });
  sendMessage("player:videoUnavailable", { videoId, reason: trimmedReason }).then(
    (resp) => {
      const result = context.handlePlaybackAdvanceResponse?.(resp, {
        origin: "auto",
        sourceVideoId: videoId,
      });
      if (!result || result.handled === false) {
        context.setControlsActive?.(false);
      }
    }
  );
}

function teardownPlayerErrorObserver() {
  if (playerErrorObserverState.observer) {
    try {
      playerErrorObserverState.observer.disconnect();
    } catch {
      /* ignore */
    }
  }
  playerErrorObserverState.observer = null;
  playerErrorObserverState.host = null;
}

function handlePlayerErrorMutation(target, context) {
  if (!target) {
    return;
  }
  if (detectUnavailableWatchState(context)) {
    return;
  }
  const message = target.getAttribute("player-error-message");
  if (message && message.trim()) {
    handleVideoUnavailable({ reason: message }, context);
  }
}

function ensurePlayerErrorObserver(context) {
  if (
    playerErrorObserverState.host &&
    !document.contains(playerErrorObserverState.host)
  ) {
    teardownPlayerErrorObserver();
  }
  const host = document.querySelector("ytd-watch-flexy");
  if (!host) {
    teardownPlayerErrorObserver();
    return;
  }
  if (playerErrorObserverState.host === host) {
    return;
  }
  teardownPlayerErrorObserver();
  const observer = new MutationObserver(() => {
    handlePlayerErrorMutation(host, context);
  });
  observer.observe(host, {
    attributes: true,
    attributeFilter: ["player-error-message"],
  });
  playerErrorObserverState.observer = observer;
  playerErrorObserverState.host = host;
  handlePlayerErrorMutation(host, context);
}

function ensurePlayerErrorEvents(context) {
  if (playerErrorEventsBound) {
    return;
  }
  const errorListener = (event) => {
    if (!event) return;
    handleVideoUnavailable(event.detail || event, context);
  };
  const pageDataListener = (event) => {
    const detail = event?.detail;
    if (!detail) {
      return;
    }
    const playerResponse =
      detail.pageData?.playerResponse ||
      detail.playerResponse ||
      detail.response?.playerResponse;
    if (!playerResponse) {
      return;
    }
    const status = playerResponse?.playabilityStatus?.status || "";
    if (!status || status === "OK") {
      return;
    }
    const reason =
      playerResponse.playabilityStatus?.reason ||
      playerResponse.playabilityStatus?.errorScreen?.playerErrorMessage?.simpleText ||
      status;
    handleVideoUnavailable({ reason }, context);
  };
  window.addEventListener("yt-player-error", errorListener, true);
  window.addEventListener("yt-page-data-updated", pageDataListener, true);
  playerErrorEventsBound = true;
}

export function ensurePlayerErrorMonitoring(context = {}) {
  ensurePlayerErrorEvents(context);
  ensurePlayerErrorObserver(context);
}
