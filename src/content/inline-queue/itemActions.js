// Inline queue item action handlers. Contains play, remove, postpone, and move behavior for queue rows.
import {
  inlinePlaylistState,
  sendMessage,
} from "../core/base.js";
import { openQuickFilterForVideo } from "./navigation.js";
import {
  finishInlineQueueRemovals,
  markInlineQueueRemovalPending,
  releaseInlineQueueRenderLock,
} from "./pendingRemovals.js";

const INLINE_QUEUE_REMOVE_BATCH_DELAY_MS = 240;
const queuedRemovalIdsByList = new Map();
const removalBatchTimers = new Map();
const flushingRemovalLists = new Set();

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

export function requireInlineQueueResponse(response) {
  if (!response || typeof response !== "object") {
    throw new Error("QUEUE_ACTION_NO_RESPONSE");
  }
  if (response.error) {
    throw new Error(String(response.error));
  }
  return response;
}

function scheduleInlineQueueRemovalBatch(listId, context) {
  if (removalBatchTimers.has(listId) || flushingRemovalLists.has(listId)) {
    return;
  }
  const timer = window.setTimeout(() => {
    removalBatchTimers.delete(listId);
    void flushInlineQueueRemovalBatch(listId, context);
  }, INLINE_QUEUE_REMOVE_BATCH_DELAY_MS);
  removalBatchTimers.set(listId, timer);
}

async function flushInlineQueueRemovalBatch(listId, context) {
  if (flushingRemovalLists.has(listId)) {
    return;
  }
  const queuedIds = queuedRemovalIdsByList.get(listId);
  if (!queuedIds?.size) {
    return;
  }
  const videoIds = Array.from(queuedIds);
  queuedRemovalIdsByList.delete(listId);
  flushingRemovalLists.add(listId);
  try {
    const response = requireInlineQueueResponse(
      await sendMessage("playlist:remove", { videoIds, listId })
    );
    finishInlineQueueRemovals(listId, videoIds);
    context.updateInlinePlaylistState?.(response);
  } catch (err) {
    console.warn("Failed to remove videos from inline queue", err);
    finishInlineQueueRemovals(listId, videoIds);
    releaseInlineQueueRenderLock(listId);
    await context.refreshInlinePlaylistState?.();
  } finally {
    flushingRemovalLists.delete(listId);
    if (queuedRemovalIdsByList.get(listId)?.size) {
      scheduleInlineQueueRemovalBatch(listId, context);
    }
  }
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
  const row = videoItem.closest(".yta-inline-queue__item") || videoItem;
  const listId = inlinePlaylistState.currentListId || null;
  if (!listId) {
    return;
  }
  markInlineQueueRemovalPending(listId, videoId);
  row.remove();
  let queuedIds = queuedRemovalIdsByList.get(listId);
  if (!queuedIds) {
    queuedIds = new Set();
    queuedRemovalIdsByList.set(listId, queuedIds);
  }
  queuedIds.add(videoId);
  scheduleInlineQueueRemovalBatch(listId, context);
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
  const row = videoItem.closest(".yta-inline-queue__item") || videoItem;
  const parent = row.parentNode;
  const nextSibling = row.nextSibling;
  target.dataset.loading = "1";
  target.disabled = true;
  parent?.appendChild(row);
  context.setInlineQueuePendingFocus?.(focusTargetId || videoId);
  const request = isCurrent
    ? sendMessage("playlist:postpone", { videoId })
    : sendMessage("playlist:postponeVideo", { videoId, listId });
  request
    .then((response) => {
      requireInlineQueueResponse(response);
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
      if (parent) {
        parent.insertBefore(row, nextSibling?.parentNode === parent ? nextSibling : null);
      }
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

function copyInlineQueueVideoLink(button) {
  const videoId = button.closest(".video-item")?.dataset.videoId;
  if (!videoId) {
    return;
  }
  const originalTitle = button.title;
  navigator.clipboard
    .writeText(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`)
    .then(() => {
      button.title = "Ссылка скопирована";
      window.setTimeout(() => {
        if (button.isConnected) {
          button.title = originalTitle;
        }
      }, 1800);
    })
    .catch((err) => {
      console.warn("Failed to copy video link", err);
    });
}

export function handleInlineQueueListClick(event, context = {}) {
  const copyLinkBtn = event.target.closest(".video-copy-link");
  if (copyLinkBtn) {
    event.preventDefault();
    event.stopPropagation();
    copyInlineQueueVideoLink(copyLinkBtn);
    return;
  }
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
