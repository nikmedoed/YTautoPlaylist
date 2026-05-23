// Content script entrypoint for YouTube pages. Starts core navigation, playback controls, inline queue, page actions, and card overlays.
import { determinePageContext, ytaDiagMeasure } from "./core/base.js";
import { injectStyles } from "./styles/index.js";
import { refreshInlinePlaylistState } from "./inline-queue/index.js";
import {
  ensurePlayerControls,
  scanForVideo,
} from "./playback/controls.js";
import { enhanceVideoCards } from "./video-cards/index.js";
import { updatePageActions } from "./page-actions/index.js";
import {
  observer,
  resetStateForNavigation,
} from "./core/navigation.js";
import { setupControlInterceptors } from "./core/interceptors.js";
import "./core/messages.js";

function init() {
  injectStyles();
  void refreshInlinePlaylistState();
  ensurePlayerControls();
  if (typeof ytaDiagMeasure === "function") {
    ytaDiagMeasure("init.enhanceVideoCards.document", () => {
      enhanceVideoCards(document);
    });
  } else {
    enhanceVideoCards(document);
  }
  updatePageActions();
  ensurePlayerControls();
  scanForVideo();
  observer.observe(document.documentElement || document.body, {
    childList: true,
    subtree: true,
  });
  setupControlInterceptors();
  window.addEventListener("yt-navigate-start", resetStateForNavigation, true);
  window.addEventListener("yt-navigate-finish", resetStateForNavigation, true);
  window.addEventListener("popstate", resetStateForNavigation);
  window.addEventListener("yt-page-data-updated", () => {
    // Full-document card scan during watch playback can cause frame drops.
    if (determinePageContext() === "watch") {
      return;
    }
    setTimeout(() => {
      if (typeof ytaDiagMeasure === "function") {
        ytaDiagMeasure("init.ytPageDataUpdated.enhanceDocument", () => {
          enhanceVideoCards(document);
        });
      } else {
        enhanceVideoCards(document);
      }
    }, 0);
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
