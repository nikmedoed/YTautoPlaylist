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
const playerControls = {
  container: null,
  prev: null,
  next: null,
};
const pageActions = {
  container: null,
  addCurrent: null,
  addVisible: null,
  addAll: null,
  status: null,
  timeout: null,
};
const CONTEXT_CAPABILITIES = {
  watch: { canAddCurrent: true, canAddVisible: false, canAddAll: false },
  channelVideos: { canAddCurrent: false, canAddVisible: true, canAddAll: true },
  channelFeatured: { canAddCurrent: false, canAddVisible: true, canAddAll: false },
  channelHome: { canAddCurrent: false, canAddVisible: true, canAddAll: false },
  home: { canAddCurrent: false, canAddVisible: true, canAddAll: false },
  other: { canAddCurrent: false, canAddVisible: true, canAddAll: false },
};
let lastPageContext = null;
let lastCapabilities = {
  canAddCurrent: null,
  canAddVisible: null,
  canAddAll: null,
  controlling: null,
};
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
    canAddVisible: Boolean(base.canAddVisible),
    canAddAll: Boolean(base.canAddAll),
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
    right: 24px;
    bottom: 8%;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    z-index: 2147483647;
    transition: opacity 0.2s ease;
  }
  .yta-player-controls .ytp-button {
    border: none;
    border-radius: 18px;
    padding: 6px 14px;
    background: rgba(17, 17, 17, 0.78);
    color: #fff;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.2s ease, transform 0.15s ease;
  }
  .yta-player-controls .ytp-button:hover {
    background: rgba(229, 45, 39, 0.9);
    transform: translateY(-1px);
  }
  .yta-player-controls .ytp-button[disabled] {
    opacity: 0.45;
    cursor: not-allowed;
    transform: none;
  }
  .html5-video-player.ytp-autohide .yta-player-controls,
  .html5-video-player:not(.ytp-chrome-controls-visible) .yta-player-controls {
    opacity: 0;
    pointer-events: none;
  }
  .yta-page-actions {
    position: fixed;
    top: 120px;
    right: 20px;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
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
  .yta-page-actions--player {
    position: absolute;
    top: 16px;
    left: 16px;
    right: auto;
    bottom: auto;
    flex-direction: row;
    align-items: center;
    gap: 8px;
  }
  .yta-page-actions--player button {
    background: rgba(17, 17, 17, 0.7);
  }
  .yta-page-actions--player .yta-page-actions__status {
    align-self: center;
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

function destroyPlayerControls() {
  if (!playerControls.container) return;
  playerControls.container.remove();
  playerControls.container = null;
  playerControls.prev = null;
  playerControls.next = null;
}

function ensurePlayerControls() {
  if (determinePageContext() !== "watch") {
    destroyPlayerControls();
    return;
  }
  const host =
    document.querySelector("#movie_player.html5-video-player") ||
    document.querySelector(".html5-video-player");
  if (!host) {
    destroyPlayerControls();
    return;
  }
  if (!playerControls.container) {
    const container = document.createElement("div");
    container.className = "yta-player-controls";
    const prevBtn = document.createElement("button");
    prevBtn.type = "button";
    prevBtn.className = "ytp-button";
    prevBtn.textContent = "Предыдущее";
    prevBtn.setAttribute("aria-label", "Предыдущее видео");
    prevBtn.addEventListener("click", (event) => {
      event.preventDefault();
      requestPrevious();
    });
    const nextBtn = document.createElement("button");
    nextBtn.type = "button";
    nextBtn.className = "ytp-button";
    nextBtn.textContent = "Следующее";
    nextBtn.setAttribute("aria-label", "Следующее видео");
    nextBtn.addEventListener("click", (event) => {
      event.preventDefault();
      requestNext();
    });
    container.append(prevBtn, nextBtn);
    host.appendChild(container);
    playerControls.container = container;
    playerControls.prev = prevBtn;
    playerControls.next = nextBtn;
  }
  updatePlayerControlsUI();
}

function updatePlayerControlsUI() {
  const disabled = !state.controlsActive;
  if (playerControls.prev) playerControls.prev.disabled = disabled;
  if (playerControls.next) playerControls.next.disabled = disabled;
  if (playerControls.container) {
    const host =
      document.querySelector("#movie_player.html5-video-player") ||
      document.querySelector(".html5-video-player");
    if (host && playerControls.container.parentElement !== host) {
      playerControls.container.remove();
      host.appendChild(playerControls.container);
    }
  }
}

function setControlsActive(active) {
  const value = Boolean(active);
  if (state.controlsActive === value) return;
  state.controlsActive = value;
  ensurePlayerControls();
  updateMediaSessionHandlers();
  updatePlayerControlsUI();
  updatePageActions();
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
  const addVisibleBtn = document.createElement("button");
  addVisibleBtn.type = "button";
  addVisibleBtn.textContent = "Добавить видимые";
  addVisibleBtn.addEventListener("click", (event) => {
    event.preventDefault();
    handleAddVisibleFromPage();
  });
  const addAllBtn = document.createElement("button");
  addAllBtn.type = "button";
  addAllBtn.textContent = "Добавить все";
  addAllBtn.addEventListener("click", (event) => {
    event.preventDefault();
    handleAddAllFromPage();
  });
  const status = document.createElement("div");
  status.className = "yta-page-actions__status";
  container.appendChild(addCurrentBtn);
  container.appendChild(addVisibleBtn);
  container.appendChild(addAllBtn);
  container.appendChild(status);
  pageActions.container = container;
  pageActions.addCurrent = addCurrentBtn;
  pageActions.addVisible = addVisibleBtn;
  pageActions.addAll = addAllBtn;
  pageActions.status = status;
  positionPageActions(determinePageContext());
}

function hidePageActions() {
  if (pageActions.container) {
    pageActions.container.dataset.hidden = "1";
  }
}

function positionPageActions(context) {
  if (!pageActions.container) return;
  const inPlayer = context === "watch";
  const host = inPlayer
    ? document.getElementById("movie_player") || document.querySelector("#player-container")
    : null;
  if (inPlayer && host) {
    if (pageActions.container.parentElement !== host) {
      pageActions.container.remove();
      host.appendChild(pageActions.container);
    }
    pageActions.container.classList.add("yta-page-actions--player");
  } else {
    if (pageActions.container.parentElement !== document.body) {
      pageActions.container.remove();
      document.body.appendChild(pageActions.container);
    }
    pageActions.container.classList.remove("yta-page-actions--player");
  }
}

function showPageActionStatus(text, kind = "info", timeout = 2500) {
  ensurePageActions();
  positionPageActions(determinePageContext());
  if (!pageActions.status) return;
  if (pageActions.container) {
    pageActions.container.dataset.hidden = "";
  }
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

async function handleAddVisibleFromPage() {
  const caps = getContextCapabilities();
  if (!caps.canAddVisible) return;
  ensurePageActions();
  if (pageActions.addVisible) pageActions.addVisible.disabled = true;
  try {
    showPageActionStatus("Добавляю видимые видео...", "info", 0);
    const videoIds = collectVisibleVideoIds({ includeCurrent: false });
    if (!videoIds.length) {
      showPageActionStatus("Видео не найдены", "error", 3000);
    } else {
      await sendMessage("playlist:addByIds", { videoIds });
      showPageActionStatus(`Добавлено ${videoIds.length} видео`, "success", 3000);
    }
  } catch (err) {
    console.error("Failed to add visible videos", err);
    showPageActionStatus("Не удалось добавить видео", "error", 3500);
  } finally {
    if (pageActions.addVisible) pageActions.addVisible.disabled = false;
  }
}

async function handleAddAllFromPage() {
  const caps = getContextCapabilities();
  if (!caps.canAddAll) return;
  ensurePageActions();
  if (pageActions.addAll) pageActions.addAll.disabled = true;
  try {
    showPageActionStatus("Собираю все видео...", "info", 0);
    const videoIds = await collectPageVideosWithContinuation();
    if (!videoIds.length) {
      showPageActionStatus("Видео не найдены", "error", 3000);
    } else {
      await sendMessage("playlist:addByIds", { videoIds });
      showPageActionStatus(`Добавлено ${videoIds.length} видео`, "success", 3000);
    }
  } catch (err) {
    console.error("Failed to add page videos", err);
    showPageActionStatus("Не удалось добавить видео", "error", 3500);
  } finally {
    if (pageActions.addAll) pageActions.addAll.disabled = false;
  }
}

function updatePageActions() {
  const context = determinePageContext();
  const caps = getContextCapabilities(context);
  const controlling = Boolean(state.controlsActive);
  if (pageActions.container) {
    positionPageActions(context);
  }
  if (
    context === lastPageContext &&
    pageActions.container &&
    caps.canAddCurrent === lastCapabilities.canAddCurrent &&
    caps.canAddVisible === lastCapabilities.canAddVisible &&
    caps.canAddAll === lastCapabilities.canAddAll &&
    controlling === lastCapabilities.controlling
  ) {
    return;
  }
  lastPageContext = context;
  lastCapabilities = {
    canAddCurrent: caps.canAddCurrent,
    canAddVisible: caps.canAddVisible,
    canAddAll: caps.canAddAll,
    controlling,
  };
  if (!caps.canAddCurrent && !caps.canAddVisible && !caps.canAddAll) {
    hidePageActions();
    return;
  }
  ensurePageActions();
  if (!pageActions.container) return;
  positionPageActions(context);
  const showAddCurrent = caps.canAddCurrent && !controlling;
  const showAddVisible = caps.canAddVisible;
  const showAddAll = caps.canAddAll;
  pageActions.container.dataset.hidden = "";
  if (pageActions.addCurrent) {
    pageActions.addCurrent.hidden = !showAddCurrent;
  }
  if (pageActions.addVisible) {
    pageActions.addVisible.hidden = !showAddVisible;
  }
  if (pageActions.addAll) {
    pageActions.addAll.hidden = !showAddAll;
  }
  const visibleButtons = [
    pageActions.addCurrent,
    pageActions.addVisible,
    pageActions.addAll,
  ].filter((btn) => btn && !btn.hidden);
  const statusVisible = pageActions.status?.dataset.visible === "1";
  if (!visibleButtons.length && !statusVisible) {
    pageActions.container.dataset.hidden = "1";
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
    sendResponse({ context, ...caps, controlling: Boolean(state.controlsActive) });
    return false;
  }
  if (message.type === "collector:collect") {
    const scope = message.scope || "current";
    const caps = getContextCapabilities();
    if (
      (scope === "current" && !caps.canAddCurrent) ||
      (scope === "page" && !caps.canAddAll) ||
      (scope === "visible" && !caps.canAddVisible)
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
    const videoIds = collectVideoIds(scope);
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
  ensurePlayerControls();
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
