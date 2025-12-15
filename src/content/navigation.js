let pendingUiFrame = null;
let pendingUiFrameType = null;
let pendingUiScan = false;

function flushScheduledUiUpdate() {
  pendingUiFrame = null;
  pendingUiFrameType = null;
  const shouldScan = pendingUiScan;
  pendingUiScan = false;
  if (shouldScan) {
    scanForVideo();
  }
  updatePageActions();
  ensurePlayerControls();
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

const observer = new MutationObserver((mutations) => {
  let shouldScanVideo = false;
  for (const mutation of mutations) {
    if (mutation.type === "childList") {
      mutation.addedNodes.forEach((node) => {
        if (node instanceof HTMLElement) {
          enhanceVideoCards(node);
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
          enhanceVideoCards(node);
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
});

function resetStateForNavigation() {
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
}
