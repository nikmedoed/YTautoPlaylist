// src/popup/lib/quickFilter.js
var settingsPath = "src/settings/settings.html";
var settingsUrl = chrome.runtime.getURL(settingsPath);
function buildQuickFilterUrl(videoId) {
  if (!videoId || typeof videoId !== "string") {
    return settingsUrl;
  }
  const normalized = videoId.trim();
  const url = new URL(settingsUrl);
  if (normalized) {
    url.searchParams.set("quickFilterVideo", normalized);
  }
  return url.toString();
}
async function openQuickFilter(videoId) {
  if (!videoId || typeof videoId !== "string") {
    return;
  }
  const normalized = videoId.trim();
  if (!normalized) {
    return;
  }
  try {
    await chrome.runtime.sendMessage({
      type: "options:openQuickFilter",
      videoId: normalized
    });
    return;
  } catch (err) {
    console.warn("Failed to open quick filter via background", err);
  }
  const url = buildQuickFilterUrl(normalized);
  try {
    if (chrome?.tabs?.create) {
      await chrome.tabs.create({ url });
      return;
    }
  } catch (err) {
    console.warn("Failed to open quick filter tab", err);
  }
  try {
    window.open(url, "_blank", "noopener,noreferrer");
  } catch (err) {
    console.error("Failed to open quick filter window", err);
  }
}

