// Video-card decoration helpers. Applies progress and added-state visual markers to card overlays.
import {
  CARD_MARK,
  CARD_OVERLAY_HOST_CLASS,
  THUMB_HOST_CLASS,
  VIDEO_CARD_SELECTOR,
  ytaDiagMeasure,
} from "../core/base.js";
import { syncInlineButtonState } from "../inline-queue/index.js";
import { createAddButtonController } from "./addButton.js";
import { createCardButtonOwnership } from "./buttonOwnership.js";
import { createVideoCardCleanup } from "./cleanup.js";
import { applyCardProgress } from "./progress.js";
import {
  clearCardRetryTimeout,
  forgetCardRetry,
  scheduleCardRetry,
} from "./retry.js";
import { determineCardTarget, hasNestedCardCandidate } from "./targets.js";

const INLINE_QUEUE_SELECTOR = ".yta-inline-queue";

export function shouldEnhanceVideoCardCandidate({
  insideInlineQueue,
  hasNestedCandidate,
}) {
  return !insideInlineQueue && !hasNestedCandidate;
}

// Coordinates card detection, target extraction, overlay placement, and retry cleanup for YouTube video cards.
export function createVideoCardDecorationController({
  overlays,
  previewOverlay,
  playlistSuccessTimers,
  inlineOverlayHosts,
  inlineButtonsByVideoId,
  inlineButtonOwners,
}) {
  let addButtonController = null;
  const buttonOwnership = createCardButtonOwnership({
    overlays,
    previewOverlay,
    playlistSuccessTimers,
    inlineButtonsByVideoId,
    inlineButtonOwners,
  });
  const cleanup = createVideoCardCleanup({
    applyProgress: applyCardProgress,
    buttonOwnership,
    inlineButtonsByVideoId,
    inlineOverlayHosts,
    overlays,
    previewOverlay,
    scheduleRetry: (card) => scheduleCardRetry(card, decorateVideoCard),
  });

  function isInsideInlineQueue(node) {
    return (
      node instanceof HTMLElement &&
      typeof node.closest === "function" &&
      Boolean(node.closest(INLINE_QUEUE_SELECTOR))
    );
  }

  function resolveFreshTargetForButton(button) {
    if (!(button instanceof HTMLButtonElement)) return null;
    const ownerCard = inlineButtonOwners.get(button);
    if (ownerCard instanceof HTMLElement && ownerCard.isConnected) {
      return determineCardTarget(ownerCard) || null;
    }
    const closestCard = button.closest(VIDEO_CARD_SELECTOR);
    if (closestCard instanceof HTMLElement && closestCard.isConnected) {
      return determineCardTarget(closestCard) || null;
    }
    return null;
  }

  function getAddButtonController() {
    if (!addButtonController) {
      addButtonController = createAddButtonController({
        bindButtonTarget: buttonOwnership.bindButtonTarget,
        overlays,
        playlistSuccessTimers,
        resolveFreshTargetForButton,
      });
    }
    return addButtonController;
  }

  // Enhances a single card if it resolves to a valid video/playlist target and is not part of the inline queue.
  function decorateVideoCard(card) {
    if (!(card instanceof HTMLElement)) return;
    if (isInsideInlineQueue(card)) {
      cleanup.clearCardDecoration(card, { retry: false });
      return;
    }
    previewOverlay.ensureWatcher();
    clearCardRetryTimeout(card);
    const target = determineCardTarget(card);
    if (!target) {
      cleanup.clearCardDecoration(card, { retry: true });
      return;
    }
    forgetCardRetry(card);
    const previousType = card.getAttribute("data-yta-target-type");
    const previousId = card.getAttribute("data-yta-target-id");
    card.setAttribute("data-yta-target-type", target.type);
    card.setAttribute("data-yta-target-id", target.id);
    card.removeAttribute("data-yta-video-id");
    let host =
      card.querySelector("ytd-thumbnail") ||
      card.querySelector("a#thumbnail") ||
      card.querySelector("yt-img-shadow") ||
      card.querySelector(".ytLockupViewModelContentImage") ||
      card.querySelector(".yt-lockup-view-model__content-image") ||
      card.querySelector("yt-thumbnail-view-model") ||
      card.querySelector(".shortsLockupViewModelHostThumbnailParentContainer") ||
      card.querySelector(".shortsLockupViewModelHostThumbnailContainer") ||
      card.querySelector("a.shortsLockupViewModelHostEndpoint");
    if (host instanceof HTMLElement) {
      host.classList.add(THUMB_HOST_CLASS);
    } else {
      host = card;
      host.classList.add(THUMB_HOST_CLASS);
    }
    const overlayHost = overlays.resolveOverlayHost(card) || card;
    const previousHost = inlineOverlayHosts.get(card);
    if (previousHost && previousHost !== overlayHost) {
      overlays.stopInlineOverlayObserver(previousHost);
    }
    inlineOverlayHosts.set(card, overlayHost);
    overlayHost.classList.add(CARD_OVERLAY_HOST_CLASS);
    const overlay = overlays.observeInlineOverlay(overlayHost, null) || overlayHost;
    let button = buttonOwnership.findCardPrimaryButton(card, overlay);
    if (!button && target.type === "video") {
      const mappedButton = inlineButtonsByVideoId.get(target.id);
      if (mappedButton instanceof HTMLButtonElement) {
        button = mappedButton;
      }
    }
    if (button && button.parentElement !== overlay) {
      overlay.appendChild(button);
    }
    if (!button) {
      button = getAddButtonController().createAddButton(overlay, overlayHost);
    } else {
      overlays.observeInlineOverlay(overlayHost, button);
    }
    if (
      previousType === "video" &&
      previousId &&
      (target.type !== "video" || previousId !== target.id)
    ) {
      inlineButtonsByVideoId.delete(previousId);
    }
    buttonOwnership.bindButtonTarget(button, target);
    inlineButtonOwners.set(button, card);
    buttonOwnership.removeExtraCardButtons(card, button);
    if (target.type === "playlist" && previousId && previousId !== target.id) {
      inlineButtonsByVideoId.delete(previousId);
    }
    syncInlineButtonState(button);
    applyCardProgress(card, target.type === "video" ? target.id : null);
    if (
      previousType === target.type &&
      previousId === target.id &&
      card.hasAttribute(CARD_MARK)
    ) {
      return;
    }
    card.setAttribute(CARD_MARK, "1");
  }

  function enhanceVideoCards(root = document) {
    const run = () => {
      if (!root) return;
      cleanup.cleanupInlineQueueAddButtons(root, INLINE_QUEUE_SELECTOR);
      if (
        root instanceof HTMLElement &&
        root.matches(VIDEO_CARD_SELECTOR) &&
        shouldEnhanceVideoCardCandidate({
          insideInlineQueue: isInsideInlineQueue(root),
          hasNestedCandidate: hasNestedCardCandidate(root, VIDEO_CARD_SELECTOR),
        })
      ) {
        decorateVideoCard(root);
      } else if (
        root instanceof HTMLElement &&
        root.matches(VIDEO_CARD_SELECTOR)
      ) {
        cleanup.clearCardDecoration(root, { retry: false });
      }
      if (root.querySelectorAll) {
        root.querySelectorAll(VIDEO_CARD_SELECTOR).forEach((card) => {
          const shouldEnhance = shouldEnhanceVideoCardCandidate({
            insideInlineQueue: isInsideInlineQueue(card),
            hasNestedCandidate: hasNestedCardCandidate(card, VIDEO_CARD_SELECTOR),
          });
          if (!shouldEnhance) {
            cleanup.clearCardDecoration(card, { retry: false });
            return;
          }
          decorateVideoCard(card);
        });
      }
    };
    if (typeof ytaDiagMeasure === "function") {
      ytaDiagMeasure("videoCards.enhanceVideoCards", run);
      return;
    }
    run();
  }

  return {
    enhanceVideoCards,
    resetVideoCardDecorations: cleanup.resetVideoCardDecorations,
  };
}
