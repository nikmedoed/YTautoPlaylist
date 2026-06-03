// Shared popup drag-to-reorder controller. Owns pointer/native drag lifecycle,
// drop indicator positioning, edge autoscroll, and no-op reorder checks.
import { createDropIndicator, findScrollableContainer, getEdgeScroll, getWheelPixels, renderDropIndicator } from "./dragReorderGeometry.js";

// Configures one sortable list. Callers provide DOM selectors plus the actual
// reorder action; this function keeps browser drag quirks in one place.
export function createDragReorderController({
  container,
  itemSelector,
  handleSelector = ".video-handle",
  dragElementSelector = null,
  interactiveSelector = null,
  nativeHandleRequired = true,
  attachNativeEvents = false,
  indicatorClassName = "queue-drop-indicator",
  indicatorLineClassName = "queue-drop-indicator__line",
  skipDraggedItemInIndicator = false,
  edgeScroll = {},
  getQueue = () => [],
  getActiveListId = () => null,
  getItemId = (item) => item?.dataset?.id || null,
  getItemListId = (item) => item?.dataset?.listId || null,
  onReorder,
} = {}) {
  if (!container) throw new Error("container element is required for drag reorder");
  if (!itemSelector) throw new Error("itemSelector is required for drag reorder");
  if (typeof onReorder !== "function") throw new Error("onReorder handler is required for drag reorder");

  const doc = container.ownerDocument || document;
  const win = doc.defaultView || window;
  const indicator = createDropIndicator(doc, { className: indicatorClassName, lineClassName: indicatorLineClassName });
  const state = {
    videoId: null,
    listId: null,
    dropIndex: null,
    lastPointerY: null,
    wheelListenerActive: false,
    docDragOverActive: false,
    scrollRepositionActive: false,
    autoScrollRAF: 0,
    autoScrollContainer: null,
    autoScrollSpeed: 0,
    manualActive: false,
    manualHandleEl: null,
    manualPointerId: null,
  };

  function itemElementFromEventTarget(target) {
    return target?.closest?.(itemSelector) || null;
  }

  function dragElementFor(item) {
    return dragElementSelector ? item?.querySelector?.(dragElementSelector) || item : item;
  }

  function rectFor(item) {
    return dragElementFor(item)?.getBoundingClientRect?.() || item.getBoundingClientRect();
  }

  function getItems({ skipDragged = false } = {}) {
    return Array.from(container.querySelectorAll(itemSelector)).filter((item) => {
      if (skipDragged && item.dataset.id === state.videoId) return false;
      const { listId } = item.dataset;
      return !state.listId || !listId || listId === state.listId;
    });
  }

  function stopAutoscroll() {
    if (state.autoScrollRAF) {
      win.cancelAnimationFrame(state.autoScrollRAF);
      state.autoScrollRAF = 0;
    }
    state.autoScrollSpeed = 0;
    state.autoScrollContainer = null;
  }

  function updateDropIndicatorAt(pointerY) {
    state.dropIndex = renderDropIndicator({
      container,
      indicator,
      items: getItems(),
      pointerY,
      rectFor,
      targetItems: getItems({ skipDragged: skipDraggedItemInIndicator }),
    });
  }

  function autoscrollTick() {
    const scrollContainer = state.autoScrollContainer;
    const speed = state.autoScrollSpeed;
    if (!state.videoId || !scrollContainer || !speed) {
      stopAutoscroll();
      return;
    }
    scrollContainer.scrollTop += speed;
    if (typeof state.lastPointerY === "number") {
      updateDropIndicatorAt(state.lastPointerY);
    }
    state.autoScrollRAF = win.requestAnimationFrame(autoscrollTick);
  }

  function ensureAutoscroll(pointerTarget, pointerY) {
    const scrollContainer = findScrollableContainer(pointerTarget, container);
    const speed = getEdgeScroll(scrollContainer, pointerY, edgeScroll);
    if (!speed) {
      stopAutoscroll();
      return;
    }
    const changed = state.autoScrollContainer !== scrollContainer;
    state.autoScrollContainer = scrollContainer;
    state.autoScrollSpeed = speed;
    if (changed || !state.autoScrollRAF) {
      stopAutoscroll();
      state.autoScrollContainer = scrollContainer;
      state.autoScrollSpeed = speed;
      state.autoScrollRAF = win.requestAnimationFrame(autoscrollTick);
    }
  }

  function clearIndicators() {
    const dropped = container.querySelectorAll(".drop-before, .drop-after");
    dropped.forEach((item) => item.classList.remove("drop-before", "drop-after"));
    indicator.remove();
  }

  function enableDragListeners() {
    if (!state.wheelListenerActive) {
      const opts = { passive: false, capture: true };
      win.addEventListener("wheel", onWheelWhileDragging, opts);
      doc.addEventListener("wheel", onWheelWhileDragging, opts);
      state.wheelListenerActive = true;
    }
    if (!state.docDragOverActive) {
      doc.addEventListener("dragover", onDocDragOver, { capture: true });
      state.docDragOverActive = true;
    }
    enableScrollReposition();
  }

  function enableScrollReposition() {
    if (state.scrollRepositionActive) return;
    const opts = { capture: true, passive: true };
    win.addEventListener("scroll", onAnyScrollDuringDrag, opts);
    doc.addEventListener("scroll", onAnyScrollDuringDrag, opts);
    state.scrollRepositionActive = true;
  }

  function disableDragListeners() {
    if (state.wheelListenerActive) {
      win.removeEventListener("wheel", onWheelWhileDragging, { capture: true });
      doc.removeEventListener("wheel", onWheelWhileDragging, { capture: true });
      state.wheelListenerActive = false;
    }
    if (state.docDragOverActive) {
      doc.removeEventListener("dragover", onDocDragOver, { capture: true });
      state.docDragOverActive = false;
    }
    if (state.scrollRepositionActive) {
      win.removeEventListener("scroll", onAnyScrollDuringDrag, { capture: true });
      doc.removeEventListener("scroll", onAnyScrollDuringDrag, { capture: true });
      state.scrollRepositionActive = false;
    }
    stopAutoscroll();
  }

  function initDrag(item, pointerY) {
    state.videoId = getItemId(item) || null;
    state.listId = getItemListId(item) || getActiveListId?.() || null;
    state.dropIndex = null;
    state.lastPointerY = typeof pointerY === "number" ? pointerY : null;
    indicator.remove();
    dragElementFor(item)?.classList.add("dragging");
  }

  function reset() {
    if (state.videoId) {
      const item = container.querySelector(`${itemSelector}[data-id="${state.videoId}"]`);
      dragElementFor(item)?.classList.remove("dragging");
    }
    clearIndicators();
    state.videoId = null;
    state.listId = null;
    state.dropIndex = null;
    state.lastPointerY = null;
    disableDragListeners();
  }

  function resolveDropIndex(event) {
    if (typeof state.dropIndex === "number") return state.dropIndex;
    const items = getItems();
    const targetItem = itemElementFromEventTarget(event.target);
    if (targetItem && items.includes(targetItem)) {
      const rect = rectFor(targetItem);
      const baseIndex = items.indexOf(targetItem);
      if (rect && typeof event.clientY === "number") {
        return event.clientY < rect.top + rect.height / 2 ? baseIndex : baseIndex + 1;
      }
      return baseIndex;
    }
    return items.length;
  }

  // Commits only meaningful moves; the callers use insertion indexes.
  async function commitReorder(targetIndex) {
    const queue = normalizeQueue(getQueue());
    const fromIndex = queue.findIndex((entry) => entry?.id === state.videoId);
    if (fromIndex === -1) {
      return;
    }
    const bounded = Math.max(0, Math.min(queue.length, Number(targetIndex)));
    if (bounded === fromIndex || bounded === fromIndex + 1) {
      return;
    }
    await onReorder({
      videoId: state.videoId,
      targetIndex: bounded,
      listId: state.listId || getActiveListId?.() || null,
    });
  }

  const onWheelWhileDragging = (event) => {
    if (!state.videoId) return;
    const scrollContainer = findScrollableContainer(event.target, container);
    const previous = scrollContainer.scrollTop;
    const delta = getWheelPixels(event, scrollContainer);
    const max = Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight);
    scrollContainer.scrollTop = Math.max(0, Math.min(max, previous + delta));
    if (scrollContainer.scrollTop !== previous) {
      event.preventDefault();
      const pointerY =
        typeof event.clientY === "number" ? event.clientY : state.lastPointerY;
      if (typeof pointerY === "number") {
        updateDropIndicatorAt(pointerY);
      }
    }
  };

  const onDocDragOver = (event) => {
    if (!state.videoId) return;
    state.lastPointerY = event.clientY;
    updateDropIndicatorAt(event.clientY);
    ensureAutoscroll(event.target, event.clientY);
  };

  const onAnyScrollDuringDrag = () => {
    if (!state.videoId || typeof state.lastPointerY !== "number") return;
    updateDropIndicatorAt(state.lastPointerY);
  };

  function handleDragStart(event) {
    if (state.manualActive) {
      event.preventDefault();
      return;
    }
    const handle = event.target.closest?.(handleSelector) || null;
    if (nativeHandleRequired && !handle) {
      event.preventDefault();
      return;
    }
    const interactive = interactiveSelector ? event.target.closest?.(interactiveSelector) : null;
    if (interactive && !handle) {
      event.preventDefault();
      return;
    }
    const item = itemElementFromEventTarget(handle || event.target);
    if (!item) {
      event.preventDefault();
      return;
    }
    initDrag(item, event.clientY);
    if (!state.videoId) {
      event.preventDefault();
      reset();
      return;
    }
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", state.videoId);
    }
    enableDragListeners();
  }

  function handleDragOver(event) {
    if (!state.videoId) return;
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "move";
    }
    state.lastPointerY = event.clientY;
    updateDropIndicatorAt(event.clientY);
    ensureAutoscroll(event.target, event.clientY);
  }

  async function handleDrop(event) {
    if (!state.videoId) return;
    event.preventDefault();
    try {
      await commitReorder(resolveDropIndex(event));
    } finally {
      reset();
    }
  }

  function handleDragEnd() {
    reset();
  }

  function manualStart(event) {
    if (!event.isPrimary || event.button !== 0) return;
    const handle = event.target.closest?.(handleSelector) || null;
    if (!handle) return;
    const item = itemElementFromEventTarget(handle);
    if (!item) return;

    state.manualHandleEl = handle;
    state.manualPointerId = event.pointerId;
    handle.draggable = false;
    state.manualActive = true;
    initDrag(item, event.clientY);
    if (!state.videoId) {
      endManualDrag();
      reset();
      return;
    }

    try {
      handle.setPointerCapture?.(event.pointerId);
    } catch {}

    updateDropIndicatorAt(event.clientY);
    doc.addEventListener("pointermove", manualMove, { capture: true });
    doc.addEventListener("pointerup", manualUp, { capture: true });
    enableScrollReposition();
  }

  function manualMove(event) {
    if (!state.manualActive) return;
    state.lastPointerY = event.clientY;
    updateDropIndicatorAt(event.clientY);
    ensureAutoscroll(event.target, event.clientY);
    event.preventDefault();
  }

  async function manualUp(event) {
    if (!state.manualActive) return;
    const targetIndex = resolveDropIndex(event);
    endManualDrag();
    try {
      await commitReorder(targetIndex);
    } finally {
      reset();
    }
  }

  function endManualDrag() {
    try {
      state.manualHandleEl?.releasePointerCapture?.(state.manualPointerId);
    } catch {}
    doc.removeEventListener("pointermove", manualMove, { capture: true });
    doc.removeEventListener("pointerup", manualUp, { capture: true });
    if (state.manualHandleEl) state.manualHandleEl.draggable = true;
    state.manualActive = false;
    state.manualHandleEl = null;
    state.manualPointerId = null;
    stopAutoscroll();
  }

  function cancelNativeWhenManual(event) {
    if (state.manualActive) {
      event.preventDefault();
    }
  }

  container.addEventListener("pointerdown", manualStart, { capture: true });
  container.addEventListener("dragstart", cancelNativeWhenManual, { capture: true });
  if (attachNativeEvents) {
    container.addEventListener("dragstart", handleDragStart);
    container.addEventListener("dragover", handleDragOver);
    container.addEventListener("drop", handleDrop);
    container.addEventListener("dragend", handleDragEnd);
  }

  return { handleDragStart, handleDragOver, handleDrop, handleDragEnd, reset };
}

function normalizeQueue(queue) {
  return Array.isArray(queue) ? queue : [];
}
