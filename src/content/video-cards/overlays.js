// Video-card overlay placement. Attaches controls to supported YouTube card layouts and maintains positioning.
import {
  CARD_OVERLAY_HOST_CLASS,
  INLINE_BUTTON_OVERLAY_CLASS,
  ADD_BUTTON_CLASS,
} from "../core/base.js";

const OVERLAY_ROOT_ID = "yta-card-overlay-root";

// Creates and observes overlay hosts attached to YouTube thumbnails without disturbing YouTube's own click targets.
export function createVideoCardOverlayController({ inlineOverlayObservers }) {
  const overlaysByHost = new WeakMap();
  const overlayRecords = new Set();
  let overlayRoot = null;
  let intersectionObserver = null;
  let updateFrame = 0;
  let globalListenersReady = false;

  function ensureOverlayRoot() {
    if (overlayRoot?.isConnected) {
      return overlayRoot;
    }
    overlayRoot = document.getElementById(OVERLAY_ROOT_ID);
    if (!(overlayRoot instanceof HTMLElement)) {
      overlayRoot = document.createElement("div");
      overlayRoot.id = OVERLAY_ROOT_ID;
      document.documentElement.appendChild(overlayRoot);
    }
    ensureGlobalListeners();
    return overlayRoot;
  }

  function ensureGlobalListeners() {
    if (globalListenersReady) return;
    globalListenersReady = true;
    window.addEventListener("scroll", scheduleAllOverlayUpdates, true);
    window.addEventListener("resize", scheduleAllOverlayUpdates, true);
  }

  function scheduleAllOverlayUpdates() {
    if (updateFrame) return;
    updateFrame = window.requestAnimationFrame(() => {
      updateFrame = 0;
      overlayRecords.forEach((record) => {
        if (!record.host.isConnected) {
          removeOverlayRecord(record.host);
          return;
        }
        if (record.visible === false) {
          record.overlay.hidden = true;
          return;
        }
        updateOverlayPosition(record.host, record.overlay);
      });
    });
  }

  function ensureIntersectionObserver() {
    if (intersectionObserver || typeof IntersectionObserver !== "function") {
      return intersectionObserver;
    }
    intersectionObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const record = overlaysByHost.get(entry.target);
          if (!record) return;
          record.visible = entry.isIntersecting;
          if (record.visible) {
            updateOverlayPosition(record.host, record.overlay);
          } else {
            record.overlay.hidden = true;
          }
        });
      },
      { root: null, rootMargin: "600px 0px", threshold: 0 }
    );
    return intersectionObserver;
  }

  function pickOverlayAnchor(host) {
    if (!(host instanceof HTMLElement)) return null;
    return (
      host.querySelector("ytd-video-preview:not([hidden])") ||
      host.querySelector("#inline-preview-player") ||
      host.querySelector("ytd-thumbnail") ||
      host.querySelector("a#thumbnail") ||
      host.querySelector("yt-img-shadow") ||
      host
    );
  }

  function updateOverlayPosition(host, overlay) {
    if (!(host instanceof HTMLElement) || !(overlay instanceof HTMLElement)) {
      return;
    }
    const anchor = pickOverlayAnchor(host);
    if (!(anchor instanceof HTMLElement) || !anchor.isConnected) {
      overlay.hidden = true;
      return;
    }
    const rect = anchor.getBoundingClientRect();
    if (
      rect.width <= 0 ||
      rect.height <= 0 ||
      rect.bottom < 0 ||
      rect.right < 0 ||
      rect.top > window.innerHeight ||
      rect.left > window.innerWidth
    ) {
      overlay.hidden = true;
      return;
    }
    overlay.hidden = false;
    overlay.style.transform = `translate3d(${Math.round(rect.left)}px, ${Math.round(rect.top)}px, 0)`;
    overlay.style.width = `${Math.round(rect.width)}px`;
    overlay.style.height = `${Math.round(rect.height)}px`;
  }

  function removeOverlayRecord(host) {
    const record = overlaysByHost.get(host);
    if (!record) return;
    intersectionObserver?.unobserve(host);
    overlayRecords.delete(record);
    record.overlay.remove();
    overlaysByHost.delete(host);
  }

  function stopInlineOverlayObserver(host) {
    const observer = inlineOverlayObservers.get(host);
    if (observer) {
      observer.disconnect();
      inlineOverlayObservers.delete(host);
    }
    removeOverlayRecord(host);
  }

  function findDirectOverlay(host) {
    if (!(host instanceof HTMLElement)) {
      return null;
    }
    const record = overlaysByHost.get(host);
    if (record?.overlay?.isConnected) {
      return record.overlay;
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
    let record = overlaysByHost.get(host);
    let overlay = record?.overlay;
    if (!(overlay instanceof HTMLElement) || !overlay.isConnected) {
      overlay = document.createElement("div");
      overlay.className = INLINE_BUTTON_OVERLAY_CLASS;
      ensureOverlayRoot().appendChild(overlay);
      record = { host, overlay, visible: true };
      overlaysByHost.set(host, record);
      overlayRecords.add(record);
      ensureIntersectionObserver()?.observe(host);
    }
    updateOverlayPosition(host, overlay);
    return overlay;
  }

  function removeNestedOverlayControls(host, keepButton) {
    host.querySelectorAll(`.${INLINE_BUTTON_OVERLAY_CLASS}`).forEach((node) => {
      if (node instanceof HTMLElement && !overlaysByHost.has(node)) {
        node.remove();
      }
    });
    host.querySelectorAll(`.${ADD_BUTTON_CLASS}`).forEach((button) => {
      if (
        button instanceof HTMLButtonElement &&
        button !== keepButton
      ) {
        button.remove();
      }
    });
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
      if (button) {
        removeNestedOverlayControls(host, button);
      }
      if (overlay) {
        updateOverlayPosition(host, overlay);
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
      scheduleAllOverlayUpdates();
    });
    observer.observe(host, { childList: true });
    inlineOverlayObservers.set(host, observer);
    return ensure();
  }

  function resolveOverlayHost(card) {
    if (!(card instanceof HTMLElement)) return card;
    const dismissible = card.querySelector(":scope > #dismissible");
    return dismissible instanceof HTMLElement ? dismissible : card;
  }

  return {
    findDirectOverlay,
    findDirectOverlayButton,
    observeInlineOverlay,
    resolveOverlayHost,
    stopInlineOverlayObserver,
  };
}
