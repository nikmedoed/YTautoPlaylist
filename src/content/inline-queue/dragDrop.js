// Inline queue drag-and-drop controller. Contains row dragging, target calculation, and reorder messaging.
import {
  inlinePlaylistState,
  sendMessage,
} from "../core/base.js";
import {
  clearInlineQueuePendingFocus,
  ensureInlineQueueFullyVisible,
  getInlineQueueList,
  maybeAutoScrollInlineQueueList,
  setInlineQueuePendingFocus,
} from "./scrollFocus.js";

const inlineQueueDragState = {
  videoId: null,
  dropIndex: null,
  draggingEl: null,
  pendingVideoId: null,
  pendingElement: null,
};

const inlineQueueAutoScrollState = {
  pointerY: null,
  rafId: null,
};

const INLINE_QUEUE_AUTO_SCROLL_THRESHOLD = 64;
const INLINE_QUEUE_AUTO_SCROLL_MAX_STEP = 18;

let inlineQueueDragDropContext = {
  hideInlineMoveMenu: null,
  updateInlinePlaylistState: null,
};

export function configureInlineQueueDragDrop(context = {}) {
  inlineQueueDragDropContext = {
    hideInlineMoveMenu:
      typeof context.hideInlineMoveMenu === "function"
        ? context.hideInlineMoveMenu
        : null,
    updateInlinePlaylistState:
      typeof context.updateInlinePlaylistState === "function"
        ? context.updateInlinePlaylistState
        : null,
  };
}

export function handleInlineQueueDragStart(event) {
  const handle = event.target.closest(".video-handle");
  if (!handle) {
    event.preventDefault();
    inlineQueueDragState.pendingVideoId = null;
    inlineQueueDragState.pendingElement = null;
    return;
  }
  const targetItem = handle.closest(".video-item");
  let item = targetItem instanceof HTMLElement ? targetItem : null;
  let videoId = item?.dataset?.videoId || null;
  if (
    inlineQueueDragState.pendingElement instanceof HTMLElement &&
    typeof inlineQueueDragState.pendingVideoId === "string" &&
    inlineQueueDragState.pendingVideoId
  ) {
    if (inlineQueueDragState.pendingElement.isConnected) {
      item = inlineQueueDragState.pendingElement;
      videoId = inlineQueueDragState.pendingVideoId;
    }
    inlineQueueDragState.pendingVideoId = null;
    inlineQueueDragState.pendingElement = null;
  }
  if (!item) {
    event.preventDefault();
    inlineQueueDragState.pendingVideoId = null;
    inlineQueueDragState.pendingElement = null;
    return;
  }
  if (typeof videoId !== "string" || !videoId) {
    event.preventDefault();
    inlineQueueDragState.pendingVideoId = null;
    inlineQueueDragState.pendingElement = null;
    return;
  }
  inlineQueueDragState.pendingVideoId = null;
  inlineQueueDragState.pendingElement = null;
  inlineQueueDragDropContext.hideInlineMoveMenu?.();
  inlineQueueDragState.videoId = videoId;
  inlineQueueDragState.dropIndex = null;
  inlineQueueDragState.draggingEl = item;
  item.classList.add("dragging");
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move";
    try {
      event.dataTransfer.setData("text/plain", videoId);
    } catch (_) {
      /* ignore */
    }
    if (item !== targetItem && item instanceof HTMLElement) {
      setInlineQueueDragImage(event, item);
    }
  }
}

function setInlineQueueDragImage(event, item) {
  try {
    const rect = item.getBoundingClientRect();
    const offsetX =
      typeof event.clientX === "number"
        ? event.clientX - rect.left
        : rect.width / 2;
    const offsetY =
      typeof event.clientY === "number"
        ? event.clientY - rect.top
        : rect.height / 2;
    event.dataTransfer.setDragImage(item, offsetX, offsetY);
  } catch (_) {
    try {
      event.dataTransfer.setDragImage(item, 0, 0);
    } catch (__) {
      /* ignore */
    }
  }
}