// src/popup/lib/dragReorderGeometry.js
function createDropIndicator(documentRef, { className, lineClassName }) {
  const indicator = documentRef.createElement("div");
  indicator.className = className;
  const line = documentRef.createElement("div");
  line.className = lineClassName;
  indicator.appendChild(line);
  return indicator;
}
function renderDropIndicator({
  container,
  indicator,
  items,
  pointerY,
  rectFor,
  targetItems
}) {
  if (!items.length) {
    indicator.style.top = `${Math.max(0, container.scrollTop)}px`;
    appendIndicator(container, indicator);
    return 0;
  }
  let targetIndex = items.length;
  for (const item of targetItems) {
    const rect = rectFor(item);
    if (pointerY < rect.top + rect.height / 2) {
      targetIndex = items.indexOf(item);
      break;
    }
  }
  const beforeItem = targetIndex > 0 ? items[targetIndex - 1] : null;
  const afterItem = targetIndex < items.length ? items[targetIndex] : null;
  indicator.style.top = `${resolveIndicatorTop({
    container,
    beforeRect: beforeItem ? rectFor(beforeItem) : null,
    afterRect: afterItem ? rectFor(afterItem) : null
  })}px`;
  appendIndicator(container, indicator);
  return targetIndex;
}
function getWheelPixels(event, container) {
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? container.clientHeight : 1;
  return event.deltaY * unit;
}
function findScrollableContainer(startNode, fallback) {
  let element = startNode && startNode.nodeType === 1 ? startNode : null;
  while (element && element !== fallback && element !== document.body && element !== document.documentElement) {
    if (isScrollable(element)) return element;
    element = element.parentElement;
  }
  if (fallback && isScrollable(fallback)) return fallback;
  return document.scrollingElement || document.documentElement;
}
function getEdgeScroll(container, pointerY, {
  edgeZone = 56,
  maxStep = 28,
  minStep = 6
} = {}) {
  const rect = container.getBoundingClientRect();
  const topBand = rect.top + edgeZone;
  const bottomBand = rect.bottom - edgeZone;
  let speed = 0;
  if (pointerY < topBand) {
    const ratio = Math.min(1, (topBand - pointerY) / edgeZone);
    speed = -Math.max(minStep, Math.round(maxStep * ratio));
  } else if (pointerY > bottomBand) {
    const ratio = Math.min(1, (pointerY - bottomBand) / edgeZone);
    speed = Math.max(minStep, Math.round(maxStep * ratio));
  }
  const previous = container.scrollTop;
  const cannotScrollUp = previous <= 0 && speed < 0;
  const cannotScrollDown = previous >= container.scrollHeight - container.clientHeight && speed > 0;
  return cannotScrollUp || cannotScrollDown ? 0 : speed;
}
function resolveIndicatorTop({ container, beforeRect, afterRect }) {
  const containerRect = container.getBoundingClientRect();
  const edgeOffset = 12;
  let targetTop;
  if (beforeRect && afterRect) {
    const gap = afterRect.top - beforeRect.bottom;
    targetTop = beforeRect.bottom + (gap > 0 ? gap / 2 : 0);
  } else if (!beforeRect && afterRect) {
    targetTop = afterRect.top - Math.min(edgeOffset, afterRect.height / 2);
  } else if (beforeRect && !afterRect) {
    targetTop = beforeRect.bottom + Math.min(edgeOffset, beforeRect.height / 2);
  } else {
    targetTop = containerRect.top + container.clientHeight / 2;
  }
  return Math.max(
    0,
    Math.min(container.scrollHeight, targetTop - containerRect.top + container.scrollTop)
  );
}
function appendIndicator(container, indicator) {
  if (!container.contains(indicator)) {
    container.appendChild(indicator);
  }
}
function isScrollable(element) {
  if (!element || element.nodeType !== 1) return false;
  const styles = getComputedStyle(element);
  if (!styles) return false;
  const overflowY = styles.overflowY;
  return (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") && element.scrollHeight > element.clientHeight;
}

// src/popup/lib/dragReorder.js
function createDragReorderController({
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
  onReorder
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
    manualPointerId: null
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
      targetItems: getItems({ skipDragged: skipDraggedItemInIndicator })
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
      listId: state.listId || getActiveListId?.() || null
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
      const pointerY = typeof event.clientY === "number" ? event.clientY : state.lastPointerY;
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
    } catch {
    }
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
    } catch {
    }
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

// src/popup/modules/shared/status.js
var DEFAULT_TIMEOUT = 5e3;
function ensureAccessibility(statusBox, statusText) {
  if (!statusBox || !statusText) return;
  statusBox.hidden = true;
  statusBox.dataset.visible = "0";
  statusText.textContent = "";
  if (!statusBox.hasAttribute("role")) {
    statusBox.setAttribute("role", "status");
  }
  statusBox.setAttribute("aria-live", "polite");
  statusBox.setAttribute("aria-atomic", "true");
}
function applyStatusProgress(progressEl, progressBarEl, progress) {
  if (!progressEl || !progressBarEl) return;
  if (!progress) {
    progressEl.hidden = true;
    progressEl.removeAttribute("data-indeterminate");
    progressBarEl.style.width = "0%";
    progressBarEl.style.transform = "translateX(0)";
    return;
  }
  if (progress.indeterminate || !progress.total) {
    progressEl.dataset.indeterminate = "1";
    progressBarEl.style.width = "40%";
    progressBarEl.style.transform = "";
  } else {
    progressEl.removeAttribute("data-indeterminate");
    const total = Number(progress.total);
    const added = Number(progress.added);
    if (Number.isFinite(total) && total > 0 && Number.isFinite(added) && added >= 0) {
      const ratio = Math.max(0, Math.min(1, added / total));
      progressBarEl.style.width = `${(ratio * 100).toFixed(2)}%`;
    } else {
      progressBarEl.style.width = "0%";
    }
    progressBarEl.style.transform = "translateX(0)";
  }
  progressEl.hidden = false;
}
function createStatusController({
  statusBox,
  statusText,
  progressEl = null,
  progressBarEl = null
}) {
  if (!statusBox || !statusText) {
    return {
      setStatus() {
      },
      hideStatus() {
      }
    };
  }
  let timeoutHandle = null;
  let hideTimer = null;
  const finalizeHide = () => {
    hideTimer = null;
    applyStatusProgress(progressEl, progressBarEl, null);
    statusBox.hidden = true;
    statusBox.removeAttribute("data-kind");
    statusText.textContent = "";
  };
  const hideStatus = (immediate = false) => {
    clearTimeout(hideTimer);
    statusBox.dataset.visible = "0";
    if (immediate) {
      finalizeHide();
      return;
    }
    hideTimer = window.setTimeout(() => {
      if (statusBox.dataset.visible !== "1") {
        finalizeHide();
      }
    }, 220);
  };
  const setStatus2 = (text, kind = "info", timeout = DEFAULT_TIMEOUT, options = {}) => {
    if (!text) {
      hideStatus(true);
      return;
    }
    clearTimeout(hideTimer);
    statusText.textContent = text;
    statusBox.dataset.kind = kind;
    statusBox.hidden = false;
    applyStatusProgress(progressEl, progressBarEl, options?.progress ?? null);
    void statusBox.offsetWidth;
    statusBox.dataset.visible = "1";
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
    if (timeout && timeout > 0) {
      timeoutHandle = window.setTimeout(() => {
        hideStatus();
      }, timeout);
    } else {
      timeoutHandle = null;
    }
  };
  ensureAccessibility(statusBox, statusText);
  if (progressEl) {
    progressEl.hidden = true;
  }
  statusBox.addEventListener("click", () => {
    hideStatus(true);
  });
  return { setStatus: setStatus2, hideStatus };
}

// src/popup/modules/manager/selection.js
function normalizeVideos(videos) {
  if (!Array.isArray(videos)) return [];
  return videos.filter((video) => video && typeof video.id === "string");
}
function createSelectionController({
  detailList,
  bulkMoveBtn,
  bulkDeleteBtn,
  floatingActions = null,
  queueSection = null
}) {
  const state = {
    selected: /* @__PURE__ */ new Set(),
    lastIndex: null,
    videos: []
  };
  const getVideoByIndex = (index) => {
    if (!Number.isFinite(index) || index < 0 || index >= state.videos.length) {
      return null;
    }
    return state.videos[index] || null;
  };
  const getVideoIndex = (videoId) => {
    if (!videoId) return -1;
    return state.videos.findIndex((video) => video.id === videoId);
  };
  const updateBulkButton = (button, count, texts = null) => {
    if (!button) return;
    button.disabled = count === 0;
    if (!Array.isArray(texts) || texts.length === 0) return;
    const [singleText, pluralText] = texts;
    button.textContent = count > 1 ? pluralText.replace("${count}", String(count)) : singleText;
  };
  const updateSelectionUI = () => {
    const count = state.selected.size;
    if (detailList) {
      detailList.querySelectorAll(".manage-list-row").forEach((row) => {
        const videoId = row.dataset.id;
        const selected = videoId ? state.selected.has(videoId) : false;
        row.classList.toggle("selected", selected);
        const checkbox = row.querySelector('input[type="checkbox"]');
        if (checkbox) {
          checkbox.checked = selected;
        }
      });
    }
    updateBulkButton(bulkMoveBtn, count);
    updateBulkButton(bulkDeleteBtn, count);
    if (floatingActions) {
      floatingActions.hidden = count === 0;
      if (!floatingActions.hidden) {
        floatingActions.dataset.count = `\u0412\u044B\u0431\u0440\u0430\u043D\u043E: ${count}`;
      } else {
        delete floatingActions.dataset.count;
      }
    }
    if (queueSection) {
      queueSection.classList.toggle("queue--floating-actions", count > 0);
    }
  };
  const setVideos = (videos) => {
    state.videos = normalizeVideos(videos);
    const availableIds = new Set(state.videos.map((video) => video.id));
    state.selected = new Set(
      Array.from(state.selected).filter((id) => availableIds.has(id))
    );
    if (state.lastIndex != null) {
      if (state.lastIndex < 0 || state.lastIndex >= state.videos.length) {
        state.lastIndex = null;
      }
    }
    updateSelectionUI();
  };
  const clear = () => {
    state.selected.clear();
    state.lastIndex = null;
    updateSelectionUI();
  };
  const selectAll = () => {
    state.selected = new Set(state.videos.map((video) => video.id));
    state.lastIndex = state.videos.length > 0 ? state.videos.length - 1 : null;
    updateSelectionUI();
  };
  const toggle = (videoId, rawIndex, shouldSelect, useShift) => {
    if (!videoId) return;
    const normalizedIndex = Number.isFinite(rawIndex) && rawIndex >= 0 ? rawIndex : getVideoIndex(videoId);
    if (useShift && state.lastIndex != null && normalizedIndex >= 0) {
      const start = Math.min(normalizedIndex, state.lastIndex);
      const end = Math.max(normalizedIndex, state.lastIndex);
      for (let index = start; index <= end; index += 1) {
        const video = getVideoByIndex(index);
        if (!video) continue;
        if (shouldSelect) {
          state.selected.add(video.id);
        } else {
          state.selected.delete(video.id);
        }
      }
    } else if (shouldSelect) {
      state.selected.add(videoId);
    } else {
      state.selected.delete(videoId);
    }
    state.lastIndex = normalizedIndex >= 0 ? normalizedIndex : state.lastIndex;
    updateSelectionUI();
  };
  const getSelectedIds = () => Array.from(state.selected);
  return {
    setVideos,
    updateUI: updateSelectionUI,
    clear,
    selectAll,
    toggle,
    getSelectedIds
  };
}

// src/utils.js
var YOUTUBE_ID_PATTERN = /[\w-]{11}/;
var THUMBNAIL_PRIORITY = ["maxres", "standard", "high", "medium", "default"];
function parseVideoId(input) {
  if (!input) return "";
  const str = String(input).trim();
  if (/^[\w-]{11}$/.test(str)) return str;
  try {
    const baseUrl = typeof globalThis?.location?.href === "string" ? globalThis.location.href : null;
    const url = baseUrl ? new URL(str, baseUrl) : new URL(str);
    if (url.hostname.includes("youtu.be")) {
      const id = url.pathname.split("/").filter(Boolean)[0];
      if (/^[\w-]{11}$/.test(id)) return id;
    }
    const candidate = url.searchParams.get("v");
    if (candidate && /^[\w-]{11}$/.test(candidate)) return candidate;
    const segments = url.pathname.split("/");
    for (const segment of segments) {
      if (/^[\w-]{11}$/.test(segment)) return segment;
    }
  } catch {
  }
  const match = str.match(YOUTUBE_ID_PATTERN);
  return match ? match[0] : "";
}
function pickThumbnailValue(value) {
  if (typeof value === "string" && value) {
    return value;
  }
  if (!value || typeof value !== "object") {
    return "";
  }
  return value.url || value.fallback || value.defaultSrc || "";
}
function pickThumbnailSet(thumbnails) {
  if (!thumbnails || typeof thumbnails !== "object") {
    return "";
  }
  for (const key of THUMBNAIL_PRIORITY) {
    const url = pickThumbnailValue(thumbnails[key]);
    if (url) {
      return url;
    }
  }
  return "";
}
function resolveThumbnailUrl(entry, fallback = "") {
  if (!entry || typeof entry !== "object") {
    return fallback || "";
  }
  const id = parseVideoId(entry.id);
  return pickThumbnailValue(entry.thumbnail) || pickThumbnailSet(entry.thumbnails) || (id ? `https://i.ytimg.com/vi/${id}/mqdefault.jpg` : "") || fallback || "";
}

// src/popup/modules/manager/runtime.js
function normalizeCount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}
function extractVideoIdsFromText(input) {
  if (!input) {
    return [];
  }
  const chunks = String(input).split(/[\s,;]+/).map((part) => part.trim()).filter(Boolean);
  const ids = chunks.map((value) => parseVideoId(value)).filter((id) => typeof id === "string" && id.length === 11);
  return Array.from(new Set(ids));
}
function setButtonLoading(button, loading) {
  if (!button) return;
  if (loading) {
    button.disabled = true;
    button.dataset.loading = "1";
  } else {
    button.disabled = false;
    button.removeAttribute("data-loading");
  }
}
async function openUrlInNewTab(url) {
  if (!url) return;
  try {
    await chrome.tabs.create({ url });
  } catch (err) {
    console.warn("Failed to open tab via chrome.tabs.create", err);
    try {
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (fallbackErr) {
      console.error("Failed to open playlist URL", fallbackErr);
    }
  }
}
function mapPlaylistCreationError(reason) {
  switch (reason) {
    case "LIST_EMPTY":
      return "\u0421\u043F\u0438\u0441\u043E\u043A \u043F\u0443\u0441\u0442 \u2014 \u043D\u0435\u0447\u0435\u0433\u043E \u0434\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u0432 \u043F\u043B\u0435\u0439\u043B\u0438\u0441\u0442";
    case "quotaExceeded":
      return "\u041F\u0440\u0435\u0432\u044B\u0448\u0435\u043D\u0430 \u043A\u0432\u043E\u0442\u0430 YouTube API, \u043F\u043E\u0432\u0442\u043E\u0440\u0438\u0442\u0435 \u043F\u043E\u0437\u0436\u0435";
    case "rateLimitExceeded":
      return "\u0421\u043B\u0438\u0448\u043A\u043E\u043C \u043C\u043D\u043E\u0433\u043E \u0437\u0430\u043F\u0440\u043E\u0441\u043E\u0432 \u043A YouTube API, \u043F\u043E\u043F\u0440\u043E\u0431\u0443\u0439\u0442\u0435 \u043F\u043E\u0437\u0436\u0435";
    case "listId required":
      return "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043E\u043F\u0440\u0435\u0434\u0435\u043B\u0438\u0442\u044C \u0441\u043F\u0438\u0441\u043E\u043A";
    default:
      if (typeof reason === "string" && reason.trim()) {
        return `\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0441\u043E\u0437\u0434\u0430\u0442\u044C \u043F\u043B\u0435\u0439\u043B\u0438\u0441\u0442: ${reason}`;
      }
      return "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0441\u043E\u0437\u0434\u0430\u0442\u044C \u043F\u043B\u0435\u0439\u043B\u0438\u0441\u0442";
  }
}

// src/popup/modules/manager/playlistCreationTracker.js
function createInitialState(listId, button) {
  return {
    listId,
    button: button || null,
    token: null,
    total: 0,
    added: 0,
    stage: "start",
    status: "start",
    reason: null,
    delayMs: null,
    startedAt: Date.now(),
    updatedAt: Date.now()
  };
}
function buildProgress(total, added, stage) {
  const totalValid = normalizeCount(total);
  const addedValid = normalizeCount(added);
  const safeAdded = totalValid ? Math.min(addedValid, totalValid) : addedValid;
  const stageSupportsProgress = ["adding", "finalizing", "done"].includes(stage);
  if (!stageSupportsProgress) {
    return null;
  }
  if (!totalValid) {
    return { indeterminate: true };
  }
  return { total: totalValid, added: safeAdded };
}
function resolveStatusText(state) {
  const totalValid = normalizeCount(state.total);
  const addedValid = normalizeCount(state.added);
  const safeAdded = totalValid ? Math.min(addedValid, totalValid) : addedValid;
  let text = "\u0421\u043E\u0437\u0434\u0430\u044E \u043F\u043B\u0435\u0439\u043B\u0438\u0441\u0442 \u044E\u0442\u0443\u0431...";
  switch (state.stage) {
    case "playlistCreated":
    case "adding":
      text = totalValid ? `\u0414\u043E\u0431\u0430\u0432\u043B\u044F\u044E \u0432\u0438\u0434\u0435\u043E \u0432 \u043F\u043B\u0435\u0439\u043B\u0438\u0441\u0442 (${safeAdded}/${totalValid})...` : "\u0414\u043E\u0431\u0430\u0432\u043B\u044F\u044E \u0432\u0438\u0434\u0435\u043E \u0432 \u043F\u043B\u0435\u0439\u043B\u0438\u0441\u0442...";
      break;
    case "finalizing":
      text = totalValid ? `\u0417\u0430\u0432\u0435\u0440\u0448\u0430\u044E \u0441\u043E\u0437\u0434\u0430\u043D\u0438\u0435 \u043F\u043B\u0435\u0439\u043B\u0438\u0441\u0442\u0430 (${safeAdded}/${totalValid})...` : "\u0417\u0430\u0432\u0435\u0440\u0448\u0430\u044E \u0441\u043E\u0437\u0434\u0430\u043D\u0438\u0435 \u043F\u043B\u0435\u0439\u043B\u0438\u0441\u0442\u0430...";
      break;
    case "done":
      text = totalValid ? `\u041F\u043B\u0435\u0439\u043B\u0438\u0441\u0442 \u043F\u043E\u0447\u0442\u0438 \u0433\u043E\u0442\u043E\u0432 (${safeAdded}/${totalValid})...` : "\u041F\u043B\u0435\u0439\u043B\u0438\u0441\u0442 \u043F\u043E\u0447\u0442\u0438 \u0433\u043E\u0442\u043E\u0432...";
      break;
    case "error":
      text = "\u041E\u0448\u0438\u0431\u043A\u0430 \u043F\u0440\u0438 \u0441\u043E\u0437\u0434\u0430\u043D\u0438\u0438 \u043F\u043B\u0435\u0439\u043B\u0438\u0441\u0442\u0430";
      break;
    default:
      break;
  }
  if (state.status === "retry") {
    const waitSeconds = state.delayMs ? Math.ceil(state.delayMs / 1e3) : null;
    return waitSeconds ? `\u041E\u0436\u0438\u0434\u0430\u044E \u043F\u0435\u0440\u0435\u0434 \u043F\u0440\u043E\u0434\u043E\u043B\u0436\u0435\u043D\u0438\u0435\u043C (${waitSeconds} \u0441)...` : "\u041E\u0436\u0438\u0434\u0430\u044E \u043F\u0435\u0440\u0435\u0434 \u043F\u0440\u043E\u0434\u043E\u043B\u0436\u0435\u043D\u0438\u0435\u043C...";
  }
  if (state.status === "quotaExceeded") {
    return "\u041F\u0440\u0435\u0432\u044B\u0448\u0435\u043D\u0430 \u043A\u0432\u043E\u0442\u0430 YouTube API, \u0441\u043E\u0437\u0434\u0430\u043D\u0438\u0435 \u043E\u0441\u0442\u0430\u043D\u043E\u0432\u043B\u0435\u043D\u043E";
  }
  if (state.status === "error") {
    return "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0434\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u0447\u0430\u0441\u0442\u044C \u0432\u0438\u0434\u0435\u043E";
  }
  return text;
}
function createPlaylistCreationTracker({ setStatus: setStatus2 }) {
  const statesByList = /* @__PURE__ */ new Map();
  const statesByToken = /* @__PURE__ */ new Map();
  const updatePlaylistCreationStatus = (state) => {
    if (!state) return;
    const progress = buildProgress(state.total, state.added, state.stage);
    setStatus2(resolveStatusText(state), "info", 0, { progress });
  };
  const registerState = (listId, button) => {
    if (!listId) return null;
    const existing = statesByList.get(listId);
    if (existing && existing.token) {
      statesByToken.delete(existing.token);
    }
    const state = createInitialState(listId, button);
    statesByList.set(listId, state);
    return state;
  };
  const releaseState = (stateOrListId) => {
    if (!stateOrListId) return;
    const state = typeof stateOrListId === "string" ? statesByList.get(stateOrListId) : stateOrListId;
    if (!state) return;
    statesByList.delete(state.listId);
    if (state.token) {
      statesByToken.delete(state.token);
    }
  };
  const handleProgressMessage = (message) => {
    if (!message || message.type !== "playlist:createYouTubePlaylist:progress") {
      return;
    }
    const token = message.token;
    const listId = message.listId;
    let state = null;
    if (token && statesByToken.has(token)) {
      state = statesByToken.get(token);
    }
    if (!state && listId && statesByList.has(listId)) {
      state = statesByList.get(listId);
    }
    if (!state) {
      return;
    }
    if (!state.token && token) {
      state.token = token;
      statesByToken.set(token, state);
    } else if (state.token && token && state.token !== token) {
      return;
    }
    if (typeof message.total === "number" && message.total >= 0) {
      state.total = message.total;
    }
    if (typeof message.added === "number" && message.added >= 0) {
      state.added = message.added;
    }
    if (typeof message.delayMs === "number") {
      state.delayMs = Number.isFinite(message.delayMs) && message.delayMs > 0 ? message.delayMs : null;
    }
    if (Object.prototype.hasOwnProperty.call(message, "reason")) {
      state.reason = message.reason || null;
    }
    if (message.stage) {
      state.stage = message.stage;
    }
    if (message.status) {
      state.status = message.status;
    }
    state.updatedAt = Date.now();
    updatePlaylistCreationStatus(state);
  };
  return {
    registerState,
    releaseState,
    handleProgressMessage
  };
}

// src/popup/modules/manager/detailActions.js
function createManagerDetailActions({
  getAppState,
  loadState,
  openQuickFilter: openQuickFilter2,
  sendMessage: sendMessage3,
  setStatus: setStatus2,
  showMoveMenu: showMoveMenu2
}) {
  return async function handleDetailAction2(event) {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const { action, videoId, listId } = button.dataset;
    if (!action || !videoId) return;
    if (action !== "quickFilter" && !listId) return;
    switch (action) {
      case "quickFilter":
        openQuickFilter2(videoId);
        break;
      case "remove":
        await sendMessage3("playlist:remove", {
          videoId,
          listId,
          videoIds: [videoId]
        });
        await loadState();
        setStatus2("\u0412\u0438\u0434\u0435\u043E \u0443\u0434\u0430\u043B\u0435\u043D\u043E", "info");
        break;
      case "move":
        showMoveMenu2([videoId], listId, button);
        break;
      case "postpone":
        await postponeVideo({ videoId, listId });
        break;
      default:
        break;
    }
  };
  async function postponeVideo({ videoId, listId }) {
    const appState2 = getAppState();
    const isCurrent = appState2?.currentListId === listId && appState2?.currentVideoId === videoId;
    try {
      if (isCurrent) {
        const payload = {
          videoId,
          tabId: Number.isInteger(appState2?.currentTabId) ? appState2.currentTabId : void 0
        };
        const response = await sendMessage3("playlist:postpone", payload);
        if (response?.handled === false) {
          setStatus2("\u041D\u0435\u0442 \u0441\u043B\u0435\u0434\u0443\u044E\u0449\u0435\u0433\u043E \u0432\u0438\u0434\u0435\u043E", "info", 3e3);
          return;
        }
      } else {
        await sendMessage3("playlist:postponeVideo", { videoId, listId });
      }
      await loadState();
      setStatus2("\u0412\u0438\u0434\u0435\u043E \u043E\u0442\u043B\u043E\u0436\u0435\u043D\u043E", "success", 2200);
    } catch (err) {
      console.error("Failed to postpone video", err);
      setStatus2("\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043E\u0442\u043B\u043E\u0436\u0438\u0442\u044C", "error", 3500);
    }
  }
}

// src/addResultMessages.js
function normalizeAddResponse(response) {
  if (!response || typeof response !== "object") {
    return { state: null, requested: null, missing: 0, added: 0 };
  }
  const state = response.state && typeof response.state === "object" ? response.state : response;
  const requested = Number.isInteger(response.requested) && response.requested >= 0 ? response.requested : null;
  const missing = Number.isInteger(response.missing) && response.missing > 0 ? response.missing : 0;
  const added = Number.isInteger(response.added) && response.added >= 0 ? response.added : 0;
  return { state, requested, missing, added };
}
function formatAddResultMessage({
  added = 0,
  requested = null,
  missing = 0,
  scopeLabel = "",
  alreadyMessage = ""
} = {}) {
  const addedCount = Number.isInteger(added) && added > 0 ? added : 0;
  const totalRequested = Number.isInteger(requested) && requested >= 0 ? requested : null;
  const missingCount = Number.isInteger(missing) && missing > 0 ? missing : 0;
  const duplicates = totalRequested !== null ? Math.max(0, totalRequested - missingCount - addedCount) : null;
  const fragments = [];
  if (addedCount > 0) {
    let message = `\u0414\u043E\u0431\u0430\u0432\u043B\u0435\u043D\u043E ${addedCount} \u0432\u0438\u0434\u0435\u043E`;
    if (duplicates && duplicates > 0) {
      message += ` (\u0435\u0449\u0451 ${duplicates} \u0432\u0438\u0434\u0435\u043E \u0443\u0436\u0435 \u0431\u044B\u043B\u0438)`;
    } else if (totalRequested !== null && totalRequested !== addedCount) {
      message += ` \u0438\u0437 ${totalRequested}`;
    }
    fragments.push(message);
  } else if (duplicates && duplicates > 0) {
    if (alreadyMessage) {
      fragments.push(alreadyMessage);
    } else if (scopeLabel) {
      fragments.push(`\u0412\u0441\u0435 ${scopeLabel} \u0443\u0436\u0435 \u0432 \u0441\u043F\u0438\u0441\u043A\u0435`);
    } else if (totalRequested !== null && totalRequested > 0) {
      fragments.push(`\u0412\u0441\u0435 ${totalRequested} \u0432\u0438\u0434\u0435\u043E \u0443\u0436\u0435 \u0432 \u0441\u043F\u0438\u0441\u043A\u0435`);
    } else {
      fragments.push("\u0412\u0441\u0435 \u0432\u0438\u0434\u0435\u043E \u0443\u0436\u0435 \u0432 \u0441\u043F\u0438\u0441\u043A\u0435");
    }
  } else if (totalRequested === 0) {
    fragments.push("\u0412\u0438\u0434\u0435\u043E \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u044B");
  } else if (scopeLabel) {
    fragments.push(`\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0434\u043E\u0431\u0430\u0432\u0438\u0442\u044C ${scopeLabel}`);
  } else {
    fragments.push("\u0412\u0438\u0434\u0435\u043E \u043D\u0435 \u0434\u043E\u0431\u0430\u0432\u043B\u0435\u043D\u044B");
  }
  if (missingCount > 0) {
    fragments.push(`\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043F\u043E\u043B\u0443\u0447\u0438\u0442\u044C \u0434\u0430\u043D\u043D\u044B\u0435 \u0434\u043B\u044F ${missingCount} \u0432\u0438\u0434\u0435\u043E`);
  }
  return {
    message: fragments.join(". "),
    kind: addedCount > 0 ? "success" : missingCount > 0 ? "error" : "info"
  };
}

// src/popup/modules/manager/modalController.js
function createManagerModalController({
  defaultListId,
  elements: elements2,
  getAppState,
  getSelectedListDetails,
  loadState,
  sendMessage: sendMessage3,
  setStatus: setStatus2,
  toggleImportTarget: toggleImportTarget3
}) {
  const {
    modalBackdrop,
    createModal,
    importModal,
    editModal,
    addLinksModal,
    openCreateModalBtn,
    openImportModalBtn,
    openAddLinksModalBtn,
    createForm,
    createName,
    createFreeze,
    importForm,
    importFile,
    importModeSelect,
    importTargetSelect,
    editForm,
    editName,
    editFreeze,
    addLinksForm,
    addLinksTextarea
  } = elements2;
  const modals = [createModal, importModal, editModal, addLinksModal];
  let editingListId = null;
  function openModal(modal) {
    if (!modal) return;
    modalBackdrop.hidden = false;
    modal.hidden = false;
    document.body.dataset.modalOpen = "1";
    const firstInput = modal.querySelector("input, select, button:not([data-close-modal])");
    if (firstInput) {
      setTimeout(() => firstInput.focus(), 0);
    }
  }
  function closeModal(modal) {
    if (!modal) return;
    modal.hidden = true;
    if (modals.every((item) => item?.hidden)) {
      modalBackdrop.hidden = true;
      document.body.dataset.modalOpen = "";
    }
  }
  function closeAllModals() {
    modals.forEach((modal) => {
      if (modal) {
        modal.hidden = true;
      }
    });
    modalBackdrop.hidden = true;
    document.body.dataset.modalOpen = "";
  }
  function openEditModal(listId) {
    const lists = Array.isArray(getAppState()?.lists) ? getAppState().lists : [];
    const list = lists.find((item) => item.id === listId);
    if (!list) return;
    editingListId = listId;
    editName.value = list.name;
    editFreeze.checked = list.id === defaultListId ? false : Boolean(list.freeze);
    editFreeze.disabled = list.id === defaultListId;
    openModal(editModal);
  }
  function register() {
    registerModalDismiss();
    registerOpenButtons();
    registerForms();
  }
  function registerModalDismiss() {
    document.querySelectorAll("[data-close-modal]").forEach((button) => {
      button.addEventListener("click", () => {
        closeModal(button.closest(".modal"));
      });
    });
    modalBackdrop.addEventListener("click", closeAllModals);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && document.body.dataset.modalOpen) {
        closeAllModals();
      }
    });
  }
  function registerOpenButtons() {
    openCreateModalBtn.addEventListener("click", () => {
      resetCreateModal();
      openModal(createModal);
    });
    openImportModalBtn.addEventListener("click", () => {
      resetImportModal();
      const lists = Array.isArray(getAppState()?.lists) ? getAppState().lists : [];
      if (!lists.length) {
        setStatus2("\u041D\u0435\u0442 \u0441\u043F\u0438\u0441\u043A\u043E\u0432 \u0434\u043B\u044F \u0434\u043E\u0431\u0430\u0432\u043B\u0435\u043D\u0438\u044F, \u0431\u0443\u0434\u0435\u0442 \u0441\u043E\u0437\u0434\u0430\u043D \u043D\u043E\u0432\u044B\u0439", "info", 2500);
      }
      openModal(importModal);
    });
    openAddLinksModalBtn?.addEventListener("click", () => {
      if (!getSelectedListDetails()?.id) {
        setStatus2("\u0421\u043D\u0430\u0447\u0430\u043B\u0430 \u043E\u0442\u043A\u0440\u043E\u0439\u0442\u0435 \u0441\u043F\u0438\u0441\u043E\u043A", "info", 2500);
        return;
      }
      resetAddLinksModal();
      openModal(addLinksModal);
    });
  }
  function registerForms() {
    createForm.addEventListener("submit", handleCreateSubmit);
    importModeSelect.addEventListener("change", toggleImportTarget3);
    importForm.addEventListener("submit", handleImportSubmit);
    editForm.addEventListener("submit", handleEditSubmit);
    addLinksForm?.addEventListener("submit", handleAddLinksSubmit);
  }
  function resetCreateModal() {
    createForm.reset();
    createFreeze.checked = false;
  }
  function resetImportModal() {
    importForm.reset();
    importFile.value = "";
    toggleImportTarget3();
  }
  function resetAddLinksModal() {
    addLinksForm?.reset();
    if (addLinksTextarea) {
      addLinksTextarea.value = "";
    }
  }
  async function handleCreateSubmit(event) {
    event.preventDefault();
    const name = createName.value.trim();
    if (!name) {
      setStatus2("\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u043D\u0430\u0437\u0432\u0430\u043D\u0438\u0435 \u0441\u043F\u0438\u0441\u043A\u0430", "error", 3e3);
      return;
    }
    setStatus2("\u0421\u043E\u0437\u0434\u0430\u044E \u0441\u043F\u0438\u0441\u043E\u043A...", "info", 0);
    try {
      await sendMessage3("playlist:createList", {
        name,
        freeze: Boolean(createFreeze.checked)
      });
      closeModal(createModal);
      await loadState();
      setStatus2("\u0421\u043F\u0438\u0441\u043E\u043A \u0441\u043E\u0437\u0434\u0430\u043D", "success");
    } catch (err) {
      console.error("create list failed", err);
      setStatus2("\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0441\u043E\u0437\u0434\u0430\u0442\u044C \u0441\u043F\u0438\u0441\u043E\u043A", "error", 4e3);
    }
  }
  async function handleImportSubmit(event) {
    event.preventDefault();
    const file = importFile.files?.[0];
    if (!file) {
      setStatus2("\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0444\u0430\u0439\u043B \u0434\u043B\u044F \u0438\u043C\u043F\u043E\u0440\u0442\u0430", "error", 3500);
      return;
    }
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const mode = importModeSelect.value;
      await sendMessage3("playlist:importList", {
        data,
        mode,
        targetListId: mode === "append" ? importTargetSelect.value || null : null
      });
      closeModal(importModal);
      await loadState();
      setStatus2("\u0421\u043F\u0438\u0441\u043E\u043A \u0438\u043C\u043F\u043E\u0440\u0442\u0438\u0440\u043E\u0432\u0430\u043D", "success");
    } catch (err) {
      console.error("import failed", err);
      setStatus2("\u041D\u0435\u0432\u0435\u0440\u043D\u044B\u0439 \u0444\u0430\u0439\u043B \u0434\u043B\u044F \u0438\u043C\u043F\u043E\u0440\u0442\u0430", "error", 4e3);
    } finally {
      importFile.value = "";
    }
  }
  async function handleEditSubmit(event) {
    event.preventDefault();
    if (!editingListId) return;
    const lists = Array.isArray(getAppState()?.lists) ? getAppState().lists : [];
    const list = lists.find((item) => item.id === editingListId);
    if (!list) return;
    const tasks = [];
    const nextName = editName.value.trim();
    if (nextName && nextName !== list.name) {
      tasks.push(sendMessage3("playlist:renameList", { listId: list.id, name: nextName }));
    }
    if (list.id !== defaultListId && Boolean(editFreeze.checked) !== Boolean(list.freeze)) {
      tasks.push(sendMessage3("playlist:setFreeze", { listId: list.id, freeze: editFreeze.checked }));
    }
    if (tasks.length) {
      await Promise.all(tasks);
      await loadState();
      setStatus2("\u041D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438 \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u044B", "success");
    }
    closeModal(editModal);
    editingListId = null;
  }
  async function handleAddLinksSubmit(event) {
    event.preventDefault();
    const selectedListDetails2 = getSelectedListDetails();
    if (!selectedListDetails2?.id) {
      setStatus2("\u0421\u043D\u0430\u0447\u0430\u043B\u0430 \u043E\u0442\u043A\u0440\u043E\u0439\u0442\u0435 \u0441\u043F\u0438\u0441\u043E\u043A", "error", 3200);
      return;
    }
    const ids = extractVideoIdsFromText(addLinksTextarea?.value || "");
    if (!ids.length) {
      setStatus2("\u041D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u043E \u043D\u0438 \u043E\u0434\u043D\u043E\u0439 \u0441\u0441\u044B\u043B\u043A\u0438 \u0438\u043B\u0438 ID", "error", 3500);
      return;
    }
    const submitBtn = addLinksForm.querySelector('button[type="submit"]');
    if (addLinksTextarea) {
      addLinksTextarea.disabled = true;
    }
    setButtonLoading(submitBtn, true);
    setStatus2(`\u0414\u043E\u0431\u0430\u0432\u043B\u044F\u044E ${ids.length} \u0432\u0438\u0434\u0435\u043E...`, "info", 0);
    try {
      const response = await sendMessage3("playlist:addByIds", {
        videoIds: ids,
        listId: selectedListDetails2.id,
        ensureDefault: false
      });
      await loadState();
      setAddLinksResultStatus(response, ids.length);
      closeModal(addLinksModal);
    } catch (err) {
      console.error("Failed to add videos by links", err);
      setStatus2("\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0434\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u043F\u043E \u0441\u0441\u044B\u043B\u043A\u0430\u043C", "error", 4e3);
    } finally {
      setButtonLoading(submitBtn, false);
      if (addLinksTextarea) {
        addLinksTextarea.disabled = false;
        addLinksTextarea.focus();
      }
    }
  }
  function setAddLinksResultStatus(response, fallbackRequested) {
    const { added, requested, missing } = normalizeAddResponse(response);
    const summary = formatAddResultMessage({
      added,
      requested: requested ?? fallbackRequested,
      missing,
      alreadyMessage: "\u0412\u0441\u0435 \u0432\u0438\u0434\u0435\u043E \u0443\u0436\u0435 \u0432 \u0441\u043F\u0438\u0441\u043A\u0435"
    });
    setStatus2(summary.message, summary.kind, 3800);
  }
  return {
    closeAllModals,
    closeModal,
    openEditModal,
    openModal,
    register
  };
}

