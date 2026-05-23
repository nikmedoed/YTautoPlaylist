// Video-card add button builder. Creates the overlay button and updates its loading/added states.
import { ADD_BUTTON_CLASS, inlinePlaylistState } from "../core/base.js";
import { isVideoInCurrentList, syncInlineButtonState } from "../inline-queue/index.js";
import {
  applyInlineAddResponse,
  clearPlaylistSuccessTimer,
  sendInlineAddRequest,
  showPlaylistSuccess,
} from "./addFlow.js";

export function createAddButtonController({
  bindButtonTarget,
  overlays,
  playlistSuccessTimers,
  resolveFreshTargetForButton,
}) {
  async function handleAddButtonClick(event, button) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    const freshTarget = resolveFreshTargetForButton(button);
    if (!freshTarget) return;
    bindButtonTarget(button, freshTarget);
    const videoId = button.dataset.videoId;
    const playlistId = button.dataset.playlistId;
    if (!videoId && !playlistId) return;
    if (button.dataset.ytaStatus === "pending") return;
    if (
      videoId &&
      (button.dataset.ytaStatus === "present" || isVideoInCurrentList(videoId))
    ) {
      return;
    }
    clearPlaylistSuccessTimer(button, playlistSuccessTimers);
    const startedAt = playlistId ? Date.now() : 0;
    let addMetrics = { added: 0, requested: null, missing: 0 };
    button.dataset.ytaStatus = "pending";
    button.disabled = true;
    syncInlineButtonState(button);
    try {
      const response = await sendInlineAddRequest({
        playlistId,
        videoId,
        listId: inlinePlaylistState.currentListId || undefined,
      });
      addMetrics = await applyInlineAddResponse(response);
    } catch (err) {
      delete button.dataset.ytaStatus;
      button.disabled = false;
      syncInlineButtonState(button);
      return;
    }
    if (playlistId) {
      showPlaylistSuccess(
        button,
        addMetrics,
        startedAt ? Date.now() - startedAt : 0,
        playlistSuccessTimers
      );
    } else {
      delete button.dataset.ytaStatus;
      syncInlineButtonState(button);
    }
  }

  function createAddButton(overlay, overlayHost) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = ADD_BUTTON_CLASS;
    button.addEventListener("click", (event) => {
      void handleAddButtonClick(event, button);
    }, true);
    overlay.appendChild(button);
    overlays.observeInlineOverlay(overlayHost, button);
    return button;
  }

  return { createAddButton };
}
