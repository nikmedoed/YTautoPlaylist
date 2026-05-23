// Inline queue layout controller. Tracks viewport layout changes and updates the watch-page queue placement.
let inlineQueueMountRetry = null;
let inlineQueueLayoutMedia = null;
let inlineQueueLayoutMediaHandler = null;
let inlineQueueWatchObserver = null;
let inlineQueueWatchObserverTarget = null;
let renderInlineQueue = null;

export function configureInlineQueueLayout(renderCallback) {
  renderInlineQueue =
    typeof renderCallback === "function" ? renderCallback : null;
}

export function ensureInlineQueueLayoutListener() {
  if (inlineQueueLayoutMediaHandler || typeof window.matchMedia !== "function") {
    return;
  }
  inlineQueueLayoutMedia = window.matchMedia("(min-width: 1312px)");
  inlineQueueLayoutMediaHandler = () => {
    scheduleInlineQueueRenderRetry();
  };
  if (typeof inlineQueueLayoutMedia.addEventListener === "function") {
    inlineQueueLayoutMedia.addEventListener("change", inlineQueueLayoutMediaHandler);
  } else if (typeof inlineQueueLayoutMedia.addListener === "function") {
    inlineQueueLayoutMedia.addListener(inlineQueueLayoutMediaHandler);
  } else {
    inlineQueueLayoutMediaHandler = null;
  }
}

export function ensureInlineQueueWatchObserver() {
  if (typeof MutationObserver !== "function") {
    return;
  }
  const target = document.querySelector("ytd-watch-flexy");
  if (!target) {
    disconnectInlineQueueWatchObserver();
    return;
  }
  if (!inlineQueueWatchObserver) {
    inlineQueueWatchObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (
          mutation.type === "attributes" &&
          (mutation.attributeName === "is-two-columns" ||
            mutation.attributeName === "is-two-columns_")
        ) {
          scheduleInlineQueueRenderRetry();
          break;
        }
      }
    });
  }
  if (inlineQueueWatchObserverTarget !== target) {
    inlineQueueWatchObserver.disconnect();
    inlineQueueWatchObserverTarget = target;
    inlineQueueWatchObserver.observe(target, { attributes: true });
  }
}

export function disconnectInlineQueueWatchObserver() {
  if (inlineQueueWatchObserver) {
    inlineQueueWatchObserver.disconnect();
    inlineQueueWatchObserverTarget = null;
  }
}

export function cancelInlineQueueRenderRetry() {
  if (inlineQueueMountRetry !== null) {
    window.clearTimeout(inlineQueueMountRetry);
    inlineQueueMountRetry = null;
  }
}

export function scheduleInlineQueueRenderRetry() {
  if (inlineQueueMountRetry !== null) {
    return;
  }
  inlineQueueMountRetry = window.setTimeout(() => {
    inlineQueueMountRetry = null;
    renderInlineQueue?.();
  }, 300);
}

export function resolveInlineQueueHostElement() {
  const watchFlexy = document.querySelector("ytd-watch-flexy");
  let preferSecondary = null;
  if (watchFlexy) {
    const attrTwoColumns =
      watchFlexy.getAttribute("is-two-columns") ??
      watchFlexy.getAttribute("is-two-columns_");
    if (attrTwoColumns === "true") {
      preferSecondary = true;
    } else if (attrTwoColumns === "false") {
      preferSecondary = false;
    } else if (
      watchFlexy.hasAttribute("is-two-columns") ||
      watchFlexy.hasAttribute("is-two-columns_")
    ) {
      preferSecondary = true;
    } else if (typeof watchFlexy.isTwoColumns === "boolean") {
      preferSecondary = watchFlexy.isTwoColumns;
    }
  }
  if (preferSecondary === null) {
    preferSecondary =
      typeof window.matchMedia === "function"
        ? window.matchMedia("(min-width: 1312px)").matches
        : true;
  }

  const secondaryInner = document.querySelector("#secondary-inner");
  const secondary = document.getElementById("secondary");
  const below = document.getElementById("below");
  const primaryInner = document.getElementById("primary-inner");
  const primary = document.getElementById("primary");

  if (preferSecondary) {
    if (secondaryInner instanceof HTMLElement) {
      return { host: secondaryInner, placement: "sidebar" };
    }
    if (secondary instanceof HTMLElement) {
      return { host: secondary, placement: "sidebar" };
    }
  }

  if (below instanceof HTMLElement) {
    return { host: below, placement: "stack" };
  }
  if (primaryInner instanceof HTMLElement) {
    return { host: primaryInner, placement: "stack" };
  }
  if (primary instanceof HTMLElement) {
    return { host: primary, placement: "stack" };
  }

  if (!preferSecondary) {
    if (secondaryInner instanceof HTMLElement) {
      return { host: secondaryInner, placement: "sidebar" };
    }
    if (secondary instanceof HTMLElement) {
      return { host: secondary, placement: "sidebar" };
    }
  }

  return null;
}