// src/popup/lib/runtimeMessages.js
async function sendMessage(type, payload = {}, options = {}) {
  try {
    return await chrome.runtime.sendMessage({ type, ...payload });
  } catch (err) {
    const recoverable = isRecoverableRuntimeError(err);
    if (!recoverable || options.logRecoverable) {
      console.error(options.label || "Message failed", type, err);
    }
    throw err;
  }
}
function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
function getErrorMessage(err) {
  if (!err) return "";
  if (typeof err === "string") return err;
  if (typeof err.message === "string") return err.message;
  return String(err);
}
function isRecoverableRuntimeError(err) {
  const message = getErrorMessage(err);
  return /receiving end/i.test(message) || /could not establish connection/i.test(message) || /message port closed/i.test(message) || /context invalidated/i.test(message);
}

// src/popup/modules/manager/listActions.js
function createManagerListActions({
  defaultListId,
  getAppState,
  loadState,
  managerModalController: managerModalController2,
  registerPlaylistCreationState: registerPlaylistCreationState2,
  releasePlaylistCreationState: releasePlaylistCreationState2,
  sendMessage: sendMessage3,
  setStatus: setStatus2,
  syncCurrentListSelection
}) {
  async function handleListAction2(event) {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const { action, listId } = button.dataset;
    if (!action || !listId) return;
    switch (action) {
      case "edit":
        if (listId === defaultListId) {
          setStatus2("\u041E\u0441\u043D\u043E\u0432\u043D\u043E\u0439 \u0441\u043F\u0438\u0441\u043E\u043A \u043D\u0435\u043B\u044C\u0437\u044F \u0440\u0435\u0434\u0430\u043A\u0442\u0438\u0440\u043E\u0432\u0430\u0442\u044C", "info", 3e3);
          break;
        }
        managerModalController2.openEditModal(listId);
        break;
      case "export":
        await exportList(listId);
        break;
      case "createYoutubePlaylist":
        await createYouTubePlaylistForList(listId, button);
        break;
      case "delete":
        await deleteList(listId);
        break;
      case "activate":
        await activateList(listId);
        break;
      default:
        break;
    }
  }
  async function activateList(listId) {
    if (!listId) return;
    const result = await syncCurrentListSelection(listId);
    if (result === "changed") {
      setStatus2("\u0421\u043F\u0438\u0441\u043E\u043A \u0430\u043A\u0442\u0438\u0432\u0438\u0440\u043E\u0432\u0430\u043D", "success", 2200);
    } else if (result === "unchanged") {
      setStatus2("\u042D\u0442\u043E\u0442 \u0441\u043F\u0438\u0441\u043E\u043A \u0443\u0436\u0435 \u0430\u043A\u0442\u0438\u0432\u0435\u043D", "info", 2200);
    } else {
      setStatus2("\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0430\u043A\u0442\u0438\u0432\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u0441\u043F\u0438\u0441\u043E\u043A", "error", 3500);
    }
  }
  async function exportList(listId) {
    const response = await sendMessage3("playlist:exportList", { listId });
    if (!response || !response.data) {
      setStatus2("\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u044D\u043A\u0441\u043F\u043E\u0440\u0442\u0438\u0440\u043E\u0432\u0430\u0442\u044C", "error", 3500);
      return;
    }
    const blob = new Blob([JSON.stringify(response.data, null, 2)], {
      type: "application/json"
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const lists = Array.isArray(getAppState()?.lists) ? getAppState().lists : [];
    const name = lists.find((list) => list.id === listId)?.name;
    a.href = url;
    a.download = `${name || "list"}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setStatus2("\u0421\u043F\u0438\u0441\u043E\u043A \u044D\u043A\u0441\u043F\u043E\u0440\u0442\u0438\u0440\u043E\u0432\u0430\u043D", "success");
  }
  async function createYouTubePlaylistForList(listId, triggerButton) {
    if (!listId) return;
    const button = triggerButton || null;
    const state = registerPlaylistCreationState2(listId, button);
    if (button) setButtonLoading(button, true);
    setStatus2("\u0421\u043E\u0437\u0434\u0430\u044E \u043F\u043B\u0435\u0439\u043B\u0438\u0441\u0442 \u044E\u0442\u0443\u0431...", "info", 0);
    try {
      const result = await sendMessage3("playlist:createYouTubePlaylist", { listId });
      if (!result || result.error) {
        setStatus2(mapPlaylistCreationError(result?.error), "error", 5e3);
        return;
      }
      const total = normalizeCount(result.total);
      const added = normalizeCount(result.added);
      const safeAdded = total ? Math.min(added, total) : added;
      const title = result.title?.trim() || "\u041F\u043B\u0435\u0439\u043B\u0438\u0441\u0442";
      let message = `\u041F\u043B\u0435\u0439\u043B\u0438\u0441\u0442 \xAB${title}\xBB \u0441\u043E\u0437\u0434\u0430\u043D`;
      if (total) message += ` (${safeAdded}/${total})`;
      setStatus2(message, total && safeAdded < total ? "info" : "success", 6e3);
      const playlistUrl = result.url || (result.playlistId ? `https://www.youtube.com/playlist?list=${result.playlistId}` : "");
      if (playlistUrl) {
        await delay(500);
        await openUrlInNewTab(playlistUrl);
      }
    } catch (err) {
      console.error("Failed to create YouTube playlist", err);
      setStatus2("\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0441\u043E\u0437\u0434\u0430\u0442\u044C \u043F\u043B\u0435\u0439\u043B\u0438\u0441\u0442", "error", 5e3);
    } finally {
      releasePlaylistCreationState2(state);
      if (button) setButtonLoading(button, false);
    }
  }
  async function deleteList(listId) {
    if (!confirm("\u0423\u0434\u0430\u043B\u0438\u0442\u044C \u0441\u043F\u0438\u0441\u043E\u043A?")) return;
    const move = confirm(
      "\u041F\u0435\u0440\u0435\u043D\u0435\u0441\u0442\u0438 \u0432\u0441\u0435 \u0432\u0438\u0434\u0435\u043E \u0432 \u043E\u0441\u043D\u043E\u0432\u043D\u043E\u0439 \u0441\u043F\u0438\u0441\u043E\u043A?\n\u041E\u041A \u2014 \u043F\u0435\u0440\u0435\u043D\u0435\u0441\u0442\u0438, \u041E\u0442\u043C\u0435\u043D\u0430 \u2014 \u0443\u0434\u0430\u043B\u0438\u0442\u044C \u043E\u043A\u043E\u043D\u0447\u0430\u0442\u0435\u043B\u044C\u043D\u043E."
    );
    await sendMessage3("playlist:removeList", {
      listId,
      mode: move ? "move" : "discard"
    });
    await loadState();
    setStatus2("\u0421\u043F\u0438\u0441\u043E\u043A \u0443\u0434\u0430\u043B\u0451\u043D", "success");
  }
  return { handleListAction: handleListAction2 };
}

// src/popup/modules/manager/bulkActions.js
function registerManagerBulkActions({
  buttons,
  clearSelection: clearSelection2,
  getSelectedListDetails,
  getWatchedVideoIds: getWatchedVideoIds2,
  loadState,
  selectionController: selectionController2,
  sendMessage: sendMessage3,
  setStatus: setStatus2,
  showMoveMenu: showMoveMenu2,
  updateRemoveWatchedButton: updateRemoveWatchedButton2
}) {
  const { bulkDeleteBtn, bulkMoveBtn, clearListBtn, removeWatchedBtn } = buttons;
  async function removeFromSelectedList(videoIds) {
    const selectedListDetails2 = getSelectedListDetails();
    if (!selectedListDetails2?.id || !videoIds.length) return false;
    await sendMessage3("playlist:remove", {
      listId: selectedListDetails2.id,
      videoIds
    });
    await loadState();
    return true;
  }
  if (removeWatchedBtn) {
    removeWatchedBtn.addEventListener("click", async () => {
      const selectedListDetails2 = getSelectedListDetails();
      if (!selectedListDetails2?.id) return;
      const videoIds = getWatchedVideoIds2(selectedListDetails2);
      const count = videoIds.length;
      if (!count) {
        setStatus2("\u0412 \u044D\u0442\u043E\u043C \u0441\u043F\u0438\u0441\u043A\u0435 \u043D\u0435\u0442 \u043F\u0440\u043E\u0441\u043C\u043E\u0442\u0440\u0435\u043D\u043D\u044B\u0445 \u0432\u0438\u0434\u0435\u043E", "info", 3e3);
        updateRemoveWatchedButton2();
        return;
      }
      const title = selectedListDetails2.name || "\u0441\u043F\u0438\u0441\u043E\u043A";
      const message = count === 1 ? `\u0423\u0434\u0430\u043B\u0438\u0442\u044C 1 \u043F\u0440\u043E\u0441\u043C\u043E\u0442\u0440\u0435\u043D\u043D\u043E\u0435 \u0432\u0438\u0434\u0435\u043E \u0438\u0437 \u0441\u043F\u0438\u0441\u043A\u0430 \xAB${title}\xBB?` : `\u0423\u0434\u0430\u043B\u0438\u0442\u044C ${count} \u043F\u0440\u043E\u0441\u043C\u043E\u0442\u0440\u0435\u043D\u043D\u044B\u0445 \u0432\u0438\u0434\u0435\u043E \u0438\u0437 \u0441\u043F\u0438\u0441\u043A\u0430 \xAB${title}\xBB?`;
      if (!confirm(`${message}

\u0411\u0443\u0434\u0443\u0442 \u0443\u0434\u0430\u043B\u0435\u043D\u044B \u0432\u0441\u0435 \u0432\u0438\u0434\u0435\u043E \u0441 \u043F\u0440\u043E\u0433\u0440\u0435\u0441\u0441\u043E\u043C \u0431\u043E\u043B\u0435\u0435 95%.`)) {
        return;
      }
      removeWatchedBtn.disabled = true;
      try {
        await removeFromSelectedList(videoIds);
        setStatus2(
          count === 1 ? "\u041F\u0440\u043E\u0441\u043C\u043E\u0442\u0440\u0435\u043D\u043D\u043E\u0435 \u0432\u0438\u0434\u0435\u043E \u0443\u0434\u0430\u043B\u0435\u043D\u043E" : `\u0423\u0434\u0430\u043B\u0435\u043D\u043E ${count} \u043F\u0440\u043E\u0441\u043C\u043E\u0442\u0440\u0435\u043D\u043D\u044B\u0445 \u0432\u0438\u0434\u0435\u043E`,
          "success",
          2500
        );
      } catch (err) {
        console.error("Failed to delete watched videos", err);
        setStatus2("\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0443\u0434\u0430\u043B\u0438\u0442\u044C \u043F\u0440\u043E\u0441\u043C\u043E\u0442\u0440\u0435\u043D\u043D\u044B\u0435", "error", 3500);
        updateRemoveWatchedButton2();
      }
    });
  }
  if (bulkMoveBtn) {
    bulkMoveBtn.addEventListener("click", (event) => {
      const selectedListDetails2 = getSelectedListDetails();
      const selectedIds = selectionController2.getSelectedIds();
      if (!selectedListDetails2 || selectedIds.length === 0) return;
      showMoveMenu2(selectedIds, selectedListDetails2.id, event.currentTarget);
    });
  }
  if (bulkDeleteBtn) {
    bulkDeleteBtn.addEventListener("click", async () => {
      const selectedListDetails2 = getSelectedListDetails();
      if (!selectedListDetails2) return;
      const videoIds = selectionController2.getSelectedIds();
      if (videoIds.length === 0) return;
      const count = videoIds.length;
      try {
        await removeFromSelectedList(videoIds);
        clearSelection2();
        setStatus2(count > 1 ? `\u0423\u0434\u0430\u043B\u0435\u043D\u043E ${count} \u0432\u0438\u0434\u0435\u043E` : "\u0412\u0438\u0434\u0435\u043E \u0443\u0434\u0430\u043B\u0435\u043D\u043E", "success", 2500);
      } catch (err) {
        console.error("Failed to delete selected videos", err);
        setStatus2("\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0443\u0434\u0430\u043B\u0438\u0442\u044C", "error", 3500);
      }
    });
  }
  if (clearListBtn) {
    clearListBtn.addEventListener("click", async () => {
      const selectedListDetails2 = getSelectedListDetails();
      const queue = Array.isArray(selectedListDetails2?.queue) ? selectedListDetails2.queue : [];
      if (!selectedListDetails2 || queue.length === 0) return;
      const title = selectedListDetails2.name || "\u0441\u043F\u0438\u0441\u043E\u043A";
      if (!confirm(`\u041E\u0447\u0438\u0441\u0442\u0438\u0442\u044C \u0441\u043F\u0438\u0441\u043E\u043A \xAB${title}\xBB?`)) return;
      const videoIds = queue.map((video) => video.id).filter(Boolean);
      if (!videoIds.length) return;
      clearListBtn.disabled = true;
      try {
        await removeFromSelectedList(videoIds);
        clearSelection2();
        setStatus2("\u0421\u043F\u0438\u0441\u043E\u043A \u043E\u0447\u0438\u0449\u0435\u043D", "success", 2500);
      } catch (err) {
        console.error("Failed to clear list", err);
        setStatus2("\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043E\u0447\u0438\u0441\u0442\u0438\u0442\u044C \u0441\u043F\u0438\u0441\u043E\u043A", "error", 3500);
        if (getSelectedListDetails()?.queue?.length) {
          clearListBtn.disabled = false;
        }
      }
    });
  }
}

// src/progress.js
function clampProgressPercent(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  const percent = Math.round(value);
  if (!Number.isFinite(percent)) {
    return null;
  }
  if (percent <= 0) return 0;
  return percent >= 100 ? 100 : percent;
}
function getProgressPercent(progressById, videoId) {
  if (!videoId || !progressById) {
    return null;
  }
  if (typeof progressById !== "object") {
    return null;
  }
  const percent = clampProgressPercent(progressById[videoId]?.percent);
  return percent && percent > 0 ? percent : null;
}

// src/popup/modules/manager/detailHelpers.js
function getLength(list, fallback = 0) {
  return Number.isFinite(list?.length) ? Number(list.length) : fallback;
}
function haveSameListMeta(previous, next, previousLength, nextLength) {
  const previousRevision = Number.isFinite(previous?.revision) ? Number(previous.revision) : 0;
  const nextRevision = Number.isFinite(next?.revision) ? Number(next.revision) : 0;
  return Boolean(previous && next) && previous?.id === next?.id && (previous?.name || "") === (next?.name || "") && Boolean(previous?.freeze) === Boolean(next?.freeze) && previousRevision === nextRevision && previousLength === nextLength;
}
function getWatchedVideoIds(details, videoProgress) {
  const queue = Array.isArray(details?.queue) ? details.queue : [];
  const watchedIds = [];
  for (const video of queue) {
    const id = typeof video?.id === "string" ? video.id : "";
    if (!id) continue;
    const progress = getProgressPercent(videoProgress, id);
    if (typeof progress === "number" && progress > 95) {
      watchedIds.push(id);
    }
  }
  return watchedIds;
}
function updateRemoveWatchedButton(button, details, videoProgress) {
  if (!button) {
    return;
  }
  const count = getWatchedVideoIds(details, videoProgress).length;
  button.disabled = count === 0;
  if (count === 0) {
    button.title = "\u0412 \u0442\u0435\u043A\u0443\u0449\u0435\u043C \u0441\u043F\u0438\u0441\u043A\u0435 \u043D\u0435\u0442 \u0432\u0438\u0434\u0435\u043E \u0441 \u043F\u0440\u043E\u0433\u0440\u0435\u0441\u0441\u043E\u043C \u0431\u043E\u043B\u0435\u0435 95%";
    button.setAttribute(
      "aria-label",
      "\u0423\u0434\u0430\u043B\u0438\u0442\u044C \u043F\u0440\u043E\u0441\u043C\u043E\u0442\u0440\u0435\u043D\u043D\u044B\u0435 \u0432\u0438\u0434\u0435\u043E \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u043D\u043E"
    );
    return;
  }
  const label = `\u0423\u0434\u0430\u043B\u0438\u0442\u044C ${count} \u043F\u0440\u043E\u0441\u043C\u043E\u0442\u0440\u0435\u043D\u043D\u044B\u0445 \u0432\u0438\u0434\u0435\u043E`;
  button.title = `${label} (\u043F\u0440\u043E\u0433\u0440\u0435\u0441\u0441 \u0431\u043E\u043B\u0435\u0435 95%)`;
  button.setAttribute("aria-label", button.title);
}
function haveListMetaChanged(previous, next) {
  const prev = Array.isArray(previous) ? previous : [];
  const curr = Array.isArray(next) ? next : [];
  if (prev.length !== curr.length) {
    return true;
  }
  for (let index = 0; index < curr.length; index += 1) {
    const a = prev[index];
    const b = curr[index];
    if (!haveSameListMeta(a, b, getLength(a), getLength(b))) {
      return true;
    }
  }
  return false;
}
function shouldReloadSelectedDetails(state, selectedListId2, selectedDetails) {
  if (!selectedListId2) {
    return false;
  }
  const meta = Array.isArray(state?.lists) ? state.lists.find((item) => item?.id === selectedListId2) || null : null;
  if (!meta) {
    return true;
  }
  if (!selectedDetails || selectedDetails.id !== selectedListId2) {
    return true;
  }
  const detailLength = Array.isArray(selectedDetails.queue) ? selectedDetails.queue.length : 0;
  return !haveSameListMeta(
    selectedDetails,
    meta,
    detailLength,
    getLength(meta)
  );
}

// src/time.js
var ISO_DURATION_PATTERN = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/;
var DISPLAY_DATE_FORMATTER = new Intl.DateTimeFormat("ru-RU", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit"
});
var STORAGE_TIMESTAMP_FORMATTER = new Intl.DateTimeFormat("ru", {
  year: "2-digit",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric"
});
function toDate(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : new Date(value.getTime());
  }
  if (typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === "string" && value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}
function formatHms(totalSeconds) {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  const secs = seconds % 60;
  if (hours) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(
      2,
      "0"
    )}:${String(secs).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}
