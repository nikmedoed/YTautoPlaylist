function collectVideoIds(scope = "visible") {
  if (scope === "current") {
    const current = getCurrentVideoId();
    return current ? [current] : [];
  }
  if (scope === "visibleNoCurrent") {
    return collectVisibleVideoIds({ includeCurrent: false });
  }
  return collectVisibleVideoIds({ includeCurrent: true });
}

function collectVisibleVideoIds({ includeCurrent = true } = {}) {
  const ids = new Set();
  document.querySelectorAll(VIDEO_CARD_SELECTOR).forEach((card) => {
    const id = findVideoIdInCard(card);
    if (id) ids.add(id);
  });
  if (includeCurrent) {
    const current = getCurrentVideoId();
    if (current) ids.add(current);
  }
  return Array.from(ids);
}

function attemptLoadMoreContinuations() {
  const button =
    document.querySelector(
      "ytd-continuation-item-renderer #button:not([disabled])"
    ) || document.querySelector("#continuations button:not([disabled])");
  if (button) {
    button.click();
    return true;
  }
  return false;
}

function findContinuationSpinner() {
  return (
    document.querySelector(
      "ytd-continuation-item-renderer tp-yt-paper-spinner[active]"
    ) ||
    document.querySelector(
      "ytd-continuation-item-renderer tp-yt-paper-spinner:not([aria-hidden='true'])"
    ) ||
    document.querySelector(
      "ytd-continuation-item-renderer tp-yt-paper-spinner"
    )
  );
}

function isContinuationSpinnerActive(spinner) {
  if (!spinner) return false;
  if (spinner.hasAttribute("active")) return true;
  const ariaHidden = spinner.getAttribute("aria-hidden");
  if (ariaHidden === "false") return true;
  try {
    const style = window.getComputedStyle(spinner);
    if (!style) return false;
    if (style.display === "none" || style.visibility === "hidden") {
      return false;
    }
    return Number.parseFloat(style.opacity || "1") > 0.01;
  } catch (_) {
    return true;
  }
}

async function waitForNextBatch(previousCount, loadTriggered, options = {}) {
  const { checkAbort } = options || {};
  const shouldAbort = typeof checkAbort === "function" ? checkAbort : null;
  const maxWait = Math.max(PAGE_SCROLL_DELAY * 3, 900);
  const step = 140;
  let elapsed = 0;
  while (elapsed < maxWait) {
    if (shouldAbort && shouldAbort()) {
      return { progressed: false, aborted: true };
    }
    await delay(step);
    elapsed += step;
    if (shouldAbort && shouldAbort()) {
      return { progressed: false, aborted: true };
    }
    const cards = document.querySelectorAll(VIDEO_CARD_SELECTOR).length;
    if (cards > previousCount) {
      return { progressed: true, aborted: false };
    }
    const spinner = findContinuationSpinner();
    const active = spinner ? isContinuationSpinnerActive(spinner) : false;
    if (!active && elapsed >= PAGE_SCROLL_DELAY) {
      return { progressed: false, aborted: false };
    }
  }
  return { progressed: false, aborted: false };
}

async function collectPageVideosWithContinuation(options = {}) {
  const { onProgress, signal, shouldStop } = options || {};
  const initialScroll = window.scrollY;
  const seen = new Set();
  let scrollIndex = 0;
  let idle = 0;
  let lastReportedTotal = -1;
  let aborted = false;

  const checkAbort = () => {
    if (signal?.aborted) {
      return true;
    }
    if (typeof shouldStop === "function" && shouldStop()) {
      return true;
    }
    return false;
  };

  const report = (newCount) => {
    if (typeof onProgress !== "function") return;
    if (aborted) return;
    if (newCount > 0 || seen.size !== lastReportedTotal) {
      lastReportedTotal = seen.size;
      onProgress({ total: seen.size, newCount });
    }
  };

  const harvest = () => {
    if (checkAbort()) {
      aborted = true;
      return { cards: [], added: 0 };
    }
    const cards = Array.from(document.querySelectorAll(VIDEO_CARD_SELECTOR));
    let added = 0;
    for (const card of cards) {
      const id = findVideoIdInCard(card);
      if (id && !seen.has(id)) {
        seen.add(id);
        added += 1;
      }
    }
    return { cards, added };
  };

  let { cards, added } = harvest();
  report(added);

  for (let loop = 0; loop < PAGE_SCROLL_MAX_LOOPS; loop += 1) {
    if (aborted || checkAbort()) {
      aborted = true;
      break;
    }
    if (seen.size >= PAGE_COLLECTION_LIMIT) {
      break;
    }

    if (loop > 0) {
      ({ cards, added } = harvest());
      if (added > 0) {
        report(added);
      }
    }

    if (aborted) {
      break;
    }
    if (seen.size >= PAGE_COLLECTION_LIMIT) {
      break;
    }

    const previousCount = cards.length;
    const hadFreshIds = added > 0;
    const targetIndex =
      scrollIndex < cards.length ? scrollIndex : Math.max(cards.length - 1, 0);
    const target = targetIndex >= 0 ? cards[targetIndex] : null;
    if (target) {
      try {
        target.scrollIntoView({
          behavior: "smooth",
          block: scrollIndex < cards.length - 1 ? "center" : "end",
        });
      } catch (_) {
        target.scrollIntoView();
      }
    }
    scrollIndex = Math.min(scrollIndex + 1, cards.length + 4);
    try {
      window.scrollTo({
        top: document.documentElement.scrollHeight,
        behavior: "smooth",
      });
    } catch (_) {
      window.scrollTo(0, document.documentElement.scrollHeight);
    }
    const loadTriggered = attemptLoadMoreContinuations();
    const waitResult = await waitForNextBatch(previousCount, loadTriggered, {
      checkAbort,
    });
    if (waitResult.aborted) {
      aborted = true;
      break;
    }
    const progressed = waitResult.progressed;
    ({ cards, added } = harvest());
    if (added > 0) {
      report(added);
      idle = 0;
    } else if (!hadFreshIds && !progressed) {
      idle += 1;
    } else {
      idle = 0;
    }
    if (idle >= PAGE_SCROLL_IDLE_LIMIT) {
      break;
    }
  }

  try {
    window.scrollTo({ top: initialScroll || 0 });
  } catch (_) {
    window.scrollTo(0, initialScroll || 0);
  }
  return {
    videoIds: Array.from(seen),
    aborted,
    total: seen.size,
  };
}
