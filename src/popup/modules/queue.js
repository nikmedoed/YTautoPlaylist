import { createVideoItem } from "../lib/videoItem.js";
import { buildDetailParts } from "../lib/detailParts.js";
import { openQuickFilter } from "../lib/quickFilter.js";

function resolveProgressPercent(state, videoId) {
  if (!state || !videoId) {
    return null;
  }
  const map = state.videoProgress;
  if (!map || typeof map !== "object") {
    return null;
  }
  const entry = map[videoId];
  if (!entry || typeof entry.percent !== "number") {
    return null;
  }
  const percent = Math.round(entry.percent);
  if (!Number.isFinite(percent) || percent <= 0) {
    return null;
  }
  if (percent >= 100) {
    return 100;
  }
  return percent;
}

function createDropIndicator(documentRef) {
  const indicator = documentRef.createElement("div");
  indicator.className = "queue-drop-indicator";
  const line = documentRef.createElement("div");
  line.className = "queue-drop-indicator__line";
  indicator.appendChild(line);
  return indicator;
}

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

  const dragState = {
    videoId: null,
    listId: null,
    dropIndex: null,

    // wheel/edge/autoscroll infra
    lastPointerY: null,
    wheelListenerActive: false,
    docDragOverActive: false,
    scrollRepositionActive: false,
    autoScrollRAF: 0,
    autoScrollContainer: null,
    autoScrollSpeed: 0,

    // manual drag mode
    manualActive: false,
    manualHandleEl: null,
  };

  const dropIndicator = createDropIndicator(queueList.ownerDocument || document);

  const EDGE_ZONE = 56;
  const MAX_STEP = 28;
  const MIN_STEP = 6;

  // ---------- utils ----------

  function getWheelPixels(e, container) {
    const unit =
      e.deltaMode === 1 /* DOM_DELTA_LINE */ ? 16 :
      e.deltaMode === 2 /* DOM_DELTA_PAGE */ ? container.clientHeight :
      1;
    return e.deltaY * unit;
  }

  function isScrollable(el) {
    if (!el || el.nodeType !== 1) return false;
    const cs = getComputedStyle(el);
    if (!cs) return false;
    const oy = cs.overflowY;
    return (oy === "auto" || oy === "scroll" || oy === "overlay") &&
           el.scrollHeight > el.clientHeight;
  }

  function findScrollableContainer(startNode, fallback) {
    let el = startNode && startNode.nodeType === 1 ? startNode : null;
    while (el && el !== fallback && el !== document.body && el !== document.documentElement) {
      if (isScrollable(el)) return el;
      el = el.parentElement;
    }
    if (fallback && isScrollable(fallback)) return fallback;
    return document.scrollingElement || document.documentElement;
  }

  // ---------- edge autoscroll ----------

  function getEdgeScroll(container, pointerY) {
    const rect = container.getBoundingClientRect();
    const topBand = rect.top + EDGE_ZONE;
    const bottomBand = rect.bottom - EDGE_ZONE;

    let speed = 0;
    if (pointerY < topBand) {
      const ratio = Math.min(1, (topBand - pointerY) / EDGE_ZONE);
      speed = -Math.max(MIN_STEP, Math.round(MAX_STEP * ratio));
    } else if (pointerY > bottomBand) {
      const ratio = Math.min(1, (pointerY - bottomBand) / EDGE_ZONE);
      speed = Math.max(MIN_STEP, Math.round(MAX_STEP * ratio));
    }

    const prev = container.scrollTop;
    const cannotUp = prev <= 0 && speed < 0;
    const cannotDown = prev >= container.scrollHeight - container.clientHeight && speed > 0;
    if (cannotUp || cannotDown) return 0;

    return speed;
  }

  function stopAutoscroll() {
    if (dragState.autoScrollRAF) {
      cancelAnimationFrame(dragState.autoScrollRAF);
      dragState.autoScrollRAF = 0;
    }
    dragState.autoScrollSpeed = 0;
    dragState.autoScrollContainer = null;
  }

  function autoscrollTick() {
    const container = dragState.autoScrollContainer;
    const speed = dragState.autoScrollSpeed;
    if (!dragState.videoId || !container || !speed) {
      stopAutoscroll();
      return;
    }
    container.scrollTop += speed;

    if (typeof dragState.lastPointerY === "number") {
      updateDropIndicatorAt(dragState.lastPointerY);
    }

    dragState.autoScrollRAF = requestAnimationFrame(autoscrollTick);
  }

  function ensureAutoscroll(pointerTarget, pointerY, fallbackContainer) {
    const container = findScrollableContainer(pointerTarget, fallbackContainer);
    const speed = getEdgeScroll(container, pointerY);
    if (!speed) {
      stopAutoscroll();
      return;
    }
    const changed = dragState.autoScrollContainer !== container;
    dragState.autoScrollContainer = container;
    dragState.autoScrollSpeed = speed;
    if (changed || !dragState.autoScrollRAF) {
      stopAutoscroll();
      dragState.autoScrollContainer = container;
      dragState.autoScrollSpeed = speed;
      dragState.autoScrollRAF = requestAnimationFrame(autoscrollTick);
    }
  }

  // ---------- indicator placement ----------

  function clearDragIndicators() {
    queueList
      .querySelectorAll(".drop-before, .drop-after")
      .forEach((el) => el.classList.remove("drop-before", "drop-after"));
    dropIndicator.remove();
  }

  function updateDropIndicatorAt(pointerY) {
    const items = Array.from(queueList.querySelectorAll(".video-item")).filter((el) => {
      if (!dragState.listId) return true;
      const { listId } = el.dataset;
      return !listId || listId === dragState.listId;
    });

    if (!items.length) {
      dragState.dropIndex = 0;
      const scrollTop = queueList.scrollTop;
      dropIndicator.style.top = `${Math.max(0, scrollTop)}px`;
      if (!queueList.contains(dropIndicator)) {
        queueList.appendChild(dropIndicator);
      }
      return;
    }

    let targetIndex = items.length;
    for (let i = 0; i < items.length; i += 1) {
      const el = items[i];
      if (el.dataset.id === dragState.videoId) continue;
      const rect = el.getBoundingClientRect();
      if (pointerY < rect.top + rect.height / 2) {
        targetIndex = i;
        break;
      }
    }
    dragState.dropIndex = targetIndex;

    const listRect = queueList.getBoundingClientRect();
    const scrollTop = queueList.scrollTop;
    const beforeEl = targetIndex > 0 ? items[targetIndex - 1] : null;
    const afterEl = targetIndex < items.length ? items[targetIndex] : null;
    const beforeRect = beforeEl?.getBoundingClientRect() || null;
    const afterRect = afterEl?.getBoundingClientRect() || null;
    const EDGE_OFFSET = 12;
    let targetTop;
    if (beforeRect && afterRect) {
      const gap = afterRect.top - beforeRect.bottom;
      const offset = gap > 0 ? gap / 2 : 0;
      targetTop = beforeRect.bottom + offset;
    } else if (!beforeRect && afterRect) {
      const offset = Math.min(EDGE_OFFSET, afterRect.height / 2);
      targetTop = afterRect.top - offset;
    } else if (beforeRect && !afterRect) {
      const offset = Math.min(EDGE_OFFSET, beforeRect.height / 2);
      targetTop = beforeRect.bottom + offset;
    } else {
      targetTop = listRect.top + queueList.clientHeight / 2;
    }
    const normalizedTop = Math.max(0, Math.min(queueList.scrollHeight, targetTop - listRect.top + scrollTop));
    dropIndicator.style.top = `${normalizedTop}px`;
    if (!queueList.contains(dropIndicator)) {
      queueList.appendChild(dropIndicator);
    }
  }

  // ---------- native HTML5-drag wheel support (kept) ----------

  const onWheelWhileDragging = (e) => {
    if (!dragState.videoId) return;

    const container = findScrollableContainer(e.target, queueList);
    const prev = container.scrollTop;
    const delta = getWheelPixels(e, container);
    const max = Math.max(0, container.scrollHeight - container.clientHeight);
    container.scrollTop = Math.max(0, Math.min(max, prev + delta));

    if (container.scrollTop !== prev) {
      e.preventDefault();
      const pointerY = typeof e.clientY === "number" ? e.clientY : dragState.lastPointerY;
      if (typeof pointerY === "number") updateDropIndicatorAt(pointerY);
    }
  };

  const onDocDragOver = (e) => {
    if (!dragState.videoId) return;
    dragState.lastPointerY = e.clientY;
    updateDropIndicatorAt(e.clientY);
    ensureAutoscroll(e.target, e.clientY, queueList);
  };

  const onAnyScrollDuringDrag = () => {
    if (!dragState.videoId) return;
    if (typeof dragState.lastPointerY === "number") {
      updateDropIndicatorAt(dragState.lastPointerY);
    }
  };

  function enableWheelDuringDrag() {
    if (!dragState.wheelListenerActive) {
      const opts = { passive: false, capture: true };
      window.addEventListener("wheel", onWheelWhileDragging, opts);
      document.addEventListener("wheel", onWheelWhileDragging, opts);
      dragState.wheelListenerActive = true;
    }
    if (!dragState.docDragOverActive) {
      document.addEventListener("dragover", onDocDragOver, { capture: true });
      dragState.docDragOverActive = true;
    }
    if (!dragState.scrollRepositionActive) {
      window.addEventListener("scroll", onAnyScrollDuringDrag, { capture: true, passive: true });
      document.addEventListener("scroll", onAnyScrollDuringDrag, { capture: true, passive: true });
      dragState.scrollRepositionActive = true;
    }
  }

  function disableWheelDuringDrag() {
    if (dragState.wheelListenerActive) {
      window.removeEventListener("wheel", onWheelWhileDragging, { capture: true });
      document.removeEventListener("wheel", onWheelWhileDragging, { capture: true });
      dragState.wheelListenerActive = false;
    }
    if (dragState.docDragOverActive) {
      document.removeEventListener("dragover", onDocDragOver, { capture: true });
      dragState.docDragOverActive = false;
    }
    if (dragState.scrollRepositionActive) {
      window.removeEventListener("scroll", onAnyScrollDuringDrag, { capture: true });
      document.removeEventListener("scroll", onAnyScrollDuringDrag, { capture: true });
      dragState.scrollRepositionActive = false;
    }
    stopAutoscroll();
  }

  // ---------- reset ----------

  function resetDragState() {
    if (dragState.videoId) {
      const draggingElement = queueList.querySelector(`.video-item[data-id="${dragState.videoId}"]`);
      draggingElement?.classList.remove("dragging");
    }
    clearDragIndicators();
    dragState.videoId = null;
    dragState.listId = null;
    dragState.dropIndex = null;
    dragState.lastPointerY = null;
    disableWheelDuringDrag();
  }

  // ---------- queue actions (unchanged) ----------

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

  // ---------- native HTML5 drag (kept for external wiring) ----------

  function handleDragStart(event) {
    if (dragState.manualActive) {
      event.preventDefault();
      return;
    }
    const handle = event.target.closest(".video-handle");
    if (!handle) {
      event.preventDefault();
      return;
    }
    const item = handle.closest(".video-item");
    if (!item) {
      event.preventDefault();
      return;
    }
    dragState.videoId = item.dataset.id;
    const playlistState = getPlaylistState();
    dragState.listId = item.dataset.listId || playlistState?.currentQueue?.id || null;
    dragState.dropIndex = null;
    dragState.lastPointerY = typeof event.clientY === "number" ? event.clientY : null;

    item.classList.add("dragging");
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", dragState.videoId || "");
    }
    enableWheelDuringDrag();
  }

  function handleDragOver(event) {
    if (!dragState.videoId) return;
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "move";
    }
    dragState.lastPointerY = event.clientY;
    updateDropIndicatorAt(event.clientY);
    ensureAutoscroll(event.target, event.clientY, queueList);
  }

  async function handleDrop(event) {
    if (!dragState.videoId) return;
    event.preventDefault();

    const items = Array.from(queueList.querySelectorAll(".video-item")).filter((el) => {
      if (!dragState.listId) return true;
      const { listId } = el.dataset;
      return !listId || listId === dragState.listId;
    });

    let targetIndex = dragState.dropIndex;
    if (typeof targetIndex !== "number") {
      const directEl = event.target.closest(".video-item");
      if (directEl && items.includes(directEl)) {
        const rect = directEl.getBoundingClientRect();
        const baseIndex = items.indexOf(directEl);
        targetIndex = event.clientY < rect.top + rect.height / 2 ? baseIndex : baseIndex + 1;
      } else {
        targetIndex = items.length;
      }
    }

    const playlistState = getPlaylistState();
    const queue = Array.isArray(playlistState?.currentQueue?.queue)
      ? playlistState.currentQueue.queue
      : [];
    const fromIndex = queue.findIndex((entry) => entry.id === dragState.videoId);
    if (fromIndex === -1) {
      resetDragState();
      return;
    }
    const bounded = Math.max(0, Math.min(queue.length, Number(targetIndex)));
    if (bounded === fromIndex || bounded === fromIndex + 1) {
      resetDragState();
      return;
    }

    try {
      const state = await sendMessage("playlist:reorder", {
        videoId: dragState.videoId,
        targetIndex: bounded,
      });
      if (state) {
        onStateChange(state);
        setStatus("Порядок обновлён", "info");
      }
    } catch (err) {
      console.error(err);
      setStatus("Не удалось изменить порядок", "error", 3000);
    } finally {
      resetDragState();
    }
  }

  function handleDragEnd() {
    resetDragState();
  }

  // ---------- MANUAL (pointer-based) DRAG on .video-handle ----------

  function manualStart(e) {
    if (!e.isPrimary || e.button !== 0) return;
    const handle = e.target.closest(".video-handle");
    if (!handle) return;

    const item = handle.closest(".video-item");
    if (!item) return;

    // Disable native HTML5 drag from the handle temporarily
    dragState.manualHandleEl = handle;
    handle.draggable = false;

    // Init
    dragState.manualActive = true;
    dragState.videoId = item.dataset.id;
    const playlistState = getPlaylistState();
    dragState.listId = item.dataset.listId || playlistState?.currentQueue?.id || null;
    dragState.dropIndex = null;
    dragState.lastPointerY = e.clientY;

    item.classList.add("dragging");

    try { handle.setPointerCapture?.(e.pointerId); } catch (_) {}

    updateDropIndicatorAt(e.clientY);

    document.addEventListener("pointermove", manualMove, { capture: true });
    document.addEventListener("pointerup", manualUp, { capture: true });
    if (!dragState.scrollRepositionActive) {
      window.addEventListener("scroll", onAnyScrollDuringDrag, { capture: true, passive: true });
      document.addEventListener("scroll", onAnyScrollDuringDrag, { capture: true, passive: true });
      dragState.scrollRepositionActive = true;
    }
  }

  function manualMove(e) {
    if (!dragState.manualActive) return;
    dragState.lastPointerY = e.clientY;
    updateDropIndicatorAt(e.clientY);
    ensureAutoscroll(e.target, e.clientY, queueList);
    e.preventDefault();
  }

  async function manualUp(e) {
    if (!dragState.manualActive) return;

    const items = Array.from(queueList.querySelectorAll(".video-item")).filter((el) => {
      if (!dragState.listId) return true;
      const { listId } = el.dataset;
      return !listId || listId === dragState.listId;
    });

    let targetIndex = dragState.dropIndex;
    if (typeof targetIndex !== "number") {
      const directEl = e.target.closest?.(".video-item") || null;
      if (directEl && items.includes(directEl)) {
        const rect = directEl.getBoundingClientRect();
        const baseIndex = items.indexOf(directEl);
        targetIndex = e.clientY < rect.top + rect.height / 2 ? baseIndex : baseIndex + 1;
      } else {
        targetIndex = items.length;
      }
    }

    endManualInfra();

    const playlistState = getPlaylistState();
    const queue = Array.isArray(playlistState?.currentQueue?.queue)
      ? playlistState.currentQueue.queue
      : [];
    const fromIndex = queue.findIndex((entry) => entry.id === dragState.videoId);
    if (fromIndex === -1) {
      resetDragState();
      return;
    }
    const bounded = Math.max(0, Math.min(queue.length, Number(targetIndex)));
    if (bounded === fromIndex || bounded === fromIndex + 1) {
      resetDragState();
      return;
    }

    try {
      const state = await sendMessage("playlist:reorder", {
        videoId: dragState.videoId,
        targetIndex: bounded,
      });
      if (state) {
        onStateChange(state);
        setStatus("Порядок обновлён", "info");
      }
    } catch (err) {
      console.error(err);
      setStatus("Не удалось изменить порядок", "error", 3000);
    } finally {
      resetDragState();
    }
  }

  function endManualInfra() {
    try { dragState.manualHandleEl?.releasePointerCapture?.(); } catch (_) {}
    document.removeEventListener("pointermove", manualMove, { capture: true });
    document.removeEventListener("pointerup", manualUp, { capture: true });

    if (dragState.manualHandleEl) {
      dragState.manualHandleEl.draggable = true;
    }

    dragState.manualActive = false;
    dragState.manualHandleEl = null;

    stopAutoscroll();
  }

  function cancelNativeWhenManual(e) {
    if (dragState.manualActive) e.preventDefault();
  }

  queueList.addEventListener("pointerdown", manualStart, { capture: true });
  queueList.addEventListener("dragstart", cancelNativeWhenManual, { capture: true });

  // ---------- render and wire ----------

  function render(queueState, playlistState) {
    resetDragState();
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
      const progressPercent = resolveProgressPercent(playlistState, entry.id);

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
  queueList.addEventListener("dragstart", handleDragStart);
  queueList.addEventListener("dragover", handleDragOver);
  queueList.addEventListener("drop", handleDrop);
  queueList.addEventListener("dragend", handleDragEnd);

  return {
    render,
  };
}