export function handleInlineQueueHandlePointerDown(event) {
  if (!event) {
    return;
  }
  if (event.type === "mousedown" && typeof window.PointerEvent === "function") {
    return;
  }
  if (typeof event.button === "number" && event.button !== 0) {
    return;
  }
  const handle =
    event.currentTarget instanceof HTMLElement
      ? event.currentTarget
      : event.target instanceof HTMLElement
        ? event.target.closest(".video-handle")
        : null;
  const item = handle instanceof HTMLElement ? handle.closest(".video-item") : null;
  if (item instanceof HTMLElement && item.dataset.videoId) {
    inlineQueueDragState.pendingVideoId = item.dataset.videoId;
    inlineQueueDragState.pendingElement = item;
  } else {
    inlineQueueDragState.pendingVideoId = null;
    inlineQueueDragState.pendingElement = null;
  }
  ensureInlineQueueFullyVisible();
}

export function handleInlineQueueDragOver(event) {
  if (!inlineQueueDragState.videoId) {
    return;
  }
  event.preventDefault();
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = "move";
  }
  const pointerY = event.clientY;
  const scrolledNow = maybeAutoScrollInlineQueueList(
    pointerY,
    INLINE_QUEUE_AUTO_SCROLL_THRESHOLD,
    INLINE_QUEUE_AUTO_SCROLL_MAX_STEP
  );
  scheduleInlineQueueAutoScroll(pointerY, scrolledNow);
  clearInlineQueueDropIndicators();
  const list = getInlineQueueList();
  if (!list) {
    inlineQueueDragState.dropIndex = null;
    return;
  }
  const targetItem = event.target.closest(".video-item");
  const items = Array.from(list.querySelectorAll(".video-item"));
  if (!targetItem || targetItem === inlineQueueDragState.draggingEl) {
    const dropTarget = computeInlineQueuePointerDropTarget(pointerY, items);
    inlineQueueDragState.dropIndex = dropTarget.index;
    if (dropTarget.element) {
      dropTarget.element.classList.add(
        dropTarget.before ? "drop-before" : "drop-after"
      );
    }
    return;
  }
  const rect = targetItem.getBoundingClientRect();
  const before = event.clientY < rect.top + rect.height / 2;
  targetItem.classList.add(before ? "drop-before" : "drop-after");
  const baseIndex = items.indexOf(targetItem);
  inlineQueueDragState.dropIndex = before ? baseIndex : baseIndex + 1;
}

export function handleInlineQueueDrop(event) {
  if (!inlineQueueDragState.videoId) {
    return;
  }
  event.preventDefault();
  const queueIds = Array.isArray(inlinePlaylistState.orderedVideoIds)
    ? inlinePlaylistState.orderedVideoIds
    : [];
  const videoId = inlineQueueDragState.videoId;
  const fromIndex = queueIds.indexOf(videoId);
  if (fromIndex === -1) {
    resetInlineQueueDragState();
    return;
  }
  let targetIndex = inlineQueueDragState.dropIndex;
  if (typeof targetIndex !== "number") {
    targetIndex = resolveInlineQueueDropIndex(event, queueIds.length);
  }
  const bounded = Math.max(0, Math.min(queueIds.length, Number(targetIndex)));
  resetInlineQueueDragState();
  if (bounded === fromIndex || bounded === fromIndex + 1) {
    return;
  }
  const desiredIndex = bounded > fromIndex ? bounded - 1 : bounded;
  const adjustedIndex = Math.max(
    0,
    Math.min(queueIds.length - 1, Number.isFinite(desiredIndex) ? desiredIndex : 0)
  );
  if (adjustedIndex === fromIndex) {
    return;
  }
  reorderInlineQueueVideo(videoId, adjustedIndex);
}

function resolveInlineQueueDropIndex(event, fallbackIndex) {
  const direct = event.target.closest(".video-item");
  const list = getInlineQueueList();
  if (!direct || !list) {
    return fallbackIndex;
  }
  const items = Array.from(list.querySelectorAll(".video-item"));
  const rect = direct.getBoundingClientRect();
  const before = event.clientY < rect.top + rect.height / 2;
  const baseIndex = items.indexOf(direct);
  return before ? baseIndex : baseIndex + 1;
}

