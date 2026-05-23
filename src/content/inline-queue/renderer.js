// Inline queue renderer. Converts queue state into row DOM and empty/loading states.
import { resolveProgressPercentFromMap } from "../../progress.js";
import { inlinePlaylistState, state } from "../core/base.js";
import { createInlineQueueItem } from "./item.js";
import {
  cancelInlineQueueRenderRetry,
  scheduleInlineQueueRenderRetry,
} from "./layout.js";
import {
  applyInlineQueuePendingFocus,
  getInlineQueuePendingScrollTop,
  restoreInlineQueueScroll,
  setInlineQueuePendingScrollTop,
} from "./scrollFocus.js";
import {
  autoScrollInlineQueueToCurrentItem,
  ensureInlineQueueElements,
  hideInlineQueueSoft,
  inlineQueueUI,
} from "./ui.js";

const inlineQueueCountFormatter = new Intl.NumberFormat("ru-RU");

export function resolveInlineQueueCurrentEntry({
  entries,
  currentIndex,
  currentVideoId,
}) {
  if (
    currentIndex !== null &&
    currentIndex >= 0 &&
    currentIndex < entries.length
  ) {
    return entries[currentIndex];
  }
  if (currentVideoId) {
    return entries.find((entry) => entry?.id === currentVideoId) || null;
  }
  return null;
}

// Updates the fixed shell metadata without rebuilding row nodes.
function updateHeader(ui, entries, currentIndex, currentVideoId, currentEntry) {
  if (ui.brand) {
    ui.brand.textContent = "YTautoPlaylist";
  }
  if (ui.title) {
    const listName = (inlinePlaylistState.currentListName || "").trim();
    ui.title.textContent = listName || "Главный плейлист";
    ui.title.dataset.listId = inlinePlaylistState.currentListId || "";
    ui.title.dataset.listName = listName || "";
    ui.title.setAttribute(
      "aria-label",
      listName
        ? `Открыть управление списком "${listName}"`
        : "Открыть управление списком"
    );
  }
  if (ui.nowPlaying) {
    const channelTitle = (currentEntry?.channelTitle || "").trim();
    const videoTitle = (currentEntry?.title || "").trim();
    const nowPlayingText = [channelTitle, videoTitle]
      .filter(Boolean)
      .join(" — ");
    if (nowPlayingText) {
      ui.nowPlaying.title = nowPlayingText;
      ui.nowPlaying.hidden = false;
      ui.nowPlaying.textContent = nowPlayingText;
    } else {
      ui.nowPlaying.textContent = "";
      ui.nowPlaying.removeAttribute("title");
      ui.nowPlaying.hidden = true;
    }
  }
  if (ui.progress) {
    let progressText = "";
    if (entries.length && currentIndex !== null && currentIndex < entries.length) {
      const currentNumber = inlineQueueCountFormatter.format(currentIndex + 1);
      const totalNumber = inlineQueueCountFormatter.format(entries.length);
      progressText = `Видео ${currentNumber} из ${totalNumber}`;
    } else if (currentVideoId && !inlinePlaylistState.videoIds.has(currentVideoId)) {
      progressText = "Смотрим другое видео";
    }
    if (progressText) {
      ui.progress.textContent = progressText;
      ui.progress.hidden = false;
      ui.progress.tabIndex = 0;
    } else {
      ui.progress.hidden = true;
      ui.progress.textContent = "";
      ui.progress.tabIndex = -1;
    }
  }
  if (ui.freeze) {
    if (inlinePlaylistState.freeze) {
      ui.freeze.textContent = "Автоочистка выключена";
      ui.freeze.hidden = false;
    } else {
      ui.freeze.hidden = true;
    }
  }
}

function renderItems(ui, entries, currentEntryId, options) {
  const allowPostpone = !inlinePlaylistState.freeze && entries.length > 1;
  entries.forEach((entry, index) => {
    if (!entry || typeof entry !== "object" || !entry.id) {
      return;
    }
    const isCurrent = Boolean(currentEntryId) && entry.id === currentEntryId;
    const item = createInlineQueueItem(entry, index, isCurrent, {
      allowPostpone,
      currentListId: inlinePlaylistState.currentListId,
      onHandlePointerDown: options.handleInlineQueueHandlePointerDown,
      progressPercent: resolveProgressPercentFromMap(
        inlinePlaylistState.progress,
        entry.id
      ),
    });
    ui.list.appendChild(item);
  });
}

