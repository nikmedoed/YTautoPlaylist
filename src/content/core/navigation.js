// Content navigation coordinator. Contains YouTube URL-change tracking and delayed refresh scheduling.
import {
  pageActions,
  parseVideoId,
  state,
  ytaDiagMeasure,
} from "./base.js";
import {
  enhanceVideoCards,
  resetVideoCardDecorations,
} from "../video-cards/index.js";
import {
  cancelAddAllFromPage,
  updatePageActions,
} from "../page-actions/index.js";
import {
  detachVideoListeners,
  ensurePlayerControls,
  hidePlaybackNotification,
  maybeFinalizeVideoEndedBeforeNavigation,
  resetPlaybackWatchdog,
  scanForVideo,
  stopPlaybackWatchdog,
  updateMediaSessionHandlers,
  updatePlayerControlsUI,
} from "../playback/controls.js";
import {
  refreshInlinePlaylistState,
  teardownInlineQueue,
} from "../inline-queue/index.js";

let pendingUiFrame = null;
let pendingUiFrameType = null;
let pendingUiScan = false;

function flushScheduledUiUpdate() {
  const run = () => {
    pendingUiFrame = null;
    pendingUiFrameType = null;
    const shouldScan = pendingUiScan;
    pendingUiScan = false;
    if (shouldScan) {
      scanForVideo();
    }
    updatePageActions();
    ensurePlayerControls();
  };
  if (typeof ytaDiagMeasure === "function") {
    ytaDiagMeasure("navigation.flushScheduledUiUpdate", run);
    return;
  }
  run();
}

function scheduleUiUpdate({ scan = false } = {}) {
  if (scan) {
    pendingUiScan = true;
  }
  if (pendingUiFrame !== null) {
    return;
  }
  if (typeof window.requestAnimationFrame === "function") {
    pendingUiFrameType = "raf";
    pendingUiFrame = window.requestAnimationFrame(() => {
      pendingUiFrame = null;
      pendingUiFrameType = null;
      flushScheduledUiUpdate();
    });
  } else {
    pendingUiFrameType = "timeout";
    pendingUiFrame = window.setTimeout(() => {
      pendingUiFrame = null;
      pendingUiFrameType = null;
      flushScheduledUiUpdate();
    }, 0);
  }
}

function cancelScheduledUiUpdate() {
  if (pendingUiFrame === null) {
    return;
  }
  if (pendingUiFrameType === "timeout") {
    window.clearTimeout(pendingUiFrame);
  } else if (pendingUiFrameType === "raf" && typeof window.cancelAnimationFrame === "function") {
    window.cancelAnimationFrame(pendingUiFrame);
  }
  pendingUiFrame = null;
  pendingUiFrameType = null;
  pendingUiScan = false;
}

export const observer = new MutationObserver((mutations) => {
  const run = () => {
  let shouldScanVideo = false;
  const maybeEnhanceCards = (node) => {
    if (!(node instanceof HTMLElement)) {
      return;
    }
    // Avoid expensive card scans for high-churn player internals.
    if (
      node.closest?.(
        "#movie_player, .html5-video-player, ytd-player, #player-container-outer"
      )
    ) {
      return;
    }
    if (typeof ytaDiagMeasure === "function") {
      ytaDiagMeasure("navigation.enhanceVideoCards.node", () => {
        enhanceVideoCards(node);
      });
    } else {
      enhanceVideoCards(node);
    }
  };
  for (const mutation of mutations) {
    if (mutation.type === "childList") {
      mutation.addedNodes.forEach((node) => {
        if (node instanceof HTMLElement) {
          maybeEnhanceCards(node);
          if (!shouldScanVideo) {
            if (node.tagName === "VIDEO" || node.querySelector?.("video")) {
              shouldScanVideo = true;
            }
          }
        } else if (
          node &&
          node.nodeType === Node.DOCUMENT_FRAGMENT_NODE &&
          typeof node.querySelector === "function"
        ) {
          if (typeof ytaDiagMeasure === "function") {
            ytaDiagMeasure("navigation.enhanceVideoCards.fragment", () => {
              enhanceVideoCards(node);
            });
          } else {
            enhanceVideoCards(node);
          }
          if (!shouldScanVideo && node.querySelector("video")) {
            shouldScanVideo = true;
          }
        }
      });
      mutation.removedNodes.forEach((node) => {
        if (!(node instanceof HTMLElement)) return;
        if (node === state.videoElement || node.contains(state.videoElement)) {
          shouldScanVideo = true;
        }
      });
    }
  }
  const needsScan =
    shouldScanVideo ||
    !state.videoElement ||
    (state.videoElement && !document.contains(state.videoElement));
  scheduleUiUpdate({ scan: needsScan });
  };
  if (typeof ytaDiagMeasure === "function") {
    ytaDiagMeasure("navigation.mutationObserver", run);
    return;
  }
  run();
});

// Clears transient content-script UI/playback state when YouTube performs an in-page navigation.
export function resetStateForNavigation(event = null) {
  const eventType = typeof event?.type === "string" ? event.type : "";
  const isNavigateStart = eventType === "yt-navigate-start";
  const run = () => {
  if (typeof maybeFinalizeVideoEndedBeforeNavigation === "function") {
    maybeFinalizeVideoEndedBeforeNavigation();
  }
  if (isNavigateStart) {
    // Keep inline queue visible until navigation actually completes.
    cancelScheduledUiUpdate();
    if (typeof cancelAddAllFromPage === "function") {
      try {
        cancelAddAllFromPage({ silent: true });
      } catch (err) {
        console.warn("Failed to cancel page collection on navigation start", err);
      }
    } else if (typeof pageActions === "object" && pageActions?.collectAbort) {
      try {
        pageActions.collectAbort.abort();
      } catch (err) {
        console.warn("Failed to abort page collection controller on navigation start", err);
      }
    }
    return;
  }
  try {
    resetVideoCardDecorations();
  } catch (err) {
    console.warn("Failed to reset video card decorations", err);
  }
  cancelScheduledUiUpdate();
  if (typeof cancelAddAllFromPage === "function") {
    try {
      cancelAddAllFromPage({ silent: true });
    } catch (err) {
      console.warn("Failed to cancel page collection on navigation", err);
    }
  } else if (typeof pageActions === "object" && pageActions?.collectAbort) {
    try {
      pageActions.collectAbort.abort();
    } catch (err) {
      console.warn("Failed to abort page collection controller", err);
    }
  }
  detachVideoListeners();
  state.controlsActive = false;
  state.currentVideoId = parseVideoId(window.location.href) || null;
  state.lastReportedVideoId = null;
  state.lastUnavailableVideoId = null;
  if (typeof resetPlaybackWatchdog === "function") {
    resetPlaybackWatchdog(state.currentVideoId || null);
  }
  if (typeof stopPlaybackWatchdog === "function") {
    stopPlaybackWatchdog();
  }
  if (typeof hidePlaybackNotification === "function") {
    hidePlaybackNotification(true);
  }
  updateMediaSessionHandlers();
  updatePlayerControlsUI();
  updatePageActions();
  if (typeof teardownInlineQueue === "function") {
    try {
      teardownInlineQueue();
    } catch (err) {
      console.warn("Failed to reset inline queue UI", err);
    }
  }
  void refreshInlinePlaylistState();
  setTimeout(() => {
    scanForVideo();
    enhanceVideoCards();
    ensurePlayerControls();
    updatePageActions();
  }, 0);
  };
  if (typeof ytaDiagMeasure === "function") {
    ytaDiagMeasure("navigation.resetStateForNavigation", run);
    return;
  }
  run();
}