function parseDuration(duration) {
  if (duration == null) return void 0;
  if (typeof duration === "number" && Number.isFinite(duration)) {
    return Math.max(0, duration);
  }
  const match = ISO_DURATION_PATTERN.exec(String(duration));
  if (!match) return void 0;
  const hours = Number(match[1] || 0);
  const minutes = Number(match[2] || 0);
  const seconds = Number(match[3] || 0);
  return hours * 3600 + minutes * 60 + seconds;
}
function formatDuration(duration) {
  if (duration == null) return "";
  const seconds = parseDuration(duration);
  if (seconds == null) return "";
  return formatHms(seconds);
}
function formatDateTime(value) {
  const date = toDate(value);
  return date ? DISPLAY_DATE_FORMATTER.format(date) : "";
}
function formatClockTime(value = /* @__PURE__ */ new Date()) {
  const date = toDate(value);
  if (!date) return "";
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

// src/popup/lib/detailParts.js
function normalizeKey(key) {
  if (key === false || key === null || key === "") {
    return null;
  }
  return typeof key === "string" ? key : null;
}
function buildDetailParts(entry, options = {}) {
  const {
    includeChannel = true,
    includeDuration = false,
    publishedKey = "publishedAt",
    listIdKey,
    getListName,
    formatDate = formatDateTime,
    formatDurationValue = formatDuration
  } = options;
  const channel = includeChannel && entry?.channelTitle ? entry.channelTitle : null;
  const resolvedPublishedKey = normalizeKey(publishedKey);
  const published = resolvedPublishedKey && entry ? formatDate(entry?.[resolvedPublishedKey]) : null;
  const duration = includeDuration && entry ? formatDurationValue(entry.duration) : null;
  const metaParts = [];
  if (channel)
    metaParts.push({
      text: channel
    });
  if (published)
    metaParts.push({
      text: published
    });
  if (duration)
    metaParts.push({
      text: duration,
      className: "video-detail-duration",
      icon: "\u23F1"
    });
  const parts = [];
  if (metaParts.length) {
    parts.push(...metaParts);
  }
  const resolvedListIdKey = normalizeKey(listIdKey);
  if (resolvedListIdKey && typeof getListName === "function") {
    const listId = entry?.[resolvedListIdKey];
    if (listId) {
      const listName = getListName(listId);
      if (listName) {
        parts.push({
          text: listName,
          className: "list-label",
          noSeparator: true
        });
      }
    }
  }
  return parts;
}

// src/popup/lib/dom.js
function applyDataset(target, dataset) {
  if (!target || !dataset) return;
  for (const [key, value] of Object.entries(dataset)) {
    if (value == null) continue;
    target.dataset[key] = String(value);
  }
}
function applyAttributes(target, attrs) {
  if (!target || !attrs) return;
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null) continue;
    target.setAttribute(key, String(value));
  }
}

// src/popup/lib/videoItem.js
var DEFAULT_TITLE = "\u0411\u0435\u0437 \u043D\u0430\u0437\u0432\u0430\u043D\u0438\u044F";
var DEFAULT_ALT = "\u0412\u0438\u0434\u0435\u043E";
function sanitizeText(value) {
  if (!value) return "";
  return String(value).replace(/\s+/g, " ").trim();
}
function createHandle(doc, options = {}) {
  const button = doc.createElement("button");
  button.type = "button";
  button.className = options.className || "video-handle";
  button.title = options.title || "\u041F\u0435\u0440\u0435\u0442\u0430\u0449\u0438\u0442\u044C";
  button.setAttribute("aria-label", options.ariaLabel || button.title);
  if (options.draggable) {
    button.setAttribute("draggable", "true");
  }
  if (typeof options.tabIndex === "number") {
    button.tabIndex = options.tabIndex;
  }
  if (options.preventClickDefault) {
    button.addEventListener("click", (event) => {
      event.preventDefault();
    });
  }
  return button;
}
function createDetails(doc, parts, className = "video-details") {
  const details = doc.createElement("div");
  details.className = className;
  for (const part of parts || []) {
    const text = typeof part?.text === "string" ? part.text : "";
    if (!text && !part?.icon) continue;
    const node = doc.createElement("span");
    if (part.className) node.className = part.className;
    if (part.title) node.title = part.title;
    if (part.icon) {
      const icon = doc.createElement("span");
      icon.className = part.iconClassName || "video-detail__icon";
      icon.textContent = part.icon;
      icon.setAttribute("aria-hidden", "true");
      node.appendChild(icon);
    }
    if (text) {
      if (part.icon) {
        const textNode = doc.createElement("span");
        textNode.className = part.textClassName || "video-detail__text";
        textNode.textContent = text;
        node.appendChild(textNode);
      } else {
        node.textContent = text;
      }
    }
    const skipSeparator = typeof part === "object" && part !== null && part.noSeparator;
    if (details.childNodes.length && !skipSeparator) {
      const separator = doc.createElement("span");
      separator.className = "video-details__separator";
      separator.textContent = "\xB7";
      separator.setAttribute("aria-hidden", "true");
      details.appendChild(separator);
    }
    details.appendChild(node);
  }
  return details;
}
function createActionButton(doc, descriptor) {
  if (!descriptor) return null;
  const element = doc.createElement("button");
  element.type = "button";
  if (descriptor.className) {
    element.className = descriptor.className;
  }
  if (descriptor.textContent != null) {
    element.textContent = descriptor.textContent;
  }
  if (descriptor.title) {
    element.title = descriptor.title;
  }
  applyDataset(element, descriptor.dataset);
  if (typeof descriptor.ariaLabel === "string") {
    element.setAttribute("aria-label", descriptor.ariaLabel);
  } else if (descriptor.title) {
    element.setAttribute("aria-label", descriptor.title);
  }
  return element;
}
function resolveThumbnailDuration(video, thumbnailOptions = {}) {
  if (!thumbnailOptions || thumbnailOptions.showDuration === false) {
    return "";
  }
  if (typeof thumbnailOptions.duration === "string") {
    return thumbnailOptions.duration.trim();
  }
  if (video?.duration == null || video.duration === "") {
    return "";
  }
  const formatted = formatDuration(video.duration);
  return typeof formatted === "string" ? formatted.trim() : "";
}
function createVideoItem(video, options = {}) {
  const {
    document: doc = globalThis.document,
    tag = "li",
    classes = [],
    dataset,
    draggable = false,
    handle,
    thumbnail = {},
    title: titleOptions = {},
    bodyClass = "video-body",
    titleClass = "video-title",
    detailsClass = "video-details",
    details = [],
    actions = [],
    progress: progressOption = null,
    progressClassName = "video-thumb__progress",
    progressBarClassName = "video-thumb__progress-bar"
  } = options;
  const element = doc.createElement(tag);
  element.classList.add("video-item");
  for (const className of classes) {
    if (className) {
      element.classList.add(className);
    }
  }
  if (draggable) {
    element.draggable = true;
  }
  applyDataset(element, dataset);
  let handleElement = null;
  if (handle) {
    handleElement = createHandle(doc, handle);
    element.appendChild(handleElement);
  }
  if (!handleElement) {
    element.classList.add("video-item--no-handle");
  }
  if (thumbnail !== false) {
    const thumbWrapper = doc.createElement("div");
    thumbWrapper.className = thumbnail.wrapperClassName || "video-thumb-wrapper";
    const thumb = doc.createElement("img");
    thumb.className = thumbnail.className || "video-thumb";
    thumb.src = thumbnail.src || resolveThumbnailUrl(video, thumbnail.fallback || thumbnail.defaultSrc);
    const titleText = typeof titleOptions.text === "string" ? titleOptions.text : video?.title;
    thumb.alt = thumbnail.alt || (titleText ? sanitizeText(titleText) : DEFAULT_ALT) || DEFAULT_ALT;
    thumb.loading = thumbnail.loading || "lazy";
    thumb.decoding = thumbnail.decoding || "async";
    thumbWrapper.appendChild(thumb);
    const durationText = resolveThumbnailDuration(video, thumbnail);
    if (durationText) {
      const durationEl = doc.createElement("span");
      durationEl.className = thumbnail.durationClassName || "video-thumb__duration";
      durationEl.textContent = durationText;
      thumbWrapper.appendChild(durationEl);
    }
    let rawProgress = null;
    if (typeof progressOption === "number") {
      rawProgress = progressOption;
    } else if (typeof progressOption === "function") {
      try {
        rawProgress = progressOption(video);
      } catch {
        rawProgress = null;
      }
    } else if (progressOption && typeof progressOption === "object") {
      if (typeof progressOption.percent === "number") {
        rawProgress = progressOption.percent;
      } else if (typeof progressOption.value === "number") {
        rawProgress = progressOption.value;
      }
    }
    const resolvedProgress = clampProgressPercent(rawProgress);
    if (resolvedProgress && resolvedProgress > 0) {
      const progressContainer = doc.createElement("div");
      progressContainer.className = progressClassName;
      const progressBar = doc.createElement("div");
      progressBar.className = progressBarClassName;
      progressBar.style.width = `${resolvedProgress}%`;
      progressContainer.appendChild(progressBar);
      thumbWrapper.appendChild(progressContainer);
    }
    element.appendChild(thumbWrapper);
  }
  const body = doc.createElement("div");
  body.className = bodyClass;
  const titleNode = doc.createElement("div");
  titleNode.className = titleClass;
  const rawTitle = typeof titleOptions.text === "string" ? titleOptions.text : video?.title || DEFAULT_TITLE;
  const resolvedTitle = sanitizeText(rawTitle);
  titleNode.textContent = resolvedTitle || DEFAULT_TITLE;
  body.appendChild(titleNode);
  const detailsNode = createDetails(doc, details, detailsClass);
  body.appendChild(detailsNode);
  element.appendChild(body);
  for (const action of actions) {
    const node = createActionButton(doc, action);
    if (node) {
      element.appendChild(node);
    }
  }
  return element;
}

// src/popup/modules/manager/videoRow.js
function createManagerVideoRow({
  video,
  index,
  listId,
  frozen = false,
  fallbackThumbnail: fallbackThumbnail2,
  videoProgress
}) {
  const row = document.createElement("li");
  row.className = "manage-list-row";
  row.dataset.id = video.id;
  row.dataset.index = String(index);
  row.dataset.listId = listId;
  const selectCell = document.createElement("div");
  selectCell.className = "manage-select";
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.dataset.videoId = video.id;
  checkbox.dataset.index = String(index);
  selectCell.appendChild(checkbox);
  row.appendChild(selectCell);
  const dataset = { id: video.id, index };
  if (listId != null) {
    dataset.listId = listId;
  }
  const removeDataset = { action: "remove", videoId: video.id };
  const moveDataset = { action: "move", videoId: video.id };
  const postponeDataset = { action: "postpone", videoId: video.id };
  const quickFilterDataset = { action: "quickFilter", videoId: video.id };
  if (listId != null) {
    removeDataset.listId = listId;
    moveDataset.listId = listId;
    postponeDataset.listId = listId;
    quickFilterDataset.listId = listId;
  }
  const actions = [
    {
      className: "icon-button video-quick-filter",
      textContent: "\u26A1",
      title: "\u0421\u043E\u0437\u0434\u0430\u0442\u044C \u0444\u0438\u043B\u044C\u0442\u0440 \u0434\u043B\u044F \u0432\u0438\u0434\u0435\u043E",
      dataset: quickFilterDataset
    },
    {
      className: "icon-button video-remove",
      textContent: "\u2715",
      title: "\u0423\u0434\u0430\u043B\u0438\u0442\u044C \u0438\u0437 \u0441\u043F\u0438\u0441\u043A\u0430",
      dataset: removeDataset
    },
    {
      className: "icon-button video-move",
      textContent: "\u21C4",
      title: "\u041F\u0435\u0440\u0435\u043D\u0435\u0441\u0442\u0438 \u0432 \u0434\u0440\u0443\u0433\u043E\u0439 \u0441\u043F\u0438\u0441\u043E\u043A",
      dataset: moveDataset
    }
  ];
  if (!frozen) {
    actions.splice(1, 0, {
      className: "icon-button video-postpone",
      textContent: "\u2935",
      title: "\u041E\u0442\u043B\u043E\u0436\u0438\u0442\u044C \u0432 \u043A\u043E\u043D\u0435\u0446 \u0441\u043F\u0438\u0441\u043A\u0430",
      dataset: postponeDataset
    });
  }
  const progressPercent = getProgressPercent(videoProgress, video.id);
  const card = createVideoItem(video, {
    tag: "div",
    classes: [
      "manage-video-item",
      !frozen ? "video-item--has-postpone" : null
    ],
    dataset,
    draggable: true,
    handle: {
      draggable: true,
      title: "\u041F\u0435\u0440\u0435\u0442\u0430\u0449\u0438\u0442\u044C",
      ariaLabel: "\u041F\u0435\u0440\u0435\u0442\u0430\u0449\u0438\u0442\u044C",
      preventClickDefault: true,
      tabIndex: -1
    },
    thumbnail: { fallback: fallbackThumbnail2 },
    details: buildDetailParts(video),
    actions,
    progress: progressPercent
  });
  row.appendChild(card);
  return row;
}

// src/popup/modules/manager/stateController.js
function createManagerStateController({
  dragController: dragController2,
  elements: elements2,
  fallbackThumbnail: fallbackThumbnail2,
  getAppState,
  getSelectedListDetails,
  getSelectedListId,
  moveMenu: moveMenu2,
  selectionController: selectionController2,
  sendMessage: sendMessage3,
  setAppState,
  setSelectedListDetails,
  setSelectedListId,
  setStatus: setStatus2,
  highlightSelectedList: highlightSelectedList2,
  populateImportTargets: populateImportTargets3,
  renderLists: renderLists2,
  updateCollectionAvailability = () => {
  },
  request
}) {
  const {
    clearListBtn,
    detailEmpty,
    detailList,
    openAddLinksModalBtn,
    removeWatchedBtn
  } = elements2;
  let requestedListApplied = false;
  function updateRemoveWatchedButton2() {
    updateRemoveWatchedButton(
      removeWatchedBtn,
      getSelectedListDetails(),
      getAppState()?.videoProgress
    );
  }
  async function syncCurrentListSelection(listId) {
    if (!listId) return "failed";
    const appState2 = getAppState();
    if (appState2?.currentListId === listId) return "unchanged";
    const previousCurrentListId = appState2?.currentListId ?? null;
    if (appState2) appState2.currentListId = listId;
    try {
      const state = await sendMessage3("playlist:setCurrentList", { listId });
      if (state && Array.isArray(state.lists)) {
        setAppState(state);
        ensureSelectedList(state);
        renderLists2();
        updateDetailActiveVideo();
        return "changed";
      }
      return "failed";
    } catch (err) {
      if (appState2) appState2.currentListId = previousCurrentListId;
      console.error("Failed to sync current list", err);
      return "failed";
    }
  }
  function ensureSelectedList(state) {
    if (!state || !Array.isArray(state.lists) || !state.lists.length) {
      setSelectedListId(null);
      return;
    }
    if (!requestedListApplied && request.listId && state.lists.some((list) => list.id === request.listId)) {
      setSelectedListId(request.listId);
      requestedListApplied = true;
      setStatus2(
        request.listName ? `\u041E\u0442\u043A\u0440\u044B\u0442 \u0441\u043F\u0438\u0441\u043E\u043A "${request.listName}"` : "\u041E\u0442\u043A\u0440\u044B\u0442 \u0437\u0430\u043F\u0440\u043E\u0448\u0435\u043D\u043D\u044B\u0439 \u0441\u043F\u0438\u0441\u043E\u043A",
        "info",
        2600
      );
      return;
    }
    requestedListApplied = true;
    if (!getSelectedListId() || !state.lists.some((list) => list.id === getSelectedListId())) {
      setSelectedListId(state.currentListId || state.lists[0].id);
    }
  }
  async function loadState() {
    const state = await sendMessage3("playlist:getState");
    if (!state || !Array.isArray(state.lists)) return;
    setAppState(state);
    ensureSelectedList(state);
    renderLists2();
    populateImportTargets3();
    await loadListDetails(getSelectedListId(), { syncCurrent: false });
    updateCollectionAvailability();
  }
  function renderDetailVideos(details) {
    moveMenu2.hide();
    dragController2.reset();
    detailList.textContent = "";
    const hasList = Boolean(details?.id);
    if (openAddLinksModalBtn) openAddLinksModalBtn.disabled = !hasList;
    const videos = Array.isArray(details?.queue) ? details.queue : [];
    selectionController2.setVideos(videos);
    if (clearListBtn) clearListBtn.disabled = videos.length === 0;
    updateRemoveWatchedButton2();
    if (!videos.length) {
      detailEmpty.hidden = false;
      selectionController2.updateUI();
      return;
    }
    detailEmpty.hidden = true;
    const frozen = Boolean(details.freeze);
    videos.forEach((video, index) => {
      detailList.appendChild(
        createManagerVideoRow({
          video,
          index,
          listId: details.id,
          frozen,
          fallbackThumbnail: fallbackThumbnail2,
          videoProgress: getAppState()?.videoProgress
        })
      );
    });
    selectionController2.updateUI();
  }
  function updateDetailActiveVideo() {
    const rows = Array.from(detailList.querySelectorAll(".manage-list-row"));
    rows.forEach((row) => {
      row.classList.remove("active");
      const videoItem = row.querySelector(".manage-video-item");
      if (videoItem) videoItem.classList.remove("active");
    });
    const selectedListDetails2 = getSelectedListDetails();
    const appState2 = getAppState();
    if (!selectedListDetails2 || !appState2) return;
    if (!selectedListDetails2.id || selectedListDetails2.id !== appState2.currentListId) {
      return;
    }
    const activeId = appState2.currentVideoId;
    if (!activeId) return;
    const activeRow = rows.find((row) => row.dataset.id === activeId);
    if (!activeRow) return;
    activeRow.classList.add("active");
    const activeVideoItem = activeRow.querySelector(".manage-video-item");
    if (activeVideoItem) activeVideoItem.classList.add("active");
  }
  async function loadListDetails(listId, options = {}) {
    const { syncCurrent = false } = options;
    if (!listId) {
      detailList.textContent = "";
      detailEmpty.hidden = false;
      setSelectedListDetails(null);
      if (clearListBtn) clearListBtn.disabled = true;
      updateRemoveWatchedButton2();
      if (openAddLinksModalBtn) openAddLinksModalBtn.disabled = true;
      updateCollectionAvailability();
      updateDetailActiveVideo();
      return;
    }
    setSelectedListId(listId);
    const syncPromise = syncCurrent ? syncCurrentListSelection(listId) : Promise.resolve();
    const details = await sendMessage3("playlist:getList", { listId });
    await syncPromise;
    if (!details) {
      setSelectedListDetails(null);
      if (clearListBtn) clearListBtn.disabled = true;
      updateRemoveWatchedButton2();
      return;
    }
    const previousListId = getSelectedListDetails()?.id;
    setSelectedListDetails(details);
    if (previousListId !== details.id) selectionController2.clear();
    renderDetailVideos(details);
    highlightSelectedList2(details.id);
    updateCollectionAvailability();
    updateDetailActiveVideo();
  }
  function handleStateUpdated(state) {
    const previousState = getAppState();
    setAppState(state);
    ensureSelectedList(state);
    const listsChanged = haveListMetaChanged(previousState?.lists, state.lists);
    if (listsChanged) {
      renderLists2();
      populateImportTargets3();
    } else {
      highlightSelectedList2(getSelectedListId());
    }
    if (getSelectedListId() && shouldReloadSelectedDetails(state, getSelectedListId(), getSelectedListDetails())) {
      loadListDetails(getSelectedListId(), { syncCurrent: false }).catch(() => {
      });
    } else {
      updateDetailActiveVideo();
      updateRemoveWatchedButton2();
      updateCollectionAvailability();
    }
  }
  return {
    ensureSelectedList,
    handleStateUpdated,
    loadListDetails,
    loadState,
    renderLists: renderLists2,
    syncCurrentListSelection,
    updateDetailActiveVideo
  };
}

