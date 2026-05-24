// Inline queue scroll helper. Keeps the active or recently changed item visible after state updates.
import { inlinePlaylistState } from "../core/base.js";

const INLINE_QUEUE_SCROLL_EPSILON = 0.5;

let inlineQueuePendingFocusId = null;
let inlineQueuePendingFocusListId = null;
let inlineQueuePendingScrollTop = null;
let inlineQueueScrollFocusContext = {
  getInlineQueueUI: null,
};

export function configureInlineQueueScrollFocus(context = {}) {
  inlineQueueScrollFocusContext = {
    getInlineQueueUI:
      typeof context.getInlineQueueUI === "function"
        ? context.getInlineQueueUI
        : null,
  };
}

function getInlineQueueUI() {
  return inlineQueueScrollFocusContext.getInlineQueueUI?.() || {};
}

export function getInlineQueueList() {
  const ui = getInlineQueueUI();
  return ui.list instanceof HTMLElement ? ui.list : null;
}

function getInlineQueueContainer() {
  const ui = getInlineQueueUI();
  return ui.container instanceof HTMLElement ? ui.container : null;
}

export function setInlineQueuePendingFocus(videoId) {
  if (typeof videoId !== "string" || !videoId) {
    return;
  }
  inlineQueuePendingFocusId = videoId;
  inlineQueuePendingFocusListId = inlinePlaylistState.currentListId || null;
  const list = getInlineQueueList();
  if (list && typeof list.scrollTop === "number") {
    inlineQueuePendingScrollTop = list.scrollTop;
  } else {
    inlineQueuePendingScrollTop = null;
  }
}

export function clearInlineQueuePendingFocus() {
  inlineQueuePendingFocusId = null;
  inlineQueuePendingFocusListId = null;
  inlineQueuePendingScrollTop = null;
}

export function getInlineQueuePendingScrollTop() {
  return inlineQueuePendingScrollTop;
}

export function setInlineQueuePendingScrollTop(scrollTop) {
  inlineQueuePendingScrollTop =
    typeof scrollTop === "number" && Number.isFinite(scrollTop)
      ? scrollTop
      : null;
}

export function scrollElementBy(element, delta) {
  if (!element || typeof element.scrollTop !== "number") {
    return false;
  }
  const { scrollHeight, clientHeight } = element;
  if (!Number.isFinite(scrollHeight) || !Number.isFinite(clientHeight)) {
    return false;
  }
  const maxScroll = Math.max(0, scrollHeight - clientHeight);
  if (maxScroll <= INLINE_QUEUE_SCROLL_EPSILON) {
    return false;
  }
  const prev = element.scrollTop;
  const next = Math.max(0, Math.min(maxScroll, prev + delta));
  if (Math.abs(next - prev) <= INLINE_QUEUE_SCROLL_EPSILON) {
    return false;
  }
  element.scrollTop = next;
  return Math.abs(element.scrollTop - prev) > INLINE_QUEUE_SCROLL_EPSILON;
}

function getInlineQueueParent(node) {
  if (!node) {
    return null;
  }
  if (node.parentElement instanceof HTMLElement) {
    return node.parentElement;
  }
  if (
    typeof ShadowRoot !== "undefined" &&
    node.parentNode &&
    node.parentNode instanceof ShadowRoot
  ) {
    return node.parentNode.host || null;
  }
  return null;
}

function maybeScrollInlineQueueAncestors(delta) {
  let current = getInlineQueueContainer();
  while (current) {
    if (scrollElementBy(current, delta)) {
      return true;
    }
    current = getInlineQueueParent(current);
    if (!current || current === document.body || current === document.documentElement) {
      break;
    }
  }
  return false;
}

function maybeScrollDocument(delta) {
  const scrollingElement =
    document.scrollingElement || document.documentElement || document.body;
  if (!scrollingElement) {
    return false;
  }
  const prev = scrollingElement.scrollTop;
  const maxScroll = Math.max(
    0,
    scrollingElement.scrollHeight - scrollingElement.clientHeight
  );
  if (maxScroll <= INLINE_QUEUE_SCROLL_EPSILON) {
    return false;
  }
  const next = Math.max(0, Math.min(maxScroll, prev + delta));
  if (Math.abs(next - prev) <= INLINE_QUEUE_SCROLL_EPSILON) {
    return false;
  }
  scrollingElement.scrollTop = next;
  return Math.abs(scrollingElement.scrollTop - prev) > INLINE_QUEUE_SCROLL_EPSILON;
}