// Owns only DOM refresh and scroll memory. Queue normalization stays in
// state.js so rendering does not reshuffle the same data again.
export function createInlineQueueRenderer(options = {}) {
  let lastAutoScrollVideoId = null;
  let lastAutoScrollListId = null;

  function resetAutoScrollState() {
    lastAutoScrollVideoId = null;
    lastAutoScrollListId = null;
  }

  function hideSoft() {
    hideInlineQueueSoft();
    resetAutoScrollState();
  }

  // Re-renders the mounted inline queue from the already-normalized state object.
  function updateInlineQueueUI() {
    const context =
      typeof options.determinePageContext === "function"
        ? options.determinePageContext()
        : "other";
    const controlsActive = Boolean(state && state.controlsActive);
    if (context !== "watch" || !controlsActive) {
      hideSoft();
      return;
    }
    if (
      typeof options.getCurrentVideoId === "function" &&
      inlinePlaylistState.currentVideoId
    ) {
      const pageVideoId = options.getCurrentVideoId();
      if (
        pageVideoId &&
        inlinePlaylistState.currentVideoId !== pageVideoId &&
        !inlinePlaylistState.videoIds.has(pageVideoId)
      ) {
        hideSoft();
        return;
      }
    }
    const ui = ensureInlineQueueElements();
    if (!ui) {
      scheduleInlineQueueRenderRetry();
      return;
    }
    cancelInlineQueueRenderRetry();
    options.hideInlineMoveMenu?.();
    options.resetInlineQueueDragState?.();

    const entries = Array.isArray(inlinePlaylistState.queueEntries)
      ? inlinePlaylistState.queueEntries
      : [];
    const currentIndex =
      typeof inlinePlaylistState.currentIndex === "number" &&
      inlinePlaylistState.currentIndex >= 0
        ? inlinePlaylistState.currentIndex
        : null;
    const currentVideoId = inlinePlaylistState.currentVideoId;
    const currentEntry = resolveInlineQueueCurrentEntry({
      entries,
      currentIndex,
      currentVideoId,
    });

    ui.container.hidden = false;
    ui.container.dataset.visible = "1";
    ui.container.dataset.listId = inlinePlaylistState.currentListId || "";

    updateHeader(ui, entries, currentIndex, currentVideoId, currentEntry);

    const previousScrollTop =
      ui.list && typeof ui.list.scrollTop === "number" ? ui.list.scrollTop : 0;
    const pendingScrollTop = getInlineQueuePendingScrollTop();
    const desiredScrollTop =
      pendingScrollTop !== null ? pendingScrollTop : previousScrollTop;
    ui.list.textContent = "";

    renderItems(ui, entries, currentEntry?.id || null, options);

    restoreInlineQueueScroll(ui.list, desiredScrollTop);
    applyInlineQueuePendingFocus();
    ui.container.dataset.empty = entries.length > 0 ? "0" : "1";
    const targetId = currentEntry?.id || null;
    const shouldAutoScroll =
      Boolean(targetId) &&
      (lastAutoScrollVideoId !== targetId ||
        lastAutoScrollListId !== (inlinePlaylistState.currentListId || null));
    if (shouldAutoScroll) {
      window.requestAnimationFrame(() => {
        if (autoScrollInlineQueueToCurrentItem(targetId) && inlineQueueUI.list) {
          lastAutoScrollVideoId = targetId;
          lastAutoScrollListId = inlinePlaylistState.currentListId || null;
          setInlineQueuePendingScrollTop(inlineQueueUI.list.scrollTop);
        }
      });
    }
  }

  return {
    hideInlineQueueSoft: hideSoft,
    resetAutoScrollState,
    updateInlineQueueUI,
  };
}
