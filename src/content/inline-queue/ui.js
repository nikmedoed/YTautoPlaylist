// Inline queue shell builder. Creates the watch-page container, toolbar, and shared handlers for the inline queue.
import { inlinePlaylistState } from "../core/base.js";
import { openListManager } from "./navigation.js";
import {
  cancelInlineQueueRenderRetry,
  disconnectInlineQueueWatchObserver,
  ensureInlineQueueLayoutListener,
  ensureInlineQueueWatchObserver,
  resolveInlineQueueHostElement,
} from "./layout.js";
import {
  clearInlineQueuePendingFocus,
  scrollElementBy,
} from "./scrollFocus.js";
import {
  hideInlineMoveMenu,
} from "./moveMenu.js";
import {
  resetInlineQueueDragState,
} from "./dragDrop.js";

const INLINE_QUEUE_SCROLL_EPSILON = 0.5;

export const inlineQueueUI = {
  container: null,
  brand: null,
  title: null,
  nowPlaying: null,
  progress: null,
  freeze: null,
  list: null,
  empty: null,
};

let shellHandlers = {
  handleInlineQueueDragEnd: null,
  handleInlineQueueDragOver: null,
  handleInlineQueueDragStart: null,
  handleInlineQueueDrop: null,
  handleInlineQueueListClick: null,
  handleInlineQueueListKeyDown: null,
};

export function configureInlineQueueUI(handlers = {}) {
  shellHandlers = { ...shellHandlers, ...handlers };
}

function handleInlineQueueTitleClick(event) {
  if (event) {
    event.preventDefault();
  }
  const target = event?.currentTarget;
  const listId =
    target?.dataset?.listId || inlinePlaylistState.currentListId || "";
  const listName =
    target?.dataset?.listName || inlinePlaylistState.currentListName || "";
  if (!listId) {
    return;
  }
  openListManager(listId, listName);
}

function handleInlineQueueTitleKeyDown(event) {
  if (!event) return;
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    handleInlineQueueTitleClick(event);
  }
}

function handleInlineQueueProgressClick(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  autoScrollInlineQueueToCurrentItem(inlinePlaylistState.currentVideoId || null);
}

function handleInlineQueueProgressKeyDown(event) {
  if (!event) {
    return;
  }
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    event.stopPropagation();
    autoScrollInlineQueueToCurrentItem(inlinePlaylistState.currentVideoId || null);
  }
}

export function resetInlineQueueUIRefs() {
  inlineQueueUI.container = null;
  inlineQueueUI.brand = null;
  inlineQueueUI.title = null;
  inlineQueueUI.nowPlaying = null;
  inlineQueueUI.progress = null;
  inlineQueueUI.freeze = null;
  inlineQueueUI.list = null;
  inlineQueueUI.empty = null;
}

export function teardownInlineQueueShell() {
  cancelInlineQueueRenderRetry();
  hideInlineMoveMenu();
  resetInlineQueueDragState();
  clearInlineQueuePendingFocus();
  if (inlineQueueUI.container && inlineQueueUI.container.isConnected) {
    inlineQueueUI.container.remove();
  }
  resetInlineQueueUIRefs();
  disconnectInlineQueueWatchObserver();
}

export function hideInlineQueueSoft() {
  cancelInlineQueueRenderRetry();
  hideInlineMoveMenu();
  resetInlineQueueDragState();
  clearInlineQueuePendingFocus();
  if (!inlineQueueUI.container) {
    return;
  }
  inlineQueueUI.container.hidden = true;
  inlineQueueUI.container.dataset.visible = "0";
}

function bindInlineQueueList(list) {
  if (!list.dataset.ytaInlineBound) {
    list.addEventListener("click", shellHandlers.handleInlineQueueListClick);
    list.addEventListener("keydown", shellHandlers.handleInlineQueueListKeyDown);
    list.addEventListener("dragstart", shellHandlers.handleInlineQueueDragStart);
    list.addEventListener("dragover", shellHandlers.handleInlineQueueDragOver);
    list.addEventListener("drop", shellHandlers.handleInlineQueueDrop);
    list.addEventListener("dragend", shellHandlers.handleInlineQueueDragEnd);
    list.dataset.ytaInlineBound = "1";
  }
}

function bindInlineQueueContainer(container) {
  if (!container.dataset.ytaInlineDragBound) {
    container.addEventListener("dragover", shellHandlers.handleInlineQueueDragOver);
    container.addEventListener("drop", shellHandlers.handleInlineQueueDrop);
    container.dataset.ytaInlineDragBound = "1";
  }
}

