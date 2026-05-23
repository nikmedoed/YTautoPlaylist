// Shared drag geometry helpers. Calculates drop marker placement, wheel deltas,
// scrollable ancestors, and edge autoscroll speed for popup reorder lists.
export function createDropIndicator(documentRef, { className, lineClassName }) {
  const indicator = documentRef.createElement("div");
  indicator.className = className;
  const line = documentRef.createElement("div");
  line.className = lineClassName;
  indicator.appendChild(line);
  return indicator;
}

export function renderDropIndicator({
  container,
  indicator,
  items,
  pointerY,
  rectFor,
  targetItems,
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
    afterRect: afterItem ? rectFor(afterItem) : null,
  })}px`;
  appendIndicator(container, indicator);
  return targetIndex;
}

export function getWheelPixels(event, container) {
  const unit =
    event.deltaMode === 1 ? 16 :
    event.deltaMode === 2 ? container.clientHeight :
    1;
  return event.deltaY * unit;
}

export function findScrollableContainer(startNode, fallback) {
  let element = startNode && startNode.nodeType === 1 ? startNode : null;
  while (
    element &&
    element !== fallback &&
    element !== document.body &&
    element !== document.documentElement
  ) {
    if (isScrollable(element)) return element;
    element = element.parentElement;
  }
  if (fallback && isScrollable(fallback)) return fallback;
  return document.scrollingElement || document.documentElement;
}

export function getEdgeScroll(container, pointerY, {
  edgeZone = 56,
  maxStep = 28,
  minStep = 6,
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
  const cannotScrollDown =
    previous >= container.scrollHeight - container.clientHeight && speed > 0;
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
  return (
    (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") &&
    element.scrollHeight > element.clientHeight
  );
}
