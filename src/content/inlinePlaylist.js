let pendingInlineRefresh = false;

const inlineQueueUI = {
  container: null,
  brand: null,
  title: null,
  progress: null,
  freeze: null,
  list: null,
  empty: null,
};

let inlineQueueMountRetry = null;

const inlineQueueCountFormatter = new Intl.NumberFormat("ru-RU");
const inlineQueueDateFormatter = new Intl.DateTimeFormat("ru-RU", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

function fallbackOpenQuickFilter(videoId) {
  const runtime = chrome?.runtime;
  let url = null;
  if (runtime?.getURL) {
    const base = runtime.getURL("src/settings/settings.html");
    const target = new URL(base);
    target.searchParams.set("quickFilterVideo", videoId);
    url = target.toString();
  }
  if (!url) {
    return;
  }
  const opened = window.open(url, "_blank", "noopener,noreferrer");
  if (!opened) {
    window.location.href = url;
  }
}

function openQuickFilterForVideo(videoId) {
  if (!videoId || typeof videoId !== "string") {
    return;
  }
  const normalized = videoId.trim();
  if (!normalized) {
    return;
  }
  const runtime = chrome?.runtime;
  if (runtime?.sendMessage) {
    try {
      runtime.sendMessage(
        { type: "options:openQuickFilter", videoId: normalized },
        (response) => {
          const lastError = chrome?.runtime?.lastError;
          if (lastError) {
            console.warn("Quick filter message failed", lastError);
            fallbackOpenQuickFilter(normalized);
            return;
          }
          if (response && response.error) {
            console.warn("Quick filter rejected", response.error);
            fallbackOpenQuickFilter(normalized);
          }
        }
      );
      return;
    } catch (err) {
      console.warn("Quick filter message threw", err);
    }
  }
  fallbackOpenQuickFilter(normalized);
}

function openListManager(listId, listName = "") {
  const normalizedId = typeof listId === "string" ? listId.trim() : "";
  if (!normalizedId) {
    return;
  }
  const normalizedName = typeof listName === "string" ? listName.trim() : "";

  const runtime = chrome?.runtime;
  const baseUrl = runtime?.getURL
    ? runtime.getURL("src/popup/lists.html")
    : null;
  const targetUrl = (() => {
    if (!baseUrl) return null;
    try {
      const url = new URL(baseUrl);
      url.searchParams.set("listId", normalizedId);
      if (normalizedName) {
        url.searchParams.set("listName", normalizedName);
      }
      return url.toString();
    } catch {
      return null;
    }
  })();

  const openFallback = () => {
    if (!targetUrl) return;
    const opened = window.open(targetUrl, "_blank", "noopener,noreferrer");
    if (!opened) {
      window.location.href = targetUrl;
    }
  };

  if (runtime?.sendMessage) {
    try {
      runtime.sendMessage(
        {
          type: "options:openListSettings",
          listId: normalizedId,
          listName: normalizedName || undefined,
        },
        (response) => {
          const lastError = chrome?.runtime?.lastError;
          if (lastError) {
            console.warn("List settings message failed", lastError);
            openFallback();
            return;
          }
          if (response && response.error) {
            console.warn("List settings rejected", response.error);
            openFallback();
            return;
          }
        }
      );
      return;
    } catch (err) {
      console.warn("List settings message threw", err);
    }
  }
  openFallback();
}
const INLINE_QUEUE_DURATION_PATTERN = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/;

let inlineQueueLayoutMedia = null;
let inlineQueueLayoutMediaHandler = null;
let inlineQueueWatchObserver = null;
let inlineQueueWatchObserverTarget = null;

const inlineQueueDragState = {
  videoId: null,
  dropIndex: null,
  draggingEl: null,
  pendingVideoId: null,
  pendingElement: null,
};

const inlineQueueAutoScrollState = {
  pointerY: null,
  rafId: null,
};

let inlineQueuePendingFocusId = null;
let inlineQueuePendingFocusListId = null;
let inlineQueuePendingScrollTop = null;

let inlineQueueLastAutoScrollVideoId = null;
let inlineQueueLastAutoScrollListId = null;

const INLINE_QUEUE_AUTO_SCROLL_THRESHOLD = 64;
const INLINE_QUEUE_AUTO_SCROLL_MAX_STEP = 18;
const INLINE_QUEUE_SCROLL_EPSILON = 0.5;

const inlineMoveMenu = {
  container: null,
  buttons: null,
  message: null,
  videoId: null,
  listId: null,
  anchor: null,
  visible: false,
};

function ensureInlineQueueLayoutListener() {
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

function ensureInlineQueueWatchObserver() {
  if (typeof MutationObserver !== "function") {
    return;
  }
  const target = document.querySelector("ytd-watch-flexy");
  if (!target) {
    if (inlineQueueWatchObserver) {
      inlineQueueWatchObserver.disconnect();
      inlineQueueWatchObserverTarget = null;
    }
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

function cancelInlineQueueRenderRetry() {
  if (inlineQueueMountRetry !== null) {
    window.clearTimeout(inlineQueueMountRetry);
    inlineQueueMountRetry = null;
  }
}

function scheduleInlineQueueRenderRetry() {
  if (inlineQueueMountRetry !== null) {
    return;
  }
  inlineQueueMountRetry = window.setTimeout(() => {
    inlineQueueMountRetry = null;
    updateInlineQueueUI();
  }, 300);
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

function resolveInlineQueueHostElement() {
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

function teardownInlineQueue() {
  cancelInlineQueueRenderRetry();
  hideInlineMoveMenu();
  resetInlineQueueDragState();
  clearInlineQueuePendingFocus();
  inlineQueueLastAutoScrollVideoId = null;
  inlineQueueLastAutoScrollListId = null;
  if (inlineQueueUI.container && inlineQueueUI.container.isConnected) {
    inlineQueueUI.container.remove();
  }
  inlineQueueUI.container = null;
  inlineQueueUI.brand = null;
  inlineQueueUI.title = null;
  inlineQueueUI.progress = null;
  inlineQueueUI.freeze = null;
  inlineQueueUI.list = null;
  inlineQueueUI.empty = null;
  if (inlineQueueWatchObserver) {
    inlineQueueWatchObserver.disconnect();
    inlineQueueWatchObserverTarget = null;
  }
}

function ensureInlineQueueElements() {
  const resolved = resolveInlineQueueHostElement();
  if (!resolved) {
    return null;
  }

  ensureInlineQueueLayoutListener();
  ensureInlineQueueWatchObserver();

  if (!inlineQueueUI.container) {
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

    const progress = document.createElement("span");
    progress.className = "yta-inline-queue__progress";
    progress.hidden = true;
    progress.tabIndex = -1;
    progress.setAttribute("role", "button");
    if (!progress.dataset.ytaInlineProgressBound) {
      progress.addEventListener("click", handleInlineQueueProgressClick);
      progress.addEventListener("keydown", handleInlineQueueProgressKeyDown);
      progress.dataset.ytaInlineProgressBound = "1";
    }
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
    inlineQueueUI.progress = progress;
    inlineQueueUI.freeze = freeze;
    inlineQueueUI.list = list;
    inlineQueueUI.empty = empty;
    if (!list.dataset.ytaInlineBound) {
      list.addEventListener("click", handleInlineQueueListClick);
      list.addEventListener("keydown", handleInlineQueueListKeyDown);
      list.addEventListener("dragstart", handleInlineQueueDragStart);
      list.addEventListener("dragover", handleInlineQueueDragOver);
      list.addEventListener("drop", handleInlineQueueDrop);
      list.addEventListener("dragend", handleInlineQueueDragEnd);
      list.dataset.ytaInlineBound = "1";
    }
    if (!container.dataset.ytaInlineDragBound) {
      container.addEventListener("dragover", handleInlineQueueDragOver);
      container.addEventListener("drop", handleInlineQueueDrop);
      container.dataset.ytaInlineDragBound = "1";
    }
  }

  const { host, placement } = resolved;
  if (!host) {
    return null;
  }

  const container = inlineQueueUI.container;
  if (!container) {
    return null;
  }

  const shouldAttachUnderPlayer = placement === "stack";
  let mounted = false;

  if (shouldAttachUnderPlayer) {
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

function parseInlineQueueDuration(duration) {
  if (duration == null) {
    return null;
  }
  if (typeof duration === "number" && Number.isFinite(duration)) {
    return Math.max(0, duration);
  }
  const match = INLINE_QUEUE_DURATION_PATTERN.exec(String(duration));
  if (!match) {
    return null;
  }
  const hours = Number(match[1] || 0);
  const minutes = Number(match[2] || 0);
  const seconds = Number(match[3] || 0);
  return hours * 3600 + minutes * 60 + seconds;
}

function formatInlineQueueDuration(duration) {
  const seconds = parseInlineQueueDuration(duration);
  if (seconds == null) {
    return "";
  }
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function formatInlineQueueDate(value) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return inlineQueueDateFormatter.format(date);
}

function createInlineQueueDetailContainer(parts) {
  const details = document.createElement("div");
  details.className = "video-details";
  let hasContent = false;

  parts.forEach((part) => {
    if (!part || typeof part !== "object" || !part.text) {
      return;
    }
    if (hasContent) {
      const separator = document.createElement("span");
      separator.className = "video-details__separator";
      separator.textContent = "·";
      separator.setAttribute("aria-hidden", "true");
      details.appendChild(separator);
    }
    const span = document.createElement("span");
    if (part.className) {
      span.className = part.className;
    }
    if (part.icon) {
      const icon = document.createElement("span");
      icon.className = part.iconClassName || "video-detail__icon";
      icon.textContent = part.icon;
      icon.setAttribute("aria-hidden", "true");
      span.appendChild(icon);
    }
    let textNode = null;
    if (part.href) {
      const link = document.createElement("a");
      link.className = part.textClassName || "video-detail__text";
      link.textContent = part.text;
      link.href = part.href;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      textNode = link;
    } else if (part.text) {
      const text = document.createElement("span");
      text.className = part.textClassName || "video-detail__text";
      text.textContent = part.text;
      textNode = text;
    }
    if (textNode) {
      span.appendChild(textNode);
    }
    details.appendChild(span);
    hasContent = true;
  });

  if (!hasContent) {
    return null;
  }

  return details;
}

function buildInlineQueueDetails(entry) {
  const parts = [];
  if (entry?.channelTitle) {
    let channelHref = null;
    if (typeof entry.channelUrl === "string" && entry.channelUrl) {
      channelHref = entry.channelUrl;
    } else if (typeof entry.channelId === "string" && entry.channelId) {
      channelHref = `https://www.youtube.com/channel/${entry.channelId}`;
    }
    parts.push({
      text: entry.channelTitle,
      href: channelHref,
      textClassName: "video-detail__text yta-inline-queue__detail-link",
    });
  }
  const published = formatInlineQueueDate(entry?.publishedAt);
  if (published) {
    parts.push({ text: published, textClassName: "video-detail__text" });
  }
  return createInlineQueueDetailContainer(parts);
}

function resolveInlineQueueThumbnail(entry) {
  if (!entry) {
    return "";
  }
  if (typeof entry.thumbnail === "string" && entry.thumbnail) {
    return entry.thumbnail;
  }
  if (entry.thumbnail && typeof entry.thumbnail === "object") {
    if (typeof entry.thumbnail.url === "string" && entry.thumbnail.url) {
      return entry.thumbnail.url;
    }
    if (
      typeof entry.thumbnail.fallback === "string" &&
      entry.thumbnail.fallback
    ) {
      return entry.thumbnail.fallback;
    }
    if (typeof entry.thumbnail.defaultSrc === "string" && entry.thumbnail.defaultSrc) {
      return entry.thumbnail.defaultSrc;
    }
  }
  if (entry.id) {
    return `https://i.ytimg.com/vi/${entry.id}/mqdefault.jpg`;
  }
  return "";
}

function createInlineQueueActionButton(className, textContent, title) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `icon-button ${className}`;
  if (textContent != null) {
    button.textContent = textContent;
  }
  if (title) {
    button.title = title;
    button.setAttribute("aria-label", title);
  }
  return button;
}

function resolveInlineProgressPercent(videoId) {
  if (!videoId) {
    return null;
  }
  const map = inlinePlaylistState.progress;
  if (!(map instanceof Map)) {
    return null;
  }
  const entry = map.get(videoId);
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

function applyThumbnailProgress(container, percent) {
  if (!(container instanceof HTMLElement)) {
    return;
  }
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  if (!Number.isFinite(clamped) || clamped <= 0) {
    return;
  }
  const progressEl = document.createElement("div");
  progressEl.className = "video-thumb__progress";
  const barEl = document.createElement("div");
  barEl.className = "video-thumb__progress-bar";
  barEl.style.width = `${clamped}%`;
  progressEl.appendChild(barEl);
  container.appendChild(progressEl);
}

function createInlineQueueItem(entry, index, isCurrent, options = {}) {
  const allowPostpone = Boolean(options.allowPostpone);
  const item = document.createElement("li");
  item.className = "yta-inline-queue__item";

  const videoItem = document.createElement("div");
  videoItem.className = "video-item";
  if (allowPostpone) {
    videoItem.classList.add("video-item--has-postpone");
  }
  videoItem.dataset.videoId = entry.id;
  videoItem.dataset.index = String(index);
  if (inlinePlaylistState.currentListId) {
    videoItem.dataset.listId = inlinePlaylistState.currentListId;
  }
  videoItem.tabIndex = 0;
  videoItem.setAttribute("role", "button");

  const baseTitle = entry.title || "Без названия";
  videoItem.setAttribute("aria-label", baseTitle);
  videoItem.title = baseTitle;

  const handle = document.createElement("button");
  handle.type = "button";
  handle.className = "video-handle";
  handle.title = "Перетащить";
  handle.setAttribute("aria-label", "Перетащить");
  handle.draggable = true;
  if (!handle.dataset.ytaInlineHandleBound) {
    handle.addEventListener("pointerdown", handleInlineQueueHandlePointerDown);
    handle.addEventListener("mousedown", handleInlineQueueHandlePointerDown);
    handle.dataset.ytaInlineHandleBound = "1";
  }
  videoItem.appendChild(handle);

  const thumbWrapper = document.createElement("div");
  thumbWrapper.className = "video-thumb-wrapper";

  const thumb = document.createElement("img");
  thumb.className = "video-thumb";
  thumb.decoding = "async";
  thumb.loading = "lazy";
  const thumbUrl = resolveInlineQueueThumbnail(entry);
  if (thumbUrl) {
    thumb.src = thumbUrl;
  }
  thumb.alt = baseTitle;
  thumbWrapper.appendChild(thumb);

  const durationText = formatInlineQueueDuration(entry?.duration);
  if (durationText) {
    const durationEl = document.createElement("span");
    durationEl.className = "video-thumb__duration";
    durationEl.textContent = durationText;
    thumbWrapper.appendChild(durationEl);
  }

  const progressPercent = resolveInlineProgressPercent(entry.id);
  if (progressPercent) {
    applyThumbnailProgress(thumbWrapper, progressPercent);
  }

  videoItem.appendChild(thumbWrapper);

  const body = document.createElement("div");
  body.className = "video-body";

  const title = document.createElement("div");
  title.className = "video-title";
  title.textContent = `${index + 1}. ${baseTitle}`;
  body.appendChild(title);

  const details = buildInlineQueueDetails(entry);
  if (details) {
    body.appendChild(details);
  }

  videoItem.appendChild(body);

  if (entry.id) {
    const quickFilterBtn = createInlineQueueActionButton(
      "video-quick-filter",
      "⚡",
      "Создать фильтр для видео"
    );
    quickFilterBtn.dataset.videoId = entry.id;
    videoItem.appendChild(quickFilterBtn);
  }

  const removeBtn = createInlineQueueActionButton(
    "video-remove",
    "✕",
    "Удалить из очереди"
  );
  videoItem.appendChild(removeBtn);

  if (allowPostpone) {
    const postponeBtn = createInlineQueueActionButton(
      "video-postpone",
      "⤵",
      "Отложить в конец списка"
    );
    videoItem.appendChild(postponeBtn);
  }

  const moveBtn = createInlineQueueActionButton(
    "video-move",
    "⇄",
    "Перенести в другой список"
  );
  videoItem.appendChild(moveBtn);

  if (isCurrent) {
    videoItem.classList.add("active");
    item.dataset.current = "1";
  }

  item.appendChild(videoItem);
  return item;
}

function handleInlineQueueProgressClick(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  scrollInlineQueueToCurrentItem();
}

function handleInlineQueueProgressKeyDown(event) {
  if (!event) {
    return;
  }
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    event.stopPropagation();
    scrollInlineQueueToCurrentItem();
  }
}

function scrollInlineQueueToCurrentItem() {
  if (!inlineQueueUI.list) {
    return false;
  }
  const currentItem =
    inlineQueueUI.list.querySelector(
      ".yta-inline-queue__item[data-current='1'] .video-item"
    ) || inlineQueueUI.list.querySelector(".video-item.active");
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

function handleInlineQueueListClick(event) {
  const quickFilterBtn = event.target.closest(".video-quick-filter");
  if (quickFilterBtn) {
    event.preventDefault();
    event.stopPropagation();
    const videoItem = quickFilterBtn.closest(".video-item");
    const videoId =
      quickFilterBtn.dataset.videoId || videoItem?.dataset.videoId || "";
    if (videoId) {
      openQuickFilterForVideo(videoId);
    }
    return;
  }
  const removeBtn = event.target.closest(".video-remove");
  if (removeBtn) {
    event.preventDefault();
    event.stopPropagation();
    handleInlineQueueRemove(removeBtn);
    return;
  }
  const postponeBtn = event.target.closest(".video-postpone");
  if (postponeBtn) {
    event.preventDefault();
    event.stopPropagation();
    handleInlineQueuePostpone(postponeBtn);
    return;
  }
  const moveBtn = event.target.closest(".video-move");
  if (moveBtn) {
    event.preventDefault();
    event.stopPropagation();
    handleInlineQueueMove(moveBtn);
    return;
  }
  if (event.target.closest(".video-handle")) {
    return;
  }
  const videoItem = event.target.closest(".video-item");
  if (!videoItem) {
    return;
  }
  event.preventDefault();
  hideInlineMoveMenu();
  activateInlineQueueItem(videoItem);
}

function handleInlineQueueListKeyDown(event) {
  if (event.defaultPrevented) {
    return;
  }
  const videoItem = event.target.closest(".video-item");
  if (!videoItem) {
    return;
  }
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    hideInlineMoveMenu();
    activateInlineQueueItem(videoItem);
  }
}

function activateInlineQueueItem(node) {
  const videoItem = node instanceof HTMLElement ? node : null;
  if (!videoItem) {
    return;
  }
  if (videoItem.dataset.loading === "1") {
    return;
  }
  const videoId = videoItem.dataset.videoId;
  if (!videoId) {
    return;
  }
  videoItem.dataset.loading = "1";
  const payload = { videoId };
  if (inlinePlaylistState.currentListId) {
    payload.listId = inlinePlaylistState.currentListId;
  }
  sendMessage("playlist:play", payload)
    .catch((err) => {
      console.warn("Failed to start playback from inline queue", err);
    })
    .finally(() => {
      if (!videoItem.isConnected) {
        return;
      }
      delete videoItem.dataset.loading;
    });
}

function handleInlineQueueRemove(button) {
  const target = button instanceof HTMLButtonElement ? button : null;
  if (!target || target.dataset.loading === "1") {
    return;
  }
  const videoItem = target.closest(".video-item");
  if (!videoItem) {
    return;
  }
  const videoId = videoItem.dataset.videoId;
  if (!videoId) {
    return;
  }
  const focusTargetId = resolveInlineQueuePostponeFocusTarget(videoItem);
  target.dataset.loading = "1";
  target.disabled = true;
  setInlineQueuePendingFocus(focusTargetId || videoId);
  const payload = { videoId };
  if (inlinePlaylistState.currentListId) {
    payload.listId = inlinePlaylistState.currentListId;
  }
  sendMessage("playlist:remove", payload)
    .then((state) => {
      if (state && typeof state === "object") {
        updateInlinePlaylistState(state);
      }
    })
    .catch((err) => {
      console.warn("Failed to remove video from inline queue", err);
    })
    .finally(() => {
      if (!target.isConnected) {
        return;
      }
      target.disabled = false;
      delete target.dataset.loading;
    });
}

function handleInlineQueuePostpone(button) {
  const target = button instanceof HTMLButtonElement ? button : null;
  if (!target || target.dataset.loading === "1") {
    return;
  }
  const videoItem = target.closest(".video-item");
  if (!videoItem) {
    return;
  }
  const videoId = videoItem.dataset.videoId;
  if (!videoId) {
    return;
  }
  const listId = inlinePlaylistState.currentListId || null;
  const isCurrent = videoId === inlinePlaylistState.currentVideoId;
  const focusTargetId = resolveInlineQueuePostponeFocusTarget(videoItem);
  target.dataset.loading = "1";
  target.disabled = true;
  setInlineQueuePendingFocus(focusTargetId || videoId);
  const request = isCurrent
    ? sendMessage("playlist:postpone", { videoId })
    : sendMessage("playlist:postponeVideo", { videoId, listId });
  request
    .then((response) => {
      if (!response) {
        clearInlineQueuePendingFocus();
        return;
      }
      if (isCurrent) {
        if (response.handled === false) {
          clearInlineQueuePendingFocus();
          return;
        }
        const presentation = response.state || response;
        if (presentation && typeof presentation === "object") {
          updateInlinePlaylistState(presentation);
        } else {
          clearInlineQueuePendingFocus();
        }
      } else if (typeof response === "object") {
        updateInlinePlaylistState(response);
      } else {
        clearInlineQueuePendingFocus();
      }
    })
    .catch((err) => {
      console.warn("Failed to postpone video from inline queue", err);
      clearInlineQueuePendingFocus();
    })
    .finally(() => {
      if (!target.isConnected) {
        return;
      }
      target.disabled = false;
      delete target.dataset.loading;
    });
}

function resolveInlineQueuePostponeFocusTarget(videoItem) {
  if (!(videoItem instanceof HTMLElement)) {
    return null;
  }
  const container = videoItem.closest(".yta-inline-queue__item");
  if (!(container instanceof HTMLElement)) {
    return null;
  }
  let sibling = container.nextElementSibling;
  while (sibling instanceof HTMLElement) {
    const candidate = sibling.querySelector(".video-item");
    if (candidate instanceof HTMLElement && candidate.dataset.videoId) {
      return candidate.dataset.videoId;
    }
    sibling = sibling.nextElementSibling;
  }
  sibling = container.previousElementSibling;
  while (sibling instanceof HTMLElement) {
    const candidate = sibling.querySelector(".video-item");
    if (candidate instanceof HTMLElement && candidate.dataset.videoId) {
      return candidate.dataset.videoId;
    }
    sibling = sibling.previousElementSibling;
  }
  return null;
}

function handleInlineQueueMove(button) {
  const target = button instanceof HTMLButtonElement ? button : null;
  if (!target) {
    return;
  }
  const videoItem = target.closest(".video-item");
  if (!videoItem) {
    return;
  }
  const videoId = videoItem.dataset.videoId;
  if (!videoId) {
    return;
  }
  showInlineMoveMenu(videoId, inlinePlaylistState.currentListId, target);
}

function handleInlineQueueDragStart(event) {
  const handle = event.target.closest(".video-handle");
  if (!handle) {
    event.preventDefault();
    inlineQueueDragState.pendingVideoId = null;
    inlineQueueDragState.pendingElement = null;
    return;
  }
  const targetItem = handle.closest(".video-item");
  let item = targetItem instanceof HTMLElement ? targetItem : null;
  let videoId = item?.dataset?.videoId || null;
  if (
    inlineQueueDragState.pendingElement instanceof HTMLElement &&
    typeof inlineQueueDragState.pendingVideoId === "string" &&
    inlineQueueDragState.pendingVideoId
  ) {
    if (inlineQueueDragState.pendingElement.isConnected) {
      item = inlineQueueDragState.pendingElement;
      videoId = inlineQueueDragState.pendingVideoId;
    }
    inlineQueueDragState.pendingVideoId = null;
    inlineQueueDragState.pendingElement = null;
  }
  if (!item) {
    event.preventDefault();
    inlineQueueDragState.pendingVideoId = null;
    inlineQueueDragState.pendingElement = null;
    return;
  }
  if (typeof videoId !== "string" || !videoId) {
    event.preventDefault();
    inlineQueueDragState.pendingVideoId = null;
    inlineQueueDragState.pendingElement = null;
    return;
  }
  inlineQueueDragState.pendingVideoId = null;
  inlineQueueDragState.pendingElement = null;
  hideInlineMoveMenu();
  inlineQueueDragState.videoId = videoId;
  inlineQueueDragState.dropIndex = null;
  inlineQueueDragState.draggingEl = item;
  item.classList.add("dragging");
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move";
    try {
      event.dataTransfer.setData("text/plain", videoId);
    } catch (_) {
      /* ignore */
    }
    if (item !== targetItem && item instanceof HTMLElement) {
      try {
        const rect = item.getBoundingClientRect();
        const offsetX = typeof event.clientX === "number" ? event.clientX - rect.left : rect.width / 2;
        const offsetY = typeof event.clientY === "number" ? event.clientY - rect.top : rect.height / 2;
        event.dataTransfer.setDragImage(item, offsetX, offsetY);
      } catch (_) {
        try {
          event.dataTransfer.setDragImage(item, 0, 0);
        } catch (__) {
          /* ignore */
        }
      }
    }
  }
}

function handleInlineQueueHandlePointerDown(event) {
  if (!event) {
    return;
  }
  if (event.type === "mousedown" && typeof window.PointerEvent === "function") {
    return;
  }
  if (typeof event.button === "number" && event.button !== 0) {
    return;
  }
  const handle =
    event.currentTarget instanceof HTMLElement
      ? event.currentTarget
      : event.target instanceof HTMLElement
        ? event.target.closest(".video-handle")
        : null;
  const item = handle instanceof HTMLElement ? handle.closest(".video-item") : null;
  if (item instanceof HTMLElement && item.dataset.videoId) {
    inlineQueueDragState.pendingVideoId = item.dataset.videoId;
    inlineQueueDragState.pendingElement = item;
  } else {
    inlineQueueDragState.pendingVideoId = null;
    inlineQueueDragState.pendingElement = null;
  }
  ensureInlineQueueFullyVisible();
}

function handleInlineQueueDragOver(event) {
  if (!inlineQueueDragState.videoId) {
    return;
  }
  event.preventDefault();
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = "move";
  }
  const pointerY = event.clientY;
  const scrolledNow = maybeAutoScrollInlineQueueList(pointerY);
  scheduleInlineQueueAutoScroll(pointerY, scrolledNow);
  clearInlineQueueDropIndicators();
  if (!inlineQueueUI.list) {
    inlineQueueDragState.dropIndex = null;
    return;
  }
  const targetItem = event.target.closest(".video-item");
  const items = Array.from(inlineQueueUI.list.querySelectorAll(".video-item"));
  if (!targetItem || targetItem === inlineQueueDragState.draggingEl) {
    const dropTarget = computeInlineQueuePointerDropTarget(pointerY, items);
    inlineQueueDragState.dropIndex = dropTarget.index;
    if (dropTarget.element) {
      dropTarget.element.classList.add(
        dropTarget.before ? "drop-before" : "drop-after"
      );
    }
    return;
  }
  const rect = targetItem.getBoundingClientRect();
  const before = event.clientY < rect.top + rect.height / 2;
  targetItem.classList.add(before ? "drop-before" : "drop-after");
  const baseIndex = items.indexOf(targetItem);
  inlineQueueDragState.dropIndex = before ? baseIndex : baseIndex + 1;
}

function handleInlineQueueDrop(event) {
  if (!inlineQueueDragState.videoId) {
    return;
  }
  event.preventDefault();
  const queueIds = Array.isArray(inlinePlaylistState.orderedVideoIds)
    ? inlinePlaylistState.orderedVideoIds
    : [];
  const videoId = inlineQueueDragState.videoId;
  const fromIndex = queueIds.indexOf(videoId);
  if (fromIndex === -1) {
    resetInlineQueueDragState();
    return;
  }
  let targetIndex = inlineQueueDragState.dropIndex;
  if (typeof targetIndex !== "number") {
    const direct = event.target.closest(".video-item");
    if (direct && inlineQueueUI.list) {
      const items = Array.from(
        inlineQueueUI.list.querySelectorAll(".video-item")
      );
      const rect = direct.getBoundingClientRect();
      const before = event.clientY < rect.top + rect.height / 2;
      const baseIndex = items.indexOf(direct);
      targetIndex = before ? baseIndex : baseIndex + 1;
    } else {
      targetIndex = queueIds.length;
    }
  }
  const bounded = Math.max(0, Math.min(queueIds.length, Number(targetIndex)));
  resetInlineQueueDragState();
  if (bounded === fromIndex || bounded === fromIndex + 1) {
    return;
  }
  const desiredIndex = bounded > fromIndex ? bounded - 1 : bounded;
  const adjustedIndex = Math.max(
    0,
    Math.min(queueIds.length - 1, Number.isFinite(desiredIndex) ? desiredIndex : 0)
  );
  if (adjustedIndex === fromIndex) {
    return;
  }
  const payload = { videoId, targetIndex: adjustedIndex };
  if (inlinePlaylistState.currentListId) {
    payload.listId = inlinePlaylistState.currentListId;
  }
  setInlineQueuePendingFocus(videoId);
  sendMessage("playlist:reorder", payload)
    .then((state) => {
      if (state && typeof state === "object") {
        updateInlinePlaylistState(state);
      } else {
        clearInlineQueuePendingFocus();
      }
    })
    .catch((err) => {
      console.warn("Failed to reorder inline queue", err);
      clearInlineQueuePendingFocus();
    });
}

function handleInlineQueueDragEnd() {
  resetInlineQueueDragState();
}

function clearInlineQueueDropIndicators() {
  if (!inlineQueueUI.list) {
    return;
  }
  inlineQueueUI.list
    .querySelectorAll(".drop-before, .drop-after")
    .forEach((el) => el.classList.remove("drop-before", "drop-after"));
}

function resetInlineQueueDragState() {
  stopInlineQueueAutoScroll();
  if (inlineQueueDragState.draggingEl) {
    inlineQueueDragState.draggingEl.classList.remove("dragging");
  }
  clearInlineQueueDropIndicators();
  inlineQueueDragState.videoId = null;
  inlineQueueDragState.dropIndex = null;
  inlineQueueDragState.draggingEl = null;
  inlineQueueDragState.pendingVideoId = null;
  inlineQueueDragState.pendingElement = null;
}

function setInlineQueuePendingFocus(videoId) {
  if (typeof videoId !== "string" || !videoId) {
    return;
  }
  inlineQueuePendingFocusId = videoId;
  inlineQueuePendingFocusListId = inlinePlaylistState.currentListId || null;
  if (inlineQueueUI.list && typeof inlineQueueUI.list.scrollTop === "number") {
    inlineQueuePendingScrollTop = inlineQueueUI.list.scrollTop;
  } else {
    inlineQueuePendingScrollTop = null;
  }
}

function clearInlineQueuePendingFocus() {
  inlineQueuePendingFocusId = null;
  inlineQueuePendingFocusListId = null;
  inlineQueuePendingScrollTop = null;
}

function computeInlineQueuePointerDropTarget(pointerY, items) {
  if (!Array.isArray(items) || !items.length) {
    return { index: 0, element: null, before: null };
  }
  const pointer = Number(pointerY);
  const resolvedPointer = Number.isFinite(pointer) ? pointer : 0;
  let fallback = null;
  for (let i = 0; i < items.length; i += 1) {
    const element = items[i];
    if (element === inlineQueueDragState.draggingEl) {
      continue;
    }
    const rect = element.getBoundingClientRect();
    const before = resolvedPointer < rect.top + rect.height / 2;
    if (before) {
      return { index: i, element, before: true };
    }
    fallback = { index: i + 1, element, before: false };
  }
  if (fallback) {
    return fallback;
  }
  return { index: 0, element: null, before: null };
}

function getInlineQueueParent(node) {
  if (!node) {
    return null;
  }
  if (node.parentElement instanceof HTMLElement) {
    return node.parentElement;
  }
  if (
    typeof ShadowRoot !== "undefined" &&
    node.parentNode &&
    node.parentNode instanceof ShadowRoot
  ) {
    return node.parentNode.host || null;
  }
  return null;
}

function scrollElementBy(element, delta) {
  if (!element || typeof element.scrollTop !== "number") {
    return false;
  }
  const { scrollHeight, clientHeight } = element;
  if (!Number.isFinite(scrollHeight) || !Number.isFinite(clientHeight)) {
    return false;
  }
  const maxScroll = Math.max(0, scrollHeight - clientHeight);
  if (maxScroll <= INLINE_QUEUE_SCROLL_EPSILON) {
    return false;
  }
  const prev = element.scrollTop;
  const next = Math.max(0, Math.min(maxScroll, prev + delta));
  if (Math.abs(next - prev) <= INLINE_QUEUE_SCROLL_EPSILON) {
    return false;
  }
  element.scrollTop = next;
  return Math.abs(element.scrollTop - prev) > INLINE_QUEUE_SCROLL_EPSILON;
}

function maybeScrollInlineQueueAncestors(delta) {
  let current = inlineQueueUI.container || null;
  while (current) {
    if (scrollElementBy(current, delta)) {
      return true;
    }
    current = getInlineQueueParent(current);
    if (!current || current === document.body || current === document.documentElement) {
      break;
    }
  }
  return false;
}

function maybeScrollDocument(delta) {
  const scrollingElement =
    document.scrollingElement || document.documentElement || document.body;
  if (!scrollingElement) {
    return false;
  }
  const prev = scrollingElement.scrollTop;
  const maxScroll = Math.max(0, scrollingElement.scrollHeight - scrollingElement.clientHeight);
  if (maxScroll <= INLINE_QUEUE_SCROLL_EPSILON) {
    return false;
  }
  const next = Math.max(0, Math.min(maxScroll, prev + delta));
  if (Math.abs(next - prev) <= INLINE_QUEUE_SCROLL_EPSILON) {
    return false;
  }
  scrollingElement.scrollTop = next;
  return Math.abs(scrollingElement.scrollTop - prev) > INLINE_QUEUE_SCROLL_EPSILON;
}

function ensureInlineQueueFullyVisible() {
  const container = inlineQueueUI.container;
  if (!container) {
    return false;
  }
  const viewportHeight =
    window.innerHeight ||
    (document.documentElement && document.documentElement.clientHeight) ||
    0;
  if (!viewportHeight) {
    return false;
  }
  const rect = container.getBoundingClientRect();
  if (rect.top < 0) {
    if (Math.abs(rect.top) <= INLINE_QUEUE_SCROLL_EPSILON) {
      return false;
    }
    return maybeScrollDocument(rect.top);
  }
  if (rect.bottom > viewportHeight) {
    const delta = rect.bottom - viewportHeight;
    if (Math.abs(delta) <= INLINE_QUEUE_SCROLL_EPSILON) {
      return false;
    }
    return maybeScrollDocument(delta);
  }
  return false;
}

function maybeScrollDocumentForInlineQueue(delta) {
  if (!inlineQueueUI.container || typeof delta !== "number" || delta === 0) {
    return false;
  }
  const viewportHeight =
    window.innerHeight ||
    (document.documentElement && document.documentElement.clientHeight) ||
    0;
  if (!viewportHeight) {
    return maybeScrollDocument(delta);
  }
  const rect = inlineQueueUI.container.getBoundingClientRect();
  if (delta < 0) {
    if (rect.top >= 0) {
      return false;
    }
    if (Math.abs(rect.top) <= INLINE_QUEUE_SCROLL_EPSILON) {
      return false;
    }
    return maybeScrollDocument(rect.top);
  }
  if (delta > 0) {
    if (rect.bottom <= viewportHeight) {
      return false;
    }
    const needed = rect.bottom - viewportHeight;
    if (Math.abs(needed) <= INLINE_QUEUE_SCROLL_EPSILON) {
      return false;
    }
    return maybeScrollDocument(needed);
  }
  return false;
}

function maybeAutoScrollInlineQueueList(pointerY) {
  if (!inlineQueueUI.list || typeof pointerY !== "number") {
    return false;
  }
  const list = inlineQueueUI.list;
  const { scrollHeight, clientHeight } = list;
  if (scrollHeight <= clientHeight) {
    return false;
  }
  const rect = list.getBoundingClientRect();
  const threshold = INLINE_QUEUE_AUTO_SCROLL_THRESHOLD;
  const topDistance = pointerY - rect.top;
  const bottomDistance = rect.bottom - pointerY;
  let delta = 0;
  if (topDistance <= threshold) {
    const distance = Math.max(0, topDistance);
    const intensity = (threshold - distance) / threshold;
    delta = -Math.ceil(intensity * INLINE_QUEUE_AUTO_SCROLL_MAX_STEP);
  } else if (bottomDistance <= threshold) {
    const distance = Math.max(0, bottomDistance);
    const intensity = (threshold - distance) / threshold;
    delta = Math.ceil(intensity * INLINE_QUEUE_AUTO_SCROLL_MAX_STEP);
  }
  if (delta !== 0) {
    if (scrollElementBy(list, delta)) {
      return true;
    }
    if (maybeScrollInlineQueueAncestors(delta)) {
      return true;
    }
    if (maybeScrollDocumentForInlineQueue(delta)) {
      return true;
    }
  }
  return false;
}

function runInlineQueueAutoScroll() {
  inlineQueueAutoScrollState.rafId = null;
  if (!inlineQueueDragState.videoId) {
    inlineQueueAutoScrollState.pointerY = null;
    return;
  }
  const pointerY = inlineQueueAutoScrollState.pointerY;
  if (typeof pointerY !== "number") {
    return;
  }
  const scrolled = maybeAutoScrollInlineQueueList(pointerY);
  if (!scrolled) {
    inlineQueueAutoScrollState.pointerY = null;
    return;
  }
  inlineQueueAutoScrollState.rafId = window.requestAnimationFrame(
    runInlineQueueAutoScroll
  );
}

function scheduleInlineQueueAutoScroll(pointerY, alreadyScrolled) {
  if (typeof pointerY !== "number") {
    return;
  }
  inlineQueueAutoScrollState.pointerY = pointerY;
  if (alreadyScrolled && inlineQueueAutoScrollState.rafId) {
    return;
  }
  if (!inlineQueueAutoScrollState.rafId) {
    inlineQueueAutoScrollState.rafId = window.requestAnimationFrame(
      runInlineQueueAutoScroll
    );
  }
}

function restoreInlineQueueScroll(list, desiredScrollTop) {
  if (!list || typeof list.scrollTop !== "number") {
    return;
  }
  const scrollHeight = Number(list.scrollHeight) || 0;
  const clientHeight = Number(list.clientHeight) || 0;
  const maxScroll = Math.max(0, scrollHeight - clientHeight);
  const rawTarget = Number(desiredScrollTop);
  const target = Number.isFinite(rawTarget)
    ? Math.max(0, Math.min(maxScroll, rawTarget))
    : Math.max(0, Math.min(maxScroll, list.scrollTop));
  if (Math.abs(list.scrollTop - target) > INLINE_QUEUE_SCROLL_EPSILON) {
    list.scrollTop = target;
  }
}

function applyInlineQueuePendingFocus() {
  if (!inlineQueuePendingFocusId || !inlineQueueUI.list) {
    clearInlineQueuePendingFocus();
    return;
  }
  const expectedListId = inlineQueuePendingFocusListId || null;
  const currentListId = inlinePlaylistState.currentListId || null;
  if (expectedListId !== null && expectedListId !== currentListId) {
    clearInlineQueuePendingFocus();
    return;
  }
  const items = inlineQueueUI.list.querySelectorAll(".video-item");
  let target = null;
  for (const element of items) {
    if (
      element instanceof HTMLElement &&
      element.dataset.videoId === inlineQueuePendingFocusId
    ) {
      target = element;
      break;
    }
  }
  if (target) {
    if (typeof target.focus === "function") {
      try {
        target.focus({ preventScroll: true });
      } catch (_) {
        target.focus();
      }
    }
    if (typeof target.getBoundingClientRect === "function") {
      const listRect = inlineQueueUI.list.getBoundingClientRect();
      const itemRect = target.getBoundingClientRect();
      if (itemRect.top < listRect.top || itemRect.bottom > listRect.bottom) {
        if (typeof target.scrollIntoView === "function") {
          target.scrollIntoView({ block: "nearest" });
        }
      }
    }
  }
  clearInlineQueuePendingFocus();
}

function stopInlineQueueAutoScroll() {
  if (inlineQueueAutoScrollState.rafId) {
    window.cancelAnimationFrame(inlineQueueAutoScrollState.rafId);
    inlineQueueAutoScrollState.rafId = null;
  }
  inlineQueueAutoScrollState.pointerY = null;
}

function ensureInlineMoveMenuElements() {
  if (
    inlineMoveMenu.container &&
    inlineMoveMenu.buttons &&
    inlineMoveMenu.message
  ) {
    return inlineMoveMenu;
  }
  const container = document.createElement("div");
  container.className = "yta-inline-move-menu";
  container.dataset.visible = "0";

  const message = document.createElement("div");
  message.className = "yta-inline-move-menu__message";
  message.textContent = "Перенести в список:";

  const buttons = document.createElement("div");
  buttons.className = "yta-inline-move-menu__buttons";
  buttons.dataset.empty = "1";
  buttons.addEventListener("click", handleInlineMoveMenuClick);

  container.append(message, buttons);
  document.body.appendChild(container);

  inlineMoveMenu.container = container;
  inlineMoveMenu.message = message;
  inlineMoveMenu.buttons = buttons;
  return inlineMoveMenu;
}

function removeInlineMoveMenuListeners() {
  document.removeEventListener("pointerdown", handleInlineMoveMenuPointerDown, true);
  document.removeEventListener("keydown", handleInlineMoveMenuKeyDown, true);
  window.removeEventListener("scroll", handleInlineMoveMenuScroll, true);
  window.removeEventListener("resize", handleInlineMoveMenuScroll, true);
}

function hideInlineMoveMenu() {
  if (!inlineMoveMenu.container) {
    inlineMoveMenu.visible = false;
    return;
  }
  if (inlineMoveMenu.visible) {
    inlineMoveMenu.container.dataset.visible = "0";
    inlineMoveMenu.container.style.visibility = "";
  }
  inlineMoveMenu.visible = false;
  inlineMoveMenu.videoId = null;
  inlineMoveMenu.listId = null;
  inlineMoveMenu.anchor = null;
  removeInlineMoveMenuListeners();
}

function handleInlineMoveMenuPointerDown(event) {
  if (!inlineMoveMenu.visible || !inlineMoveMenu.container) {
    return;
  }
  if (inlineMoveMenu.container.contains(event.target)) {
    return;
  }
  if (
    inlineMoveMenu.anchor &&
    inlineMoveMenu.anchor instanceof HTMLElement &&
    inlineMoveMenu.anchor.contains(event.target)
  ) {
    return;
  }
  hideInlineMoveMenu();
}

function handleInlineMoveMenuKeyDown(event) {
  if (event.key === "Escape") {
    hideInlineMoveMenu();
  }
}

function handleInlineMoveMenuScroll() {
  hideInlineMoveMenu();
}

function handleInlineMoveMenuClick(event) {
  const button = event.target.closest("button[data-target-list]");
  if (!button) {
    return;
  }
  event.preventDefault();
  const targetListId = button.dataset.targetList;
  if (!targetListId) {
    return;
  }
  const videoId = inlineMoveMenu.videoId;
  hideInlineMoveMenu();
  if (!videoId) {
    return;
  }
  sendMessage("playlist:moveVideo", { videoId, targetListId })
    .then((state) => {
      if (state && typeof state === "object") {
        updateInlinePlaylistState(state);
      }
    })
    .catch((err) => {
      console.warn("Failed to move video from inline queue", err);
    });
}

function showInlineMoveMenu(videoId, listId, anchor) {
  if (!videoId || !(anchor instanceof HTMLElement)) {
    return;
  }
  if (inlineMoveMenu.visible && inlineMoveMenu.anchor === anchor) {
    hideInlineMoveMenu();
    return;
  }
  hideInlineMoveMenu();
  const menu = ensureInlineMoveMenuElements();
  const lists = Array.isArray(inlinePlaylistState.lists)
    ? inlinePlaylistState.lists
    : [];
  const targets = lists.filter(
    (entry) => entry && entry.id && entry.id !== listId
  );
  menu.buttons.textContent = "";
  if (!targets.length) {
    menu.buttons.dataset.empty = "1";
    menu.message.textContent = "Нет других списков";
  } else {
    menu.buttons.dataset.empty = "0";
    menu.message.textContent = "Перенести в список:";
    targets.forEach((list) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "yta-inline-move-menu__option";
      btn.dataset.targetList = list.id;
      const label =
        typeof list.name === "string" && list.name.trim()
          ? list.name.trim()
          : list.id === DEFAULT_LIST_ID
          ? "Список по умолчанию"
          : "Список";
      btn.textContent = label;
      menu.buttons.appendChild(btn);
    });
  }
  inlineMoveMenu.videoId = videoId;
  inlineMoveMenu.listId = listId || null;
  inlineMoveMenu.anchor = anchor;
  inlineMoveMenu.visible = true;
  menu.container.dataset.visible = "1";
  menu.container.style.visibility = "hidden";
  menu.container.style.top = "0px";
  menu.container.style.left = "0px";
  const menuRect = menu.container.getBoundingClientRect();
  const anchorRect = anchor.getBoundingClientRect();
  const margin = 12;
  const viewportWidth =
    window.innerWidth || document.documentElement.clientWidth || 0;
  const viewportHeight =
    window.innerHeight || document.documentElement.clientHeight || 0;
  let top = window.scrollY + anchorRect.bottom + margin;
  if (top + menuRect.height > window.scrollY + viewportHeight - margin) {
    top = window.scrollY + anchorRect.top - margin - menuRect.height;
  }
  let left = window.scrollX + anchorRect.left;
  if (left + menuRect.width > window.scrollX + viewportWidth - margin) {
    left = window.scrollX + viewportWidth - margin - menuRect.width;
  }
  left = Math.max(window.scrollX + margin, left);
  top = Math.max(window.scrollY + margin, top);
  menu.container.style.top = `${top}px`;
  menu.container.style.left = `${left}px`;
  menu.container.style.visibility = "";

  document.addEventListener("pointerdown", handleInlineMoveMenuPointerDown, {
    capture: true,
  });
  document.addEventListener("keydown", handleInlineMoveMenuKeyDown, {
    capture: true,
  });
  window.addEventListener("scroll", handleInlineMoveMenuScroll, true);
  window.addEventListener("resize", handleInlineMoveMenuScroll, true);
}

function updateInlineQueueUI() {
  const context =
    typeof determinePageContext === "function" ? determinePageContext() : "other";
  const controlsActive = Boolean(state && state.controlsActive);
  if (context !== "watch" || !controlsActive) {
    hideInlineMoveMenu();
    teardownInlineQueue();
    return;
  }
  if (
    typeof getCurrentVideoId === "function" &&
    inlinePlaylistState.currentVideoId
  ) {
    const pageVideoId = getCurrentVideoId();
    if (
      pageVideoId &&
      inlinePlaylistState.currentVideoId !== pageVideoId &&
      !inlinePlaylistState.videoIds.has(pageVideoId)
    ) {
      hideInlineMoveMenu();
      teardownInlineQueue();
      return;
    }
  }
  const ui = ensureInlineQueueElements();
  if (!ui) {
    scheduleInlineQueueRenderRetry();
    return;
  }
  cancelInlineQueueRenderRetry();
  hideInlineMoveMenu();
  resetInlineQueueDragState();

  const entries = Array.isArray(inlinePlaylistState.queueEntries)
    ? inlinePlaylistState.queueEntries
    : [];
  const currentIndex =
    typeof inlinePlaylistState.currentIndex === "number" &&
    inlinePlaylistState.currentIndex >= 0
      ? inlinePlaylistState.currentIndex
      : null;
  const currentVideoId = inlinePlaylistState.currentVideoId;
  const allowPostpone = !inlinePlaylistState.freeze && entries.length > 1;

  ui.container.hidden = false;
  ui.container.dataset.visible = "1";
  ui.container.dataset.listId = inlinePlaylistState.currentListId || "";

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

  const previousScrollTop =
    ui.list && typeof ui.list.scrollTop === "number" ? ui.list.scrollTop : 0;
  const desiredScrollTop =
    inlineQueuePendingScrollTop !== null
      ? inlineQueuePendingScrollTop
      : previousScrollTop;
  ui.list.textContent = "";

  entries.forEach((entry, index) => {
    if (!entry || typeof entry !== "object" || !entry.id) {
      return;
    }
    const isCurrent =
      currentIndex !== null
        ? index === currentIndex
        : Boolean(currentVideoId) && entry.id === currentVideoId;
    const item = createInlineQueueItem(entry, index, isCurrent, {
      allowPostpone,
    });
    ui.list.appendChild(item);
  });

  restoreInlineQueueScroll(ui.list, desiredScrollTop);
  const hadPendingFocus = inlineQueuePendingFocusId !== null;
  applyInlineQueuePendingFocus();
  ui.container.dataset.empty = entries.length > 0 ? "0" : "1";
  if (
    !hadPendingFocus &&
    currentVideoId &&
    (inlineQueueLastAutoScrollVideoId !== currentVideoId ||
      inlineQueueLastAutoScrollListId !== (inlinePlaylistState.currentListId || null))
  ) {
    if (scrollInlineQueueToCurrentItem()) {
      inlineQueueLastAutoScrollVideoId = currentVideoId;
      inlineQueueLastAutoScrollListId = inlinePlaylistState.currentListId || null;
    }
  }
}

function updateInlinePlaylistState(rawPresentation) {
  if (!rawPresentation || typeof rawPresentation !== "object") {
    return;
  }
  let presentation = rawPresentation;
  if (
    !presentation.currentQueue &&
    presentation.state &&
    typeof presentation.state === "object"
  ) {
    presentation = presentation.state;
  }
  if (!presentation || typeof presentation !== "object") {
    return;
  }
  if (
    presentation.currentQueue &&
    !Array.isArray(presentation.currentQueue.queue)
  ) {
    if (!pendingInlineRefresh) {
      pendingInlineRefresh = true;
      window.setTimeout(async () => {
        try {
          await refreshInlinePlaylistState();
        } finally {
          pendingInlineRefresh = false;
        }
      }, 0);
    }
    return;
  }
  const queueEntries = Array.isArray(presentation?.currentQueue?.queue)
    ? presentation.currentQueue.queue
    : [];
  const normalizedEntries = [];
  const orderedIds = [];
  const entryMap = new Map();
  queueEntries.forEach((entry) => {
    if (!entry || typeof entry !== "object") {
      return;
    }
    const id = typeof entry.id === "string" ? entry.id : null;
    if (!id) {
      return;
    }
    orderedIds.push(id);
    const normalized = {
      id,
      title: entry.title || "",
      channelId: entry.channelId || "",
      channelTitle: entry.channelTitle || "",
      channelUrl:
        typeof entry.channelUrl === "string" && entry.channelUrl
          ? entry.channelUrl
          : null,
      thumbnail: entry.thumbnail || "",
      publishedAt: entry.publishedAt || null,
      duration: entry.duration ?? null,
      addedAt: entry.addedAt ?? null,
    };
    normalizedEntries.push(normalized);
    if (!entryMap.has(id)) {
      entryMap.set(id, normalized);
    }
  });
  const listId = presentation?.currentQueue?.id || presentation?.currentListId || null;
  const listFrozen = Boolean(presentation?.currentQueue?.freeze);
  const rawIndex = presentation?.currentQueue?.currentIndex;
  const normalizedIndex =
    Number.isInteger(rawIndex) && rawIndex >= 0 && rawIndex < orderedIds.length
      ? rawIndex
      : orderedIds.length
      ? 0
      : null;
  const historyLength = Array.isArray(presentation?.history)
    ? presentation.history.length
    : 0;
  const newSet = new Set(orderedIds);
  let changed =
    inlinePlaylistState.currentListId !== listId ||
    inlinePlaylistState.currentIndex !== normalizedIndex ||
    inlinePlaylistState.historyLength !== historyLength ||
    inlinePlaylistState.orderedVideoIds.length !== orderedIds.length;
  if (!changed) {
    for (let i = 0; i < orderedIds.length; i += 1) {
      if (inlinePlaylistState.orderedVideoIds[i] !== orderedIds[i]) {
        changed = true;
        break;
      }
    }
  }
  inlinePlaylistState.currentListId = listId;
  inlinePlaylistState.videoIds = newSet;
  inlinePlaylistState.orderedVideoIds = orderedIds;
  inlinePlaylistState.indexById = new Map(
    orderedIds.map((id, index) => [id, index])
  );
  inlinePlaylistState.currentIndex = normalizedIndex;
  inlinePlaylistState.historyLength = historyLength;
  inlinePlaylistState.freeze = listFrozen;
  inlinePlaylistState.queueEntries = normalizedEntries;
  inlinePlaylistState.entriesById = entryMap;
  const listsMeta = Array.isArray(presentation?.lists)
    ? presentation.lists
    : [];
  inlinePlaylistState.lists = listsMeta
    .map((list) => ({
      id: typeof list?.id === "string" ? list.id : null,
      name: typeof list?.name === "string" ? list.name : "",
      freeze: Boolean(list?.freeze),
      length:
        typeof list?.length === "number" && Number.isFinite(list.length)
          ? list.length
          : 0,
      revision:
        typeof list?.revision === "number" && Number.isFinite(list.revision)
          ? list.revision
          : 0,
    }))
    .filter((list) => list.id);
  inlinePlaylistState.currentListName =
    typeof presentation?.currentQueue?.name === "string"
      ? presentation.currentQueue.name
      : "";
  inlinePlaylistState.currentVideoId =
    typeof presentation?.currentVideoId === "string" && presentation.currentVideoId
      ? presentation.currentVideoId
      : null;

  const progressEntries =
    presentation && typeof presentation === "object" && presentation.videoProgress
      ? presentation.videoProgress
      : null;
  const progressMap = new Map();
  if (progressEntries && typeof progressEntries === "object") {
    Object.entries(progressEntries).forEach(([id, entry]) => {
      if (typeof id !== "string" || !id) {
        return;
      }
      const percent = Number(entry?.percent);
      if (!Number.isFinite(percent) || percent <= 0) {
        return;
      }
      const clamped = Math.max(0, Math.min(100, Math.round(percent)));
      if (clamped <= 0) {
        return;
      }
      const updatedAt = Number.isFinite(Number(entry?.updatedAt))
        ? Number(entry.updatedAt)
        : 0;
      progressMap.set(id, { percent: clamped, updatedAt });
    });
  }
  inlinePlaylistState.progress = progressMap;
  if (changed) {
    syncAllInlineButtons();
  }
  if (typeof globalThis.ytaSyncVideoCardProgress === "function") {
    try {
      globalThis.ytaSyncVideoCardProgress();
    } catch (err) {
      console.debug("Failed to sync card progress", err);
    }
  }
  updatePlayerControlsUI();
  updateInlineQueueUI();
  if (typeof updatePageActions === "function") {
    updatePageActions();
  }
}

function isVideoInCurrentList(videoId) {
  if (!videoId) return false;
  return inlinePlaylistState.videoIds.has(videoId);
}

function syncInlineButtonState(button) {
  if (!(button instanceof HTMLButtonElement)) {
    return;
  }
  const videoId = button.dataset.videoId;
  const playlistId = button.dataset.playlistId;
  const status = button.dataset.ytaStatus;
  if (!videoId) {
    if (status === "success" && playlistId) {
      button.classList.add(ADD_BUTTON_DONE_CLASS);
      button.disabled = true;
      return;
    }
    button.classList.remove(ADD_BUTTON_DONE_CLASS);
    if (status === "pending") {
      button.disabled = true;
      return;
    }
    if (!status || (status !== "pending" && status !== "success")) {
      delete button.dataset.ytaStatus;
    }
    button.disabled = false;
    return;
  }
  if (isVideoInCurrentList(videoId)) {
    button.classList.add(ADD_BUTTON_DONE_CLASS);
    button.dataset.ytaStatus = "present";
    button.disabled = true;
    return;
  }
  button.classList.remove(ADD_BUTTON_DONE_CLASS);
  if (button.dataset.ytaStatus === "pending") {
    button.disabled = true;
    return;
  }
  delete button.dataset.ytaStatus;
  button.disabled = false;
}

function syncAllInlineButtons() {
  document
    .querySelectorAll(`.${ADD_BUTTON_CLASS}`)
    .forEach((button) => syncInlineButtonState(button));
}

async function refreshInlinePlaylistState() {
  const presentation = await sendMessage("playlist:getState");
  if (presentation && typeof presentation === "object") {
    updateInlinePlaylistState(presentation);
  }
}
