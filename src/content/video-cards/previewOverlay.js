// Video-card preview overlay. Adds hover/preview affordances around enhanced card targets.
import { parseVideoId } from "../../utils.js";

// Tracks hover previews so add buttons can follow YouTube's mini-player preview DOM when cards are recycled.
export function createPreviewOverlayController({
  inlineButtonsByVideoId,
  observeInlineOverlay,
}) {
  const state = {
    previewEl: null,
    button: null,
    homeOverlay: null,
  };
  let observer = null;
  let watcherReady = false;
  let syncPending = false;

  function detach() {
    if (state.button && state.homeOverlay?.isConnected) {
      state.homeOverlay.appendChild(state.button);
    }
    state.previewEl = null;
    state.button = null;
    state.homeOverlay = null;
  }

  function attach(preview) {
    if (!(preview instanceof HTMLElement)) {
      detach();
      return;
    }
    if (!isShortsPreview(preview)) {
      detach();
      return;
    }
    const videoId = parseVideoIdFromPreview(preview);
    if (!videoId) {
      detach();
      return;
    }
    const button = inlineButtonsByVideoId.get(videoId);
    if (!(button instanceof HTMLButtonElement)) {
      detach();
      return;
    }
    const host =
      preview.querySelector("#player-container") ||
      preview.querySelector("#media-container") ||
      preview;
    const overlay = observeInlineOverlay(host, null) || host;
    if (!overlay) {
      detach();
      return;
    }
    const currentHome = button.parentElement;
    if (overlay !== currentHome) {
      state.homeOverlay = currentHome;
      overlay.appendChild(button);
    } else {
      state.homeOverlay = currentHome;
    }
    state.previewEl = preview;
    state.button = button;
  }

  function ensureWatcher() {
    if (watcherReady) return;
    watcherReady = true;
    const sync = () => {
      const preview =
        document.querySelector("ytd-video-preview:not([hidden])") ||
        document.querySelector("#video-preview:not([hidden])");
      if (preview) {
        attach(preview);
      } else {
        detach();
      }
    };
    const scheduleSync = () => {
      if (syncPending) return;
      syncPending = true;
      if (typeof window.requestAnimationFrame === "function") {
        window.requestAnimationFrame(() => {
          syncPending = false;
          sync();
        });
      } else {
        window.setTimeout(() => {
          syncPending = false;
          sync();
        }, 0);
      }
    };
    observer = new MutationObserver(scheduleSync);
    observer.observe(document.documentElement || document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["hidden"],
    });
    sync();
  }

  return {
    detach,
    ensureWatcher,
    hasButton(button) {
      return state.button === button;
    },
  };
}

function parseVideoIdFromPreview(preview) {
  if (!(preview instanceof HTMLElement)) return "";
  const anchor =
    preview.querySelector("a[href*='watch']:not([href='#'])") ||
    preview.querySelector("a.ytp-title-link[href]");
  if (anchor) {
    const href = anchor.getAttribute("href") || anchor.href || "";
    const parsed = parseVideoId(href);
    if (parsed) return parsed;
  }
  const inlinePlayer = preview.querySelector("#inline-preview-player");
  if (inlinePlayer) {
    const dataVideoId = inlinePlayer.getAttribute("data-video-id");
    const parsed = parseVideoId(dataVideoId);
    if (parsed) return parsed;
  }
  const mediaLink = preview.querySelector("#media-container-link");
  if (mediaLink) {
    const href = mediaLink.getAttribute("href") || "";
    const parsed = parseVideoId(href);
    if (parsed) return parsed;
  }
  const previewContainer = preview.querySelector("#video-preview-container");
  if (previewContainer) {
    const href = previewContainer.getAttribute("href") || "";
    const parsed = parseVideoId(href);
    if (parsed) return parsed;
  }
  const player = preview.querySelector("ytd-player#inline-player");
  if (player) {
    const dataId =
      player.getAttribute("video-id") ||
      player.getAttribute("data-video-id") ||
      player.getAttribute("player-video-id");
    const parsed = parseVideoId(dataId);
    if (parsed) return parsed;
  }
  return "";
}

function isShortsPreview(preview) {
  if (!(preview instanceof HTMLElement)) return false;
  if (preview.querySelector("a[href*='/shorts/']")) {
    return true;
  }
  const attrHref =
    preview.getAttribute("href") ||
    preview.getAttribute("data-ytEndpoint") ||
    "";
  if (typeof attrHref === "string" && attrHref.includes("/shorts/")) {
    return true;
  }
  return false;
}
