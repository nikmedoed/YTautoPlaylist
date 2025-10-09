const state = {
  videoElement: null,
  controlsActive: false,
  currentVideoId: null,
  lastReportedVideoId: null,
};

const STYLE_ID = "yta-controller-style";
const CARD_MARK = "data-yta-enhanced";
const THUMB_HOST_CLASS = "yta-thumb-host";
const ADD_BUTTON_CLASS = "yta-inline-add";
const ADD_BUTTON_DONE_CLASS = "yta-inline-add--done";
const VIDEO_CARD_SELECTOR = [
  "ytd-rich-grid-media",
  "ytd-rich-grid-slim-media",
  "ytd-rich-item-renderer",
  "ytd-video-renderer",
  "ytd-compact-video-renderer",
  "ytd-grid-video-renderer",
  "ytd-playlist-video-renderer",
  "ytd-playlist-panel-video-renderer",
  "ytd-watch-card-compact-video-renderer",
].join(",");
const floatingControls = {
  container: null,
  prev: null,
  next: null,
  hideTimer: null,
  cursorTimer: null,
};
const pageActions = {
  container: null,
  addCurrent: null,
  addAll: null,
  status: null,
  timeout: null,
};
const CONTEXT_CAPABILITIES = {
  watch: { canAddCurrent: true, canAddPage: false },
  channelVideos: { canAddCurrent: false, canAddPage: true },
  channelFeatured: { canAddCurrent: false, canAddPage: false },
  channelHome: { canAddCurrent: false, canAddPage: false },
  home: { canAddCurrent: false, canAddPage: false },
  other: { canAddCurrent: false, canAddPage: false },
};
let lastPageContext = null;
let lastCapabilities = { canAddCurrent: null, canAddPage: null };
const PAGE_COLLECTION_LIMIT = 5000;
const PAGE_SCROLL_MAX_LOOPS = 120;
const PAGE_SCROLL_IDLE_LIMIT = 4;
const PAGE_SCROLL_DELAY = 350;

function parseVideoId(input) {
  if (!input) return "";
  const str = String(input).trim();
  if (/^[\w-]{11}$/.test(str)) return str;
  try {
    const url = new URL(str, window.location.href);
    if (url.hostname.includes("youtu.be")) {
      const parts = url.pathname.split("/").filter(Boolean);
      const id = parts[0];
      if (/^[\w-]{11}$/.test(id)) return id;
    }
    const v = url.searchParams.get("v");
    if (v && /^[\w-]{11}$/.test(v)) return v;
    const segments = url.pathname.split("/");
    for (const part of segments) {
      if (/^[\w-]{11}$/.test(part)) return part;
    }
  } catch (_) {
    /* not a full URL */
  }
  const match = str.match(/[\w-]{11}/);
  return match ? match[0] : "";
}

function determinePageContext() {
  const pathname = window.location.pathname || "";
  if (pathname.startsWith("/watch") || pathname.startsWith("/shorts/")) {
    return "watch";
  }
  if (/^\/@[^/]+\/videos\/?$/.test(pathname)) {
    return "channelVideos";
  }
  if (/^\/@[^/]+\/featured\/?$/.test(pathname)) {
    return "channelFeatured";
  }
  if (/^\/@[^/]+\/?$/.test(pathname)) {
    return "channelHome";
  }
  if (pathname === "/" || /^\/feed\//.test(pathname)) {
    return "home";
  }
  return "other";
}

