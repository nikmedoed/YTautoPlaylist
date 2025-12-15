export function createDragController({
  detailList,
  onReorder,
  getQueue,
  getActiveListId,
} = {}) {
  if (!detailList) {
    throw new Error("detailList element is required for drag controller");
  }
  if (typeof onReorder !== "function") {
    throw new Error("onReorder handler is required for drag controller");
  }

  // Drop indicator (line)
  const dropIndicator = document.createElement("div");
  dropIndicator.className = "manage-drop-indicator";
  const dropIndicatorLine = document.createElement("div");
  dropIndicatorLine.className = "manage-drop-indicator__line";
  dropIndicator.appendChild(dropIndicatorLine);

  // Drag state shared by native and manual modes
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

  const EDGE_ZONE = 56;
  const MAX_STEP = 28;
  const MIN_STEP = 6;

  // ---------- shared helpers ----------

  function getActiveRows() {
    return Array.from(detailList.querySelectorAll(".manage-list-row")).filter((row) => {
      if (!dragState.listId) return true;
      const { listId } = row.dataset;
      return !listId || listId === dragState.listId;
    });
  }

  function getQueueSnapshot() {
    const queueSource = typeof getQueue === "function" ? getQueue() : [];
    return Array.isArray(queueSource) ? queueSource : [];
  }

  function resolveTargetIndex(rows, pointerY, targetEl) {
    if (typeof dragState.dropIndex === "number") {
      return dragState.dropIndex;
    }
    const directRow = targetEl?.closest?.(".manage-list-row") || null;
    if (directRow && rows.includes(directRow)) {
      const card = directRow.querySelector(".manage-video-item");
      const rect = card?.getBoundingClientRect() || directRow.getBoundingClientRect();
      const baseIndex = rows.indexOf(directRow);
      if (rect && typeof pointerY === "number") {
        return pointerY < rect.top + rect.height / 2 ? baseIndex : baseIndex + 1;
      }
      return baseIndex;
    }
    return rows.length;
  }

  // ---------- utils: scroll containers ----------

  function getWheelPixels(e, container) {
    // Normalize wheel delta across pixel/line/page modes
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
    detailList
      .querySelectorAll(".manage-video-item.drop-before, .manage-video-item.drop-after")
      .forEach((card) => card.classList.remove("drop-before", "drop-after"));
    dropIndicator.remove();
  }

  function updateDropIndicatorAt(pointerY) {
    const rows = getActiveRows();

    if (!rows.length) {
      dragState.dropIndex = 0;
      const scrollTop = detailList.scrollTop;
      dropIndicator.style.top = `${Math.max(0, scrollTop)}px`;
      if (!detailList.contains(dropIndicator)) {
        detailList.appendChild(dropIndicator);
      }
      return;
    }

    let targetIndex = rows.length;
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      const card = row.querySelector(".manage-video-item");
      const rect = card?.getBoundingClientRect() || row.getBoundingClientRect();
      if (pointerY < rect.top + rect.height / 2) {
        targetIndex = i;
        break;
      }
    }
    dragState.dropIndex = targetIndex;

    const listRect = detailList.getBoundingClientRect();
    const scrollTop = detailList.scrollTop;
    const beforeRow = targetIndex > 0 ? rows[targetIndex - 1] : null;
    const afterRow = targetIndex < rows.length ? rows[targetIndex] : null;
    const beforeRect = beforeRow
      ? beforeRow.querySelector(".manage-video-item")?.getBoundingClientRect() || beforeRow.getBoundingClientRect()
      : null;
    const afterRect = afterRow
      ? afterRow.querySelector(".manage-video-item")?.getBoundingClientRect() || afterRow.getBoundingClientRect()
      : null;
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
      targetTop = listRect.top + detailList.clientHeight / 2;
    }
    const normalizedTop = Math.max(0, Math.min(detailList.scrollHeight, targetTop - listRect.top + scrollTop));
    dropIndicator.style.top = `${normalizedTop}px`;
    if (!detailList.contains(dropIndicator)) {
      detailList.appendChild(dropIndicator);
    }
  }

  async function commitDrop(pointerY, targetEl) {
    const rows = getActiveRows();
    const targetIndex = resolveTargetIndex(rows, pointerY, targetEl);

    const queue = getQueueSnapshot();
    const fromIndex = queue.findIndex((video) => video.id === dragState.videoId);
    if (fromIndex === -1) {
      return;
    }

    const bounded = Math.max(0, Math.min(queue.length, Number(targetIndex)));
    if (bounded === fromIndex || bounded === fromIndex + 1) {
      return;
    }

    await onReorder({
      videoId: dragState.videoId,
      targetIndex: bounded,
      listId: dragState.listId || getActiveListId?.() || null,
    });
  }

  // ---------- native HTML5-drag wheel support (kept for completeness) ----------

  const onWheelWhileDragging = (e) => {
    if (!dragState.videoId) return;

    const container = findScrollableContainer(e.target, detailList);
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
    ensureAutoscroll(e.target, e.clientY, detailList);
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

  function reset() {
    if (dragState.videoId) {
      const row = detailList.querySelector(`.manage-list-row[data-id="${dragState.videoId}"]`);
      row?.querySelector(".manage-video-item")?.classList.remove("dragging");
    }
    clearDragIndicators();
    dragState.videoId = null;
    dragState.listId = null;
    dragState.dropIndex = null;
    dragState.lastPointerY = null;
    disableWheelDuringDrag();
  }

  // ---------- native HTML5 drag handlers (existing API) ----------

  const handleDragStart = (event) => {
    // If manual drag is active, cancel native drag immediately
    if (dragState.manualActive) {
      event.preventDefault();
      return;
    }

    const interactive = event.target.closest("button, a, input, select, textarea, label");
    const overHandle = event.target.closest(".video-handle");
    if (interactive && !overHandle) {
      event.preventDefault();
      return;
    }
    const card = event.target.closest(".manage-video-item");
    if (!card) {
      event.preventDefault();
      return;
    }
    const row = card.closest(".manage-list-row");
    if (!row) {
      event.preventDefault();
      return;
    }
    dragState.videoId = row.dataset.id || null;
    dragState.listId = row.dataset.listId || null;
    dragState.dropIndex = null;
    dragState.lastPointerY = typeof event.clientY === "number" ? event.clientY : null;

    dropIndicator.remove();
    card.classList.add("dragging");
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", dragState.videoId || "");
    }
    enableWheelDuringDrag();
  };

  const handleDragOver = (event) => {
    if (!dragState.videoId) return;
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "move";
    }
    dragState.lastPointerY = event.clientY;
    updateDropIndicatorAt(event.clientY);
    ensureAutoscroll(event.target, event.clientY, detailList);
  };

  const handleDrop = async (event) => {
    if (!dragState.videoId) return;
    event.preventDefault();

    try {
      await commitDrop(event.clientY, event.target);
    } finally {
      reset();
    }
  };

  const handleDragEnd = () => {
    reset();
  };

  // ---------- MANUAL (pointer-based) DRAG: always available via .video-handle ----------

  function manualStart(e) {
    // Start only on left-button primary pointer and on .video-handle
    if (!e.isPrimary || e.button !== 0) return;
    const handle = e.target.closest(".video-handle");
    if (!handle) return;

    const card = handle.closest(".manage-video-item");
    const row = handle.closest(".manage-list-row");
    if (!card || !row) return;

    // Disable native HTML5 drag from the handle temporarily
    dragState.manualHandleEl = handle;
    handle.draggable = false;

    // Init state
    dragState.manualActive = true;
    dragState.videoId = row.dataset.id || null;
    dragState.listId = row.dataset.listId || null;
    dragState.dropIndex = null;
    dragState.lastPointerY = e.clientY;

    // Visual
    dropIndicator.remove();
    card.classList.add("dragging");

    // Capture pointer to keep receiving moves outside the element
    try { handle.setPointerCapture?.(e.pointerId); } catch (_) {}

    // Infra: update indicator immediately
    updateDropIndicatorAt(e.clientY);

    // Attach document-level move/up & scroll reflow
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
    ensureAutoscroll(e.target, e.clientY, detailList);
    // Prevent accidental text selection
    e.preventDefault();
  }

  async function manualUp(e) {
    if (!dragState.manualActive) return;

    // Cleanup visual & listeners before async call
    endManualInfra();

    try {
      await commitDrop(e.clientY, e.target);
    } finally {
      reset();
    }
  }

  function endManualInfra() {
    try { dragState.manualHandleEl?.releasePointerCapture?.(); } catch (_) {}
    document.removeEventListener("pointermove", manualMove, { capture: true });
    document.removeEventListener("pointerup", manualUp, { capture: true });

    // Restore draggable attribute
    if (dragState.manualHandleEl) {
      dragState.manualHandleEl.draggable = true;
    }

    dragState.manualActive = false;
    dragState.manualHandleEl = null;

    stopAutoscroll();
  }

  // Cancel native drag if manual already running (belt and suspenders)
  function cancelNativeWhenManual(e) {
    if (dragState.manualActive) {
      e.preventDefault();
    }
  }

  // Listen for manual start on handles
  detailList.addEventListener("pointerdown", manualStart, { capture: true });
  detailList.addEventListener("dragstart", cancelNativeWhenManual, { capture: true });

  // Public API (kept for existing wiring)
  return {
    handleDragStart,
    handleDragOver,
    handleDrop,
    handleDragEnd,
    reset,
  };
}