function reorderInlineQueueVideo(videoId, targetIndex) {
  const payload = { videoId, targetIndex };
  if (inlinePlaylistState.currentListId) {
    payload.listId = inlinePlaylistState.currentListId;
  }
  setInlineQueuePendingFocus(videoId);
  sendMessage("playlist:reorder", payload)
    .then((state) => {
      if (state && typeof state === "object") {
        inlineQueueDragDropContext.updateInlinePlaylistState?.(state);
      } else {
        clearInlineQueuePendingFocus();
      }
    })
    .catch((err) => {
      console.warn("Failed to reorder inline queue", err);
      clearInlineQueuePendingFocus();
    });
}

export function handleInlineQueueDragEnd() {
  resetInlineQueueDragState();
}

function clearInlineQueueDropIndicators() {
  const list = getInlineQueueList();
  if (!list) {
    return;
  }
  list
    .querySelectorAll(".drop-before, .drop-after")
    .forEach((el) => el.classList.remove("drop-before", "drop-after"));
}

export function resetInlineQueueDragState() {
  stopInlineQueueAutoScroll();
  if (inlineQueueDragState.draggingEl) {
    inlineQueueDragState.draggingEl.classList.remove("dragging");
  }
  clearInlineQueueDropIndicators();
  inlineQueueDragState.videoId = null;
  inlineQueueDragState.dropIndex = null;
  inlineQueueDragState.draggingEl = null;
  inlineQueueDragState.pendingVideoId = null;
  inlineQueueDragState.pendingElement = null;
}

function computeInlineQueuePointerDropTarget(pointerY, items) {
  if (!Array.isArray(items) || !items.length) {
    return { index: 0, element: null, before: null };
  }
  const pointer = Number(pointerY);
  const resolvedPointer = Number.isFinite(pointer) ? pointer : 0;
  let fallback = null;
  for (let i = 0; i < items.length; i += 1) {
    const element = items[i];
    if (element === inlineQueueDragState.draggingEl) {
      continue;
    }
    const rect = element.getBoundingClientRect();
    const before = resolvedPointer < rect.top + rect.height / 2;
    if (before) {
      return { index: i, element, before: true };
    }
    fallback = { index: i + 1, element, before: false };
  }
  if (fallback) {
    return fallback;
  }
  return { index: 0, element: null, before: null };
}

function runInlineQueueAutoScroll() {
  inlineQueueAutoScrollState.rafId = null;
  if (!inlineQueueDragState.videoId) {
    inlineQueueAutoScrollState.pointerY = null;
    return;
  }
  const pointerY = inlineQueueAutoScrollState.pointerY;
  if (typeof pointerY !== "number") {
    return;
  }
  const scrolled = maybeAutoScrollInlineQueueList(
    pointerY,
    INLINE_QUEUE_AUTO_SCROLL_THRESHOLD,
    INLINE_QUEUE_AUTO_SCROLL_MAX_STEP
  );
  if (!scrolled) {
    inlineQueueAutoScrollState.pointerY = null;
    return;
  }
  inlineQueueAutoScrollState.rafId = window.requestAnimationFrame(
    runInlineQueueAutoScroll
  );
}

function scheduleInlineQueueAutoScroll(pointerY, alreadyScrolled) {
  if (typeof pointerY !== "number") {
    return;
  }
  inlineQueueAutoScrollState.pointerY = pointerY;
  if (alreadyScrolled && inlineQueueAutoScrollState.rafId) {
    return;
  }
  if (!inlineQueueAutoScrollState.rafId) {
    inlineQueueAutoScrollState.rafId = window.requestAnimationFrame(
      runInlineQueueAutoScroll
    );
  }
}

function stopInlineQueueAutoScroll() {
  if (inlineQueueAutoScrollState.rafId) {
    window.cancelAnimationFrame(inlineQueueAutoScrollState.rafId);
    inlineQueueAutoScrollState.rafId = null;
  }
  inlineQueueAutoScrollState.pointerY = null;
}
