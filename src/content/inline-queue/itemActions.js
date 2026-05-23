// Inline queue item action handlers. Contains play, remove, postpone, and move behavior for queue rows.
import {
  inlinePlaylistState,
  sendMessage,
} from "../core/base.js";
import { openQuickFilterForVideo } from "./navigation.js";

function activateInlineQueueItem(node) {
  const videoItem = node instanceof HTMLElement ? node : null;
  if (!videoItem) {
    return;
  }
  if (videoItem.dataset.loading === "1") {
    return;
  }
  const videoId = videoItem.dataset.videoId;
  if (!videoId) {
    return;
  }
  videoItem.dataset.loading = "1";
  const payload = { videoId };
  if (inlinePlaylistState.currentListId) {
    payload.listId = inlinePlaylistState.currentListId;
  }
  sendMessage("playlist:play", payload)
    .catch((err) => {
      console.warn("Failed to start playback from inline queue", err);
    })
    .finally(() => {
      if (!videoItem.isConnected) {
        return;
      }
      delete videoItem.dataset.loading;
    });
}

function resolveInlineQueuePostponeFocusTarget(videoItem) {
  if (!(videoItem instanceof HTMLElement)) {
    return null;
  }
  const container = videoItem.closest(".yta-inline-queue__item");
  if (!(container instanceof HTMLElement)) {
    return null;
  }
  let sibling = container.nextElementSibling;
  while (sibling instanceof HTMLElement) {
    const candidate = sibling.querySelector(".video-item");
    if (candidate instanceof HTMLElement && candidate.dataset.videoId) {
      return candidate.dataset.videoId;
    }
    sibling = sibling.nextElementSibling;
  }
  sibling = container.previousElementSibling;
  while (sibling instanceof HTMLElement) {
    const candidate = sibling.querySelector(".video-item");
    if (candidate instanceof HTMLElement && candidate.dataset.videoId) {
      return candidate.dataset.videoId;
    }
    sibling = sibling.previousElementSibling;
  }
  return null;
}

function handleInlineQueueRemove(button, context = {}) {
  const target = button instanceof HTMLButtonElement ? button : null;
  if (!target || target.dataset.loading === "1") {
    return;
  }
  const videoItem = target.closest(".video-item");
  if (!videoItem) {
    return;
  }
  const videoId = videoItem.dataset.videoId;
  if (!videoId) {
    return;
  }
  const focusTargetId = resolveInlineQueuePostponeFocusTarget(videoItem);
  target.dataset.loading = "1";
  target.disabled = true;
  context.setInlineQueuePendingFocus?.(focusTargetId || videoId);
  const payload = { videoId };
  if (inlinePlaylistState.currentListId) {
    payload.listId = inlinePlaylistState.currentListId;
  }
  sendMessage("playlist:remove", payload)
    .then((state) => {
      if (state && typeof state === "object") {
        context.updateInlinePlaylistState?.(state);
      }
    })
    .catch((err) => {
      console.warn("Failed to remove video from inline queue", err);
    })
    .finally(() => {
      if (!target.isConnected) {
        return;
      }
      target.disabled = false;
      delete target.dataset.loading;
    });
}

function handleInlineQueuePostpone(button, context = {}) {
  const target = button instanceof HTMLButtonElement ? button : null;
  if (!target || target.dataset.loading === "1") {
    return;
  }
  const videoItem = target.closest(".video-item");
  if (!videoItem) {
    return;
  }
  const videoId = videoItem.dataset.videoId;
  if (!videoId) {
    return;
  }
  const listId = inlinePlaylistState.currentListId || null;
  const isCurrent = videoId === inlinePlaylistState.currentVideoId;
  const focusTargetId = resolveInlineQueuePostponeFocusTarget(videoItem);
  target.dataset.loading = "1";
  target.disabled = true;
  context.setInlineQueuePendingFocus?.(focusTargetId || videoId);
  const request = isCurrent
    ? sendMessage("playlist:postpone", { videoId })
    : sendMessage("playlist:postponeVideo", { videoId, listId });
  request
    .then((response) => {
      if (!response) {
        context.clearInlineQueuePendingFocus?.();
        return;
      }
      if (isCurrent) {
        if (response.handled === false) {
          context.clearInlineQueuePendingFocus?.();
          return;
        }
        const presentation = response.state || response;
        if (presentation && typeof presentation === "object") {
          context.updateInlinePlaylistState?.(presentation);
        } else {
          context.clearInlineQueuePendingFocus?.();
        }
      } else if (typeof response === "object") {
        context.updateInlinePlaylistState?.(response);
      } else {
        context.clearInlineQueuePendingFocus?.();
      }
    })
    .catch((err) => {
      console.warn("Failed to postpone video from inline queue", err);
      context.clearInlineQueuePendingFocus?.();
    })
    .finally(() => {
      if (!target.isConnected) {
        return;
      }
      target.disabled = false;
      delete target.dataset.loading;
    });
}

function handleInlineQueueMove(button, context = {}) {
  const target = button instanceof HTMLButtonElement ? button : null;
  if (!target) {
    return;
  }
  const videoItem = target.closest(".video-item");
  if (!videoItem) {
    return;
  }
  const videoId = videoItem.dataset.videoId;
  if (!videoId) {
    return;
  }
  context.showInlineMoveMenu?.(videoId, inlinePlaylistState.currentListId, target);
}

export function handleInlineQueueListClick(event, context = {}) {
  const quickFilterBtn = event.target.closest(".video-quick-filter");
  if (quickFilterBtn) {
    event.preventDefault();
    event.stopPropagation();
    const videoItem = quickFilterBtn.closest(".video-item");
    const videoId =
      quickFilterBtn.dataset.videoId || videoItem?.dataset.videoId || "";
    if (videoId) {
      openQuickFilterForVideo(videoId);
    }
    return;
  }
  const removeBtn = event.target.closest(".video-remove");
  if (removeBtn) {
    event.preventDefault();
    event.stopPropagation();
    handleInlineQueueRemove(removeBtn, context);
    return;
  }
  const postponeBtn = event.target.closest(".video-postpone");
  if (postponeBtn) {
    event.preventDefault();
    event.stopPropagation();
    handleInlineQueuePostpone(postponeBtn, context);
    return;
  }
  const moveBtn = event.target.closest(".video-move");
  if (moveBtn) {
    event.preventDefault();
    event.stopPropagation();
    handleInlineQueueMove(moveBtn, context);
    return;
  }
  if (event.target.closest(".video-handle")) {
    return;
  }
  const videoItem = event.target.closest(".video-item");
  if (!videoItem) {
    return;
  }
  event.preventDefault();
  context.hideInlineMoveMenu?.();
  activateInlineQueueItem(videoItem);
}

export function handleInlineQueueListKeyDown(event, context = {}) {
  if (event.defaultPrevented) {
    return;
  }
  const videoItem = event.target.closest(".video-item");
  if (!videoItem) {
    return;
  }
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    context.hideInlineMoveMenu?.();
    activateInlineQueueItem(videoItem);
  }
}