// src/popup/modules/manager/events.js
function registerManagerEvents({
  controllers,
  elements: elements2,
  handlers,
  managerSection: managerSection2
}) {
  const {
    clearSelection: clearSelection2,
    handleDetailAction: handleDetailAction2,
    handleListAction: handleListAction2,
    handleSelectionToggle,
    selectAllVideos
  } = handlers;
  const { clearSelectionBtn, detailList, listsBody, managerCollectBtn, selectAllBtn } = elements2;
  let pendingShiftSelect = false;
  listsBody.addEventListener("click", handleListAction2);
  detailList.addEventListener("pointerdown", (event) => {
    pendingShiftSelect = Boolean(
      event.shiftKey && event.target.closest(".manage-select")
    );
  });
  detailList.addEventListener("click", (event) => {
    const checkbox = event.target.closest('.manage-select input[type="checkbox"]');
    if (!checkbox) return;
    const videoId = checkbox.dataset.videoId || "";
    const index = Number(checkbox.dataset.index);
    const useShift = pendingShiftSelect || event.shiftKey;
    pendingShiftSelect = false;
    handleSelectionToggle(
      videoId,
      Number.isNaN(index) ? -1 : index,
      checkbox.checked,
      useShift
    );
    event.stopPropagation();
  });
  detailList.addEventListener("click", handleDetailAction2);
  detailList.addEventListener("dragstart", controllers.drag.handleDragStart);
  detailList.addEventListener("dragover", controllers.drag.handleDragOver);
  detailList.addEventListener("drop", controllers.drag.handleDrop);
  detailList.addEventListener("dragend", controllers.drag.handleDragEnd);
  if (selectAllBtn) {
    selectAllBtn.addEventListener("click", selectAllVideos);
  }
  if (clearSelectionBtn) {
    clearSelectionBtn.addEventListener("click", clearSelection2);
  }
  if (managerCollectBtn) {
    managerCollectBtn.addEventListener("click", () => {
      Promise.resolve(managerSection2.collectSubscriptions()).catch(() => {
      });
    });
  }
}

// src/popup/lib/moveMenu.js
var DEFAULT_PADDING = 12;
var DEFAULT_OFFSET = 6;
function positionMenu(root, anchor, { offset, padding }) {
  if (!anchor || !root) return;
  const rect = anchor.getBoundingClientRect();
  const menuRect = root.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  let left = rect.left;
  let top = rect.bottom + offset;
  if (left + menuRect.width > viewportWidth - padding) {
    left = viewportWidth - menuRect.width - padding;
  }
  if (left < padding) {
    left = padding;
  }
  if (top + menuRect.height > viewportHeight - padding) {
    const alternativeTop = rect.top - menuRect.height - offset;
    if (alternativeTop >= padding) {
      top = alternativeTop;
    } else {
      top = viewportHeight - menuRect.height - padding;
    }
  }
  if (top < padding) {
    top = padding;
  }
  root.style.top = `${Math.round(top)}px`;
  root.style.left = `${Math.round(left)}px`;
}
function createMoveMenu({
  document: doc = globalThis.document,
  headerText = "\u041F\u0435\u0440\u0435\u043D\u0435\u0441\u0442\u0438 \u0432:",
  cancelLabel = "\u041E\u0442\u043C\u0435\u043D\u0430",
  className = "move-menu",
  messageClass = "move-menu__message",
  buttonsClass = "move-menu__buttons",
  getOptions,
  onSelect,
  onEmpty,
  onOpen,
  onClose,
  offset = DEFAULT_OFFSET,
  padding = DEFAULT_PADDING,
  shouldIgnoreClick
} = {}) {
  if (typeof getOptions !== "function") {
    throw new Error("createMoveMenu: getOptions must be a function");
  }
  const root = doc.createElement("div");
  root.className = className;
  root.dataset.visible = "0";
  const message = doc.createElement("div");
  message.className = messageClass;
  root.appendChild(message);
  const buttons = doc.createElement("div");
  buttons.className = buttonsClass;
  buttons.dataset.empty = "1";
  root.appendChild(buttons);
  const cancelButton = doc.createElement("button");
  cancelButton.type = "button";
  cancelButton.classList.add("secondary");
  cancelButton.textContent = cancelLabel;
  root.appendChild(cancelButton);
  doc.body.appendChild(root);
  let state = null;
  const hide = (trigger) => {
    if (root.dataset.visible === "0") return;
    root.dataset.visible = "0";
    state = null;
    buttons.textContent = "";
    buttons.dataset.empty = "1";
    cancelButton.textContent = cancelLabel;
    message.textContent = "";
    if (typeof onClose === "function") {
      onClose(trigger);
    }
  };
  const handleCancel = () => {
    hide({ reason: "cancel" });
  };
  const handleOptionClick = async (event) => {
    const button = event.target.closest("button[data-target-list-id]");
    if (!button || root.dataset.visible !== "1" || !state) return;
    const targetListId = button.dataset.targetListId;
    if (!targetListId) return;
    const { context, options } = state;
    const selected = options.find((option) => option.id === targetListId) || null;
    hide({ reason: "select", targetListId });
    if (typeof onSelect === "function") {
      await onSelect(targetListId, context, selected);
    }
  };
  const handleDocumentClick = (event) => {
    if (root.dataset.visible !== "1") return;
    if (root.contains(event.target)) return;
    const anchor = state?.anchor || null;
    if (anchor && (anchor === event.target || anchor.contains(event.target))) {
      return;
    }
    if (typeof shouldIgnoreClick === "function") {
      if (shouldIgnoreClick({ event, anchor, context: state?.context, menu: root })) {
        return;
      }
    }
    hide({ reason: "outside-click" });
  };
  const handleKeydown = (event) => {
    if (event.key === "Escape" && root.dataset.visible === "1") {
      hide({ reason: "escape" });
    }
  };
  cancelButton.addEventListener("click", handleCancel);
  buttons.addEventListener("click", handleOptionClick);
  doc.addEventListener("click", handleDocumentClick);
  doc.addEventListener("keydown", handleKeydown);
  const show = (anchor, context = {}) => {
    const rawOptions = getOptions(context);
    const normalized = Array.isArray(rawOptions) ? rawOptions.map((option) => {
      if (!option) return null;
      if (typeof option === "string") {
        return { id: option, label: option };
      }
      if (typeof option.id !== "string") return null;
      const label = option.label || option.name;
      if (typeof label !== "string" || !label.trim()) return null;
      return {
        id: option.id,
        label,
        dataset: option.dataset,
        attrs: option.attrs
      };
    }).filter(Boolean) : [];
    if (!normalized.length) {
      hide({ reason: "empty" });
      if (typeof onEmpty === "function") {
        onEmpty(context);
      }
      return false;
    }
    buttons.textContent = "";
    buttons.dataset.empty = "0";
    cancelButton.textContent = cancelLabel;
    message.textContent = headerText;
    normalized.forEach((option) => {
      const button = doc.createElement("button");
      button.type = "button";
      button.textContent = option.label;
      button.dataset.targetListId = option.id;
      applyDataset(button, option.dataset);
      applyAttributes(button, option.attrs);
      buttons.appendChild(button);
    });
    state = { anchor: anchor || null, context, options: normalized };
    root.dataset.visible = "1";
    requestAnimationFrame(() => {
      positionMenu(root, anchor || buttons, { offset, padding });
    });
    if (typeof onOpen === "function") {
      onOpen(context, normalized);
    }
    return true;
  };
  const destroy = () => {
    hide({ reason: "destroy" });
    cancelButton.removeEventListener("click", handleCancel);
    buttons.removeEventListener("click", handleOptionClick);
    doc.removeEventListener("click", handleDocumentClick);
    doc.removeEventListener("keydown", handleKeydown);
    if (root.parentNode) {
      root.parentNode.removeChild(root);
    }
  };
  return {
    show,
    hide,
    destroy,
    get element() {
      return root;
    }
  };
}

// src/popup/modules/manager/moveActions.js
function createManagerMoveActions({
  bulkMoveBtn,
  clearSelection: clearSelection2,
  getAppState,
  getSelectedListDetails,
  loadState,
  sendMessage: sendMessage3,
  setStatus: setStatus2
}) {
  const moveMenu2 = createMoveMenu({
    getOptions: ({ sourceListId }) => {
      const lists = Array.isArray(getAppState()?.lists) ? getAppState().lists : [];
      return lists.filter((list) => list.id !== sourceListId).map((list) => ({ id: list.id, label: list.name }));
    },
    onEmpty: () => {
      setStatus2("\u041D\u0435\u0442 \u0434\u0440\u0443\u0433\u0438\u0445 \u0441\u043F\u0438\u0441\u043A\u043E\u0432", "info", 2500);
    },
    onSelect: async (targetListId, context) => {
      const videoIds = Array.isArray(context?.videoIds) ? context.videoIds : [];
      if (!targetListId || !videoIds.length) return;
      const isBulk = videoIds.length > 1;
      setStatus2(
        isBulk ? `\u041F\u0435\u0440\u0435\u043D\u043E\u0448\u0443 ${videoIds.length} \u0432\u0438\u0434\u0435\u043E...` : "\u041F\u0435\u0440\u0435\u043D\u043E\u0448\u0443 \u0432\u0438\u0434\u0435\u043E...",
        "info"
      );
      try {
        if (videoIds.length === 1) {
          await sendMessage3("playlist:moveVideo", {
            videoId: videoIds[0],
            targetListId
          });
          setStatus2("\u0412\u0438\u0434\u0435\u043E \u043F\u0435\u0440\u0435\u043D\u0435\u0441\u0435\u043D\u043E", "success", 2500);
        } else {
          await sendMessage3("playlist:moveVideos", {
            videoIds,
            targetListId
          });
          setStatus2(`\u041F\u0435\u0440\u0435\u043D\u0435\u0441\u0435\u043D\u043E ${videoIds.length} \u0432\u0438\u0434\u0435\u043E`, "success", 2500);
        }
        await loadState();
        if (isBulk) clearSelection2();
      } catch (err) {
        console.error("Failed to move videos", err);
        setStatus2("\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043F\u0435\u0440\u0435\u043D\u0435\u0441\u0442\u0438", "error", 3e3);
      }
    }
  });
  function showMoveMenu2(videoIds, sourceListId, anchor) {
    const normalizedIds = Array.isArray(videoIds) ? videoIds.map((id) => typeof id === "string" ? id.trim() : "").filter(Boolean) : [];
    if (!normalizedIds.length) return;
    const selectedListDetails2 = getSelectedListDetails();
    const resolvedSourceId = typeof sourceListId === "string" && sourceListId.trim() ? sourceListId : selectedListDetails2?.id || null;
    if (!resolvedSourceId) return;
    let anchorEl = null;
    if (anchor && typeof anchor.getBoundingClientRect === "function") {
      anchorEl = anchor;
    } else if (bulkMoveBtn && typeof bulkMoveBtn.getBoundingClientRect === "function") {
      anchorEl = bulkMoveBtn;
    }
    moveMenu2.show(anchorEl, {
      videoIds: normalizedIds,
      sourceListId: resolvedSourceId
    });
  }
  return { moveMenu: moveMenu2, showMoveMenu: showMoveMenu2 };
}

// src/popup/modules/manager/elements.js
var MANAGER_ELEMENT_IDS = [
  "listsBody",
  "detailList",
  "detailEmpty",
  "selectAllBtn",
  "removeWatchedBtn",
  "clearSelectionBtn",
  "bulkMoveBtn",
  "bulkDeleteBtn",
  "clearListBtn",
  "floatingSelectionActions",
  "status",
  "statusText",
  "statusProgress",
  "statusProgressBar",
  "managerCollectionArea",
  "managerCollectSubscriptions",
  "managerCollectionNote",
  "managerCollectionProgress",
  "managerCollectionStage",
  "managerCollectionCounters",
  "managerCollectionLog",
  "openCreateModal",
  "openImportModal",
  "openAddLinksModal",
  "modalBackdrop",
  "createModal",
  "importModal",
  "editModal",
  "addLinksModal",
  "createForm",
  "createName",
  "createFreeze",
  "importForm",
  "importFile",
  "importModeSelect",
  "importTargetField",
  "importTargetSelect",
  "editForm",
  "editName",
  "editFreeze",
  "addLinksForm",
  "addLinksTextarea"
];
var ELEMENT_ALIASES = {
  managerCollectSubscriptions: "managerCollectBtn",
  openAddLinksModal: "openAddLinksModalBtn",
  openCreateModal: "openCreateModalBtn",
  openImportModal: "openImportModalBtn",
  status: "statusBox"
};
function getManagerElements(documentRef = document) {
  const elements2 = Object.fromEntries(
    MANAGER_ELEMENT_IDS.map((id) => {
      const key = ELEMENT_ALIASES[id] || id;
      return [key, documentRef.getElementById(id)];
    })
  );
  return {
    ...elements2,
    queueSection: documentRef.querySelector(".queue"),
    managerCollectionTitle: elements2.managerCollectionProgress?.querySelector?.(".collection-info h4") || null
  };
}

// src/popup/modules/collection/constants.js
var MAX_STAGE_LOG_ITEMS = 60;
var COLLECTION_STAGE_DEFS = {
  intake: { title: "\u041F\u043E\u043B\u0443\u0447\u0435\u043D\u0438\u0435 \u043F\u043E\u0434\u043F\u0438\u0441\u043E\u043A" },
  playlists: { title: "\u041F\u043E\u0438\u0441\u043A \u043D\u043E\u0432\u044B\u0445 \u0432\u0438\u0434\u0435\u043E \u0432 \u043F\u043E\u0434\u043F\u0438\u0441\u043A\u0430\u0445" },
  videos: { title: "\u0424\u0438\u043B\u044C\u0442\u0440\u0430\u0446\u0438\u044F \u0432\u0438\u0434\u0435\u043E" },
  queue: { title: "\u0414\u043E\u0431\u0430\u0432\u043B\u0435\u043D\u0438\u0435 \u0432 \u043E\u0447\u0435\u0440\u0435\u0434\u044C" },
  error: { title: "\u041E\u0448\u0438\u0431\u043A\u0430" }
};
var PHASE_TO_STAGE = {
  start: "intake",
  channelsLoaded: "intake",
  playlistFetch: "playlists",
  playlistFetched: "playlists",
  aggregate: "playlists",
  filtering: "videos",
  filterProgress: "videos",
  filterStats: "videos",
  filtered: "videos",
  readyToAdd: "queue",
  adding: "queue",
  complete: "queue",
  error: "error"
};
function resolveStageId(event) {
  if (!event?.phase) {
    return null;
  }
  const mapped = PHASE_TO_STAGE[event.phase];
  if (mapped) {
    return mapped;
  }
  if (event.stageId && COLLECTION_STAGE_DEFS[event.stageId]) {
    return event.stageId;
  }
  return event.phase;
}
function getStageTitle(stageId) {
  return (COLLECTION_STAGE_DEFS[stageId] || { title: stageId }).title;
}

// src/popup/modules/collection/metrics.js
var EMPTY_FILTER_TOTALS = Object.freeze({
  filtered: 0,
  broadcasts: 0,
  shorts: 0,
  stoplists: 0,
  passed: 0
});
var numberFormatter = typeof Intl !== "undefined" ? new Intl.NumberFormat("ru-RU") : null;
function formatCount(value) {
  const numeric = Number.isFinite(Number(value)) ? Number(value) : 0;
  const count = Math.max(0, Math.round(numeric));
  return numberFormatter ? numberFormatter.format(count) : String(count);
}
function formatRatio(value, total) {
  const safeTotal = Number(total) || 0;
  const safeValue = Number(value) || 0;
  if (safeTotal > 0) {
    const clamped = Math.min(Math.max(0, safeValue), safeTotal);
    return `${formatCount(clamped)} / ${formatCount(safeTotal)}`;
  }
  return formatCount(safeValue);
}
function resolveFilterTotals(raw) {
  return {
    filtered: Number(raw?.filtered) || 0,
    broadcasts: Number(raw?.broadcasts) || 0,
    shorts: Number(raw?.shorts) || 0,
    stoplists: Number(raw?.stoplists) || 0,
    passed: Number(raw?.passed) || 0
  };
}

// src/popup/modules/collection/summary.js
var INITIAL_STATE = {
  startDate: null,
  channelCount: 0,
  playlistsTotal: 0,
  playlistsDone: 0,
  playlistCurrent: 0,
  playlistId: null,
  lastPlaylistVideoCount: 0,
  fetched: 0,
  filtered: 0,
  filterTotal: 0,
  filterProcessed: 0,
  filterTotals: EMPTY_FILTER_TOTALS,
  filterChannels: [],
  ready: 0,
  readyPotential: 0,
  skippedExisting: 0,
  adding: 0,
  queueBefore: 0,
  added: 0,
  completeTarget: 0,
  errorMessage: ""
};
function createInitialSummary() {
  return {
    ...INITIAL_STATE,
    filterTotals: resolveFilterTotals(EMPTY_FILTER_TOTALS),
    filterChannels: []
  };
}
function createCollectionSummary() {
  const data = createInitialSummary();
  function reset(startDate = null) {
    Object.assign(data, createInitialSummary());
    if (startDate) {
      data.startDate = startDate;
    }
  }
  function update(event = {}) {
    switch (event.phase) {
      case "start":
        if (event.startDate) data.startDate = event.startDate;
        data.channelCount = event.channelCount || 0;
        data.playlistsTotal = event.playlistCount || 0;
        break;
      case "channelsLoaded":
        data.channelCount = event.channelCount || 0;
        data.playlistsTotal = event.playlistCount || 0;
        break;
      case "playlistFetch":
        data.playlistsTotal = event.total || data.playlistsTotal;
        data.playlistCurrent = event.index || data.playlistCurrent;
        break;
      case "playlistFetched":
        data.playlistsTotal = event.total || data.playlistsTotal;
        data.playlistCurrent = event.index || data.playlistCurrent;
        data.playlistsDone = Math.max(
          data.playlistsDone,
          event.index || data.playlistsDone
        );
        data.playlistId = event.playlistId || data.playlistId;
        data.lastPlaylistVideoCount = event.videoCount || data.lastPlaylistVideoCount;
        break;
      case "aggregate":
        data.fetched = event.videoCount || 0;
        break;
      case "filtering":
        data.filtered = 0;
        data.filterTotal = event.videoCount || 0;
        data.filterProcessed = 0;
        data.filterTotals = resolveFilterTotals(EMPTY_FILTER_TOTALS);
        data.filterChannels = [];
        data.readyPotential = 0;
        data.skippedExisting = 0;
        break;
      case "filterProgress":
        if (typeof event.total === "number" && event.total >= 0) {
          data.filterTotal = event.total;
        }
        if (typeof event.processed === "number") {
          const total = data.filterTotal || event.total || event.processed;
          const current = Math.min(
            Math.max(0, event.processed),
            total || event.processed
          );
          data.filterProcessed = Math.max(data.filterProcessed, current);
        }
        break;
      case "filterStats": {
        if (typeof event.total === "number" && event.total >= 0) {
          data.filterTotal = event.total;
        }
        data.filterTotals = resolveFilterTotals(event.totals);
        data.filterChannels = Array.isArray(event.channels) ? event.channels.map((channel) => ({
          name: channel?.name || "",
          title: channel?.title || channel?.name || "",
          new: Number(channel?.new) || 0,
          filtered: Number(channel?.filtered) || 0,
          broadcasts: Number(channel?.broadcasts) || 0,
          shorts: Number(channel?.shorts) || 0,
          add: Number(channel?.add) || 0,
          stoplists: Number(channel?.stoplists) || 0
        })) : [];
        if (typeof event.videoCount === "number") {
          data.filtered = event.videoCount;
        }
        if (data.filterTotal) {
          data.filterProcessed = Math.max(
            data.filterProcessed,
            data.filterTotal
          );
        }
        if (typeof event.readyPotential === "number") {
          data.readyPotential = event.readyPotential;
        } else if (!data.readyPotential) {
          data.readyPotential = data.filterTotals.passed || data.filtered || 0;
        }
        break;
      }
      case "filtered":
        data.filtered = event.videoCount || data.filtered;
        if (data.filterTotal) {
          data.filterProcessed = Math.max(data.filterProcessed, data.filterTotal);
        }
        break;
      case "readyToAdd":
        data.ready = event.videoCount || 0;
        data.skippedExisting = Math.max(0, Number(event.skippedExisting) || 0);
        if (typeof event.sourceTotal === "number" && event.sourceTotal >= 0) {
          data.readyPotential = event.sourceTotal;
        } else if (!data.readyPotential) {
          data.readyPotential = data.filterTotals.passed || data.ready;
        }
        data.completeTarget = data.readyPotential || data.ready || data.completeTarget;
        break;
      case "adding":
        if (typeof event.addCount === "number") {
          data.adding = event.addCount;
        }
        if (typeof event.queueBefore === "number") {
          data.queueBefore = event.queueBefore;
        }
        if (!data.completeTarget) {
          data.completeTarget = data.adding || data.ready || data.readyPotential;
        }
        break;
      case "complete":
        if (typeof event.added === "number") {
          data.added = event.added;
          data.adding = 0;
        }
        if (typeof event.fetched === "number") {
          data.fetched = event.fetched;
          data.completeTarget = event.fetched;
        } else if (!data.completeTarget) {
          data.completeTarget = data.readyPotential || data.ready || data.added;
        }
        if (typeof event.skippedExisting === "number") {
          data.skippedExisting = Math.max(0, event.skippedExisting);
        }
        break;
      case "error":
        data.errorMessage = event.message || "";
        break;
      default:
        break;
    }
  }
  function getMetrics() {
    const metrics = [];
    const playlistTotal = data.playlistsTotal || 0;
    const playlistProgress = Math.max(data.playlistCurrent, data.playlistsDone);
    if (playlistTotal || playlistProgress) {
      const completed = playlistTotal ? Math.min(playlistProgress, playlistTotal) : playlistProgress;
      const total = playlistTotal || completed;
      metrics.push({
        id: "playlists",
        label: "\u041F\u043B\u0435\u0439\u043B\u0438\u0441\u0442\u044B",
        value: completed,
        total,
        text: formatRatio(completed, total)
      });
    }
    const totals = resolveFilterTotals(data.filterTotals);
    const filterTotal = data.filterTotal || data.readyPotential || data.completeTarget || data.fetched || 0;
    const processed = Math.max(
      Number(data.filterProcessed) || 0,
      Number(data.filtered) || 0,
      totals.passed || 0
    );
    if (filterTotal || processed) {
      const total = filterTotal || processed;
      const value = Math.min(processed, total || processed);
      const metric = {
        id: "filter",
        label: "\u0424\u0438\u043B\u044C\u0442\u0440\u0430\u0446\u0438\u044F",
        value,
        total,
        text: formatRatio(value, total)
      };
      if (total > 0 && value >= total && data.added) {
        metric.status = "complete";
      }
      metrics.push(metric);
    }
    return metrics;
  }
  return {
    data,
    reset,
    update,
    getMetrics
  };
}

