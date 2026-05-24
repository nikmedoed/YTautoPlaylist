// Popup queue controller. Renders the current queue, empty state, row actions, active item, and drag integration.
import { getProgressPercent } from "../../../progress.js";
import { createVideoItem } from "../../lib/videoItem.js";
import { buildDetailParts } from "../../lib/detailParts.js";
import { openQuickFilter } from "../../lib/quickFilter.js";
import { createDragReorderController } from "../../lib/dragReorder.js";

// Owns popup queue rendering, row actions, active markers, and queue reorder messages.
export function createQueueController({
  queueList,
  queueEmpty,
  queueFreezeIndicator,
  fallbackThumbnail,
  showMoveMenu = () => {},
  hideMoveMenu = () => {},
  setStatus = () => {},
  sendMessage,
  onStateChange = () => {},
  getPlaylistState = () => null,
  defaultListId = "default",
}) {
  if (!queueList || typeof sendMessage !== "function") {
    return { render() {} };
  }

  const dragController = createDragReorderController({
    container: queueList,
    itemSelector: ".video-item",
    attachNativeEvents: true,
    skipDraggedItemInIndicator: true,
    getQueue: () => {
      const playlistState = getPlaylistState();
      return Array.isArray(playlistState?.currentQueue?.queue)
        ? playlistState.currentQueue.queue
        : [];
    },
    getActiveListId: () => {
      const playlistState = getPlaylistState();
      return playlistState?.currentQueue?.id || null;
    },
    getItemListId: (item) => {
      const playlistState = getPlaylistState();
      return item.dataset.listId || playlistState?.currentQueue?.id || null;
    },
    onReorder: async ({ videoId, targetIndex, listId }) => {
      try {
        const state = await sendMessage("playlist:reorder", {
          videoId,
          targetIndex,
          listId,
        });
        if (state) {
          onStateChange(state);
          setStatus("Порядок обновлён", "info");
        }
      } catch (err) {
        console.error(err);
        setStatus("Не удалось изменить порядок", "error", 3000);
      }
    },
  });

  async function removeQueueItem(item) {
    hideMoveMenu();
    if (!item) return;
    const videoId = item.dataset.id;
    if (!videoId) return;
    const playlistState = getPlaylistState();
    const listId = item.dataset.listId || playlistState?.currentQueue?.id;
    try {
      const state = await sendMessage("playlist:remove", { videoId, listId });
      if (state) {
        onStateChange(state);
        setStatus("Видео удалено", "info");
      }
    } catch (err) {
      console.error(err);
      setStatus("Не удалось удалить видео", "error", 3000);
    }
  }

  async function postponeQueueItem(item) {
    hideMoveMenu();
    if (!item) return;
    const videoId = item.dataset.id;
    if (!videoId) return;
    const playlistState = getPlaylistState();
    const listId = item.dataset.listId || playlistState?.currentQueue?.id || null;
    const isCurrent =
      Boolean(listId) &&
      listId === playlistState?.currentQueue?.id &&
      playlistState?.currentVideoId === videoId;
    setStatus("Откладываю видео...", "info");
    try {
      if (isCurrent) {
        const payload = {
          videoId,
          tabId: Number.isInteger(playlistState?.currentTabId)
            ? playlistState.currentTabId
            : undefined,
        };
        const response = await sendMessage("playlist:postpone", payload);
        if (response?.handled === false) {
          setStatus("Нет следующего видео", "info", 3000);
          return;
        }
        const presentation = response?.state || response;
        if (presentation) {
          onStateChange(presentation);
        }
      } else {
        const state = await sendMessage("playlist:postponeVideo", { videoId, listId });
        if (state) {
          onStateChange(state);
        }
      }
      setStatus("Видео отложено", "success", 2200);
    } catch (err) {
      console.error(err);
      setStatus("Не удалось отложить", "error", 3000);
    }
  }

  function handleQueueClick(event) {
    const quickFilterBtn = event.target.closest(".video-quick-filter");
    if (quickFilterBtn) {
      event.stopPropagation();
      const item = quickFilterBtn.closest(".video-item");
      const videoId =
        quickFilterBtn.dataset.videoId || item?.dataset.id || item?.dataset.videoId;
      if (videoId) {
        openQuickFilter(videoId);
      }
      return;
    }
    const removeBtn = event.target.closest(".video-remove");
    if (removeBtn) {
      event.stopPropagation();
      const item = removeBtn.closest(".video-item");
      removeQueueItem(item);
      return;
    }
    const postponeBtn = event.target.closest(".video-postpone");
    if (postponeBtn) {
      event.stopPropagation();
      const item = postponeBtn.closest(".video-item");
      postponeQueueItem(item);
      return;
    }
    const moveBtn = event.target.closest(".video-move");
    if (moveBtn) {
      event.stopPropagation();
      const item = moveBtn.closest(".video-item");
      if (item) {
        showMoveMenu(item.dataset.id, item.dataset.listId, moveBtn);
      }
      return;
    }
    if (event.target.closest(".video-handle")) {
      return;
    }
    const item = event.target.closest(".video-item");
    if (!item) return;
    const videoId = item.dataset.id;
    if (!videoId) return;
    const playlistState = getPlaylistState();
    const listId = item.dataset.listId || playlistState?.currentQueue?.id;
    hideMoveMenu();
    setStatus("Запускаю видео...", "info");
    sendMessage("playlist:play", { videoId, listId })
      .then((state) => {
        if (state) onStateChange(state);
      })
      .catch((err) => {
        console.error(err);
        setStatus("Не удалось запустить видео", "error", 3000);
      });
  }

  // Rebuilds the queue list from current presentation state and keeps drag state pointed at the same queue data.
  function render(queueState, playlistState) {
    dragController.reset();
    queueList.textContent = "";
    const listId =
      queueState?.id ||
      playlistState?.currentQueue?.id ||
      playlistState?.currentListId ||
      null;
    const listName =
      queueState?.name ||
      playlistState?.currentQueue?.name ||
      "";
    const items = Array.isArray(queueState?.queue) ? queueState.queue : [];
    const lists = Array.isArray(playlistState?.lists) ? playlistState.lists : [];
    const listMeta = lists.find((item) => item.id === listId) || null;
    const isActiveList =
      Boolean(playlistState?.currentListId) &&
      Boolean(playlistState?.currentVideoId) &&
      Boolean(listId) &&
      listId === playlistState.currentListId;
    const currentId = isActiveList
      ? playlistState?.currentVideoId ||
        queueState?.queue?.[queueState?.currentIndex ?? -1]?.id ||
        null
      : null;
    const isFrozenList = Boolean(
      listId &&
        listId !== defaultListId &&
        (queueState?.freeze || playlistState?.currentQueue?.freeze || listMeta?.freeze)
    );
    if (queueFreezeIndicator) {
      const hasList = Boolean(listName);
      if (hasList) {
        const icon = isFrozenList ? "🧊" : "🔥";
        const label = isFrozenList
          ? "Список неизменяемый: видео не удаляются автоматически"
          : "Список автоматически очищается: просмотренные видео удаляются";
        const state = isFrozenList ? "frozen" : "active";
        queueFreezeIndicator.hidden = false;
        queueFreezeIndicator.textContent = icon;
        queueFreezeIndicator.setAttribute("data-state", state);
        queueFreezeIndicator.setAttribute("title", label);
        queueFreezeIndicator.setAttribute("aria-label", label);
      } else {
        queueFreezeIndicator.hidden = true;
        queueFreezeIndicator.textContent = "";
        queueFreezeIndicator.removeAttribute("data-state");
        queueFreezeIndicator.removeAttribute("title");
        queueFreezeIndicator.removeAttribute("aria-label");
      }
    }
    if (!items.length) {
      if (queueEmpty) {
        queueEmpty.hidden = false;
      }
      return;
    }
    if (queueEmpty) {
      queueEmpty.hidden = true;
    }

    const allowPostpone = !isFrozenList && items.length > 1;

    items.forEach((entry, index) => {
      const dataset = { id: entry.id, index };
      if (listId) {
        dataset.listId = listId;
      }

      const detailParts = buildDetailParts(entry);
      const progressPercent = getProgressPercent(
        playlistState?.videoProgress,
        entry.id
      );

      const removeDataset = { action: "remove", listId };
      const moveDataset = { action: "move", listId };
      const postponeDataset = { action: "postpone", listId };
      const quickFilterDataset = { action: "quickFilter", videoId: entry.id, listId };

      const actions = [
        {
          className: "icon-button video-quick-filter",
          textContent: "⚡",
          title: "Создать фильтр для видео",
          dataset: quickFilterDataset,
        },
        {
          className: "icon-button video-remove",
          textContent: "✕",
          title: "Удалить из очереди",
          dataset: removeDataset,
        },
        {
          className: "icon-button video-move",
          textContent: "⇄",
          title: "Перенести в другой список",
          dataset: moveDataset,
        },
      ];
      if (allowPostpone) {
        actions.splice(1, 0, {
          className: "icon-button video-postpone",
          textContent: "⤵",
          title: "Отложить в конец списка",
          dataset: postponeDataset,
        });
      }

      const { element } = createVideoItem(entry, {
        tag: "li",
        classes: ["queue-item", allowPostpone ? "video-item--has-postpone" : null],
        dataset,
        handle: {
          draggable: true,
          title: "Перетащить",
          ariaLabel: "Перетащить",
        },
        thumbnail: { fallback: fallbackThumbnail },
        details: detailParts,
        actions,
        progress: progressPercent,
      });

      if (currentId && entry.id === currentId) {
        element.classList.add("active");
      }

      queueList.appendChild(element);
    });
  }

  queueList.addEventListener("click", handleQueueClick);

  return {
    render,
  };
}