function createInlineQueueElements() {
  const container = document.createElement("section");
  container.className = "yta-inline-queue";
  container.dataset.visible = "0";
  container.dataset.empty = "1";
  container.hidden = true;

  const header = document.createElement("div");
  header.className = "yta-inline-queue__header";
  const headerLine = document.createElement("div");
  headerLine.className = "yta-inline-queue__header-line";

  const brand = document.createElement("span");
  brand.className = "yta-inline-queue__brand";
  brand.textContent = "YTautoPlaylist";
  headerLine.appendChild(brand);

  const title = document.createElement("span");
  title.className = "yta-inline-queue__title";
  title.textContent = "Главный плейлист";
  title.tabIndex = 0;
  title.setAttribute("role", "link");
  title.dataset.ytaInlineListTitle = "1";
  title.addEventListener("click", handleInlineQueueTitleClick);
  title.addEventListener("keydown", handleInlineQueueTitleKeyDown);
  headerLine.appendChild(title);

  const nowPlaying = document.createElement("span");
  nowPlaying.className = "yta-inline-queue__now-playing";
  nowPlaying.hidden = true;
  headerLine.appendChild(nowPlaying);

  const progress = document.createElement("span");
  progress.className = "yta-inline-queue__progress";
  progress.hidden = true;
  progress.tabIndex = -1;
  progress.setAttribute("role", "button");
  progress.addEventListener("click", handleInlineQueueProgressClick);
  progress.addEventListener("keydown", handleInlineQueueProgressKeyDown);
  progress.dataset.ytaInlineProgressBound = "1";
  headerLine.appendChild(progress);

  header.appendChild(headerLine);

  const freeze = document.createElement("span");
  freeze.className = "yta-inline-queue__freeze";
  freeze.hidden = true;
  header.appendChild(freeze);

  const list = document.createElement("ol");
  list.className = "yta-inline-queue__list video-list";
  list.setAttribute("role", "list");

  const empty = document.createElement("div");
  empty.className = "yta-inline-queue__empty";
  empty.textContent =
    "В очереди пока нет видео. Добавьте их через расширение.";

  container.append(header, empty, list);
  inlineQueueUI.container = container;
  inlineQueueUI.brand = brand;
  inlineQueueUI.title = title;
  inlineQueueUI.nowPlaying = nowPlaying;
  inlineQueueUI.progress = progress;
  inlineQueueUI.freeze = freeze;
  inlineQueueUI.list = list;
  inlineQueueUI.empty = empty;
  bindInlineQueueList(list);
  bindInlineQueueContainer(container);
}

export function ensureInlineQueueElements() {
  const resolved = resolveInlineQueueHostElement();
  if (!resolved) {
    return null;
  }

  ensureInlineQueueLayoutListener();
  ensureInlineQueueWatchObserver();

  if (!inlineQueueUI.container) {
    createInlineQueueElements();
  }

  const { host, placement } = resolved;
  if (!host || !inlineQueueUI.container) {
    return null;
  }

  const container = inlineQueueUI.container;
  let mounted = false;

  if (placement === "stack") {
    const below = document.getElementById("below");
    if (below instanceof HTMLElement && below.parentElement) {
      below.insertAdjacentElement("beforebegin", container);
      mounted = true;
    } else {
      const player = document.querySelector(
        "ytd-watch-flexy #player, ytd-watch-flexy ytd-player"
      );
      if (player instanceof HTMLElement && player.parentElement) {
        player.insertAdjacentElement("afterend", container);
        mounted = true;
      }
    }
  }

  if (!mounted && host instanceof HTMLElement) {
    if (container.parentElement !== host) {
      host.prepend(container);
    }
    mounted = true;
  }

  if (!mounted) {
    return null;
  }

  container.dataset.placement = placement;
  return inlineQueueUI;
}

function getInlineQueueCurrentItem(targetVideoId = null) {
  if (!inlineQueueUI.list) {
    return null;
  }
  if (targetVideoId) {
    const byId = inlineQueueUI.list.querySelector(
      `.video-item[data-video-id='${CSS.escape(targetVideoId)}']`
    );
    if (byId instanceof HTMLElement) {
      return byId;
    }
  }
  return (
    inlineQueueUI.list.querySelector(
      ".yta-inline-queue__item[data-current='1'] .video-item"
    ) || inlineQueueUI.list.querySelector(".video-item.active")
  );
}

function scrollInlineQueueToCurrentItem(targetVideoId = null) {
  if (!inlineQueueUI.list) {
    return false;
  }
  const currentItem = getInlineQueueCurrentItem(targetVideoId);
  if (!currentItem) {
    return false;
  }
  const list = inlineQueueUI.list;
  const listRect = list.getBoundingClientRect();
  const itemRect = currentItem.getBoundingClientRect();
  const delta = itemRect.top - listRect.top;
  if (Math.abs(delta) > INLINE_QUEUE_SCROLL_EPSILON) {
    scrollElementBy(list, delta);
  }
  if (typeof currentItem.focus === "function") {
    try {
      currentItem.focus({ preventScroll: true });
    } catch (_) {
      currentItem.focus();
    }
  }
  return true;
}

export function autoScrollInlineQueueToCurrentItem(targetVideoId = null) {
  return scrollInlineQueueToCurrentItem(targetVideoId);
}