// src/popup/modules/collection/formatters.js
function shortenId(value, length = 8) {
  if (!value) return "";
  const str = String(value);
  if (str.length <= length) return str;
  const half = Math.max(1, Math.floor((length - 1) / 2));
  return `${str.slice(0, half)}\u2026${str.slice(-half)}`;
}
function formatPlaylistLabel(event = {}) {
  const title = (event.channelTitle || event.playlistTitle || "").trim();
  if (title) {
    return title;
  }
  return shortenId(event.playlistId);
}
function formatFilterBreakdown(totals) {
  const safeTotals = resolveFilterTotals(totals);
  return [
    `\u0412 \u043E\u0447\u0435\u0440\u0435\u0434\u044C ${formatCount(safeTotals.passed)}`,
    `\u0424\u0438\u043B\u044C\u0442\u0440 ${formatCount(safeTotals.filtered)}`,
    `\u0422\u0440\u0430\u043D\u0441\u043B\u044F\u0446\u0438\u0438 ${formatCount(safeTotals.broadcasts)}`,
    `\u0428\u043E\u0440\u0442\u044B ${formatCount(safeTotals.shorts)}`,
    `\u0421\u0442\u043E\u043F-\u043B\u0438\u0441\u0442 ${formatCount(safeTotals.stoplists)}`
  ].join(" \xB7 ");
}
function formatStageMeta(stageId, summary, event = {}) {
  switch (stageId) {
    case "intake": {
      const channels = summary.channelCount || event.channelCount || 0;
      const playlists = summary.playlistsTotal || event.playlistCount || 0;
      if (channels || playlists) {
        if (channels && playlists) {
          return `\u041A\u0430\u043D\u0430\u043B\u044B ${formatCount(channels)}, \u043F\u043B\u0435\u0439\u043B\u0438\u0441\u0442\u044B ${formatCount(
            playlists
          )}`;
        }
        if (channels) {
          return `\u041A\u0430\u043D\u0430\u043B\u044B ${formatCount(channels)}`;
        }
        return `\u041F\u043B\u0435\u0439\u043B\u0438\u0441\u0442\u044B ${formatCount(playlists)}`;
      }
      if (event.startDate || summary.startDate) {
        const text = formatDateTime(event.startDate || summary.startDate);
        if (text) return `\u0421 ${text}`;
      }
      return "\u041F\u043E\u0434\u0433\u043E\u0442\u043E\u0432\u043A\u0430";
    }
    case "playlists": {
      const total = summary.playlistsTotal || event.total || 0;
      const current = Math.max(
        summary.playlistCurrent,
        summary.playlistsDone,
        event.index || 0
      );
      if (total) {
        return `\u041F\u043B\u0435\u0439\u043B\u0438\u0441\u0442 ${formatCount(Math.min(current, total))}/${formatCount(
          total
        )}`;
      }
      if (current) {
        return `\u041F\u043B\u0435\u0439\u043B\u0438\u0441\u0442 ${formatCount(current)}`;
      }
      return "\u0417\u0430\u0433\u0440\u0443\u0437\u043A\u0430 \u043F\u043B\u0435\u0439\u043B\u0438\u0441\u0442\u043E\u0432";
    }
    case "videos": {
      const totals = summary.filterTotals || EMPTY_FILTER_TOTALS;
      const total = summary.filterTotal || event.total || summary.readyPotential || summary.fetched || 0;
      const processed = Math.max(
        summary.filterProcessed || event.processed || 0,
        summary.filtered || event.videoCount || 0,
        totals.passed || 0
      );
      if (total) {
        return `\u0424\u0438\u043B\u044C\u0442\u0440\u0430\u0446\u0438\u044F ${formatCount(Math.min(processed, total))}/${formatCount(
          total
        )}`;
      }
      if (processed) {
        return `\u0424\u0438\u043B\u044C\u0442\u0440\u0430\u0446\u0438\u044F ${formatCount(processed)}`;
      }
      if (summary.fetched || event.videoCount) {
        return `\u041D\u0430\u0439\u0434\u0435\u043D\u043E ${formatCount(summary.fetched || event.videoCount || 0)} \u0432\u0438\u0434\u0435\u043E`;
      }
      return "\u0424\u0438\u043B\u044C\u0442\u0440\u0430\u0446\u0438\u044F";
    }
    case "queue": {
      const added = summary.added || event.added || 0;
      const ready = summary.ready || event.videoCount || 0;
      if (added) {
        const total = summary.completeTarget || summary.readyPotential || summary.fetched || event.fetched || added;
        return `\u0414\u043E\u0431\u0430\u0432\u043B\u0435\u043D\u043E ${formatCount(added)}${total ? ` \u0438\u0437 ${formatCount(total)}` : ""}`;
      }
      if (event.phase === "complete" && !added) {
        const total = summary.completeTarget || summary.readyPotential || summary.fetched || event.fetched || 0;
        if (total) {
          return `\u0414\u043E\u0431\u0430\u0432\u043B\u0435\u043D\u043E 0 \u0438\u0437 ${formatCount(total)}`;
        }
        return "\u041D\u043E\u0432\u044B\u0445 \u0432\u0438\u0434\u0435\u043E \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u043E";
      }
      if (ready) {
        const skipped = summary.skippedExisting || event.skippedExisting || 0;
        if (skipped) {
          return `\u0413\u043E\u0442\u043E\u0432\u043E ${formatCount(ready)} (\u0443\u0436\u0435 \u0432 \u043E\u0447\u0435\u0440\u0435\u0434\u0438 ${formatCount(
            skipped
          )})`;
        }
        return `\u0413\u043E\u0442\u043E\u0432\u043E ${formatCount(ready)}`;
      }
      if (summary.adding || typeof event.addCount === "number") {
        const count = summary.adding || event.addCount || 0;
        const before = summary.queueBefore || event.queueBefore || 0;
        if (before) {
          return `\u0414\u043E\u0431\u0430\u0432\u043B\u044F\u0435\u043C ${formatCount(count)} (\u0431\u044B\u043B\u043E ${formatCount(before)})`;
        }
        return `\u0414\u043E\u0431\u0430\u0432\u043B\u044F\u0435\u043C ${formatCount(count)}`;
      }
      if (summary.queueBefore) {
        return `\u041E\u0447\u0435\u0440\u0435\u0434\u044C \u0431\u044B\u043B\u0430 ${formatCount(summary.queueBefore)}`;
      }
      return "\u0414\u043E\u0431\u0430\u0432\u043B\u0435\u043D\u0438\u0435 \u0432 \u043E\u0447\u0435\u0440\u0435\u0434\u044C";
    }
    case "error":
      return summary.errorMessage || event.message || "\u041E\u0448\u0438\u0431\u043A\u0430";
    default:
      return "";
  }
}
function formatStageLog(event = {}, summary) {
  switch (event.phase) {
    case "start":
      return event.startDate ? `\u0421\u0442\u0430\u0440\u0442 \u0441 ${formatDateTime(event.startDate)}` : "\u0417\u0430\u043F\u0443\u0441\u043A \u043F\u0440\u043E\u0446\u0435\u0441\u0441\u0430";
    case "channelsLoaded":
      return `\u041F\u043E\u043B\u0443\u0447\u0435\u043D\u043E ${event.channelCount || 0} \u043A\u0430\u043D\u0430\u043B\u043E\u0432 \u0438 ${event.playlistCount || 0} \u043F\u043B\u0435\u0439\u043B\u0438\u0441\u0442\u043E\u0432`;
    case "playlistFetch":
      return null;
    case "playlistFetched": {
      const index = Number(event.index);
      const total = Number(event.total);
      const parts = [];
      if (Number.isFinite(total) && total > 0) {
        const boundedIndex = Math.max(0, Math.min(Number.isFinite(index) ? index : 0, total));
        parts.push(`${formatCount(boundedIndex)}/${formatCount(total)}`);
      } else if (Number.isFinite(index) && index > 0) {
        parts.push(formatCount(index));
      }
      parts.push(`${formatCount(event.videoCount || 0)} \u0432\u0438\u0434\u0435\u043E`);
      const label = formatPlaylistLabel(event);
      if (label) {
        parts.push(label);
      }
      return parts.join(" \u2013 ");
    }
    case "aggregate":
      return `\u0421\u043E\u0431\u0440\u0430\u043D\u043E ${event.videoCount || 0} \u0443\u043D\u0438\u043A\u0430\u043B\u044C\u043D\u044B\u0445 \u0432\u0438\u0434\u0435\u043E`;
    case "filtering":
      return `\u0424\u0438\u043B\u044C\u0442\u0440\u0430\u0446\u0438\u044F (${formatCount(event.videoCount || 0)})`;
    case "filterProgress":
      if (event.total) {
        return `\u0424\u0438\u043B\u044C\u0442\u0440\u0430\u0446\u0438\u044F ${formatCount(event.processed || 0)}/${formatCount(
          event.total
        )}`;
      }
      return `\u0424\u0438\u043B\u044C\u0442\u0440\u0430\u0446\u0438\u044F ${formatCount(event.processed || 0)}`;
    case "filterStats":
      return formatFilterBreakdown(event.totals || summary?.filterTotals);
    case "filtered":
      return null;
    case "readyToAdd":
      return event.skippedExisting ? `\u041A \u0434\u043E\u0431\u0430\u0432\u043B\u0435\u043D\u0438\u044E ${formatCount(event.videoCount || 0)} \u0432\u0438\u0434\u0435\u043E (\u0443\u0436\u0435 \u0432 \u043E\u0447\u0435\u0440\u0435\u0434\u0438 ${formatCount(event.skippedExisting || 0)})` : `\u041A \u0434\u043E\u0431\u0430\u0432\u043B\u0435\u043D\u0438\u044E ${formatCount(event.videoCount || 0)} \u0432\u0438\u0434\u0435\u043E`;
    case "adding":
      return `\u0414\u043E\u0431\u0430\u0432\u043B\u044F\u0435\u043C ${formatCount(event.addCount || 0)} \u0432\u0438\u0434\u0435\u043E (\u043E\u0447\u0435\u0440\u0435\u0434\u044C \u0431\u044B\u043B\u0430 ${formatCount(
        event.queueBefore || 0
      )})`;
    case "complete":
      return event.added ? `\u0412 \u043E\u0447\u0435\u0440\u0435\u0434\u044C \u0434\u043E\u0431\u0430\u0432\u043B\u0435\u043D\u043E ${formatCount(event.added)} \u0438\u0437 ${formatCount(
        event.fetched || event.added
      )}` : "\u041D\u043E\u0432\u044B\u0445 \u0432\u0438\u0434\u0435\u043E \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u043E";
    case "error":
      return event.message || "\u041F\u0440\u043E\u0438\u0437\u043E\u0448\u043B\u0430 \u043E\u0448\u0438\u0431\u043A\u0430";
    default:
      return null;
  }
}
function getStatusInfo(event = {}, summary) {
  if (!event.phase) return null;
  switch (event.phase) {
    case "start":
      return { text: "\u0421\u0431\u043E\u0440 \u043F\u043E\u0434\u043F\u0438\u0441\u043E\u043A...", kind: "info", timeout: 0 };
    case "channelsLoaded":
      return {
        text: `\u041A\u0430\u043D\u0430\u043B\u043E\u0432: ${event.channelCount || 0}, \u043F\u043B\u0435\u0439\u043B\u0438\u0441\u0442\u043E\u0432: ${event.playlistCount || 0}`,
        kind: "info",
        timeout: 0
      };
    case "playlistFetch":
      return {
        text: `\u0417\u0430\u0433\u0440\u0443\u0437\u043A\u0430 \u043F\u043B\u0435\u0439\u043B\u0438\u0441\u0442\u043E\u0432 ${event.index || 0}/${event.total || 0}`,
        kind: "info",
        timeout: 0
      };
    case "playlistFetched":
      return {
        text: `\u041F\u043B\u0435\u0439\u043B\u0438\u0441\u0442 ${event.index || 0}/${event.total || 0}: +${event.videoCount || 0}`,
        kind: "info",
        timeout: 0
      };
    case "aggregate":
      return {
        text: `\u041D\u0430\u0439\u0434\u0435\u043D\u043E ${event.videoCount || 0} \u0432\u0438\u0434\u0435\u043E`,
        kind: "info",
        timeout: 0
      };
    case "filtering":
      return {
        text: `\u0424\u0438\u043B\u044C\u0442\u0440\u0430\u0446\u0438\u044F ${event.videoCount || 0} \u0432\u0438\u0434\u0435\u043E`,
        kind: "info",
        timeout: 0
      };
    case "filterProgress": {
      const processed = Number(event.processed) || 0;
      const total = Number(event.total) || processed;
      return {
        text: `\u0424\u0438\u043B\u044C\u0442\u0440\u0430\u0446\u0438\u044F ${processed}/${total}`,
        kind: "info",
        timeout: 0
      };
    }
    case "filterStats": {
      const breakdown = formatFilterBreakdown(
        event.totals || summary?.filterTotals
      );
      if (breakdown) {
        return {
          text: breakdown,
          kind: "info",
          timeout: 0
        };
      }
      const totals = event.totals || {};
      const total = Number(event.total) || Number(event.initialCount) || 0;
      const passed = totals.passed || event.videoCount || 0;
      const base = total ? `\u041F\u043E\u0441\u043B\u0435 \u0444\u0438\u043B\u044C\u0442\u0440\u0430 ${passed}/${total}` : `\u041F\u043E\u0441\u043B\u0435 \u0444\u0438\u043B\u044C\u0442\u0440\u0430 ${passed}`;
      return {
        text: base,
        kind: "info",
        timeout: 0
      };
    }
    case "filtered": {
      const breakdown = formatFilterBreakdown(
        summary?.filterTotals || event.totals
      );
      if (breakdown) {
        return {
          text: breakdown,
          kind: "info",
          timeout: 0
        };
      }
      return {
        text: `\u041F\u043E\u0441\u043B\u0435 \u0444\u0438\u043B\u044C\u0442\u0440\u0430 ${event.videoCount || 0}`,
        kind: "info",
        timeout: 0
      };
    }
    case "readyToAdd":
      return {
        text: event.skippedExisting && event.skippedExisting > 0 ? `\u041A \u0434\u043E\u0431\u0430\u0432\u043B\u0435\u043D\u0438\u044E ${event.videoCount || 0} \u0432\u0438\u0434\u0435\u043E (\u0443\u0436\u0435 \u0432 \u043E\u0447\u0435\u0440\u0435\u0434\u0438 ${event.skippedExisting})` : `\u041A \u0434\u043E\u0431\u0430\u0432\u043B\u0435\u043D\u0438\u044E ${event.videoCount || 0} \u0432\u0438\u0434\u0435\u043E`,
        kind: "info",
        timeout: 0
      };
    case "adding":
      return {
        text: `\u0414\u043E\u0431\u0430\u0432\u043B\u044F\u0435\u043C ${event.addCount || 0} \u0432\u0438\u0434\u0435\u043E`,
        kind: "info",
        timeout: 0
      };
    case "complete":
      return summary?.added ? {
        text: `\u0414\u043E\u0431\u0430\u0432\u043B\u0435\u043D\u043E ${summary.added} \u0438\u0437 ${summary.fetched || summary.added}`,
        kind: "success",
        timeout: 5e3
      } : {
        text: "\u041D\u043E\u0432\u044B\u0445 \u0432\u0438\u0434\u0435\u043E \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u043E",
        kind: "info",
        timeout: 5e3
      };
    case "error":
      return {
        text: event.message || "\u041E\u0448\u0438\u0431\u043A\u0430 \u043F\u0440\u0438 \u0441\u0431\u043E\u0440\u0435 \u043F\u043E\u0434\u043F\u0438\u0441\u043E\u043A",
        kind: "error",
        timeout: 6e3
      };
    default:
      return null;
  }
}
function getStageDefinition(stageId) {
  return COLLECTION_STAGE_DEFS[stageId] || { title: stageId };
}

