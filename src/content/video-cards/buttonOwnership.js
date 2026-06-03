// Video-card button ownership helpers. Prevents duplicate buttons and protects inline queue rows from card overlays.
import {
  ADD_BUTTON_CLASS,
  VIDEO_CARD_SELECTOR,
} from "../core/base.js";
import { parseVideoId } from "../../utils.js";
import { clearPlaylistSuccessTimer } from "./addFlow.js";

// Tracks which enhanced card owns an inline add button so recycled YouTube DOM nodes do not keep stale controls.
export function createCardButtonOwnership({
  overlays,
  previewOverlay,
  playlistSuccessTimers,
  inlineButtonsByVideoId,
  inlineButtonOwners,
}) {
  function forgetButtonVideo(button) {
    const previousVideoId = parseVideoId(button?.dataset?.videoId);
    if (previousVideoId) {
      inlineButtonsByVideoId.delete(previousVideoId);
    }
  }

  function removeOwnedButton(button) {
    if (!(button instanceof HTMLButtonElement)) return;
    clearPlaylistSuccessTimer(button, playlistSuccessTimers);
    forgetButtonVideo(button);
    if (previewOverlay.hasButton(button)) {
      previewOverlay.detach();
    }
    inlineButtonOwners.delete(button);
    button.remove();
  }

  function getButtonOwnerCard(button) {
    if (!(button instanceof HTMLButtonElement)) return null;
    const explicitOwner = inlineButtonOwners.get(button);
    if (explicitOwner instanceof HTMLElement) return explicitOwner;
    const closestCard = button.closest(VIDEO_CARD_SELECTOR);
    return closestCard instanceof HTMLElement ? closestCard : null;
  }

  function findCardOwnedButtons(card) {
    if (!(card instanceof HTMLElement)) return [];
    return Array.from(card.querySelectorAll(`.${ADD_BUTTON_CLASS}`)).filter(
      (button) => getButtonOwnerCard(button) === card
    );
  }

  function findCardPrimaryButton(card, overlay) {
    if (!(card instanceof HTMLElement)) return null;
    const directButton = overlays.findDirectOverlayButton(overlay);
    if (directButton && getButtonOwnerCard(directButton) === card) {
      return directButton;
    }
    const ownedButtons = findCardOwnedButtons(card);
    return ownedButtons.length ? ownedButtons[0] : null;
  }

  function removeExtraCardButtons(card, keepButton) {
    const ownedButtons = findCardOwnedButtons(card);
    ownedButtons.forEach((button) => {
      if (button !== keepButton) {
        removeOwnedButton(button);
      }
    });
  }

  function bindButtonTarget(button, target) {
    if (!(button instanceof HTMLButtonElement) || !target) return;
    const previousVideoId = parseVideoId(button.dataset.videoId);
    if (target.type === "playlist") {
      if (previousVideoId) {
        inlineButtonsByVideoId.delete(previousVideoId);
      }
      button.dataset.playlistId = target.id;
      delete button.dataset.videoId;
      button.title = "Добавить все видео плейлиста в очередь";
      if (previewOverlay.hasButton(button)) {
        previewOverlay.detach();
      }
      return;
    }
    if (previousVideoId && previousVideoId !== target.id) {
      inlineButtonsByVideoId.delete(previousVideoId);
    }
    button.dataset.videoId = target.id;
    delete button.dataset.playlistId;
    button.title = "Добавить в очередь расширения";
    inlineButtonsByVideoId.set(target.id, button);
  }

  return {
    bindButtonTarget,
    findCardOwnedButtons,
    findCardPrimaryButton,
    forgetButtonVideo,
    removeExtraCardButtons,
    removeOwnedButton,
  };
}
