// Video-card cleanup helpers. Removes stale overlays and observers when cards disappear or change identity.
import {
  ADD_BUTTON_CLASS,
  CARD_MARK,
  CARD_OVERLAY_HOST_CLASS,
  INLINE_BUTTON_OVERLAY_CLASS,
  THUMB_HOST_CLASS,
  VIDEO_CARD_SELECTOR,
  ytaDiagMeasure,
} from "../core/base.js";

// Removes overlays, timers, observers, and ownership records for cards that YouTube detached or recycled.
export function createVideoCardCleanup({
  applyProgress,
  buttonOwnership,
  inlineButtonsByVideoId,
  inlineOverlayHosts,
  overlays,
  previewOverlay,
  scheduleRetry,
}) {
  function cleanupInlineQueueAddButtons(scope, inlineQueueSelector) {
    const roots = [];
    if (scope instanceof HTMLElement && scope.matches(inlineQueueSelector)) {
      roots.push(scope);
    }
    if (scope?.querySelectorAll) {
      roots.push(...scope.querySelectorAll(inlineQueueSelector));
    }
    roots.forEach((root) => {
      if (!(root instanceof HTMLElement)) return;
      root.querySelectorAll(`.${ADD_BUTTON_CLASS}`).forEach((button) => {
        buttonOwnership.removeOwnedButton(button);
      });
      root.querySelectorAll(`.${INLINE_BUTTON_OVERLAY_CLASS}`).forEach((overlay) => {
        overlay.remove();
      });
      root.querySelectorAll(`.${CARD_OVERLAY_HOST_CLASS}`).forEach((node) => {
        node.classList.remove(CARD_OVERLAY_HOST_CLASS);
      });
      root.querySelectorAll(`.${THUMB_HOST_CLASS}`).forEach((node) => {
        node.classList.remove(THUMB_HOST_CLASS);
      });
      root.querySelectorAll(`[${CARD_MARK}]`).forEach((node) => {
        node.removeAttribute(CARD_MARK);
        node.removeAttribute("data-yta-target-type");
        node.removeAttribute("data-yta-target-id");
        node.removeAttribute("data-yta-video-id");
      });
    });
  }

  function clearCardDecoration(card, { retry = false } = {}) {
    if (!(card instanceof HTMLElement)) return;
    card.classList.remove(CARD_OVERLAY_HOST_CLASS);
    card.removeAttribute("data-yta-video-id");
    card.removeAttribute("data-yta-target-id");
    card.removeAttribute("data-yta-target-type");
    card.removeAttribute(CARD_MARK);
    buttonOwnership.findCardOwnedButtons(card).forEach((button) => {
      buttonOwnership.removeOwnedButton(button);
    });
    const previousHost = inlineOverlayHosts.get(card);
    if (previousHost) {
      overlays.stopInlineOverlayObserver(previousHost);
      inlineOverlayHosts.delete(card);
      previousHost.classList.remove(CARD_OVERLAY_HOST_CLASS);
      const overlay = overlays.findDirectOverlay(previousHost);
      if (overlay && !overlays.findDirectOverlayButton(overlay)) {
        overlay.remove();
      }
    } else {
      overlays.stopInlineOverlayObserver(card);
      const overlay = overlays.findDirectOverlay(card);
      if (overlay && !overlays.findDirectOverlayButton(overlay)) {
        overlay.remove();
      }
    }
    applyProgress(card, null);
    if (retry) {
      scheduleRetry(card);
    }
  }

  function resetVideoCardDecorations(root = document) {
    const run = () => {
      const scope =
        root instanceof Document || root instanceof HTMLElement ? root : document;
      previewOverlay.detach();
      inlineButtonsByVideoId.clear();
      scope.querySelectorAll(`.${ADD_BUTTON_CLASS}`).forEach((button) => {
        buttonOwnership.removeOwnedButton(button);
      });
      scope.querySelectorAll(VIDEO_CARD_SELECTOR).forEach((card) => {
        clearCardDecoration(card, { retry: false });
      });
      scope.querySelectorAll(`.${THUMB_HOST_CLASS}`).forEach((host) => {
        if (host instanceof HTMLElement) {
          host.classList.remove(THUMB_HOST_CLASS);
        }
      });
    };
    if (typeof ytaDiagMeasure === "function") {
      ytaDiagMeasure("videoCards.resetVideoCardDecorations", run);
      return;
    }
    run();
  }

  return {
    cleanupInlineQueueAddButtons,
    clearCardDecoration,
    resetVideoCardDecorations,
  };
}