// src/popup/modules/collection/stageLog.js
function createStageLogManager({ logEl, collapsed = true } = {}) {
  if (!logEl) {
    return {
      clear() {
      },
      applyUpdate() {
        return null;
      },
      markCompleted() {
      },
      openStage() {
      }
    };
  }
  const isCollapsed = Boolean(collapsed);
  const stages = /* @__PURE__ */ new Map();
  function clear() {
    stages.forEach((entry) => entry.container?.remove());
    stages.clear();
    logEl.textContent = "";
  }
  function ensure(stageId) {
    let entry = stages.get(stageId);
    if (entry) {
      logEl.prepend(entry.container);
      return entry;
    }
    const doc = logEl.ownerDocument;
    const container = doc.createElement("li");
    container.className = "collection-stage";
    const details = doc.createElement("details");
    details.open = !isCollapsed;
    const summaryNode = doc.createElement("summary");
    summaryNode.className = "collection-stage__summary";
    const summaryRow = doc.createElement("div");
    summaryRow.className = "collection-stage__summary-row";
    const title = doc.createElement("span");
    title.className = "collection-stage__title";
    title.textContent = getStageDefinition(stageId).title;
    const meta = doc.createElement("span");
    meta.className = "collection-stage__meta";
    meta.hidden = true;
    summaryRow.append(title, meta);
    const statusLine = doc.createElement("div");
    statusLine.className = "collection-stage__status";
    statusLine.hidden = true;
    summaryNode.append(summaryRow, statusLine);
    const body = doc.createElement("div");
    body.className = "collection-stage__body";
    details.append(summaryNode, body);
    container.append(details);
    logEl.prepend(container);
    entry = {
      id: stageId,
      container,
      details,
      summaryTitle: title,
      summaryMeta: meta,
      summaryStatus: statusLine,
      body,
      logs: [],
      lastLogText: ""
    };
    stages.set(stageId, entry);
    return entry;
  }
  function updateSummaryStatus(entry) {
    if (!entry?.summaryStatus) return;
    if (entry.lastLogText) {
      entry.summaryStatus.textContent = entry.lastLogText;
      entry.summaryStatus.hidden = false;
    } else {
      entry.summaryStatus.textContent = "";
      entry.summaryStatus.hidden = true;
    }
  }
  function addStageLog(entry, text) {
    if (!entry?.body || !text) return;
    if (entry.lastLogText === text) {
      return;
    }
    const item = entry.body.ownerDocument.createElement("div");
    item.className = "collection-stage__log";
    const timestamped = `[${formatClockTime()}] ${text}`;
    item.textContent = timestamped;
    entry.body.prepend(item);
    entry.logs.unshift(item);
    entry.lastLogText = text;
    updateSummaryStatus(entry);
    while (entry.logs.length > MAX_STAGE_LOG_ITEMS) {
      const tail = entry.logs.pop();
      tail?.remove();
    }
  }
  function addFilterTable(entry, channels) {
    if (!entry?.body || !channels?.length) return;
    const doc = entry.body.ownerDocument;
    const item = doc.createElement("div");
    item.className = "collection-stage__log collection-stage__log--table";
    const timestamp = doc.createElement("div");
    timestamp.className = "collection-stage__log-time";
    timestamp.textContent = `[${formatClockTime()}]`;
    const scroll = doc.createElement("div");
    scroll.className = "collection-stage__table-wrap";
    const table = doc.createElement("table");
    table.className = "collection-stage__table";
    const head = doc.createElement("thead");
    const headRow = doc.createElement("tr");
    const headers = [
      "\u041A\u0430\u043D\u0430\u043B",
      "\u041D\u043E\u0432\u044B\u0435",
      "\u0424\u0438\u043B\u044C\u0442\u0440",
      "\u0422\u0440\u0430\u043D\u0441\u043B\u044F\u0446\u0438\u0438",
      "\u0428\u043E\u0440\u0442\u044B",
      "\u0412 \u043E\u0447\u0435\u0440\u0435\u0434\u044C",
      "\u0421\u0442\u043E\u043F-\u043B\u0438\u0441\u0442"
    ];
    headers.forEach((label) => {
      const cell = doc.createElement("th");
      cell.textContent = label;
      headRow.append(cell);
    });
    head.append(headRow);
    const body = doc.createElement("tbody");
    channels.forEach((channel) => {
      const row = doc.createElement("tr");
      const cells = [
        channel?.title || channel?.name || "",
        channel?.new ?? "",
        channel?.filtered ?? "",
        channel?.broadcasts ?? "",
        channel?.shorts ?? "",
        channel?.add ?? "",
        channel?.stoplists ?? ""
      ];
      cells.forEach((value, index) => {
        const cell = doc.createElement("td");
        cell.textContent = `${value ?? ""}`;
        if (index === 0) {
          cell.classList.add("is-name");
        }
        row.append(cell);
      });
      body.append(row);
    });
    table.append(head, body);
    scroll.append(table);
    item.append(timestamp, scroll);
    entry.body.prepend(item);
    entry.logs.unshift(item);
    while (entry.logs.length > MAX_STAGE_LOG_ITEMS) {
      const tail = entry.logs.pop();
      tail?.remove();
    }
  }
  function applyUpdate(stageId, event, summary) {
    const entry = ensure(stageId);
    if (!entry) return null;
    if (entry.summaryTitle && event?.titleOverride) {
      entry.summaryTitle.textContent = event.titleOverride;
    }
    if (entry.summaryMeta) {
      const metaText = formatStageMeta(stageId, summary, event);
      entry.summaryMeta.textContent = metaText || "";
      entry.summaryMeta.hidden = !metaText;
    }
    const logText = formatStageLog(event, summary);
    if (logText) {
      addStageLog(entry, logText);
    }
    if (event?.phase === "filterStats" && Array.isArray(event.channels)) {
      addFilterTable(entry, event.channels);
    } else if (Array.isArray(event?.logEntries) && event.logEntries.length) {
      for (let i = event.logEntries.length - 1; i >= 0; i -= 1) {
        const text = event.logEntries[i];
        if (typeof text === "string" && text.trim()) {
          addStageLog(entry, text);
        }
      }
    }
    updateSummaryStatus(entry);
    return entry;
  }
  function markCompleted(stageId, isError = false) {
    const entry = stages.get(stageId);
    if (!entry || !entry.container) return;
    entry.container.classList.add(isError ? "error" : "completed");
    if (entry.details) {
      entry.details.open = false;
    }
  }
  function openStage(stageId) {
    stages.forEach((entry, id) => {
      if (!entry.details) return;
      if (id === stageId) {
        entry.details.open = true;
      } else if (isCollapsed || entry.container.classList.contains("completed")) {
        entry.details.open = false;
      }
    });
  }
  return {
    clear,
    applyUpdate,
    markCompleted,
    openStage
  };
}

// src/popup/modules/collection/index.js
function createCollectionController({
  progressEl,
  stageTextEl,
  countersEl,
  logEl,
  titleEl,
  setStatus: setStatus2 = () => {
  }
} = {}) {
  const summary = createCollectionSummary();
  const stageLog = createStageLogManager({ logEl, collapsed: true });
  const headerTitleEl = titleEl || progressEl?.querySelector?.(".collection-info h4") || null;
  const baseTitle = (headerTitleEl?.textContent || "").trim() || "\u0421\u0431\u043E\u0440 \u043F\u043E\u0434\u043F\u0438\u0441\u043E\u043A";
  const state = {
    active: false,
    currentStage: null,
    hasHistory: false
  };
  function renderCounters() {
    if (!countersEl) {
      return;
    }
    const metrics = summary.getMetrics();
    const doc = countersEl.ownerDocument || document;
    countersEl.textContent = "";
    countersEl.classList.add("collection-metrics");
    if (!metrics.length) {
      return;
    }
    for (const metric of metrics) {
      const item = doc.createElement("div");
      item.className = "collection-metric";
      if (metric?.id) {
        item.dataset.metricId = metric.id;
      }
      if (metric?.status === "complete") {
        item.classList.add("is-complete");
      }
      const header = doc.createElement("div");
      header.className = "collection-metric__header";
      const label = doc.createElement("span");
      label.className = "collection-metric__label";
      label.textContent = metric?.label || "";
      const value = doc.createElement("span");
      value.className = "collection-metric__value";
      value.textContent = metric?.text || "";
      header.append(label, value);
      item.append(header);
      const bar = doc.createElement("div");
      bar.className = "collection-metric__bar";
      const fill = doc.createElement("div");
      fill.className = "collection-metric__fill";
      const total = Number(metric?.total);
      const current = Number(metric?.value);
      let ratio = 0;
      if (Number.isFinite(total) && total > 0) {
        const safeValue = Number.isFinite(current) ? current : 0;
        ratio = Math.max(0, Math.min(1, safeValue / total));
      } else if (Number.isFinite(current) && current > 0) {
        ratio = 1;
      }
      const width = `${(ratio * 100).toFixed(1)}%`;
      fill.style.width = width;
      if (ratio > 0 && ratio < 0.04) {
        fill.style.minWidth = "3%";
      }
      bar.append(fill);
      item.append(bar);
      if (metric?.caption) {
        const caption = doc.createElement("div");
        caption.className = "collection-metric__caption";
        caption.textContent = metric.caption;
        item.append(caption);
      }
      if (Array.isArray(metric?.details) && metric.details.length) {
        const details = doc.createElement("div");
        details.className = "collection-metric__details";
        for (const detail of metric.details) {
          if (!detail?.label) continue;
          const detailItem = doc.createElement("span");
          detailItem.className = "collection-metric__detail";
          const detailLabel = doc.createElement("span");
          detailLabel.className = "collection-metric__detail-label";
          detailLabel.textContent = detail.label;
          const detailValue = doc.createElement("span");
          detailValue.className = "collection-metric__detail-value";
          detailValue.textContent = detail?.text || String(detail?.value ?? "");
          detailItem.append(detailLabel, detailValue);
          details.append(detailItem);
        }
        if (details.childNodes.length) {
          item.append(details);
        }
      }
      countersEl.append(item);
    }
  }
  function resetView(startDate) {
    state.currentStage = null;
    summary.reset(startDate);
    stageLog.clear();
    if (progressEl) {
      progressEl.classList.remove("finished", "error");
    }
    if (stageTextEl) {
      stageTextEl.textContent = "";
      stageTextEl.hidden = true;
    }
    if (headerTitleEl) {
      headerTitleEl.textContent = baseTitle;
    }
    renderCounters();
  }
  function hidePanel({ clear = false } = {}) {
    if (!progressEl) return;
    if (clear) {
      resetView();
      state.hasHistory = false;
    }
    progressEl.hidden = true;
    progressEl.classList.add("is-hidden");
  }
  function showPanel() {
    if (!progressEl) return;
    progressEl.hidden = false;
    progressEl.classList.remove("is-hidden");
  }
  function updateHeader(stageId) {
    const stageTitle = getStageTitle(stageId);
    if (headerTitleEl) {
      headerTitleEl.textContent = stageTitle ? `${baseTitle} \u2013 ${stageTitle}` : baseTitle;
    }
    if (stageTextEl) {
      stageTextEl.textContent = "";
      stageTextEl.hidden = true;
    }
    renderCounters();
  }
  function beginProgress(event) {
    state.active = true;
    state.hasHistory = true;
    resetView(event?.startDate);
    showPanel();
  }
  function ensureVisible() {
    if (!progressEl) return;
    if (!progressEl.hidden) return;
    if (!state.hasHistory && !state.active) return;
    showPanel();
  }
  function handleEvent(event) {
    if (!event?.phase) return null;
    const stageId = resolveStageId(event);
    if (!stageId) return null;
    if (event.phase === "start") {
      beginProgress(event);
    } else {
      state.hasHistory = true;
      ensureVisible();
      if (progressEl) {
        progressEl.classList.remove("finished", "error");
      }
    }
    summary.update(event);
    if (state.currentStage && state.currentStage !== stageId) {
      stageLog.markCompleted(state.currentStage);
    }
    const entry = stageLog.applyUpdate(stageId, event, summary.data);
    state.currentStage = stageId;
    if (event.phase === "complete") {
      stageLog.markCompleted(stageId);
      if (progressEl) {
        progressEl.classList.add("finished");
      }
      state.active = false;
    } else if (event.phase === "error") {
      stageLog.markCompleted(stageId, true);
      if (progressEl) {
        progressEl.classList.add("error");
      }
      state.active = false;
    } else if (entry) {
      stageLog.openStage(stageId);
    }
    updateHeader(stageId);
    const statusInfo = getStatusInfo(event, summary.data);
    if (statusInfo) {
      setStatus2(statusInfo.text, statusInfo.kind, statusInfo.timeout);
    }
    return event.phase;
  }
  hidePanel({ clear: true });
  return {
    handleEvent,
    hidePanel,
    showPanel,
    showIfHasHistory: () => {
      if (state.hasHistory || state.active) {
        showPanel();
      }
    },
    clear: () => hidePanel({ clear: true }),
    isActive: () => state.active,
    hasHistory: () => state.hasHistory
  };
}

// src/popup/modules/collection/availability.js
function readAutoCollectMeta(state) {
  const meta = state?.autoCollect || {};
  const cooldownMs = Number(meta.cooldownMs) || 0;
  const lastRunAt = Number(meta.lastRunAt) || 0;
  const storedNext = Number(meta.nextAutoCollectAt) || 0;
  let nextRun = storedNext;
  if (!nextRun && cooldownMs > 0 && lastRunAt > 0) {
    nextRun = lastRunAt + cooldownMs;
  }
  return {
    lastRunAt,
    lastAdded: Number(meta.lastAdded) || 0,
    lastFetched: Number(meta.lastFetched) || 0,
    nextAutoCollectAt: storedNext,
    nextRunAt: nextRun > 0 ? nextRun : 0,
    cooldownMs
  };
}
function formatTimeOfDay(timestamp) {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}
function formatCooldownMessage(remainingMs, targetTime) {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1e3));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor(totalSeconds % 3600 / 60);
  const seconds = totalSeconds % 60;
  const parts = [];
  if (hours > 0) {
    parts.push(`${hours} \u0447`);
  }
  if (minutes > 0 || hours > 0) {
    parts.push(`${minutes} \u043C\u0438\u043D`);
  }
  if (!parts.length) {
    parts.push(`${seconds} \u0441\u0435\u043A`);
  }
  const timeLabel = formatTimeOfDay(targetTime);
  return timeLabel ? `\u0421\u0431\u043E\u0440 \u0431\u0443\u0434\u0435\u0442 \u0434\u043E\u0441\u0442\u0443\u043F\u0435\u043D \u0447\u0435\u0440\u0435\u0437 ${parts.join(" ")} (\u2248 ${timeLabel})` : `\u0421\u0431\u043E\u0440 \u0431\u0443\u0434\u0435\u0442 \u0434\u043E\u0441\u0442\u0443\u043F\u0435\u043D \u0447\u0435\u0440\u0435\u0437 ${parts.join(" ")}`;
}
function createCollectionAvailabilityController({
  applyState,
  collectBtn,
  collectionArea,
  collectionNote,
  collectionController: collectionController2,
  defaultListId,
  getPlaylistState,
  getSelectedListId,
  refreshState,
  setLoading,
  setStatus: setStatus2,
  sendMessage: sendMessage3
}) {
  let isCollecting = false;
  let collectionCooldownTimer = null;
  let collectionCooldownTarget = 0;
  function stopCollectionCooldownTimer() {
    if (collectionCooldownTimer) {
      clearInterval(collectionCooldownTimer);
      collectionCooldownTimer = null;
    }
  }
  function updateCollectionCooldownMessage() {
    if (!collectionNote) {
      stopCollectionCooldownTimer();
      collectionCooldownTarget = 0;
      return;
    }
    if (!collectionCooldownTarget) {
      stopCollectionCooldownTimer();
      collectionNote.hidden = true;
      collectionNote.textContent = "";
      return;
    }
    const remaining = Math.max(0, collectionCooldownTarget - Date.now());
    if (remaining <= 0) {
      collectionCooldownTarget = 0;
      stopCollectionCooldownTimer();
      collectionNote.hidden = true;
      collectionNote.textContent = "";
      updateAvailability();
      return;
    }
    collectionNote.hidden = false;
    collectionNote.textContent = formatCooldownMessage(
      remaining,
      collectionCooldownTarget
    );
  }
  function startCollectionCooldownTimer(targetTime) {
    collectionCooldownTarget = Number(targetTime) || 0;
    if (!collectionCooldownTarget) {
      updateCollectionCooldownMessage();
      return;
    }
    updateCollectionCooldownMessage();
    if (!collectionCooldownTimer) {
      collectionCooldownTimer = window.setInterval(
        updateCollectionCooldownMessage,
        1e3
      );
    }
  }
  function updateAvailability() {
    if (!collectBtn && !collectionArea) return;
    const playlistState = getPlaylistState() || {};
    const selectedListId2 = getSelectedListId();
    const isDefaultList = selectedListId2 === defaultListId;
    const autoMeta = readAutoCollectMeta(playlistState);
    const now = Date.now();
    const nextRunAt = autoMeta.nextRunAt || autoMeta.nextAutoCollectAt || 0;
    const onCooldown = isDefaultList && nextRunAt > now;
    const controllerActive = Boolean(collectionController2?.isActive?.());
    const showArea = isDefaultList || controllerActive;
    const busy = isCollecting || controllerActive;
    if (collectionArea) {
      const hidden = !showArea;
      collectionArea.hidden = hidden;
      collectionArea.classList.toggle("hidden", hidden);
      if (hidden) {
        stopCollectionCooldownTimer();
        if (collectionNote) {
          collectionNote.hidden = true;
          collectionNote.textContent = "";
        }
      } else {
        collectionController2?.showIfHasHistory?.();
      }
    }
    if (collectBtn) {
      const showButton = isDefaultList && !onCooldown && !busy;
      collectBtn.classList.toggle("hidden", !showButton);
      if (showButton) {
        const loading = collectBtn.dataset.loading === "1";
        collectBtn.disabled = loading || busy;
      } else {
        collectBtn.disabled = true;
      }
    }
    if (collectionNote) {
      if (isDefaultList && onCooldown) {
        startCollectionCooldownTimer(nextRunAt);
      } else {
        collectionNote.hidden = true;
        collectionNote.textContent = "";
        stopCollectionCooldownTimer();
      }
    }
  }
  async function collectSubscriptions() {
    if (collectBtn?.classList.contains("hidden")) return;
    if (isCollecting) return;
    isCollecting = true;
    setLoading(collectBtn, true);
    setStatus2("\u0421\u043E\u0431\u0438\u0440\u0430\u044E \u043D\u043E\u0432\u044B\u0435 \u0432\u0438\u0434\u0435\u043E...", "info", 0);
    updateAvailability();
    try {
      const result = await sendMessage3("playlist:collectSubscriptions");
      if (result?.error === "ON_COOLDOWN") {
        if (result?.state) {
          await applyState?.(result.state);
        }
        const nextRunAt = Number(result.nextRunAt) || 0;
        const remaining = Number(result.remainingMs) || (nextRunAt ? Math.max(0, nextRunAt - Date.now()) : 0);
        const message = remaining ? formatCooldownMessage(remaining, nextRunAt) : "\u0421\u0431\u043E\u0440 \u043C\u043E\u0436\u043D\u043E \u0437\u0430\u043F\u0443\u0441\u043A\u0430\u0442\u044C \u043D\u0435 \u0447\u0430\u0449\u0435 \u0440\u0430\u0437\u0430 \u0432 \u0447\u0430\u0441";
        setStatus2(message, "info", 4e3);
        return;
      }
      if (result?.state) {
        await applyState?.(result.state);
      } else {
        await refreshState?.();
      }
    } catch (err) {
      console.error(err);
      setStatus2("\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0441\u043E\u0431\u0440\u0430\u0442\u044C \u043F\u043E\u0434\u043F\u0438\u0441\u043A\u0438", "error", 4e3);
    } finally {
      setLoading(collectBtn, false);
      isCollecting = false;
      updateAvailability();
    }
  }
  function handleProgressMessage(message) {
    const phase = collectionController2?.handleEvent?.(message.event || message);
    if (phase === "complete" || phase === "error") {
      isCollecting = false;
      setLoading?.(collectBtn, false);
    }
    updateAvailability();
    return phase;
  }
  return {
    collectSubscriptions,
    handleProgressMessage,
    teardown: stopCollectionCooldownTimer,
    updateAvailability
  };
}