function getContextCapabilities(context = determinePageContext()) {
  const base = CONTEXT_CAPABILITIES[context] || CONTEXT_CAPABILITIES.other;
  const currentAvailable = Boolean(getCurrentVideoId());
  return {
    canAddCurrent: Boolean(base.canAddCurrent && currentAvailable),
    canAddPage: Boolean(base.canAddPage),
  };
}

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
  .${THUMB_HOST_CLASS} {
    position: relative !important;
  }
  .${ADD_BUTTON_CLASS} {
    position: absolute;
    top: 8px;
    left: 8px;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    border: none;
    background: rgba(17, 17, 17, 0.8);
    color: #fff;
    font-size: 18px;
    line-height: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    z-index: 5;
    transition: transform 0.15s ease, background 0.2s ease, opacity 0.2s ease;
  }
  .${ADD_BUTTON_CLASS}:hover {
    transform: scale(1.08);
    background: rgba(229, 45, 39, 0.9);
  }
  .${ADD_BUTTON_CLASS}[disabled] {
    cursor: progress;
    opacity: 0.6;
  }
  .${ADD_BUTTON_CLASS}.${ADD_BUTTON_DONE_CLASS} {
    background: rgba(34, 197, 94, 0.85);
  }
  .${ADD_BUTTON_CLASS}::after {
    content: "+";
    font-weight: 600;
  }
  .${ADD_BUTTON_CLASS}.${ADD_BUTTON_DONE_CLASS}::after {
    content: "✓";
    font-weight: 600;
  }
  .yta-player-controls {
    position: absolute;
    top: 12px;
    right: 12px;
    display: flex;
    gap: 8px;
    z-index: 1000;
    pointer-events: auto;
  }
  .yta-player-controls button {
    border: none;
    border-radius: 16px;
    padding: 6px 10px;
    background: rgba(17, 17, 17, 0.7);
    color: #fff;
    font-size: 12px;
    cursor: pointer;
    transition: background 0.2s ease, transform 0.15s ease;
  }
  .yta-player-controls button:hover {
    background: rgba(229, 45, 39, 0.9);
    transform: translateY(-1px);
  }
  .yta-player-controls button[disabled] {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .yta-floating-controls {
    position: fixed;
    right: 18px;
    bottom: 32px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    z-index: 2147483646;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.2s ease;
  }
  .yta-floating-controls[data-visible="1"] {
    opacity: 1;
    pointer-events: auto;
  }
  .yta-floating-controls button {
    border: none;
    border-radius: 18px;
    padding: 10px 16px;
    background: rgba(17, 17, 17, 0.82);
    color: #fff;
    font-size: 13px;
    cursor: pointer;
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.35);
    transition: background 0.2s ease, transform 0.15s ease;
  }
  .yta-floating-controls button:hover {
    background: rgba(229, 45, 39, 0.92);
    transform: translateY(-1px);
  }
  .yta-floating-controls button:disabled {
    opacity: 0.45;
    cursor: default;
    transform: none;
  }
  .yta-page-actions {
    position: fixed;
    bottom: 96px;
    right: 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    z-index: 2147483647;
    font-size: 12px;
  }
  .yta-page-actions[data-hidden="1"] {
    display: none;
  }
  .yta-page-actions button {
    border: none;
    border-radius: 999px;
    padding: 8px 14px;
    background: rgba(17, 17, 17, 0.85);
    color: #fff;
    cursor: pointer;
    transition: background 0.2s ease, transform 0.15s ease;
    font-weight: 600;
  }
  .yta-page-actions button:hover {
    background: rgba(229, 45, 39, 0.9);
    transform: translateY(-1px);
  }
  .yta-page-actions button:disabled {
    opacity: 0.6;
    cursor: progress;
    transform: none;
  }
  .yta-page-actions__status {
    padding: 8px 12px;
    border-radius: 999px;
    background: rgba(25, 118, 210, 0.25);
    color: #cbdfff;
    display: none;
  }
  .yta-page-actions__status[data-visible="1"] {
    display: inline-block;
  }
  .yta-page-actions__status[data-kind="success"] {
    background: rgba(56, 142, 60, 0.25);
    color: #c8f7cb;
  }
  .yta-page-actions__status[data-kind="error"] {
    background: rgba(229, 45, 39, 0.25);
    color: #ffd7d7;
  }
  `;
  document.head.appendChild(style);
}

function getCurrentVideoId() {
  const fromState = state.currentVideoId;
  if (fromState) return fromState;
  const id = parseVideoId(window.location.href);
  if (id) {
    state.currentVideoId = id;
  }
  return state.currentVideoId;
}

async function sendMessage(type, payload) {
  try {
    return await chrome.runtime.sendMessage({ type, ...payload });
  } catch (err) {
    if (
      !err ||
      typeof err.message !== "string" ||
      !/receiving end/i.test(err.message)
    ) {
      console.warn("Failed to send message", type, err);
    }
    return null;
  }
}

function findVideoIdInCard(card) {
  if (!(card instanceof HTMLElement)) return "";
  const direct =
    card.dataset?.videoId ||
    card.getAttribute("data-video-id") ||
    card.getAttribute("data-id");
  if (direct) {
    const parsed = parseVideoId(direct);
    if (parsed) return parsed;
  }
  const datasetNode = card.querySelector("[data-video-id]");
  if (datasetNode && datasetNode.dataset) {
    const parsed = parseVideoId(datasetNode.dataset.videoId);
    if (parsed) return parsed;
  }
  const anchors = card.querySelectorAll("a[href]");
  for (const anchor of anchors) {
    const href = anchor.href || anchor.getAttribute("href");
    if (!href) continue;
    const parsed = parseVideoId(href);
    if (parsed) return parsed;
  }
  const buttons = card.querySelectorAll("button[data-video-id]");
  for (const btn of buttons) {
    const parsed = parseVideoId(btn.getAttribute("data-video-id"));
    if (parsed) return parsed;
  }
  return "";
}

function decorateVideoCard(card) {
  if (!(card instanceof HTMLElement)) return;
  const videoId = findVideoIdInCard(card);
  if (!videoId) return;
  const previousId = card.getAttribute("data-yta-video-id");
  if (previousId === videoId && card.hasAttribute(CARD_MARK)) {
    return;
  }
  card.setAttribute("data-yta-video-id", videoId);
  let host =
    card.querySelector("ytd-thumbnail") ||
    card.querySelector("a#thumbnail") ||
    card.querySelector("yt-img-shadow");
  if (host instanceof HTMLElement) {
    host.classList.add(THUMB_HOST_CLASS);
  } else {
    host = card;
    host.classList.add(THUMB_HOST_CLASS);
  }
  let button = card.querySelector(`.${ADD_BUTTON_CLASS}`);
  if (!button) {
    button = document.createElement("button");
    button.type = "button";
    button.className = ADD_BUTTON_CLASS;
    button.title = "Добавить в очередь расширения";
    button.addEventListener(
      "click",
      (event) => {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        const id = button.dataset.videoId;
        if (!id) return;
        button.disabled = true;
        sendMessage("playlist:addByIds", { videoIds: [id] })
          .then(() => {
            button.classList.add(ADD_BUTTON_DONE_CLASS);
            setTimeout(() => {
              button.classList.remove(ADD_BUTTON_DONE_CLASS);
            }, 2000);
          })
          .catch(() => {
            button.classList.remove(ADD_BUTTON_DONE_CLASS);
          })
          .finally(() => {
            button.disabled = false;
          });
      },
      true
    );
    host.appendChild(button);
  }
  button.dataset.videoId = videoId;
  button.classList.remove(ADD_BUTTON_DONE_CLASS);
  card.setAttribute(CARD_MARK, "1");
}

function enhanceVideoCards(root = document) {
  if (!root) return;
  if (root instanceof HTMLElement && root.matches(VIDEO_CARD_SELECTOR)) {
    decorateVideoCard(root);
  }
  if (root.querySelectorAll) {
    const cards = root.querySelectorAll(VIDEO_CARD_SELECTOR);
    cards.forEach((card) => decorateVideoCard(card));
  }
}

function updatePlayerControlsUI() {
  ensureFloatingControls();
  const disabled = !state.controlsActive;
  if (floatingControls.prev) floatingControls.prev.disabled = disabled;
  if (floatingControls.next) floatingControls.next.disabled = disabled;
}

function ensurePlayerControls() {
  ensureFloatingControls();
}

function ensureFloatingControls() {
  if (determinePageContext() !== "watch") {
    if (floatingControls.container) {
      floatingControls.container.remove();
      floatingControls.container = null;
      floatingControls.prev = null;
      floatingControls.next = null;
    }
    return;
  }
  if (floatingControls.container) return;
  const legacy = document.querySelector(".yta-player-controls");
  if (legacy) legacy.remove();
  const container = document.createElement("div");
  container.className = "yta-floating-controls";
  const prevBtn = document.createElement("button");
  prevBtn.type = "button";
  prevBtn.textContent = "Предыдущее";
  prevBtn.addEventListener("click", (event) => {
    event.preventDefault();
    requestPrevious();
  });
  const nextBtn = document.createElement("button");
  nextBtn.type = "button";
  nextBtn.textContent = "Следующее";
  nextBtn.addEventListener("click", (event) => {
    event.preventDefault();
    requestNext();
  });
  container.append(prevBtn, nextBtn);
  document.body.append(container);
  floatingControls.container = container;
  floatingControls.prev = prevBtn;
  floatingControls.next = nextBtn;
  hideFloatingControls(true);
  updatePlayerControlsUI();
}

function hideFloatingControls(immediate = false) {
  if (!floatingControls.container) return;
  if (floatingControls.hideTimer) {
    clearTimeout(floatingControls.hideTimer);
    floatingControls.hideTimer = null;
  }
  const applyHide = () => {
    floatingControls.container.dataset.visible = "0";
  };
  if (immediate) {
    applyHide();
  } else {
    floatingControls.hideTimer = window.setTimeout(applyHide, 0);
  }
}

function showFloatingControls() {
  if (!floatingControls.container) return;
  floatingControls.container.dataset.visible = "1";
  if (floatingControls.hideTimer) {
    clearTimeout(floatingControls.hideTimer);
    floatingControls.hideTimer = null;
  }
  floatingControls.hideTimer = window.setTimeout(() => {
    floatingControls.container.dataset.visible = "0";
    floatingControls.hideTimer = null;
  }, 1800);
}

function handlePointerActivity() {
  ensureFloatingControls();
  if (!floatingControls.container || !state.controlsActive) {
    return;
  }
  showFloatingControls();
  if (floatingControls.cursorTimer) {
    clearTimeout(floatingControls.cursorTimer);
    floatingControls.cursorTimer = null;
  }
  floatingControls.cursorTimer = window.setTimeout(() => {
    hideFloatingControls();
  }, 2000);
}

function setControlsActive(active) {
  const value = Boolean(active);
  if (state.controlsActive === value) return;
  state.controlsActive = value;
  ensureFloatingControls();
  updateMediaSessionHandlers();
  updatePlayerControlsUI();
  if (state.controlsActive) {
    showFloatingControls();
  } else {
    hideFloatingControls();
  }
}

function updateMediaSessionHandlers() {
  if (!("mediaSession" in navigator)) {
    return;
  }
  try {
    if (state.controlsActive) {
      navigator.mediaSession.setActionHandler("nexttrack", requestNext);
      navigator.mediaSession.setActionHandler("previoustrack", requestPrevious);
    } else {
      navigator.mediaSession.setActionHandler("nexttrack", null);
      navigator.mediaSession.setActionHandler("previoustrack", null);
    }
  } catch (err) {
    console.warn("Failed to update media session handlers", err);
  }
}

function ensurePageActions() {
  if (pageActions.container) return;
  const container = document.createElement("div");
  container.className = "yta-page-actions";
  const addCurrentBtn = document.createElement("button");
  addCurrentBtn.type = "button";
  addCurrentBtn.textContent = "Добавить текущее";
  addCurrentBtn.addEventListener("click", (event) => {
    event.preventDefault();
    handleAddCurrentFromPage();
  });
  const addAllBtn = document.createElement("button");
  addAllBtn.type = "button";
  addAllBtn.textContent = "Добавить страницу";
  addAllBtn.addEventListener("click", (event) => {
    event.preventDefault();
    handleAddAllFromPage();
  });
  const status = document.createElement("div");
  status.className = "yta-page-actions__status";
  container.appendChild(addCurrentBtn);
  container.appendChild(addAllBtn);
  container.appendChild(status);
  document.body.appendChild(container);
  pageActions.container = container;
  pageActions.addCurrent = addCurrentBtn;
  pageActions.addAll = addAllBtn;
  pageActions.status = status;
}

function hidePageActions() {
  if (pageActions.container) {
    pageActions.container.dataset.hidden = "1";
  }
}

function showPageActionStatus(text, kind = "info", timeout = 2500) {
  ensurePageActions();
  if (!pageActions.status) return;
  pageActions.status.textContent = text;
  pageActions.status.dataset.kind = kind;
  pageActions.status.dataset.visible = "1";
  if (pageActions.timeout) {
    clearTimeout(pageActions.timeout);
    pageActions.timeout = null;
  }
  if (timeout && timeout > 0) {
    pageActions.timeout = window.setTimeout(() => {
      if (pageActions.status) {
        pageActions.status.dataset.visible = "0";
      }
      pageActions.timeout = null;
    }, timeout);
  }
}

async function handleAddCurrentFromPage() {
  const caps = getContextCapabilities();
  if (!caps.canAddCurrent) return;
  ensurePageActions();
  if (pageActions.addCurrent) pageActions.addCurrent.disabled = true;
  try {
    const videoId = getCurrentVideoId();
    if (!videoId) {
      showPageActionStatus("Видео не найдено", "error", 3000);
    } else {
      showPageActionStatus("Добавляю видео...", "info", 0);
      await sendMessage("playlist:addByIds", { videoIds: [videoId] });
      showPageActionStatus("Видео добавлено", "success", 2500);
    }
  } catch (err) {
    console.error("Failed to add current video", err);
    showPageActionStatus("Не удалось добавить видео", "error", 3500);
  } finally {
    if (pageActions.addCurrent) pageActions.addCurrent.disabled = false;
  }
}

async function handleAddAllFromPage() {
  const caps = getContextCapabilities();
  if (!caps.canAddPage) return;
  ensurePageActions();
  if (pageActions.addAll) pageActions.addAll.disabled = true;
  try {
    showPageActionStatus("Собираю видео со страницы...", "info", 0);
    const videoIds = await collectPageVideosWithContinuation();
    if (!videoIds.length) {
      showPageActionStatus("Видео не найдены", "error", 3000);
    } else {
      await sendMessage("playlist:addByIds", { videoIds });
      showPageActionStatus(`Добавлено ${videoIds.length} видео`, "success", 3000);
    }
  } catch (err) {
    console.error("Failed to add page videos", err);
    showPageActionStatus("Не удалось добавить список", "error", 3500);
  } finally {
    if (pageActions.addAll) pageActions.addAll.disabled = false;
  }
}

function updatePageActions() {
  const context = determinePageContext();
  const caps = getContextCapabilities(context);
  if (
    context === lastPageContext &&
    pageActions.container &&
    caps.canAddCurrent === lastCapabilities.canAddCurrent &&
    caps.canAddPage === lastCapabilities.canAddPage
  ) {
    return;
  }
  lastPageContext = context;
  lastCapabilities = {
    canAddCurrent: caps.canAddCurrent,
    canAddPage: caps.canAddPage,
  };
  if (!caps.canAddCurrent && !caps.canAddPage) {
    hidePageActions();
    return;
  }
  ensurePageActions();
  if (!pageActions.container) return;
  pageActions.container.dataset.hidden = "";
  if (pageActions.addCurrent) {
    pageActions.addCurrent.hidden = !caps.canAddCurrent;
  }
  if (pageActions.addAll) {
    pageActions.addAll.hidden = !caps.canAddPage;
  }
  if (pageActions.status) {
    pageActions.status.dataset.visible = "0";
  }
}

function requestNext() {
  if (!state.controlsActive) return;
  const videoId = getCurrentVideoId();
  sendMessage("player:requestNext", { videoId });
}

function requestPrevious() {
  if (!state.controlsActive) return;
  sendMessage("player:requestPrevious", {
    videoId: getCurrentVideoId(),
  });
}

function handleVideoStarted() {
  const videoId = parseVideoId(window.location.href);
  if (!videoId) return;
  state.currentVideoId = videoId;
  if (state.lastReportedVideoId === videoId) return;
  state.lastReportedVideoId = videoId;
  sendMessage("player:videoStarted", { videoId }).then((resp) => {
    setControlsActive(Boolean(resp?.controlled));
  });
}

function handleVideoEnded() {
  const videoId = getCurrentVideoId();
  if (!videoId) return;
  sendMessage("player:videoEnded", { videoId }).then((resp) => {
    if (!resp || resp.handled === false) {
      setControlsActive(false);
    }
  });
}

function detachVideoListeners() {
  if (!state.videoElement) return;
  state.videoElement.removeEventListener("ended", handleVideoEnded);
  state.videoElement.removeEventListener("play", handleVideoStarted);
  state.videoElement.removeEventListener("playing", handleVideoStarted);
  state.videoElement.removeEventListener("loadeddata", handleVideoStarted);
  state.videoElement = null;
}

function attachVideoListeners(video) {
  if (state.videoElement === video) return;
  detachVideoListeners();
  state.videoElement = video;
  video.addEventListener("ended", handleVideoEnded);
  video.addEventListener("play", handleVideoStarted);
  video.addEventListener("playing", handleVideoStarted);
  video.addEventListener("loadeddata", handleVideoStarted);
  handleVideoStarted();
}

function scanForVideo() {
  const video = document.querySelector("video");
  if (video) {
    attachVideoListeners(video);
    ensurePlayerControls();
    return true;
  }
  return false;
}

const observer = new MutationObserver((mutations) => {
  let shouldScanVideo = false;
  for (const mutation of mutations) {
    if (mutation.type === "childList") {
      mutation.addedNodes.forEach((node) => {
        if (node instanceof HTMLElement) {
          enhanceVideoCards(node);
          if (!shouldScanVideo) {
            if (node.tagName === "VIDEO" || node.querySelector?.("video")) {
              shouldScanVideo = true;
            }
          }
        } else if (
          node &&
          node.nodeType === Node.DOCUMENT_FRAGMENT_NODE &&
          typeof node.querySelector === "function"
        ) {
          enhanceVideoCards(node);
          if (!shouldScanVideo && node.querySelector("video")) {
            shouldScanVideo = true;
          }
        }
      });
      mutation.removedNodes.forEach((node) => {
        if (!(node instanceof HTMLElement)) return;
        if (node === state.videoElement || node.contains(state.videoElement)) {
          shouldScanVideo = true;
        }
      });
    }
  }
  if (
    !state.videoElement ||
    !document.contains(state.videoElement) ||
    shouldScanVideo
  ) {
    scanForVideo();
  }
  updatePageActions();
  ensurePlayerControls();
});

function resetStateForNavigation() {
  hideFloatingControls(true);
  detachVideoListeners();
  state.controlsActive = false;
  state.currentVideoId = parseVideoId(window.location.href) || null;
  state.lastReportedVideoId = null;
  updateMediaSessionHandlers();
  updatePlayerControlsUI();
  updatePageActions();
  setTimeout(() => {
    scanForVideo();
    enhanceVideoCards();
    ensurePlayerControls();
    updatePageActions();
  }, 0);
}

function collectVideoIds(scope) {
  return collectVisibleVideoIds(scope);
}

function collectVisibleVideoIds(scope) {
  const ids = new Set();
  if (!scope || scope === "current") {
    const current = getCurrentVideoId();
    if (current) ids.add(current);
    return Array.from(ids);
  }
  document.querySelectorAll(VIDEO_CARD_SELECTOR).forEach((card) => {
    const id = findVideoIdInCard(card);
    if (id) ids.add(id);
  });
  const current = getCurrentVideoId();
  if (current) ids.add(current);
  return Array.from(ids);
}

function attemptLoadMoreContinuations() {
  const button =
    document.querySelector("ytd-continuation-item-renderer #button") ||
    document.querySelector("#continuations button");
  if (button && !button.disabled) {
    button.click();
  }
}

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function collectPageVideosWithContinuation() {
  const initialScroll = window.scrollY;
  const seen = new Set();
  let idle = 0;
  for (let loop = 0; loop < PAGE_SCROLL_MAX_LOOPS; loop += 1) {
    document.querySelectorAll(VIDEO_CARD_SELECTOR).forEach((card) => {
      const id = findVideoIdInCard(card);
      if (id) seen.add(id);
    });
    if (seen.size >= PAGE_COLLECTION_LIMIT) break;
    const before = seen.size;
    attemptLoadMoreContinuations();
    window.scrollTo(0, document.documentElement.scrollHeight);
    await delay(PAGE_SCROLL_DELAY);
    const after = seen.size;
    if (after === before) {
      idle += 1;
      if (idle >= PAGE_SCROLL_IDLE_LIMIT) {
        break;
      }
    } else {
      idle = 0;
    }
  }
  window.scrollTo(0, initialScroll || 0);
  return Array.from(seen);
}

function setupControlInterceptors() {
  document.addEventListener(
    "click",
    (event) => {
      if (!state.controlsActive) return;
      const path = event.composedPath();
      const hasNext = path.some(
        (node) => node?.classList && node.classList.contains("ytp-next-button")
      );
      const hasPrev = path.some(
        (node) => node?.classList && node.classList.contains("ytp-prev-button")
      );
      if (hasNext) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        requestNext();
      } else if (hasPrev) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        requestPrevious();
      }
    },
    true
  );

  document.addEventListener(
    "keydown",
    (event) => {
      const code = event.code;
      const key = event.key;
      const isMediaNext =
        code === "MediaTrackNext" || key === "MediaTrackNext";
      const isMediaPrevious =
        code === "MediaTrackPrevious" || key === "MediaTrackPrevious";
      if (isMediaNext || isMediaPrevious) {
        if (!state.controlsActive) return;
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        if (isMediaNext) {
          requestNext();
        } else {
          requestPrevious();
        }
        return;
      }
      if (!state.controlsActive) return;
      if (event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
        const lower = (event.key || "").toLowerCase();
        if (lower === "n") {
          event.preventDefault();
          requestNext();
        } else if (lower === "p") {
          event.preventDefault();
          requestPrevious();
        }
      }
    },
    true
  );
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message.type !== "string") return;
  if (message.type === "collector:getCapabilities") {
    const context = determinePageContext();
    const caps = getContextCapabilities(context);
    sendResponse({ context, ...caps });
    return false;
  }
  if (message.type === "collector:collect") {
    const scope = message.scope || "current";
    const caps = getContextCapabilities();
    if (
      (scope === "current" && !caps.canAddCurrent) ||
      (scope === "page" && !caps.canAddPage)
    ) {
      sendResponse({ videoIds: [], error: "NOT_ALLOWED" });
      return false;
    }
    if (scope === "page") {
      collectPageVideosWithContinuation()
        .then((videoIds) => {
          sendResponse({ videoIds });
        })
        .catch((err) => {
          console.error("Failed to collect page videos", err);
          sendResponse({
            videoIds: [],
            error: err?.message || "FAILED_TO_COLLECT",
          });
        });
      return true;
    }
    const videoIds = collectVisibleVideoIds(scope);
    sendResponse({ videoIds });
    return false;
  }
  if (message.type === "playlist:stateUpdated") {
    const current = getCurrentVideoId();
    const playlistState = message.state || {};
    if (current && playlistState.currentVideoId === current) {
      setControlsActive(true);
    } else if (
      !playlistState.queue ||
      !Array.isArray(playlistState.queue) ||
      !playlistState.queue.some((item) => item.id === current)
    ) {
      setControlsActive(false);
    }
  }
  return false;
});

function init() {
  injectStyles();
  ensureFloatingControls();
  document.addEventListener("mousemove", handlePointerActivity, { passive: true });
  document.addEventListener("touchstart", handlePointerActivity, { passive: true });
  enhanceVideoCards(document);
  updatePageActions();
  ensurePlayerControls();
  scanForVideo();
  observer.observe(document.documentElement || document.body, {
    childList: true,
    subtree: true,
  });
  setupControlInterceptors();
  window.addEventListener("yt-navigate-start", resetStateForNavigation, true);
  window.addEventListener("yt-navigate-finish", resetStateForNavigation, true);
  window.addEventListener("popstate", resetStateForNavigation);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
