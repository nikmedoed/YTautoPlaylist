// Content navigation coordinator. Contains YouTube URL-change tracking and delayed refresh scheduling.
import {
  state,
  ytaDiagMeasure,
} from "./base.js";
import { parseVideoId } from "../../utils.js";
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
  maybeFinalizeVideoEndedBeforeNavigation,
  scanForVideo,
  updateMediaSessionHandlers,
  updatePlayerControlsUI,
} from "../playback/controls.js";
import { hidePlaybackNotification } from "../playback/notification.js";
import {
  resetPlaybackWatchdog,
  stopPlaybackWatchdog,
} from "../playback/progressWatchdog.js";
import {
  refreshInlinePlaylistState,
  teardownInlineQueue,
} from "../inline-queue/index.js";

let pendingUiFrame = null;
let pendingUiFrameType = null;
let pendingUiScan = false;

function flushScheduledUiUpdate() {
  ytaDiagMeasure("navigation.flushScheduledUiUpdate", () => {
    pendingUiFrame = null;
    pendingUiFrameType = null;
    const shouldScan = pendingUiScan;
    pendingUiScan = false;
    if (shouldScan) {
      scanForVideo();
    }
    updatePageActions();
    ensurePlayerControls();
  });
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

function cancelPageCollection(label) {
  try {
    cancelAddAllFromPage({ silent: true });
  } catch (err) {
    console.warn(`Failed to cancel page collection on ${label}`, err);
  }
}

function enhanceCardsFromMutationNode(node) {
  if (!(node instanceof HTMLElement)) {
    if (
      node &&
      node.nodeType === Node.DOCUMENT_FRAGMENT_NODE &&
      typeof node.querySelector === "function"
    ) {
      ytaDiagMeasure("navigation.enhanceVideoCards.fragment", () => {
        enhanceVideoCards(node);
      });
      return Boolean(node.querySelector("video"));
    }
    return false;
  }

  // Avoid expensive card scans for high-churn player internals.
  if (
    node.closest?.(
      "#movie_player, .html5-video-player, ytd-player, #player-container-outer"
    )
  ) {
    return node.tagName === "VIDEO" || Boolean(node.querySelector?.("video"));
  }

  ytaDiagMeasure("navigation.enhanceVideoCards.node", () => {
    enhanceVideoCards(node);
  });
  return node.tagName === "VIDEO" || Boolean(node.querySelector?.("video"));
}

export const observer = new MutationObserver((mutations) => {
  ytaDiagMeasure("navigation.mutationObserver", () => {
    let shouldScanVideo = false;
    for (const mutation of mutations) {
      if (mutation.type !== "childList") {
        continue;
      }
      mutation.addedNodes.forEach((node) => {
        if (enhanceCardsFromMutationNode(node)) {
          shouldScanVideo = true;
        }
      });
      mutation.removedNodes.forEach((node) => {
        if (!(node instanceof HTMLElement)) return;
        if (node === state.videoElement || node.contains(state.videoElement)) {
          shouldScanVideo = true;
        }
      });
    }
    const needsScan =
      shouldScanVideo ||
      !state.videoElement ||
      (state.videoElement && !document.contains(state.videoElement));
    scheduleUiUpdate({ scan: needsScan });
  });
});

// Clears transient content-script UI/playback state when YouTube performs an in-page navigation.
export function resetStateForNavigation(event = null) {
  const eventType = typeof event?.type === "string" ? event.type : "";
  const isNavigateStart = eventType === "yt-navigate-start";
  ytaDiagMeasure("navigation.resetStateForNavigation", () => {
    maybeFinalizeVideoEndedBeforeNavigation();
    if (isNavigateStart) {
      // Keep inline queue visible until navigation actually completes.
      cancelScheduledUiUpdate();
      cancelPageCollection("navigation start");
      return;
    }
    try {
      resetVideoCardDecorations();
    } catch (err) {
      console.warn("Failed to reset video card decorations", err);
    }
    cancelScheduledUiUpdate();
    cancelPageCollection("navigation");
    detachVideoListeners();
    state.controlsActive = false;
    state.currentVideoId = parseVideoId(window.location.href) || null;
    state.lastReportedVideoId = null;
    state.lastUnavailableVideoId = null;
    resetPlaybackWatchdog(state.currentVideoId || null);
    stopPlaybackWatchdog();
    hidePlaybackNotification(true);
    updateMediaSessionHandlers();
    updatePlayerControlsUI();
    updatePageActions();
    try {
      teardownInlineQueue();
    } catch (err) {
      console.warn("Failed to reset inline queue UI", err);
    }
    void refreshInlinePlaylistState();
    setTimeout(() => {
      scanForVideo();
      enhanceVideoCards();
      ensurePlayerControls();
      updatePageActions();
    }, 0);
  });
}
