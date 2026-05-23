// Video-card overlay placement. Attaches controls to supported YouTube card layouts and maintains positioning.
import {
  CARD_OVERLAY_HOST_CLASS,
  INLINE_BUTTON_OVERLAY_CLASS,
  ADD_BUTTON_CLASS,
} from "../core/base.js";

// Creates and observes overlay hosts attached to YouTube thumbnails without disturbing YouTube's own click targets.
export function createVideoCardOverlayController({ inlineOverlayObservers }) {
  function stopInlineOverlayObserver(host) {
    const observer = inlineOverlayObservers.get(host);
    if (observer) {
      observer.disconnect();
      inlineOverlayObservers.delete(host);
    }
  }

  function findDirectOverlay(host) {
    if (!(host instanceof HTMLElement)) {
      return null;
    }
    return Array.from(host.children).find(
      (child) =>
        child instanceof HTMLElement &&
        child.classList.contains(INLINE_BUTTON_OVERLAY_CLASS)
    ) || null;
  }

  function findDirectOverlayButton(overlay) {
    if (!(overlay instanceof HTMLElement)) {
      return null;
    }
    return Array.from(overlay.children).find(
      (child) =>
        child instanceof HTMLButtonElement &&
        child.classList.contains(ADD_BUTTON_CLASS)
    ) || null;
  }

  function ensureInlineOverlay(host) {
    if (!(host instanceof HTMLElement)) {
      return null;
    }
    host.classList.add(CARD_OVERLAY_HOST_CLASS);
    let overlay = findDirectOverlay(host);
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.className = INLINE_BUTTON_OVERLAY_CLASS;
      host.appendChild(overlay);
    }
    return overlay;
  }

  function observeInlineOverlay(host, button) {
    if (!(host instanceof HTMLElement)) {
      return null;
    }
    const ensure = () => {
      const overlay = ensureInlineOverlay(host);
      if (overlay && button && button.parentElement !== overlay) {
        overlay.appendChild(button);
      }
      return overlay;
    };
    const existing = inlineOverlayObservers.get(host);
    if (existing) {
      return ensure();
    }
    const observer = new MutationObserver(() => {
      if (!host.isConnected) {
        stopInlineOverlayObserver(host);
        return;
      }
      ensure();
    });
    observer.observe(host, { childList: true });
    inlineOverlayObservers.set(host, observer);
    return ensure();
  }

  function resolveOverlayHost(card) {
    if (!(card instanceof HTMLElement)) return card;
    const previewHost =
      card.querySelector("ytd-video-preview #player-container") ||
      card.querySelector("ytd-video-preview") ||
      card.querySelector("#inline-preview-player")?.closest(".html5-video-player") ||
      null;
    if (previewHost instanceof HTMLElement) {
      return previewHost;
    }
    return card;
  }

  return {
    findDirectOverlay,
    findDirectOverlayButton,
    observeInlineOverlay,
    resolveOverlayHost,
    stopInlineOverlayObserver,
  };
}