// src/popup/modules/manager/listView.js
function makeActionButton(text, action, listId, options = {}) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = text;
  button.dataset.action = action;
  button.dataset.listId = listId;
  if (options.className) button.className = options.className;
  if (options.disabled) button.disabled = true;
  return button;
}
function createFreezeIndicator(list, defaultListId) {
  const indicator = document.createElement("span");
  indicator.className = "list-card-freeze-indicator";
  indicator.setAttribute("role", "img");
  const isFrozen = Boolean(
    list?.id && list.id !== defaultListId && list.freeze
  );
  const icon = isFrozen ? "\u{1F9CA}" : "\u{1F525}";
  const label = isFrozen ? "\u0421\u043F\u0438\u0441\u043E\u043A \u043D\u0435\u0438\u0437\u043C\u0435\u043D\u044F\u0435\u043C\u044B\u0439: \u0432\u0438\u0434\u0435\u043E \u043D\u0435 \u0443\u0434\u0430\u043B\u044F\u044E\u0442\u0441\u044F \u0430\u0432\u0442\u043E\u043C\u0430\u0442\u0438\u0447\u0435\u0441\u043A\u0438" : "\u0421\u043F\u0438\u0441\u043E\u043A \u0430\u0432\u0442\u043E\u043C\u0430\u0442\u0438\u0447\u0435\u0441\u043A\u0438 \u043E\u0447\u0438\u0449\u0430\u0435\u0442\u0441\u044F: \u043F\u0440\u043E\u0441\u043C\u043E\u0442\u0440\u0435\u043D\u043D\u044B\u0435 \u0432\u0438\u0434\u0435\u043E \u0443\u0434\u0430\u043B\u044F\u044E\u0442\u0441\u044F";
  const state = isFrozen ? "frozen" : "active";
  indicator.textContent = icon;
  indicator.setAttribute("data-state", state);
  indicator.setAttribute("title", label);
  indicator.setAttribute("aria-label", label);
  return indicator;
}
function createListCard({
  list,
  activeListId,
  selectedListId: selectedListId2,
  defaultListId,
  onOpenList
}) {
  const item = document.createElement("li");
  item.className = "list-card";
  item.dataset.listId = list.id;
  if (list.id === selectedListId2) {
    item.classList.add("active");
  }
  const main = document.createElement("div");
  main.className = "list-card-main";
  const header = document.createElement("div");
  header.className = "list-card-header";
  const title = document.createElement("div");
  title.className = "list-card-title";
  const isDefaultList = list.id === defaultListId;
  if (isDefaultList) {
    title.classList.add("list-card-title--system");
    title.title = "\u0421\u0438\u0441\u0442\u0435\u043C\u043D\u044B\u0439 \u0441\u043F\u0438\u0441\u043E\u043A \u2014 \u0440\u0435\u0434\u0430\u043A\u0442\u0438\u0440\u043E\u0432\u0430\u043D\u0438\u0435 \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u043D\u043E";
    const lock = document.createElement("span");
    lock.className = "list-card-title-lock";
    lock.textContent = "\u{1F512}";
    lock.setAttribute("aria-hidden", "true");
    title.appendChild(lock);
  }
  const freezeIndicator = createFreezeIndicator(list, defaultListId);
  freezeIndicator.classList.add("list-card-freeze-indicator--inline");
  title.appendChild(freezeIndicator);
  const titleText = document.createElement("span");
  titleText.className = "list-card-title-text";
  titleText.textContent = list.name || "\u0411\u0435\u0437 \u043D\u0430\u0437\u0432\u0430\u043D\u0438\u044F";
  title.appendChild(titleText);
  if (list.id && list.id === activeListId) {
    const activeBadge = document.createElement("span");
    activeBadge.className = "list-card-toggle list-card-toggle--active";
    activeBadge.textContent = "\u0421\u043C\u043E\u0442\u0440\u0438\u043C";
    activeBadge.setAttribute(
      "aria-label",
      "\u042D\u0442\u043E\u0442 \u0441\u043F\u0438\u0441\u043E\u043A \u0438\u0441\u043F\u043E\u043B\u044C\u0437\u0443\u0435\u0442\u0441\u044F \u0434\u043B\u044F \u0432\u043E\u0441\u043F\u0440\u043E\u0438\u0437\u0432\u0435\u0434\u0435\u043D\u0438\u044F"
    );
    title.appendChild(activeBadge);
  } else if (list.id) {
    const activateButton = document.createElement("button");
    activateButton.type = "button";
    activateButton.className = "list-card-toggle";
    activateButton.dataset.action = "activate";
    activateButton.dataset.listId = list.id;
    activateButton.textContent = "\u0421\u043C\u043E\u0442\u0440\u0435\u0442\u044C \u044D\u0442\u043E\u0442";
    activateButton.setAttribute(
      "aria-label",
      "\u0421\u0434\u0435\u043B\u0430\u0442\u044C \u0441\u043F\u0438\u0441\u043E\u043A \u0430\u043A\u0442\u0438\u0432\u043D\u044B\u043C \u0434\u043B\u044F \u0432\u043E\u0441\u043F\u0440\u043E\u0438\u0437\u0432\u0435\u0434\u0435\u043D\u0438\u044F"
    );
    title.appendChild(activateButton);
  }
  header.appendChild(title);
  main.appendChild(header);
  const meta = document.createElement("div");
  meta.className = "list-card-meta";
  const metaText = document.createElement("span");
  metaText.className = "list-card-meta-text";
  const metaParts = [`${list.length ?? 0} \u0432\u0438\u0434\u0435\u043E`];
  metaParts.push(
    list.freeze ? "\u0421\u043E\u0445\u0440\u0430\u043D\u044F\u0435\u0442 \u043F\u0440\u043E\u0441\u043C\u043E\u0442\u0440\u0435\u043D\u043D\u044B\u0435" : "\u0423\u0434\u0430\u043B\u044F\u0435\u0442 \u043F\u0440\u043E\u0441\u043C\u043E\u0442\u0440\u0435\u043D\u043D\u044B\u0435"
  );
  metaText.textContent = metaParts.join(" \u2022 ");
  meta.appendChild(metaText);
  main.appendChild(meta);
  item.appendChild(main);
  const actions = document.createElement("div");
  actions.className = "list-card-actions";
  if (!isDefaultList) {
    actions.appendChild(makeActionButton("\u0420\u0435\u0434\u0430\u043A\u0442\u0438\u0440\u043E\u0432\u0430\u0442\u044C", "edit", list.id));
  }
  actions.appendChild(makeActionButton("\u042D\u043A\u0441\u043F\u043E\u0440\u0442", "export", list.id));
  actions.appendChild(
    makeActionButton("\u0421\u043E\u0437\u0434\u0430\u0442\u044C \u043F\u043B\u0435\u0439\u043B\u0438\u0441\u0442 \u044E\u0442\u0443\u0431", "createYoutubePlaylist", list.id)
  );
  if (list.id !== defaultListId) {
    actions.appendChild(
      makeActionButton("\u0423\u0434\u0430\u043B\u0438\u0442\u044C", "delete", list.id, { className: "secondary" })
    );
  }
  item.appendChild(actions);
  item.addEventListener("click", (event) => {
    if (event.target.closest("button")) return;
    onOpenList(list.id);
  });
  return item;
}
function renderListCards({
  listsBody,
  lists,
  activeListId,
  selectedListId: selectedListId2,
  defaultListId,
  onOpenList
}) {
  if (!listsBody) return;
  listsBody.textContent = "";
  const safeLists = Array.isArray(lists) ? lists : [];
  safeLists.forEach((list) => {
    listsBody.appendChild(
      createListCard({
        list,
        activeListId,
        selectedListId: selectedListId2,
        defaultListId,
        onOpenList
      })
    );
  });
}
function highlightSelectedList(listsBody, listId) {
  Array.from(listsBody?.querySelectorAll(".list-card") || []).forEach((item) => {
    item.classList.toggle("active", item.dataset.listId === listId);
  });
}
function toggleImportTarget({
  importModeSelect,
  importTargetField,
  importTargetSelect
}) {
  if (!importModeSelect || !importTargetField || !importTargetSelect) return;
  const mode = importModeSelect.value;
  const show = mode === "append" && importTargetSelect.options.length > 0;
  importTargetField.hidden = !show;
  importTargetSelect.disabled = !show;
}
function populateImportTargets({
  importTargetSelect,
  lists,
  onToggleTarget
}) {
  if (!importTargetSelect) return;
  importTargetSelect.textContent = "";
  const safeLists = Array.isArray(lists) ? lists : [];
  safeLists.forEach((list) => {
    const option = document.createElement("option");
    option.value = list.id;
    option.textContent = list.name;
    importTargetSelect.appendChild(option);
  });
  onToggleTarget();
}

// src/popup/lists.js
var DEFAULT_LIST_ID = "default";
var fallbackThumbnail = chrome.runtime.getURL("icon/icon.png");
var elements = getManagerElements(document);
var searchParams = new URLSearchParams(window.location.search);
var requestedListId = (searchParams.get("listId") || "").trim();
var requestedListName = (searchParams.get("listName") || "").trim();
var appState = null;
var selectedListId = null;
var selectedListDetails = null;
var managerStateController;
var managerSection;
var dragController = createDragReorderController({
  container: elements.detailList,
  itemSelector: ".manage-list-row",
  dragElementSelector: ".manage-video-item",
  interactiveSelector: "button, a, input, select, textarea, label",
  nativeHandleRequired: false,
  indicatorClassName: "manage-drop-indicator",
  indicatorLineClassName: "manage-drop-indicator__line",
  getQueue: () => Array.isArray(selectedListDetails?.queue) ? selectedListDetails.queue : [],
  getActiveListId: () => selectedListDetails?.id || null,
  onReorder: reorderVideo
});
var { setStatus } = createStatusController({
  statusBox: elements.statusBox,
  statusText: elements.statusText,
  progressEl: elements.statusProgress,
  progressBarEl: elements.statusProgressBar
});
var selectionController = createSelectionController({
  detailList: elements.detailList,
  bulkMoveBtn: elements.bulkMoveBtn,
  bulkDeleteBtn: elements.bulkDeleteBtn,
  floatingActions: elements.floatingSelectionActions,
  queueSection: elements.queueSection
});
var {
  registerState: registerPlaylistCreationState,
  releaseState: releasePlaylistCreationState,
  handleProgressMessage: handlePlaylistCreationProgress
} = createPlaylistCreationTracker({ setStatus });
var { moveMenu, showMoveMenu } = createManagerMoveActions({
  bulkMoveBtn: elements.bulkMoveBtn,
  clearSelection,
  getAppState: () => appState,
  getSelectedListDetails: () => selectedListDetails,
  loadState: () => managerStateController.loadState(),
  sendMessage: sendMessage2,
  setStatus
});
var managerModalController = createManagerModalController({
  defaultListId: DEFAULT_LIST_ID,
  elements: {
    modalBackdrop: elements.modalBackdrop,
    createModal: elements.createModal,
    importModal: elements.importModal,
    editModal: elements.editModal,
    addLinksModal: elements.addLinksModal,
    openCreateModalBtn: elements.openCreateModalBtn,
    openImportModalBtn: elements.openImportModalBtn,
    openAddLinksModalBtn: elements.openAddLinksModalBtn,
    createForm: elements.createForm,
    createName: elements.createName,
    createFreeze: elements.createFreeze,
    importForm: elements.importForm,
    importFile: elements.importFile,
    importModeSelect: elements.importModeSelect,
    importTargetSelect: elements.importTargetSelect,
    editForm: elements.editForm,
    editName: elements.editName,
    editFreeze: elements.editFreeze,
    addLinksForm: elements.addLinksForm,
    addLinksTextarea: elements.addLinksTextarea
  },
  getAppState: () => appState,
  getSelectedListDetails: () => selectedListDetails,
  loadState: () => managerStateController.loadState(),
  sendMessage: sendMessage2,
  setStatus,
  toggleImportTarget: toggleImportTarget2
});
var handleDetailAction = createManagerDetailActions({
  getAppState: () => appState,
  loadState: () => managerStateController.loadState(),
  openQuickFilter,
  sendMessage: sendMessage2,
  setStatus,
  showMoveMenu
});
managerStateController = createManagerStateController({
  dragController,
  elements: {
    clearListBtn: elements.clearListBtn,
    detailEmpty: elements.detailEmpty,
    detailList: elements.detailList,
    openAddLinksModalBtn: elements.openAddLinksModalBtn,
    removeWatchedBtn: elements.removeWatchedBtn
  },
  fallbackThumbnail,
  getAppState: () => appState,
  getSelectedListDetails: () => selectedListDetails,
  getSelectedListId: () => selectedListId,
  moveMenu,
  selectionController,
  sendMessage: sendMessage2,
  setAppState: (state) => {
    appState = state;
  },
  setSelectedListDetails: (details) => {
    selectedListDetails = details;
  },
  setSelectedListId: (listId) => {
    selectedListId = listId;
  },
  setStatus,
  highlightSelectedList: (listId) => highlightSelectedList(elements.listsBody, listId),
  populateImportTargets: populateImportTargets2,
  renderLists,
  updateCollectionAvailability: () => managerSection?.updateAvailability(),
  request: {
    listId: requestedListId,
    listName: requestedListName
  }
});
var collectionController = createCollectionController({
  progressEl: elements.managerCollectionProgress,
  titleEl: elements.managerCollectionTitle,
  stageTextEl: elements.managerCollectionStage,
  countersEl: elements.managerCollectionCounters,
  logEl: elements.managerCollectionLog,
  setStatus
});
managerSection = createCollectionAvailabilityController({
  applyState: syncManagerCollectionState,
  collectBtn: elements.managerCollectBtn,
  collectionArea: elements.managerCollectionArea,
  collectionNote: elements.managerCollectionNote,
  collectionController,
  defaultListId: DEFAULT_LIST_ID,
  getPlaylistState: () => appState || {},
  getSelectedListId: () => selectedListId,
  refreshState: managerStateController.loadState,
  sendMessage: sendMessage2,
  setLoading: setButtonLoading,
  setStatus
});
managerSection.updateAvailability();
var { handleListAction } = createManagerListActions({
  defaultListId: DEFAULT_LIST_ID,
  getAppState: () => appState,
  loadState: managerStateController.loadState,
  managerModalController,
  registerPlaylistCreationState,
  releasePlaylistCreationState,
  sendMessage: sendMessage2,
  setStatus,
  syncCurrentListSelection: managerStateController.syncCurrentListSelection
});
function renderLists() {
  const lists = Array.isArray(appState?.lists) ? appState.lists : [];
  renderListCards({
    listsBody: elements.listsBody,
    lists,
    activeListId: appState?.currentListId || null,
    selectedListId,
    defaultListId: DEFAULT_LIST_ID,
    onOpenList: (listId) => {
      managerStateController.loadListDetails(listId, { syncCurrent: false }).catch(() => {
      });
    }
  });
}
function populateImportTargets2() {
  const lists = Array.isArray(appState?.lists) ? appState.lists : [];
  populateImportTargets({
    importTargetSelect: elements.importTargetSelect,
    lists,
    onToggleTarget: toggleImportTarget2
  });
}
function toggleImportTarget2() {
  toggleImportTarget({
    importModeSelect: elements.importModeSelect,
    importTargetField: elements.importTargetField,
    importTargetSelect: elements.importTargetSelect
  });
}
async function syncManagerCollectionState(state) {
  if (!state || !Array.isArray(state.lists)) return;
  appState = state;
  managerStateController.ensureSelectedList(state);
  managerStateController.renderLists();
  if (selectedListId) {
    await managerStateController.loadListDetails(selectedListId, { syncCurrent: false });
  } else {
    managerSection.updateAvailability();
  }
}
async function sendMessage2(type, payload = {}) {
  return sendMessage(type, payload, { label: "sendMessage failed" });
}
async function reorderVideo({ videoId, targetIndex, listId }) {
  if (!videoId || typeof targetIndex !== "number") {
    return;
  }
  try {
    const state = await sendMessage2("playlist:reorder", {
      videoId,
      targetIndex,
      listId: listId || selectedListDetails?.id || null
    });
    if (state && Array.isArray(state.lists)) {
      appState = state;
      managerStateController.ensureSelectedList(state);
      managerStateController.renderLists();
    }
    await managerStateController.loadListDetails(selectedListId, { syncCurrent: false });
    setStatus("\u041F\u043E\u0440\u044F\u0434\u043E\u043A \u043E\u0431\u043D\u043E\u0432\u043B\u0451\u043D", "success", 2e3);
  } catch (err) {
    console.error("Failed to reorder videos", err);
    setStatus("\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0438\u0437\u043C\u0435\u043D\u0438\u0442\u044C \u043F\u043E\u0440\u044F\u0434\u043E\u043A", "error", 3500);
  }
}
function clearSelection() {
  selectionController.clear();
}
registerManagerBulkActions({
  buttons: {
    bulkDeleteBtn: elements.bulkDeleteBtn,
    bulkMoveBtn: elements.bulkMoveBtn,
    clearListBtn: elements.clearListBtn,
    removeWatchedBtn: elements.removeWatchedBtn
  },
  clearSelection,
  getSelectedListDetails: () => selectedListDetails,
  getWatchedVideoIds: (details = selectedListDetails) => getWatchedVideoIds(details, appState?.videoProgress),
  loadState: managerStateController.loadState,
  selectionController,
  sendMessage: sendMessage2,
  setStatus,
  showMoveMenu,
  updateRemoveWatchedButton: () => updateRemoveWatchedButton(
    elements.removeWatchedBtn,
    selectedListDetails,
    appState?.videoProgress
  )
});
registerManagerEvents({
  controllers: {
    drag: dragController
  },
  elements: {
    clearSelectionBtn: elements.clearSelectionBtn,
    detailList: elements.detailList,
    listsBody: elements.listsBody,
    managerCollectBtn: elements.managerCollectBtn,
    selectAllBtn: elements.selectAllBtn
  },
  handlers: {
    clearSelection,
    handleDetailAction,
    handleListAction,
    handleSelectionToggle: selectionController.toggle,
    selectAllVideos: () => {
      if (Array.isArray(selectedListDetails?.queue)) {
        selectionController.selectAll();
      }
    }
  },
  managerSection
});
chrome.runtime.onMessage.addListener((message) => {
  if (!message || !message.type) return;
  if (message.type === "playlist:createYouTubePlaylist:progress") {
    handlePlaylistCreationProgress(message);
    return;
  }
  if (message.type === "playlist:stateUpdated") {
    if (message.state && Array.isArray(message.state.lists)) {
      managerStateController.handleStateUpdated(message.state);
    }
    return;
  }
  if (message.type === "playlist:collectProgress") {
    managerSection.handleProgressMessage(message);
  }
});
managerModalController.register();
managerStateController.loadState().catch((err) => {
  console.error("Failed to load lists state", err);
  setStatus("\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044C \u0441\u043F\u0438\u0441\u043A\u0438", "error", 4e3);
});