export function ensureInlineQueueFullyVisible() {
  const container = getInlineQueueContainer();
  if (!container) {
    return false;
  }
  const viewportHeight =
    window.innerHeight ||
    (document.documentElement && document.documentElement.clientHeight) ||
    0;
  if (!viewportHeight) {
    return false;
  }
  const rect = container.getBoundingClientRect();
  if (rect.top < 0) {
    if (Math.abs(rect.top) <= INLINE_QUEUE_SCROLL_EPSILON) {
      return false;
    }
    return maybeScrollDocument(rect.top);
  }
  if (rect.bottom > viewportHeight) {
    const delta = rect.bottom - viewportHeight;
    if (Math.abs(delta) <= INLINE_QUEUE_SCROLL_EPSILON) {
      return false;
    }
    return maybeScrollDocument(delta);
  }
  return false;
}

function maybeScrollDocumentForInlineQueue(delta) {
  const container = getInlineQueueContainer();
  if (!container || typeof delta !== "number" || delta === 0) {
    return false;
  }
  const viewportHeight =
    window.innerHeight ||
    (document.documentElement && document.documentElement.clientHeight) ||
    0;
  if (!viewportHeight) {
    return maybeScrollDocument(delta);
  }
  const rect = container.getBoundingClientRect();
  if (delta < 0) {
    if (rect.top >= 0) {
      return false;
    }
    if (Math.abs(rect.top) <= INLINE_QUEUE_SCROLL_EPSILON) {
      return false;
    }
    return maybeScrollDocument(rect.top);
  }
  if (delta > 0) {
    if (rect.bottom <= viewportHeight) {
      return false;
    }
    const needed = rect.bottom - viewportHeight;
    if (Math.abs(needed) <= INLINE_QUEUE_SCROLL_EPSILON) {
      return false;
    }
    return maybeScrollDocument(needed);
  }
  return false;
}

export function maybeAutoScrollInlineQueueList(
  pointerY,
  threshold,
  maxStep
) {
  const list = getInlineQueueList();
  if (!list || typeof pointerY !== "number") {
    return false;
  }
  const { scrollHeight, clientHeight } = list;
  if (scrollHeight <= clientHeight) {
    return false;
  }
  const rect = list.getBoundingClientRect();
  const topDistance = pointerY - rect.top;
  const bottomDistance = rect.bottom - pointerY;
  let delta = 0;
  if (topDistance <= threshold) {
    const distance = Math.max(0, topDistance);
    const intensity = (threshold - distance) / threshold;
    delta = -Math.ceil(intensity * maxStep);
  } else if (bottomDistance <= threshold) {
    const distance = Math.max(0, bottomDistance);
    const intensity = (threshold - distance) / threshold;
    delta = Math.ceil(intensity * maxStep);
  }
  if (delta !== 0) {
    if (scrollElementBy(list, delta)) {
      return true;
    }
    if (maybeScrollInlineQueueAncestors(delta)) {
      return true;
    }
    if (maybeScrollDocumentForInlineQueue(delta)) {
      return true;
    }
  }
  return false;
}

export function restoreInlineQueueScroll(list, desiredScrollTop) {
  if (!list || typeof list.scrollTop !== "number") {
    return;
  }
  const scrollHeight = Number(list.scrollHeight) || 0;
  const clientHeight = Number(list.clientHeight) || 0;
  const maxScroll = Math.max(0, scrollHeight - clientHeight);
  const rawTarget = Number(desiredScrollTop);
  const target = Number.isFinite(rawTarget)
    ? Math.max(0, Math.min(maxScroll, rawTarget))
    : Math.max(0, Math.min(maxScroll, list.scrollTop));
  if (Math.abs(list.scrollTop - target) > INLINE_QUEUE_SCROLL_EPSILON) {
    list.scrollTop = target;
  }
}

export function applyInlineQueuePendingFocus() {
  const list = getInlineQueueList();
  if (!inlineQueuePendingFocusId || !list) {
    clearInlineQueuePendingFocus();
    return;
  }
  const expectedListId = inlineQueuePendingFocusListId || null;
  const currentListId = inlinePlaylistState.currentListId || null;
  if (expectedListId !== null && expectedListId !== currentListId) {
    clearInlineQueuePendingFocus();
    return;
  }
  const items = list.querySelectorAll(".video-item");
  let target = null;
  for (const element of items) {
    if (
      element instanceof HTMLElement &&
      element.dataset.videoId === inlineQueuePendingFocusId
    ) {
      target = element;
      break;
    }
  }
  if (target) {
    if (typeof target.focus === "function") {
      try {
        target.focus({ preventScroll: true });
      } catch {
        target.focus();
      }
    }
    if (typeof target.getBoundingClientRect === "function") {
      const listRect = list.getBoundingClientRect();
      const itemRect = target.getBoundingClientRect();
      if (itemRect.top < listRect.top || itemRect.bottom > listRect.bottom) {
        if (typeof target.scrollIntoView === "function") {
          target.scrollIntoView({ block: "nearest" });
        }
      }
    }
  }
  clearInlineQueuePendingFocus();
}
