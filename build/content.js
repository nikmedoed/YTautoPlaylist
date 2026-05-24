(() => {
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
    return pickThumbnailValue(entry.thumbnail) || pickThumbnailSet(entry.thumbnails) || fallback || "";
  }

  // src/content/core/diagnostics.js
  var YTA_DIAG_FLAG_KEY = "yta_diag_enabled";
  var ytaDiag = {
    enabled: false,
    stats: /* @__PURE__ */ new Map(),
    longTasks: [],
    loopLag: [],
    buffering: {
      samples: 0,
      stalledSamples: 0,
      totalStalledMs: 0
    },
    timers: {
      loopLag: null,
      videoSample: null
    },
    observers: {
      longTask: null
    },
    getVideoElement: null
  };
  function ytaDiagRecord(name, durationMs) {
    if (!ytaDiag.enabled) return;
    const safeDuration = Number.isFinite(durationMs) ? durationMs : 0;
    const previous = ytaDiag.stats.get(name) || {
      count: 0,
      total: 0,
      max: 0,
      over16: 0,
      over50: 0
    };
    previous.count += 1;
    previous.total += safeDuration;
    previous.max = Math.max(previous.max, safeDuration);
    if (safeDuration >= 16) previous.over16 += 1;
    if (safeDuration >= 50) previous.over50 += 1;
    ytaDiag.stats.set(name, previous);
  }
  function ytaDiagMeasure(name, fn) {
    const started = performance.now();
    try {
      return fn();
    } finally {
      ytaDiagRecord(name, performance.now() - started);
    }
  }
  function getTrackedVideoElement() {
    if (typeof ytaDiag.getVideoElement === "function") {
      const video = ytaDiag.getVideoElement();
      if (video) return video;
    }
    return document.querySelector("video");
  }
  function ytaDiagSampleVideo() {
    if (!ytaDiag.enabled) return;
    const video = getTrackedVideoElement();
    if (!video) return;
    ytaDiag.buffering.samples += 1;
    const likelyBuffering = !video.paused && !video.ended && (video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA || video.networkState === HTMLMediaElement.NETWORK_LOADING);
    if (likelyBuffering) {
      ytaDiag.buffering.stalledSamples += 1;
      ytaDiag.buffering.totalStalledMs += 1e3;
    }
  }
  function ytaDiagReport() {
    const rows = Array.from(ytaDiag.stats.entries()).map(([name, stat]) => {
      const avg = stat.count > 0 ? stat.total / stat.count : 0;
      return {
        name,
        calls: stat.count,
        avgMs: Number(avg.toFixed(2)),
        maxMs: Number(stat.max.toFixed(2)),
        over16: stat.over16,
        over50: stat.over50
      };
    });
    rows.sort((a, b) => b.maxMs - a.maxMs);
    const lagSamples = ytaDiag.loopLag;
    const lagAvg = lagSamples.length > 0 ? lagSamples.reduce((sum, value) => sum + value, 0) / lagSamples.length : 0;
    const lagMax = lagSamples.length > 0 ? Math.max(...lagSamples) : 0;
    console.group("YTA Diagnostic Report");
    console.table(rows);
    console.log("Long tasks:", ytaDiag.longTasks.length, ytaDiag.longTasks.slice(-10));
    console.log("Loop lag avg/max (ms):", Number(lagAvg.toFixed(2)), Number(lagMax.toFixed(2)));
    console.log("Buffer samples:", ytaDiag.buffering);
    console.groupEnd();
    return {
      rows,
      longTasks: ytaDiag.longTasks.slice(),
      loopLag: {
        samples: lagSamples.length,
        avgMs: Number(lagAvg.toFixed(2)),
        maxMs: Number(lagMax.toFixed(2))
      },
      buffering: { ...ytaDiag.buffering }
    };
  }
  function ytaDiagReset() {
    ytaDiag.stats.clear();
    ytaDiag.longTasks = [];
    ytaDiag.loopLag = [];
    ytaDiag.buffering = {
      samples: 0,
      stalledSamples: 0,
      totalStalledMs: 0
    };
  }
  function ytaDiagStopInternal() {
    if (ytaDiag.timers.loopLag) {
      clearInterval(ytaDiag.timers.loopLag);
      ytaDiag.timers.loopLag = null;
    }
    if (ytaDiag.timers.videoSample) {
      clearInterval(ytaDiag.timers.videoSample);
      ytaDiag.timers.videoSample = null;
    }
    if (ytaDiag.observers.longTask) {
      try {
        ytaDiag.observers.longTask.disconnect();
      } catch (_) {
      }
      ytaDiag.observers.longTask = null;
    }
  }
  function ytaDiagStartInternal() {
    if (ytaDiag.enabled) return;
    ytaDiag.enabled = true;
    ytaDiagReset();
    let expectedAt = Date.now() + 1e3;
    ytaDiag.timers.loopLag = setInterval(() => {
      const now = Date.now();
      const lag = Math.max(0, now - expectedAt);
      expectedAt = now + 1e3;
      if (ytaDiag.loopLag.length >= 120) {
        ytaDiag.loopLag.shift();
      }
      ytaDiag.loopLag.push(lag);
    }, 1e3);
    ytaDiag.timers.videoSample = setInterval(ytaDiagSampleVideo, 1e3);
    if (typeof PerformanceObserver === "function") {
      try {
        const observer2 = new PerformanceObserver((entryList) => {
          const entries = entryList.getEntries();
          for (const entry of entries) {
            if (ytaDiag.longTasks.length >= 120) {
              ytaDiag.longTasks.shift();
            }
            ytaDiag.longTasks.push({
              name: entry.name,
              duration: Number(entry.duration.toFixed(2)),
              startTime: Number(entry.startTime.toFixed(2))
            });
          }
        });
        observer2.observe({ entryTypes: ["longtask"] });
        ytaDiag.observers.longTask = observer2;
      } catch (_) {
      }
    }
    console.info("[YTA] diagnostics enabled");
  }
  function ytaDiagStart() {
    try {
      localStorage.setItem(YTA_DIAG_FLAG_KEY, "1");
    } catch (_) {
    }
    ytaDiagStartInternal();
  }
  function ytaDiagStop() {
    ytaDiag.enabled = false;
    ytaDiagStopInternal();
    try {
      localStorage.removeItem(YTA_DIAG_FLAG_KEY);
    } catch (_) {
    }
    console.info("[YTA] diagnostics disabled");
  }
  function shouldEnableYtaDiagFromStorage() {
    try {
      return localStorage.getItem(YTA_DIAG_FLAG_KEY) === "1";
    } catch (_) {
      return false;
    }
  }
  function initYtaDiagnostics({ getVideoElement } = {}) {
    ytaDiag.getVideoElement = typeof getVideoElement === "function" ? getVideoElement : null;
    globalThis.ytaDiagStart = ytaDiagStart;
    globalThis.ytaDiagStop = ytaDiagStop;
    globalThis.ytaDiagReport = ytaDiagReport;
    globalThis.ytaDiagReset = ytaDiagReset;
    if (shouldEnableYtaDiagFromStorage()) {
      ytaDiagStartInternal();
    }
  }

  // src/content/core/base.js
  var DEFAULT_LIST_ID = "default";
  var state = {
    videoElement: null,
    controlsActive: false,
    currentVideoId: null,
    lastReportedVideoId: null,
    lastUnavailableVideoId: null
  };
  var playerControls = {
    container: null,
    prev: null,
    next: null,
    postpone: null,
    start: null,
    addCurrent: null,
    position: null,
    host: null,
    observer: null
  };
  var pageActions = {
    container: null,
    toggle: null,
    panel: null,
    addCurrent: null,
    addVisible: null,
    addAll: null,
    status: null,
    timeout: null,
    info: null,
    collapseTimeout: null,
    stop: null,
    collectingAll: false,
    cancelRequested: false,
    host: null,
    hostObserver: null,
    collectAbort: null
  };
  var playbackNotification = {
    container: null,
    title: null,
    body: null,
    close: null,
    timeout: null
  };
  var progressTracker = {
    videoId: null,
    lastSentPercent: null,
    lastSentAt: 0
  };
  var inlinePlaylistState = {
    currentListId: null,
    currentListName: "",
    videoIds: /* @__PURE__ */ new Set(),
    orderedVideoIds: [],
    indexById: /* @__PURE__ */ new Map(),
    currentIndex: null,
    historyLength: 0,
    freeze: false,
    currentVideoId: null,
    queueEntries: [],
    lists: [],
    progress: {}
  };
  var cardRetryState = /* @__PURE__ */ new WeakMap();
  var STYLE_ID = "yta-controller-style";
  var CARD_MARK = "data-yta-enhanced";
  var THUMB_HOST_CLASS = "yta-thumb-host";
  var CARD_OVERLAY_HOST_CLASS = "yta-card-overlay-host";
  var INLINE_BUTTON_OVERLAY_CLASS = "yta-inline-overlay";
  var ADD_BUTTON_CLASS = "yta-inline-add";
  var ADD_BUTTON_DONE_CLASS = "yta-inline-add--done";
  var VIDEO_CARD_SELECTOR = [
    "ytd-rich-grid-media",
    "ytd-rich-grid-slim-media",
    "ytd-rich-item-renderer",
    "ytd-video-renderer",
    "ytd-grid-video-renderer",
    "ytd-playlist-video-renderer",
    "ytd-playlist-panel-video-renderer",
    "ytd-watch-card-compact-video-renderer",
    "ytd-compact-video-renderer",
    "ytd-compact-autoplay-renderer",
    "ytd-reel-item-renderer",
    "yt-lockup-view-model",
    ".ytLockupViewModelHost",
    "div.yt-lockup-view-model",
    "div.ytm-lockup-view-model",
    "ytm-lockup-view-model",
    "ytm-shorts-lockup-view-model",
    ".shortsLockupViewModelHost"
  ].join(",");
  var CONTEXT_CAPABILITIES = {
    watch: { canAddCurrent: true, canAddVisible: false, canAddAll: false },
    channelVideos: { canAddCurrent: false, canAddVisible: true, canAddAll: true },
    channelShorts: { canAddCurrent: false, canAddVisible: true, canAddAll: true },
    channelFeatured: { canAddCurrent: false, canAddVisible: true, canAddAll: false },
    channelHome: { canAddCurrent: false, canAddVisible: true, canAddAll: true },
    channelPlaylists: { canAddCurrent: false, canAddVisible: false, canAddAll: false },
    home: { canAddCurrent: false, canAddVisible: true, canAddAll: false },
    search: { canAddCurrent: false, canAddVisible: true, canAddAll: true },
    playlist: { canAddCurrent: false, canAddVisible: true, canAddAll: true },
    other: { canAddCurrent: false, canAddVisible: false, canAddAll: false }
  };
  var PAGE_COLLECTION_LIMIT = 5e3;
  var PAGE_SCROLL_MAX_LOOPS = 120;
  var PAGE_SCROLL_IDLE_LIMIT = 4;
  var PAGE_SCROLL_DELAY = 420;
  initYtaDiagnostics({
    getVideoElement: () => state.videoElement
  });
  installRuntimeInvalidationGuard();
  function determinePageContext() {
    const pathname = window.location.pathname || "";
    if (pathname.startsWith("/watch") || pathname.startsWith("/shorts/")) {
      return "watch";
    }
    if (pathname.startsWith("/results")) {
      return "search";
    }
    if (pathname.startsWith("/playlist")) {
      return "playlist";
    }
    if (/^\/@[^/]+\/(videos|streams)\/?$/.test(pathname)) {
      return "channelVideos";
    }
    if (/^\/@[^/]+\/shorts\/?$/.test(pathname)) {
      return "channelShorts";
    }
    if (/^\/@[^/]+\/playlists\/?$/.test(pathname)) {
      return "channelPlaylists";
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
  function hasInlineQueueItems() {
    const queueEntries = Array.isArray(inlinePlaylistState.queueEntries) ? inlinePlaylistState.queueEntries : [];
    if (queueEntries.some((entry) => entry && entry.id)) {
      return true;
    }
    const orderedIds = Array.isArray(inlinePlaylistState.orderedVideoIds) ? inlinePlaylistState.orderedVideoIds : [];
    if (orderedIds.some(Boolean)) {
      return true;
    }
    const currentIndex = inlinePlaylistState.currentIndex;
    if (Number.isInteger(currentIndex) && currentIndex >= 0) {
      return true;
    }
    const historyLength = Number(inlinePlaylistState.historyLength) || 0;
    if (historyLength > 0) {
      return true;
    }
    const currentId = inlinePlaylistState.currentVideoId;
    if (typeof currentId === "string" && currentId) {
      return true;
    }
    const listId = inlinePlaylistState.currentListId;
    return typeof listId === "string" && Boolean(listId);
  }
  function canHandlePlaybackActions() {
    if (state.controlsActive) {
      return true;
    }
    return hasInlineQueueItems();
  }
  function getContextCapabilities(context = determinePageContext()) {
    const base = CONTEXT_CAPABILITIES[context] || CONTEXT_CAPABILITIES.other;
    const capabilities = {
      canAddCurrent: false,
      canAddVisible: false,
      canAddAll: false
    };
    if (base.canAddCurrent) {
      const currentId = getCurrentVideoId();
      if (currentId) {
        const inList = inlinePlaylistState.videoIds.has(currentId);
        if (!inList) {
          capabilities.canAddCurrent = true;
        }
      }
    }
    if (base.canAddVisible) {
      capabilities.canAddVisible = true;
    }
    if (base.canAddAll) {
      capabilities.canAddAll = true;
    }
    return capabilities;
  }
  function sendMessage(type, payload, options) {
    if (!type || typeof type !== "string") {
      return Promise.resolve(null);
    }
    const payloadIsObject = payload && typeof payload === "object";
    const messagePayload = arguments.length >= 2 && payloadIsObject ? { ...payload } : {};
    const messageOptions = arguments.length >= 3 && options && typeof options === "object" ? { ...options } : {};
    const runtime = chrome?.runtime;
    if (!runtime || typeof runtime.sendMessage !== "function") {
      return handleRuntimeMessageError(
        { type, ...messagePayload },
        new Error("RUNTIME_UNAVAILABLE"),
        messageOptions
      );
    }
    const message = { type, ...messagePayload };
    const resolveWithError = (err) => handleRuntimeMessageError(message, err, messageOptions);
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        resolve(value ?? null);
      };
      const handleError = (err) => {
        Promise.resolve(resolveWithError(err)).then(finish).catch((handlerErr) => {
          console.error(
            "Runtime message error handler failed",
            handlerErr
          );
          finish(null);
        });
      };
      try {
        const maybePromise = runtime.sendMessage(message, (response) => {
          const lastError = chrome?.runtime?.lastError;
          if (lastError) {
            handleError(lastError);
            return;
          }
          finish(response);
        });
        if (maybePromise && typeof maybePromise.then === "function") {
          maybePromise.then(finish).catch(handleError);
        }
      } catch (err) {
        handleError(err);
      }
    });
  }
  function handleRuntimeMessageError(message, err, options = {}) {
    if (isReceivingEndError(err)) {
      return Promise.resolve(null);
    }
    if (isRecoverableRuntimeError(err)) {
      if (typeof options.onDisconnect === "function") {
        try {
          const result = options.onDisconnect(err, message);
          return Promise.resolve(result ?? null);
        } catch (handlerError) {
          console.error("Recoverable handler failed", handlerError);
        }
      }
      return Promise.resolve(null);
    }
    console.warn("Failed to send message", message?.type || "<unknown>", err);
    return Promise.resolve(null);
  }
  function getErrorMessage(err) {
    if (!err) {
      return "";
    }
    if (typeof err === "string") {
      return err;
    }
    if (typeof err.message === "string") {
      return err.message;
    }
    if (typeof err.error === "string") {
      return err.error;
    }
    if (typeof err.reason === "string") {
      return err.reason;
    }
    return String(err);
  }
  function installRuntimeInvalidationGuard() {
    if (typeof window === "undefined" || typeof window.addEventListener !== "function") {
      return;
    }
    if (window.__ytaRuntimeInvalidationGuardInstalled) {
      return;
    }
    window.__ytaRuntimeInvalidationGuardInstalled = true;
    window.addEventListener("unhandledrejection", (event) => {
      if (isRecoverableRuntimeError(event.reason)) {
        event.preventDefault();
      }
    });
  }
  function isReceivingEndError(err) {
    const message = getErrorMessage(err);
    return /receiving end/i.test(message);
  }
  function isRecoverableRuntimeError(err) {
    const message = getErrorMessage(err);
    return /context invalidated/i.test(message) || /message port closed/i.test(message);
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
  function delay(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  // src/content/styles/inline-queue-items.js
  function getInlineQueueItemStyles() {
    return `
  }
  .yta-inline-queue__list {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .yta-inline-queue .video-list {
    display: flex;
    flex-direction: column;
    gap: var(--inline-queue-gap, 6px);
    max-height: none;
    overflow: visible;
    position: relative;
  }
  .yta-inline-queue[data-placement="sidebar"] .video-list {
    max-height: min(72vh, 620px);
    overflow-y: auto;
  }
  .yta-inline-queue[data-placement="stack"] .video-list {
    max-height: min(52vh, 540px);
    overflow-y: auto;
  }
  .yta-inline-queue__item {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .yta-inline-queue .video-item {
    --video-item-thumbnail-width: 112px;
    --video-item-grid-template:
      24px var(--video-item-thumbnail-width) minmax(0, 1fr);
    --video-item-min-height: 63px;
    --video-item-background: rgba(255, 255, 255, 0.05);
    --video-item-hover-background: rgba(255, 255, 255, 0.08);
    --video-item-active-background: rgba(229, 57, 53, 0.15);
    --video-item-border-color: transparent;
    --video-item-hover-border-color: #e53935;
    --video-item-active-border-color: #e53935;
    --video-item-cursor: pointer;
    --video-body-padding-top: 0;
    --video-body-padding-right: 40px;
    --video-body-padding-bottom: 0;
    --video-body-padding-left: 14px;
    --video-body-gap: 4px;
    position: relative;
    display: grid;
    grid-template-columns: var(--video-item-grid-template);
    align-items: stretch;
    column-gap: 0;
    row-gap: 0;
    min-height: var(--video-item-min-height);
    padding: 0;
    border-radius: 10px;
    overflow: hidden;
    background: var(--video-item-background);
    cursor: var(--video-item-cursor);
    transition: background 0.2s ease, border-color 0.2s ease;
    border: 1px solid var(--video-item-border-color);
  }
  .yta-inline-queue[data-placement="sidebar"] .video-item {
    --video-item-thumbnail-width: 132px;
    --video-item-min-height: 74px;
    --video-body-padding-right: 44px;
    --video-body-padding-left: 16px;
  }
  .yta-inline-queue .video-item:hover {
    background: var(--video-item-hover-background);
    border-color: var(--video-item-hover-border-color);
  }
  .yta-inline-queue .video-item.active,
  .yta-inline-queue__item[data-current="1"] .video-item {
    border-color: var(--video-item-active-border-color);
    background: var(--video-item-active-background);
  }
  .yta-inline-queue .video-item:focus-visible {
    outline: 2px solid var(--yt-spec-themed-blue, #3ea6ff);
    outline-offset: 3px;
  }
  .yta-inline-queue .video-item[disabled] {
    opacity: 0.6;
    cursor: wait;
  }
  .yta-inline-queue .video-item.dragging {
    opacity: 0.55;
  }
  .yta-inline-queue .video-item.drop-before::after,
  .yta-inline-queue .video-item.drop-after::after {
    content: "";
    position: absolute;
    left: 20px;
    right: 20px;
    height: 2px;
    border-radius: 999px;
    background: linear-gradient(
      90deg,
      rgba(244, 67, 54, 0) 0%,
      rgba(244, 67, 54, 0.9) 20%,
      rgba(244, 67, 54, 0.9) 80%,
      rgba(244, 67, 54, 0) 100%
    );
    box-shadow: 0 0 4px rgba(244, 67, 54, 0.4);
    pointer-events: none;
  }
  .yta-inline-queue .video-item.drop-before::after {
    top: 0;
    transform: translateY(
      calc(-50% - (var(--inline-queue-gap, 6px) / 2))
    );
  }
  .yta-inline-queue .video-item.drop-after::after {
    bottom: 0;
    transform: translateY(
      calc(50% + (var(--inline-queue-gap, 6px) / 2))
    );
  }
  .yta-inline-queue .video-item.drop-before,
  .yta-inline-queue .video-item.drop-after {
    overflow: visible;
  }
  .yta-inline-queue .video-handle {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    margin: 0;
    padding: 0;
    border: none;
    border-right: 1px solid rgba(255, 255, 255, 0.08);
    background: rgba(255, 255, 255, 0.02);
    color: rgba(255, 255, 255, 0.45);
    cursor: grab;
    transition: background 0.2s ease, color 0.2s ease;
  }
  .yta-inline-queue .video-handle::before,
  .yta-inline-queue .video-handle::after {
    content: "";
    position: absolute;
    top: 50%;
    width: 2px;
    height: 2px;
    border-radius: 50%;
    background: currentColor;
    transform: translate(-50%, -50%);
    box-shadow:
      0 -6px 0 currentColor,
      0 6px 0 currentColor;
  }
  .yta-inline-queue .video-handle::before {
    left: calc(50% - 3px);
  }
  .yta-inline-queue .video-handle::after {
    left: calc(50% + 3px);
  }
  .yta-inline-queue .video-handle:active {
    cursor: grabbing;
  }
  .yta-inline-queue .video-handle:hover {
    background: rgba(229, 57, 53, 0.16);
    color: rgba(229, 57, 53, 0.9);
  }
  .yta-inline-queue .icon-button {
    position: absolute;
    width: 26px;
    height: 26px;
    border-radius: 50%;
    border: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    line-height: 1;
    background: rgba(0, 0, 0, 0.45);
    color: #f5f5f5;
    cursor: pointer;
    transition: background 0.2s ease, transform 0.15s ease, opacity 0.2s ease;
  }
  .yta-inline-queue .icon-button:disabled {
    opacity: 0.55;
    cursor: not-allowed;
    transform: none;
  }
  .yta-inline-queue .video-remove {
    top: 4px;
    right: 4px;
  }
  .yta-inline-queue .video-remove:hover {
    background: rgba(229, 57, 53, 0.85);
  }
  .yta-inline-queue .video-quick-filter {
    top: 4px;
    right: 32px;
  }
  .yta-inline-queue .video-quick-filter:hover {
    background: rgba(33, 150, 243, 0.85);
  }
  .yta-inline-queue .video-postpone {
    bottom: 4px;
    right: 32px;
  }
  .yta-inline-queue .video-postpone:hover {
    background: rgba(255, 193, 7, 0.85);
  }
  .yta-inline-queue .video-item:not(.video-item--has-postpone) .video-postpone {
    display: none;
  }
  .yta-inline-queue .video-move {
    bottom: 4px;
    right: 4px;
  }
  .yta-inline-queue .video-move:hover {
    background: rgba(33, 150, 243, 0.85);
  }
  .yta-inline-queue .video-thumb-wrapper {
    position: relative;
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    align-self: stretch;
    justify-self: stretch;
  }
  .yta-inline-queue .video-thumb {
    width: 100%;
    aspect-ratio: 16 / 9;
    height: auto;
    object-fit: contain;
    object-position: center;
    background: #000;
    flex-shrink: 0;
    overflow: hidden;
    align-self: center;
    justify-self: stretch;
    display: block;
  }
  .yta-inline-queue .video-thumb__duration {
    position: absolute;
    bottom: 1px;
    right: 1px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 1px 4px;
    color: #fff;
    -webkit-text-fill-color: #fff;
    font-size: 11px;
    font-weight: 600;
    line-height: 1.2;
    letter-spacing: 0.2px;
    text-align: center;
    white-space: nowrap;
    background: rgba(0, 0, 0, 0.7);
    border-radius: 6px;
  }
  .yta-inline-queue .video-body {
    display: flex;
    flex-direction: column;
    gap: var(--video-body-gap);
    min-width: 0;
    padding: var(--video-body-padding-top) var(--video-body-padding-right)
      var(--video-body-padding-bottom) var(--video-body-padding-left);
    justify-content: center;
    height: 100%;
  }
  .yta-inline-queue .video-title {
    font-weight: 600;
    font-size: 12.5px;
    color: var(--yt-spec-text-primary, #fff);
    line-height: 1.3;
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }
  .yta-inline-queue .video-details {
    font-size: 10.5px;
    opacity: 0.75;
    display: flex;
    flex-wrap: wrap;
    column-gap: 0;
    row-gap: 4px;
    align-items: center;
    color: var(--yt-spec-text-secondary, rgba(255, 255, 255, 0.72));
  }
  .yta-inline-queue .video-details > span:not(.video-details__separator) {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    line-height: 1;
  }
  .yta-inline-queue .video-details__separator {
    display: inline-block;
    padding: 0 4px;
    font-size: inherit;
    line-height: 1;
    opacity: 0.5;
    vertical-align: middle;
  }
  .yta-inline-queue .video-detail__icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    line-height: 1;
  }
  .yta-inline-queue .video-detail__text {
    display: inline-flex;
    align-items: center;
    line-height: 1;
  }
  .yta-inline-queue__detail-link {
    color: inherit;
    text-decoration: none;
    font-weight: 600;
  }
  .yta-inline-queue__detail-link:hover {
    color: var(--yt-spec-text-primary, #fff);
    text-decoration: underline;
  }
  .yta-inline-move-menu {
    position: fixed;
    z-index: 2147483647;
    display: none;
    flex-direction: column;
    gap: 8px;
    padding: 12px 14px;
    background: rgba(17, 17, 17, 0.96);
    border: 1px solid rgba(255, 255, 255, 0.18);
    border-radius: 12px;
    box-shadow: 0 18px 42px rgba(0, 0, 0, 0.4);
    color: #f5f5f5;
    max-width: min(280px, calc(100% - 32px));
    box-sizing: border-box;
  }
  .yta-inline-move-menu[data-visible="1"] {
    display: flex;
  }
  .yta-inline-move-menu__message {
    font-size: 12.5px;
    line-height: 1.35;
    opacity: 0.85;
  }
  .yta-inline-move-menu__buttons {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .yta-inline-move-menu__buttons[data-empty="1"] {
    display: none;
  }
  .yta-inline-move-menu__option {
    border: none;
    border-radius: 8px;
    padding: 9px 12px;
    font-size: 13px;
    font-weight: 600;
    background: rgba(229, 57, 53, 0.95);
    color: #fff;
    cursor: pointer;
    transition: background 0.2s ease, transform 0.15s ease;
    text-align: left;
  }
  .yta-inline-move-menu__option:hover {
    background: rgba(244, 81, 58, 0.98);
    transform: translateY(-1px);
  }
  `;
  }

  // src/content/styles/inline-queue.js
  function getInlineQueueShellStyles() {
    return `
  .yta-inline-queue {
    --inline-queue-gap: 6px;
    position: relative;
    display: none;
    padding: 12px 14px;
    margin: 10px 0 14px;
    color: var(--yt-spec-text-primary, #fff);
    box-sizing: border-box;
    isolation: isolate;
  }
  .yta-inline-queue > * {
    position: relative;
    z-index: 1;
  }
  .yta-inline-queue::before {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: 12px;
    background: var(--yt-spec-raised-background, rgba(18, 18, 18, 0.95));
    border: 1px solid rgba(255, 255, 255, 0.08);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.28);
    pointer-events: none;
  }
  .yta-inline-queue[data-placement="sidebar"] {
    margin: 0 0 16px;
  }
  .yta-inline-queue[data-visible="1"] {
    display: block;
  }
  .yta-inline-queue__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 10px;
    flex-wrap: wrap;
  }
  .yta-inline-queue__header-line {
    display: flex;
    align-items: center;
    flex-wrap: nowrap;
    gap: 8px;
    flex: 1 1 auto;
    min-width: 0;
  }
  .yta-inline-queue__brand {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--yt-spec-text-secondary, rgba(255, 255, 255, 0.6));
    flex: 0 0 auto;
  }
  .yta-inline-queue__title {
    align-self: center;
    display: inline-flex;
    align-items: center;
    font-size: 15px;
    font-weight: 700;
    letter-spacing: 0.01em;
    color: var(--yt-spec-text-primary, #fff);
    line-height: 1.3;
    word-break: normal;
    white-space: nowrap;
    min-width: auto;
    flex: 0 0 auto;
    cursor: pointer;
  }
  .yta-inline-queue__title:hover,
  .yta-inline-queue__title:focus-visible {
    text-decoration: underline;
    outline: none;
  }
  .yta-inline-queue__now-playing {
    display: block;
    align-self: center;
    font-size: 13px;
    color: var(--yt-spec-text-secondary, rgba(255, 255, 255, 0.72));
    line-height: 1.35;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
    max-width: 100%;
    width: 100%;
    flex: 1 1 auto;
    text-align: center;
  }
  .yta-inline-queue__progress {
    font-size: 12.5px;
    font-weight: 600;
    color: var(--yt-spec-text-primary, rgba(255, 255, 255, 0.92));
    white-space: nowrap;
    flex: 0 0 auto;
    cursor: pointer;
  }
  .yta-inline-queue__freeze {
    margin-left: auto;
    font-weight: 600;
    color: var(--yt-spec-text-primary, #fff);
    white-space: nowrap;
  }
  .yta-inline-queue__empty {
    font-size: 13px;
    color: var(--yt-spec-text-secondary, rgba(255, 255, 255, 0.74));
    border: 1px dashed rgba(255, 255, 255, 0.18);
    border-radius: 10px;
    padding: 12px;
    text-align: center;
    margin: 4px 0 10px;
    background: rgba(255, 255, 255, 0.04);
  }
  .yta-inline-queue[data-empty="0"] .yta-inline-queue__empty {
    display: none;
  }
  .yta-inline-queue[data-empty="1"] .yta-inline-queue__list {
    display: none;
  `;
  }

  // src/content/styles/page-actions.js
  function getPageActionStyles() {
    return `
  .yta-page-actions {
    position: fixed;
    top: 140px;
    right: 16px;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 10px;
    z-index: 2147483647;
    transition: opacity 0.2s ease, transform 0.2s ease;
  }
  .yta-page-actions[data-hidden="1"] {
    display: none;
  }
  .yta-page-actions[data-controls-hidden="1"] {
    opacity: 0;
    pointer-events: none;
  }
  .yta-page-actions__toggle {
    width: 52px;
    height: 52px;
    border-radius: 50%;
    border: 1px solid rgba(255, 255, 255, 0.12);
    padding: 0;
    background: rgba(22, 22, 26, 0.88);
    color: #fff;
    box-shadow: 0 14px 28px rgba(0, 0, 0, 0.32);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    backdrop-filter: blur(14px);
    transition: transform 0.2s ease, background 0.2s ease, box-shadow 0.2s ease;
  }
  .yta-page-actions__toggle img {
    width: 28px;
    height: 28px;
    pointer-events: none;
  }
  .yta-page-actions__toggle-fallback {
    font-weight: 700;
    font-size: 13px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .yta-page-actions__toggle:hover,
  .yta-page-actions[data-expanded="1"] .yta-page-actions__toggle {
    transform: translateY(-1px) scale(1.04);
    background: rgba(32, 32, 36, 0.92);
    box-shadow: 0 18px 34px rgba(0, 0, 0, 0.36);
  }
  .yta-page-actions__panel {
    min-width: 220px;
    max-width: 280px;
    padding: 14px 16px 16px;
    border-radius: 20px;
    background: rgba(16, 16, 20, 0.82);
    backdrop-filter: blur(18px);
    border: 1px solid rgba(255, 255, 255, 0.08);
    color: #fff;
    display: none;
    flex-direction: column;
    align-items: stretch;
    gap: 12px;
    text-align: center;
    opacity: 0;
    pointer-events: none;
    transform: translateY(-8px) scale(0.96);
    transform-origin: top right;
    transition: opacity 0.22s ease, transform 0.22s ease;
    box-shadow: 0 20px 42px rgba(0, 0, 0, 0.36);
  }
  .yta-page-actions[data-expanded="1"] .yta-page-actions__panel,
  .yta-page-actions__panel[data-status-visible="1"] {
    display: flex;
    opacity: 1;
    pointer-events: auto;
    transform: translateY(0) scale(1);
  }
  .yta-page-actions__actions {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .yta-page-actions__action {
    border: none;
    border-radius: 999px;
    padding: 10px 22px;
    background: rgba(229, 45, 39, 0.94);
    color: #ffffff;
    font-weight: 600;
    font-size: 14px;
    line-height: 1.32;
    cursor: pointer;
    transition: background 0.2s ease, transform 0.15s ease, opacity 0.2s ease;
    display: inline-flex;
    justify-content: center;
    align-items: center;
    text-align: center;
    box-shadow: 0 12px 26px rgba(229, 45, 39, 0.38);
  }
  .yta-page-actions__action:hover {
    background: rgba(255, 61, 52, 0.98);
    transform: translateY(-1px);
  }
  .yta-page-actions__action:disabled {
    opacity: 0.7;
    cursor: progress;
    transform: none;
    box-shadow: none;
  }
  .yta-page-actions__info {
    font-size: 13px;
    line-height: 1.4;
    color: rgba(255, 255, 255, 0.9);
    text-align: center;
    display: none;
    border-radius: 999px;
    padding: 7px 16px;
    background: rgba(255, 255, 255, 0.12);
    align-self: center;
  }
  .yta-page-actions__info[data-visible="1"] {
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .yta-page-actions__info[data-dimmed="1"] {
    opacity: 0.55;
  }
  .yta-page-actions__status {
    padding: 10px 16px;
    border-radius: 16px;
    background: rgba(0, 0, 0, 0.34);
    color: rgba(255, 255, 255, 0.94);
    font-size: 12px;
    line-height: 1.45;
    display: none;
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.05);
  }
  .yta-page-actions__status[data-visible="1"] {
    display: block;
  }
  .yta-page-actions__status[data-kind="success"] {
    background: rgba(26, 140, 77, 0.36);
    color: #d6ffe8;
  }
  .yta-page-actions__status[data-kind="error"] {
    background: rgba(229, 45, 39, 0.32);
    color: #ffe3e3;
  }
  .yta-page-actions__stop {
    border: 1px solid rgba(255, 255, 255, 0.22);
    border-radius: 999px;
    padding: 8px 20px;
    background: rgba(15, 15, 18, 0.42);
    color: #ffffff;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.2s ease, transform 0.15s ease, opacity 0.2s ease;
    display: none;
  }
  .yta-page-actions__stop:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.22);
    transform: translateY(-1px);
  }
  .yta-page-actions__stop:disabled {
    opacity: 0.6;
    cursor: progress;
    transform: none;
  }
  .yta-page-actions[data-collecting="1"] .yta-page-actions__stop {
    display: inline-flex;
    justify-content: center;
  }
  .yta-page-actions[data-collecting="1"] .yta-page-actions__toggle {
    box-shadow: 0 10px 20px rgba(0, 0, 0, 0.24);
  }
  .yta-page-actions--player {
    position: absolute;
    top: auto;
    right: 24px;
    left: auto;
    bottom: 96px;
    align-items: flex-end;
  }
  .yta-page-actions[data-context="watch"] {
    gap: 6px;
  }
  .yta-page-actions[data-context="watch"] .yta-page-actions__panel {
    background: transparent;
    border: none;
    box-shadow: none;
    padding: 0;
    opacity: 1;
    pointer-events: auto;
    transform: none;
    align-items: flex-end;
  }
  .yta-page-actions[data-context="watch"] .yta-page-actions__actions {
    gap: 0;
  }
  .yta-page-actions[data-context="watch"] .yta-page-actions__action {
    border: none;
    border-radius: 999px;
    padding: 10px 24px;
    background: rgba(229, 45, 39, 0.96);
    font-size: 15px;
    box-shadow: none;
  }
  .yta-page-actions[data-context="watch"] .yta-page-actions__action:hover {
    background: rgba(255, 61, 52, 0.98);
  }
  .yta-page-actions[data-context="watch"] .yta-page-actions__status {
    background: rgba(0, 0, 0, 0.55);
  }
  .yta-page-actions[data-context="watch"] .yta-page-actions__info {
    text-align: center;
    background: rgba(0, 0, 0, 0.55);
    font-size: 14px;
    padding: 8px 18px;
  }
  .yta-page-actions[data-context="watch"] .yta-page-actions__stop {
    display: none !important;
  }
  `;
  }

  // src/content/styles/playback.js
  function getPlaybackStyles() {
    return `
  .yta-playback-notification {
    position: fixed;
    top: 152px;
    left: 50%;
    transform: translateX(-50%) translateY(-10px);
    display: grid;
    place-items: center;
    padding: 20px 56px;
    border-radius: 20px;
    background: linear-gradient(150deg, #ff0033 0%, #d40000 50%, #a80000 100%);
    color: #ffffff;
    box-shadow: 0 30px 70px rgba(0, 0, 0, 0.38);
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.24s ease, transform 0.24s ease;
    z-index: 2147483647;
    box-sizing: border-box;
    max-width: min(720px, calc(100% - 48px));
    min-width: min(560px, calc(100% - 48px));
    font-size: 17px;
    text-align: center;
  }
  .yta-playback-notification[data-visible="1"] {
    opacity: 1;
    pointer-events: auto;
    transform: translateX(-50%) translateY(0);
  }
  .yta-playback-notification__content {
    display: grid;
    justify-items: center;
    align-content: center;
    gap: 10px;
    width: 100%;
  }
  .yta-playback-notification__title {
    font-size: 24px;
    font-weight: 800;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    color: #ffffff;
    text-shadow: 0 3px 18px rgba(0, 0, 0, 0.45);
  }
  .yta-playback-notification__body {
    font-size: 18px;
    line-height: 1.55;
    color: rgba(255, 255, 255, 0.94);
    font-weight: 600;
    max-width: 560px;
  }
  .yta-player-controls {
    position: absolute;
    right: 24px;
    bottom: 64px;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 8px;
    z-index: 2147483647;
    transition: opacity 0.2s ease;
  }
  .yta-player-controls__row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .yta-player-controls__row--top,
  .yta-player-controls__row--bottom {
    justify-content: flex-end;
  }
  .yta-player-controls .ytp-button[hidden] {
    display: none !important;
  }
  .yta-player-controls .ytp-button {
    border: none;
    width: 32px;
    height: 32px;
    border-radius: 16px;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: rgba(17, 17, 17, 0.6);
    color: #fff;
    font-size: 16px;
    font-weight: 500;
    line-height: 1;
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
  .yta-player-controls__add {
    border: none;
    border-radius: 999px;
    padding: 0 18px;
    min-width: 132px;
    height: 32px;
    background: rgba(229, 45, 39, 0.95);
    color: #ffffff;
    font-weight: 600;
    font-size: 14px;
    letter-spacing: 0.01em;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: background 0.2s ease, transform 0.15s ease, opacity 0.2s ease;
  }
  .yta-player-controls__add:hover:not([disabled]) {
    background: rgba(255, 61, 52, 0.98);
    transform: translateY(-1px);
  }
  .yta-player-controls__add[disabled] {
    opacity: 0.65;
    cursor: not-allowed;
    transform: none;
  }
  .yta-player-controls__add[hidden] {
    display: none !important;
  }
  .yta-player-controls__start {
    width: auto !important;
    min-width: 132px;
    height: 32px;
    padding: 0 16px;
    font-size: 14px;
    font-weight: 600;
    text-align: center;
  }
  .yta-player-controls__postpone {
    width: auto !important;
    min-width: 108px;
    height: 32px;
    padding: 0 12px;
    gap: 6px;
    font-size: 14px;
    font-weight: 500;
  }
  .yta-player-controls__postpone span {
    display: inline-flex;
    align-items: center;
    pointer-events: none;
  }
  .yta-player-controls__postpone-icon {
    font-size: 16px;
    line-height: 1;
  }
  .yta-player-controls[data-hidden="1"] {
    opacity: 0;
    pointer-events: none;
  }
  `;
  }

  // src/content/styles/video-cards.js
  function getVideoCardStyles() {
    return `
  .${THUMB_HOST_CLASS} {
    position: relative !important;
  }
  .${CARD_OVERLAY_HOST_CLASS} {
    position: relative !important;
    z-index: auto;
  }
  .${INLINE_BUTTON_OVERLAY_CLASS} {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 2147483000;
  }
  .${INLINE_BUTTON_OVERLAY_CLASS} .${ADD_BUTTON_CLASS} {
    pointer-events: auto;
  }
  .video-thumb__progress {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 4px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.18);
    overflow: hidden;
    pointer-events: none;
    z-index: 4;
  }
  .video-thumb__progress-bar {
    position: absolute;
    top: 0;
    left: 0;
    bottom: 0;
    width: 0%;
    background: linear-gradient(
      90deg,
      rgba(255, 87, 34, 0.95) 0%,
      rgba(244, 67, 54, 0.95) 50%,
      rgba(198, 40, 40, 0.95) 100%
    );
    box-shadow: 0 0 6px rgba(229, 57, 53, 0.45);
    transition: width 0.2s ease;
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
    pointer-events: none;
  }
  .${ADD_BUTTON_CLASS}[data-yta-status="pending"] {
    cursor: progress;
    opacity: 0.6;
  }
  .${ADD_BUTTON_CLASS}.${ADD_BUTTON_DONE_CLASS},
  .${ADD_BUTTON_CLASS}[data-yta-status="present"] {
    background: rgba(34, 197, 94, 0.85);
  }
  .${ADD_BUTTON_CLASS}[data-yta-status="present"] {
    cursor: default;
    opacity: 1;
  }
  .${ADD_BUTTON_CLASS}[data-yta-status="present"]:hover {
    background: rgba(34, 197, 94, 0.85);
    transform: none;
  }
  .${ADD_BUTTON_CLASS}::after {
    content: "+";
    font-weight: 600;
  }
  .${ADD_BUTTON_CLASS}.${ADD_BUTTON_DONE_CLASS}::after {
    content: "\u2713";
    font-weight: 600;
  }`;
  }

  // src/content/styles/index.js
  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `${getVideoCardStyles()}
  ${getPlaybackStyles()}
  ${getInlineQueueShellStyles()}
  ${getInlineQueueItemStyles()}
  ${getPageActionStyles()}`;
    document.head.appendChild(style);
  }

  // src/content/video-cards/targets.js
  var PLAYLIST_CARD_SELECTOR = [
    "ytd-playlist-renderer",
    "ytd-grid-playlist-renderer",
    "ytd-compact-playlist-renderer",
    "ytd-radio-renderer",
    "ytd-compact-radio-renderer",
    ".yt-lockup-view-model--collection",
    ".yt-lockup-view-model--collection-stack-2",
    ".yt-lockup-view-model--collection-stack-3"
  ].join(",");
  var PLAYLIST_ID_PATTERN = /[\w-]{13,64}/;
  function hasNestedCardCandidate(card, videoCardSelector) {
    if (!(card instanceof HTMLElement)) {
      return false;
    }
    return Boolean(card.querySelector(videoCardSelector));
  }
  function parsePlaylistIdCandidate(value) {
    if (!value) return "";
    const str = String(value).trim();
    if (!str || str.length === 11) return "";
    if (/^[\w-]{13,64}$/.test(str)) return str;
    const match = str.replace(/content-id-/gi, "").match(PLAYLIST_ID_PATTERN);
    if (match && match[0] && match[0].length !== 11) {
      return match[0];
    }
    return "";
  }
  function isPlaylistCollectionCard(card) {
    if (!(card instanceof HTMLElement)) return false;
    if (card.matches(PLAYLIST_CARD_SELECTOR)) {
      return true;
    }
    if (card.classList) {
      return Array.from(card.classList).some(
        (cls) => /collection/i.test(cls)
      );
    }
    return Boolean(card.querySelector("yt-collection-thumbnail-view-model")) || Boolean(card.querySelector("yt-collections-stack")) || Boolean(card.querySelector("ytd-playlist-thumbnail"));
  }
  function findPlaylistIdInCard(card) {
    if (!(card instanceof HTMLElement)) return "";
    const directValues = [
      card.dataset?.playlistId,
      card.dataset?.listId,
      card.dataset?.contentId,
      card.getAttribute("data-playlist-id"),
      card.getAttribute("data-list-id"),
      card.getAttribute("data-content-id")
    ];
    for (const value of directValues) {
      const parsed = parsePlaylistIdCandidate(value);
      if (parsed) return parsed;
    }
    if (typeof card.className === "string" && card.className) {
      const match = card.className.match(/content-id-([\w-]{13,64})/i);
      if (match) {
        const parsed = parsePlaylistIdCandidate(match[1]);
        if (parsed) return parsed;
      }
    }
    const attributeNodes = card.querySelectorAll(
      "[data-playlist-id],[data-list-id],[data-content-id]"
    );
    for (const node of attributeNodes) {
      const parsed = parsePlaylistIdCandidate(node.getAttribute("data-playlist-id")) || parsePlaylistIdCandidate(node.getAttribute("data-list-id")) || parsePlaylistIdCandidate(node.getAttribute("data-content-id"));
      if (parsed) return parsed;
    }
    const anchors = card.querySelectorAll("a[href]");
    for (const anchor of anchors) {
      const href = anchor.getAttribute("href");
      if (!href) continue;
      try {
        const url = new URL(href, window.location.href);
        const listParam = parsePlaylistIdCandidate(url.searchParams.get("list"));
        if (listParam) {
          if (!url.pathname.startsWith("/watch")) {
            return listParam;
          }
          if (isPlaylistCollectionCard(card)) {
            return listParam;
          }
        }
        const fromPath = parsePlaylistIdCandidate(url.pathname);
        if (fromPath) {
          return fromPath;
        }
      } catch {
        const parsed = parsePlaylistIdCandidate(href);
        if (parsed) return parsed;
      }
    }
    return "";
  }
  function determineCardTarget(card) {
    const playlistId = findPlaylistIdInCard(card);
    const videoId = findVideoIdInCard(card);
    if (playlistId && (!videoId || isPlaylistCollectionCard(card))) {
      return { type: "playlist", id: playlistId };
    }
    if (videoId) {
      return { type: "video", id: videoId };
    }
    if (playlistId) {
      return { type: "playlist", id: playlistId };
    }
    return null;
  }
  function findVideoIdInCard(card) {
    if (!(card instanceof HTMLElement)) return "";
    const direct = card.dataset?.videoId || card.dataset?.ytVideoId || card.dataset?.contentId || card.getAttribute("data-video-id") || card.getAttribute("data-content-id") || card.getAttribute("data-entity-id") || card.getAttribute("data-id") || card.id;
    if (direct) {
      const parsed = parseVideoId(direct);
      if (parsed) return parsed;
    }
    if (typeof card.className === "string" && card.className) {
      const match = card.className.match(/content-id-([\w-]{11})/i);
      if (match) {
        const parsed = parseVideoId(match[1]);
        if (parsed) return parsed;
      }
    }
    const datasetNode = card.querySelector("[data-video-id]");
    if (datasetNode && datasetNode.dataset) {
      const parsed = parseVideoId(datasetNode.dataset.videoId);
      if (parsed) return parsed;
    }
    const contentIdNode = card.querySelector("[data-content-id], [data-entity-id]");
    if (contentIdNode) {
      const parsed = parseVideoId(contentIdNode.getAttribute("data-content-id")) || parseVideoId(contentIdNode.getAttribute("data-entity-id"));
      if (parsed) return parsed;
    }
    const classNode = card.querySelector("[class*='content-id-']");
    if (classNode && typeof classNode.className === "string") {
      const match = classNode.className.match(/content-id-([\w-]{11})/i);
      if (match) {
        const parsed = parseVideoId(match[1]);
        if (parsed) return parsed;
      }
    }
    const anchors = card.querySelectorAll("a[href]");
    for (const anchor of anchors) {
      const href = anchor.href || anchor.getAttribute("href");
      if (!href) continue;
      if (!/[?&]v=/.test(href) && !/\/shorts\//.test(href) && !/youtu\.be\//.test(href)) {
        continue;
      }
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

  // src/content/collection/collectors.js
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
    const ids = /* @__PURE__ */ new Set();
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
    const button = document.querySelector(
      "ytd-continuation-item-renderer #button:not([disabled])"
    ) || document.querySelector("#continuations button:not([disabled])");
    if (button) {
      button.click();
      return true;
    }
    return false;
  }
  function findContinuationSpinner() {
    return document.querySelector(
      "ytd-continuation-item-renderer tp-yt-paper-spinner[active]"
    ) || document.querySelector(
      "ytd-continuation-item-renderer tp-yt-paper-spinner:not([aria-hidden='true'])"
    ) || document.querySelector(
      "ytd-continuation-item-renderer tp-yt-paper-spinner"
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
    const seen = /* @__PURE__ */ new Set();
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
      const cards2 = Array.from(document.querySelectorAll(VIDEO_CARD_SELECTOR));
      let added2 = 0;
      for (const card of cards2) {
        const id = findVideoIdInCard(card);
        if (id && !seen.has(id)) {
          seen.add(id);
          added2 += 1;
        }
      }
      return { cards: cards2, added: added2 };
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
      const targetIndex = scrollIndex < cards.length ? scrollIndex : Math.max(cards.length - 1, 0);
      const target = targetIndex >= 0 ? cards[targetIndex] : null;
      if (target) {
        try {
          target.scrollIntoView({
            behavior: "smooth",
            block: scrollIndex < cards.length - 1 ? "center" : "end"
          });
        } catch (_) {
          target.scrollIntoView();
        }
      }
      scrollIndex = Math.min(scrollIndex + 1, cards.length + 4);
      try {
        window.scrollTo({
          top: document.documentElement.scrollHeight,
          behavior: "smooth"
        });
      } catch (_) {
        window.scrollTo(0, document.documentElement.scrollHeight);
      }
      const loadTriggered = attemptLoadMoreContinuations();
      const waitResult = await waitForNextBatch(previousCount, loadTriggered, {
        checkAbort
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
      total: seen.size
    };
  }

  // src/addResultMessages.js
  function normalizeAddResponse(response) {
    if (!response || typeof response !== "object") {
      return { state: null, requested: null, missing: 0, added: 0 };
    }
    const state2 = response.state && typeof response.state === "object" ? response.state : response;
    const requested = Number.isInteger(response.requested) && response.requested >= 0 ? response.requested : null;
    const missing = Number.isInteger(response.missing) && response.missing > 0 ? response.missing : 0;
    const added = Number.isInteger(response.added) && response.added >= 0 ? response.added : 0;
    return { state: state2, requested, missing, added };
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

  // src/content/page-actions/dom.js
  var DEFAULT_TOGGLE_TITLE = "YTautoPlaylist";
  function getRuntimeIconUrl() {
    if (typeof chrome !== "undefined" && chrome?.runtime?.getURL) {
      try {
        return chrome.runtime.getURL("icon/icon.png");
      } catch {
        return "";
      }
    }
    if (typeof browser !== "undefined" && browser?.runtime?.getURL) {
      try {
        return browser.runtime.getURL("icon/icon.png");
      } catch {
        return "";
      }
    }
    return "";
  }
  function createToggleButton(onToggle) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "yta-page-actions__toggle";
    button.setAttribute("aria-label", DEFAULT_TOGGLE_TITLE);
    button.setAttribute("aria-expanded", "false");
    button.title = DEFAULT_TOGGLE_TITLE;
    const iconUrl = getRuntimeIconUrl();
    if (iconUrl) {
      const iconImg = document.createElement("img");
      iconImg.src = iconUrl;
      iconImg.alt = "";
      iconImg.decoding = "async";
      iconImg.loading = "lazy";
      button.appendChild(iconImg);
    } else {
      const fallback = document.createElement("span");
      fallback.className = "yta-page-actions__toggle-fallback";
      fallback.textContent = "YT";
      button.appendChild(fallback);
    }
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      onToggle();
    });
    return button;
  }
  function createActionButton(label, handler) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "yta-page-actions__action";
    button.textContent = label;
    button.addEventListener("click", (event) => {
      event.preventDefault();
      handler();
    });
    return button;
  }
  function createStopButton(onCancel) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "yta-page-actions__stop";
    button.textContent = "\u0421\u0442\u043E\u043F";
    button.hidden = true;
    button.addEventListener("click", (event) => {
      event.preventDefault();
      onCancel();
    });
    return button;
  }
  function setDefaultToggleLabel(toggle) {
    if (!toggle) return;
    toggle.title = DEFAULT_TOGGLE_TITLE;
    toggle.setAttribute("aria-label", DEFAULT_TOGGLE_TITLE);
  }
  function setToggleLabelSuffix(toggle, text) {
    if (!toggle) return;
    toggle.title = `${DEFAULT_TOGGLE_TITLE} \u2022 ${text}`;
    toggle.setAttribute("aria-label", `${DEFAULT_TOGGLE_TITLE} \u2014 ${text}`);
  }
  function createPageActionElements({
    actionDefinitions,
    onCancel,
    onFocusOut,
    onMouseEnter,
    onMouseLeave,
    onToggle
  }) {
    const container = document.createElement("div");
    container.className = "yta-page-actions";
    container.dataset.hidden = "1";
    container.dataset.expanded = "0";
    const toggle = createToggleButton(onToggle);
    const panel = document.createElement("div");
    panel.className = "yta-page-actions__panel";
    const actionsWrap = document.createElement("div");
    actionsWrap.className = "yta-page-actions__actions";
    const actionButtons = {};
    actionDefinitions.forEach(({ key, label, handler }) => {
      const button = createActionButton(label, handler);
      actionsWrap.appendChild(button);
      actionButtons[key] = button;
    });
    const info = document.createElement("div");
    info.className = "yta-page-actions__info";
    info.dataset.visible = "0";
    const status = document.createElement("div");
    status.className = "yta-page-actions__status";
    status.dataset.visible = "0";
    const stop = createStopButton(onCancel);
    panel.appendChild(actionsWrap);
    panel.appendChild(info);
    panel.appendChild(status);
    panel.appendChild(stop);
    container.appendChild(toggle);
    container.appendChild(panel);
    container.addEventListener("mouseenter", onMouseEnter);
    container.addEventListener("mouseleave", onMouseLeave);
    container.addEventListener("focusin", onMouseEnter);
    container.addEventListener("focusout", onFocusOut);
    return {
      actionButtons,
      container,
      info,
      panel,
      status,
      stop,
      toggle
    };
  }

  // src/content/page-actions/host.js
  function createPageActionHostController({ pageActions: pageActions2 }) {
    function positionPageActions(context) {
      if (!pageActions2.container) return;
      pageActions2.container.dataset.context = context;
      const inPlayer = context === "watch";
      const host = inPlayer ? document.getElementById("movie_player") || document.querySelector("#player-container") : null;
      if (inPlayer && host) {
        if (pageActions2.container.parentElement !== host) {
          pageActions2.container.remove();
          host.appendChild(pageActions2.container);
        }
        pageActions2.container.classList.add("yta-page-actions--player");
        observePageActionsHost(host);
      } else {
        if (pageActions2.container.parentElement !== document.body) {
          pageActions2.container.remove();
          document.body.appendChild(pageActions2.container);
        }
        pageActions2.container.classList.remove("yta-page-actions--player");
        observePageActionsHost(null);
      }
    }
    function syncPageActionsHostVisibility(host) {
      if (!pageActions2.container) return;
      if (!host) {
        delete pageActions2.container.dataset.controlsHidden;
        return;
      }
      const hidden = host.classList.contains("ytp-autohide");
      if (hidden) {
        pageActions2.container.dataset.controlsHidden = "1";
      } else {
        delete pageActions2.container.dataset.controlsHidden;
      }
    }
    function observePageActionsHost(host) {
      if (!pageActions2.container) return;
      if (pageActions2.host === host) {
        syncPageActionsHostVisibility(host);
        return;
      }
      if (pageActions2.hostObserver) {
        pageActions2.hostObserver.disconnect();
        pageActions2.hostObserver = null;
      }
      pageActions2.host = host || null;
      if (host) {
        const observer2 = new MutationObserver(() => {
          syncPageActionsHostVisibility(host);
        });
        observer2.observe(host, { attributes: true, attributeFilter: ["class"] });
        pageActions2.hostObserver = observer2;
        syncPageActionsHostVisibility(host);
      } else {
        delete pageActions2.container.dataset.controlsHidden;
      }
    }
    return {
      positionPageActions
    };
  }

  // src/content/page-actions/view.js
  var DEFAULT_COLLAPSE_DELAY = 220;
  function createPageActionViewController({
    determinePageContext: determinePageContext2,
    getContextCapabilities: getContextCapabilities2,
    getCurrentVideoId: getCurrentVideoId2,
    inlinePlaylistState: inlinePlaylistState2,
    pageActions: pageActions2,
    state: state2,
    actionDefinitions,
    cancelAddAllFromPage: cancelAddAllFromPage2
  }) {
    let lastPositionHint = { videoId: null, index: null, total: null };
    let lastPageContext = null;
    let lastCapabilities = {
      canAddCurrent: null,
      canAddVisible: null,
      canAddAll: null,
      controlling: null
    };
    const hostController = createPageActionHostController({ pageActions: pageActions2 });
    function resetToggleLabel() {
      setDefaultToggleLabel(pageActions2.toggle);
    }
    function setToggleLabelSuffix2(text) {
      setToggleLabelSuffix(pageActions2.toggle, text);
    }
    function resetPageActionInfoState() {
      if (pageActions2.info) {
        pageActions2.info.dataset.visible = "0";
        pageActions2.info.textContent = "";
        delete pageActions2.info.dataset.dimmed;
      }
      lastPositionHint = { videoId: null, index: null, total: null };
      resetToggleLabel();
    }
    function togglePageActions() {
      if (!pageActions2.container) return;
      if (pageActions2.container.dataset.expanded === "1") {
        delete pageActions2.container.dataset.pinned;
        collapsePageActions({ force: true });
      } else {
        expandPageActions();
      }
    }
    function handleContainerMouseLeave() {
      if (pageActions2.toggle && document.activeElement === pageActions2.toggle) {
        pageActions2.toggle.blur();
      }
      scheduleCollapsePageActions2(DEFAULT_COLLAPSE_DELAY);
    }
    function handleContainerFocusOut(event) {
      if (pageActions2.container && event.relatedTarget && pageActions2.container.contains(event.relatedTarget)) {
        return;
      }
      scheduleCollapsePageActions2(DEFAULT_COLLAPSE_DELAY);
    }
    function ensurePageActions2() {
      if (pageActions2.container) return;
      const elements = createPageActionElements({
        actionDefinitions,
        onCancel: cancelAddAllFromPage2,
        onFocusOut: handleContainerFocusOut,
        onMouseEnter: () => {
          expandPageActions();
        },
        onMouseLeave: handleContainerMouseLeave,
        onToggle: togglePageActions
      });
      Object.assign(pageActions2, elements.actionButtons);
      pageActions2.container = elements.container;
      pageActions2.toggle = elements.toggle;
      pageActions2.panel = elements.panel;
      pageActions2.status = elements.status;
      pageActions2.info = elements.info;
      pageActions2.stop = elements.stop;
      document.body.appendChild(elements.container);
      positionPageActions(determinePageContext2());
    }
    function expandPageActions({ pinned = false } = {}) {
      ensurePageActions2();
      if (!pageActions2.container) return;
      pageActions2.container.dataset.expanded = "1";
      if (pageActions2.toggle) {
        pageActions2.toggle.setAttribute("aria-expanded", "true");
      }
      if (pinned) {
        pageActions2.container.dataset.pinned = "1";
      }
      if (pageActions2.collapseTimeout) {
        clearTimeout(pageActions2.collapseTimeout);
        pageActions2.collapseTimeout = null;
      }
    }
    function collapsePageActions({ force = false } = {}) {
      if (!pageActions2.container) return;
      if (!force) {
        if (pageActions2.container.dataset.pinned === "1") return;
        if (pageActions2.status?.dataset.visible === "1") return;
        const activeElement = document.activeElement;
        if (pageActions2.container.contains(activeElement) && activeElement !== document.body) {
          return;
        }
        if (typeof pageActions2.container.matches === "function" && pageActions2.container.matches(":hover")) {
          return;
        }
      }
      pageActions2.container.dataset.expanded = "0";
      if (pageActions2.toggle) {
        pageActions2.toggle.setAttribute("aria-expanded", "false");
      }
      if (force) {
        clearStatusTimeout();
        if (pageActions2.status) {
          pageActions2.status.dataset.visible = "0";
          pageActions2.status.textContent = "";
        }
        if (pageActions2.panel) {
          pageActions2.panel.dataset.statusVisible = "0";
        }
        if (pageActions2.info) {
          delete pageActions2.info.dataset.dimmed;
        }
        delete pageActions2.container.dataset.pinned;
        updatePageActionInfo(determinePageContext2(), lastCapabilities);
      }
    }
    function scheduleCollapsePageActions2(delay2 = 200) {
      if (pageActions2.collectingAll) {
        return;
      }
      if (determinePageContext2() === "watch") {
        return;
      }
      if (pageActions2.collapseTimeout) {
        clearTimeout(pageActions2.collapseTimeout);
      }
      pageActions2.collapseTimeout = window.setTimeout(() => {
        pageActions2.collapseTimeout = null;
        collapsePageActions();
      }, delay2);
    }
    function hidePageActions() {
      if (!pageActions2.container) return;
      pageActions2.container.dataset.hidden = "1";
      delete pageActions2.container.dataset.pinned;
      collapsePageActions({ force: true });
    }
    function positionPageActions(context) {
      hostController.positionPageActions(context);
    }
    function updatePageActionInfo(context, caps) {
      if (!pageActions2.info || !pageActions2.toggle) return;
      const isWatchContext = context === "watch";
      if (!isWatchContext || caps?.canAddCurrent) {
        resetPageActionInfoState();
        return;
      }
      const videoId = getCurrentVideoId2();
      const index = inlinePlaylistState2.indexById.get(videoId);
      const total = inlinePlaylistState2.orderedVideoIds.length;
      if (!Number.isInteger(index) || total <= 0) {
        resetPageActionInfoState();
        return;
      }
      if (lastPositionHint.videoId !== videoId || lastPositionHint.index !== index || lastPositionHint.total !== total) {
        const text = `\u0412\u0438\u0434\u0435\u043E ${index + 1} \u0438\u0437 ${total}`;
        lastPositionHint = { videoId, index, total };
        setToggleLabelSuffix2(text);
      }
      pageActions2.info.dataset.visible = "0";
      pageActions2.info.textContent = "";
      delete pageActions2.info.dataset.dimmed;
    }
    function clearStatusTimeout() {
      if (pageActions2.timeout) {
        clearTimeout(pageActions2.timeout);
        pageActions2.timeout = null;
      }
    }
    function showPageActionStatus2(text, kind = "info", timeout = 2500) {
      ensurePageActions2();
      positionPageActions(determinePageContext2());
      if (!pageActions2.status) return;
      if (pageActions2.container) {
        delete pageActions2.container.dataset.hidden;
        expandPageActions({ pinned: true });
      }
      if (pageActions2.panel) {
        pageActions2.panel.dataset.statusVisible = "1";
      }
      if (pageActions2.info) {
        pageActions2.info.dataset.dimmed = "1";
      }
      pageActions2.status.textContent = text;
      pageActions2.status.dataset.kind = kind;
      pageActions2.status.dataset.visible = "1";
      clearStatusTimeout();
      if (timeout && timeout > 0) {
        pageActions2.timeout = window.setTimeout(() => {
          if (pageActions2.status) {
            pageActions2.status.dataset.visible = "0";
            pageActions2.status.textContent = "";
          }
          if (pageActions2.panel) {
            pageActions2.panel.dataset.statusVisible = "0";
          }
          if (pageActions2.info) {
            delete pageActions2.info.dataset.dimmed;
          }
          if (pageActions2.container) {
            delete pageActions2.container.dataset.pinned;
          }
          pageActions2.timeout = null;
          updatePageActionInfo(determinePageContext2(), lastCapabilities);
          scheduleCollapsePageActions2(320);
        }, timeout);
      }
    }
    function clearPageActionStatus2({ collapse = false } = {}) {
      ensurePageActions2();
      clearStatusTimeout();
      if (pageActions2.status) {
        pageActions2.status.dataset.visible = "0";
        pageActions2.status.textContent = "";
        delete pageActions2.status.dataset.kind;
      }
      if (pageActions2.panel) {
        pageActions2.panel.dataset.statusVisible = "0";
      }
      if (pageActions2.info) {
        delete pageActions2.info.dataset.dimmed;
      }
      if (collapse) {
        if (pageActions2.container) {
          delete pageActions2.container.dataset.pinned;
        }
        if (determinePageContext2() === "watch") {
          collapsePageActions({ force: true });
        } else {
          scheduleCollapsePageActions2(DEFAULT_COLLAPSE_DELAY);
        }
      }
    }
    function setCollectingAllState2(active) {
      pageActions2.collectingAll = Boolean(active);
      if (pageActions2.container) {
        if (pageActions2.collectingAll) {
          pageActions2.container.dataset.collecting = "1";
        } else {
          delete pageActions2.container.dataset.collecting;
        }
      }
      if (pageActions2.stop) {
        if (pageActions2.collectingAll) {
          pageActions2.stop.hidden = false;
          pageActions2.stop.disabled = false;
        } else {
          pageActions2.stop.hidden = true;
          pageActions2.stop.disabled = false;
        }
      }
    }
    function updatePageActions2() {
      const context = determinePageContext2();
      const caps = getContextCapabilities2(context);
      const controlling = Boolean(state2.controlsActive);
      const statusVisible = pageActions2.status?.dataset.visible === "1";
      const showAddCurrentAction = context !== "watch" && caps.canAddCurrent;
      if (pageActions2.container) {
        positionPageActions(context);
        if (context === "watch") {
          if (showAddCurrentAction || statusVisible) {
            pageActions2.container.dataset.expanded = "1";
          } else {
            pageActions2.container.dataset.expanded = "0";
          }
        }
      }
      updatePageActionInfo(context, caps);
      if (context === lastPageContext && pageActions2.container && caps.canAddCurrent === lastCapabilities.canAddCurrent && caps.canAddVisible === lastCapabilities.canAddVisible && caps.canAddAll === lastCapabilities.canAddAll && controlling === lastCapabilities.controlling) {
        return;
      }
      lastPageContext = context;
      lastCapabilities = {
        canAddCurrent: caps.canAddCurrent,
        canAddVisible: caps.canAddVisible,
        canAddAll: caps.canAddAll,
        controlling
      };
      const infoVisible = pageActions2.info?.dataset.visible === "1";
      const hasActions = showAddCurrentAction || caps.canAddVisible || caps.canAddAll;
      if (!hasActions && !statusVisible && !infoVisible) {
        hidePageActions();
        return;
      }
      ensurePageActions2();
      if (!pageActions2.container) return;
      positionPageActions(context);
      delete pageActions2.container.dataset.hidden;
      if (pageActions2.toggle) {
        pageActions2.toggle.hidden = context === "watch";
      }
      if (pageActions2.addCurrent) {
        pageActions2.addCurrent.hidden = !showAddCurrentAction;
      }
      if (pageActions2.addVisible) {
        pageActions2.addVisible.hidden = !caps.canAddVisible;
      }
      if (pageActions2.addAll) {
        pageActions2.addAll.hidden = !caps.canAddAll;
      }
      const visibleButtons = [
        pageActions2.addCurrent,
        pageActions2.addVisible,
        pageActions2.addAll
      ].filter((btn) => btn && !btn.hidden);
      if (!visibleButtons.length && !statusVisible && !infoVisible) {
        pageActions2.container.dataset.hidden = "1";
      } else {
        delete pageActions2.container.dataset.hidden;
      }
      if (!statusVisible && !visibleButtons.length) {
        collapsePageActions({ force: true });
      }
    }
    return {
      clearPageActionStatus: clearPageActionStatus2,
      ensurePageActions: ensurePageActions2,
      scheduleCollapsePageActions: scheduleCollapsePageActions2,
      setCollectingAllState: setCollectingAllState2,
      showPageActionStatus: showPageActionStatus2,
      updatePageActions: updatePageActions2
    };
  }

  // src/content/page-actions/index.js
  var ACTION_DEFINITIONS = [
    { key: "addCurrent", label: "\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u0432 \u043F\u043B\u0435\u0439\u043B\u0438\u0441\u0442", handler: handleAddCurrentFromPage },
    { key: "addVisible", label: "\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u0432\u0438\u0434\u0438\u043C\u044B\u0435", handler: handleAddVisibleFromPage },
    {
      key: "addAll",
      label: "\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u0432\u0441\u0435 \u043D\u0430 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0435",
      handler: handleAddAllFromPage
    }
  ];
  var pageActionView = createPageActionViewController({
    determinePageContext,
    getContextCapabilities,
    getCurrentVideoId,
    inlinePlaylistState,
    pageActions,
    state,
    actionDefinitions: ACTION_DEFINITIONS,
    cancelAddAllFromPage
  });
  var {
    clearPageActionStatus,
    ensurePageActions,
    scheduleCollapsePageActions,
    setCollectingAllState
  } = pageActionView;
  var showPageActionStatus = pageActionView.showPageActionStatus;
  var updatePageActions = pageActionView.updatePageActions;
  function cancelAddAllFromPage(options = {}) {
    if (!pageActions.collectingAll) return false;
    const { silent = false } = options || {};
    if (pageActions.stop) {
      pageActions.stop.disabled = true;
    }
    if (!pageActions.cancelRequested) {
      pageActions.cancelRequested = true;
      if (!silent) {
        showPageActionStatus("\u041E\u0441\u0442\u0430\u043D\u0430\u0432\u043B\u0438\u0432\u0430\u044E...", "info", 0);
      }
    }
    if (pageActions.collectAbort) {
      try {
        pageActions.collectAbort.abort();
      } catch (err) {
        console.warn("Failed to abort collection", err);
      }
    }
    return true;
  }
  async function syncPlaybackAfterManualAdd(videoId) {
    if (!videoId) {
      return false;
    }
    const video = state.videoElement || document.querySelector("video");
    const isPlayingInTab = Boolean(video && !video.paused && !video.ended);
    if (!isPlayingInTab) {
      return false;
    }
    state.currentVideoId = videoId;
    try {
      const response = await sendMessage("player:videoStarted", { videoId });
      if (response && typeof response.controlled === "boolean") {
        const controlled = Boolean(response.controlled);
        setControlsActive(controlled);
        if (controlled) {
          return true;
        }
      }
    } catch (err) {
      console.warn("Failed to synchronize playback state", err);
    }
    return false;
  }
  async function addVideoIds(videoIds, options = {}) {
    const {
      scopeLabel = "",
      alreadyMessage = "",
      fallbackRequested = Array.isArray(videoIds) ? videoIds.length : null
    } = options;
    const safeIds = Array.isArray(videoIds) ? videoIds : [];
    const payload = {
      videoIds: safeIds
    };
    if (inlinePlaylistState.currentListId) {
      payload.listId = inlinePlaylistState.currentListId;
    }
    const response = await sendMessage("playlist:addByIds", payload);
    const { state: presentation, requested, missing, added } = normalizeAddResponse(
      response
    );
    if (presentation && typeof presentation === "object") {
      updateInlinePlaylistState(presentation);
    } else {
      await refreshInlinePlaylistState();
    }
    const totalRequested = requested ?? (Number.isInteger(fallbackRequested) ? fallbackRequested : 0);
    const summary = formatAddResultMessage({
      added,
      requested: totalRequested,
      missing,
      scopeLabel,
      alreadyMessage
    });
    return { added, missing, summary };
  }
  async function handleAddCurrentFromPage() {
    const caps = getContextCapabilities();
    if (!caps.canAddCurrent) return;
    ensurePageActions();
    clearPageActionStatus({ collapse: true });
    if (pageActions.addCurrent) pageActions.addCurrent.disabled = true;
    const controlsButton = playerControls && typeof playerControls === "object" ? playerControls.addCurrent : null;
    if (controlsButton) {
      controlsButton.disabled = true;
      controlsButton.dataset.loading = "1";
    }
    try {
      const videoId = getCurrentVideoId();
      if (!videoId) {
        showPageActionStatus("\u0412\u0438\u0434\u0435\u043E \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u043E", "error", 3200);
        return;
      }
      state.currentVideoId = videoId;
      const { added, missing, summary } = await addVideoIds([videoId], {
        alreadyMessage: "\u0412\u0438\u0434\u0435\u043E \u0443\u0436\u0435 \u0432 \u043F\u043B\u0435\u0439\u043B\u0438\u0441\u0442\u0435",
        fallbackRequested: 1
      });
      if (added > 0 && missing === 0) {
        clearPageActionStatus({ collapse: true });
      } else {
        showPageActionStatus(summary.message, summary.kind, 3400);
      }
      await syncPlaybackAfterManualAdd(videoId);
    } catch (err) {
      console.error("Failed to add current video", err);
      showPageActionStatus("\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0434\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u0432\u0438\u0434\u0435\u043E", "error", 3500);
    } finally {
      if (pageActions.addCurrent) pageActions.addCurrent.disabled = false;
      if (controlsButton) {
        delete controlsButton.dataset.loading;
      }
      updatePageActions();
      updatePlayerControlsUI();
    }
  }
  async function handleAddVisibleFromPage() {
    const caps = getContextCapabilities();
    if (!caps.canAddVisible) return;
    ensurePageActions();
    if (pageActions.addVisible) pageActions.addVisible.disabled = true;
    try {
      const collected = collectVisibleVideoIds({ includeCurrent: false });
      const uniqueIds = Array.from(new Set(collected));
      if (!uniqueIds.length) {
        showPageActionStatus("\u0412\u0438\u0434\u0435\u043E \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u044B", "error", 3200);
        return;
      }
      showPageActionStatus(`\u0414\u043E\u0431\u0430\u0432\u043B\u044F\u044E ${uniqueIds.length} \u0432\u0438\u0434\u0435\u043E...`, "info", 0);
      const { summary } = await addVideoIds(uniqueIds, {
        scopeLabel: "\u0432\u0438\u0434\u0438\u043C\u044B\u0435 \u0432\u0438\u0434\u0435\u043E",
        fallbackRequested: uniqueIds.length
      });
      showPageActionStatus(summary.message, summary.kind, 3400);
    } catch (err) {
      console.error("Failed to add visible videos", err);
      showPageActionStatus("\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0434\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u0432\u0438\u0434\u0435\u043E", "error", 3500);
    } finally {
      if (pageActions.addVisible) pageActions.addVisible.disabled = false;
      updatePageActions();
    }
  }
  async function handleAddAllFromPage() {
    const caps = getContextCapabilities();
    if (!caps.canAddAll) return;
    ensurePageActions();
    if (pageActions.addAll) pageActions.addAll.disabled = true;
    pageActions.cancelRequested = false;
    const controller = new AbortController();
    pageActions.collectAbort = controller;
    setCollectingAllState(true);
    try {
      let reportedTotal = -1;
      showPageActionStatus("\u0421\u043E\u0431\u0438\u0440\u0430\u044E \u0432\u0438\u0434\u0435\u043E...", "info", 0);
      const collected = await collectPageVideosWithContinuation({
        signal: controller.signal,
        shouldStop: () => pageActions.cancelRequested,
        onProgress: ({ total }) => {
          if (pageActions.cancelRequested) return;
          if (total !== reportedTotal) {
            reportedTotal = total;
            showPageActionStatus(`\u0421\u043E\u0431\u0440\u0430\u043D\u043E ${total} \u0432\u0438\u0434\u0435\u043E...`, "info", 0);
          }
        }
      });
      const videoIds = Array.isArray(collected?.videoIds) ? collected.videoIds : Array.isArray(collected) ? collected : [];
      const uniqueIds = Array.from(new Set(videoIds));
      const aborted = Boolean(collected?.aborted || pageActions.cancelRequested);
      if (!uniqueIds.length) {
        const message = aborted ? "\u0421\u0431\u043E\u0440 \u043E\u0441\u0442\u0430\u043D\u043E\u0432\u043B\u0435\u043D. \u0412\u0438\u0434\u0435\u043E \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u044B" : "\u0412\u0438\u0434\u0435\u043E \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u044B";
        showPageActionStatus(message, aborted ? "info" : "error", 3200);
        return;
      }
      showPageActionStatus(
        aborted ? `\u0421\u0431\u043E\u0440 \u043E\u0441\u0442\u0430\u043D\u043E\u0432\u043B\u0435\u043D, \u0434\u043E\u0431\u0430\u0432\u043B\u044F\u044E \u043D\u0430\u0439\u0434\u0435\u043D\u043D\u044B\u0435 ${uniqueIds.length} \u0432\u0438\u0434\u0435\u043E...` : `\u0414\u043E\u0431\u0430\u0432\u043B\u044F\u044E ${uniqueIds.length} \u0432\u0438\u0434\u0435\u043E...`,
        "info",
        0
      );
      if (pageActions.stop) {
        pageActions.stop.disabled = true;
      }
      pageActions.collectAbort = null;
      const { summary } = await addVideoIds(uniqueIds, {
        scopeLabel: aborted ? "\u043D\u0430\u0439\u0434\u0435\u043D\u043D\u044B\u0435 \u0432\u0438\u0434\u0435\u043E" : "\u0432\u0438\u0434\u0435\u043E \u043D\u0430 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0435",
        fallbackRequested: uniqueIds.length
      });
      const finalMessage = aborted ? `\u0421\u0431\u043E\u0440 \u043E\u0441\u0442\u0430\u043D\u043E\u0432\u043B\u0435\u043D. ${summary.message}` : summary.message;
      showPageActionStatus(finalMessage, summary.kind, 3600);
    } catch (err) {
      console.error("Failed to add page videos", err);
      showPageActionStatus("\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0434\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u0432\u0438\u0434\u0435\u043E", "error", 3500);
    } finally {
      pageActions.collectAbort = null;
      const wasCollecting = pageActions.collectingAll;
      setCollectingAllState(false);
      pageActions.cancelRequested = false;
      if (pageActions.addAll) pageActions.addAll.disabled = false;
      if (wasCollecting) {
        scheduleCollapsePageActions(340);
      }
      updatePageActions();
    }
  }

  // src/content/playback/controlsView.js
  function destroyPlayerControls() {
    if (playerControls.observer) {
      playerControls.observer.disconnect();
      playerControls.observer = null;
    }
    playerControls.host = null;
    if (!playerControls.container) return;
    playerControls.container.remove();
    playerControls.container = null;
    playerControls.prev = null;
    playerControls.next = null;
    playerControls.postpone = null;
    playerControls.start = null;
    playerControls.addCurrent = null;
  }
  function syncPlayerControlsVisibility(host) {
    if (!playerControls.container) return;
    const hide = host?.classList?.contains("ytp-autohide");
    playerControls.container.dataset.hidden = hide ? "1" : "0";
  }
  function observePlayerHost(host) {
    if (!host || playerControls.host === host) {
      syncPlayerControlsVisibility(host || playerControls.host);
      return;
    }
    if (playerControls.observer) {
      playerControls.observer.disconnect();
      playerControls.observer = null;
    }
    playerControls.host = host;
    const observer2 = new MutationObserver(() => {
      syncPlayerControlsVisibility(host);
    });
    observer2.observe(host, { attributes: true, attributeFilter: ["class"] });
    playerControls.observer = observer2;
    syncPlayerControlsVisibility(host);
  }
  function resolvePlayerHost() {
    return document.querySelector("#movie_player.html5-video-player") || document.querySelector(".html5-video-player");
  }
  function bindAddCurrentButton(addCurrentBtn, context) {
    addCurrentBtn.addEventListener("click", (event) => {
      event.preventDefault();
      if (addCurrentBtn.disabled || addCurrentBtn.dataset.loading === "1") {
        return;
      }
      addCurrentBtn.disabled = true;
      addCurrentBtn.dataset.loading = "1";
      const finalize = () => {
        delete addCurrentBtn.dataset.loading;
        updatePlayerControlsUI2(context);
      };
      try {
        const result = typeof context.handleAddCurrentFromPage === "function" ? context.handleAddCurrentFromPage() : null;
        if (result && typeof result.finally === "function") {
          result.finally(finalize);
        } else if (result && typeof result.then === "function") {
          result.then(finalize).catch(finalize);
        } else {
          finalize();
        }
      } catch (_) {
        finalize();
      }
    });
  }
  function createPlayerControls(host, context) {
    const container = document.createElement("div");
    container.className = "yta-player-controls";
    const topRow = document.createElement("div");
    topRow.className = "yta-player-controls__row yta-player-controls__row--top";
    const bottomRow = document.createElement("div");
    bottomRow.className = "yta-player-controls__row yta-player-controls__row--bottom";
    const startBtn = document.createElement("button");
    startBtn.type = "button";
    startBtn.className = "ytp-button yta-player-controls__start";
    startBtn.textContent = "\u25B6 \u041F\u043B\u0435\u0439\u043B\u0438\u0441\u0442";
    startBtn.title = "\u0417\u0430\u043F\u0443\u0441\u0442\u0438\u0442\u044C \u043F\u043B\u0435\u0439\u043B\u0438\u0441\u0442";
    startBtn.setAttribute("aria-label", "\u0417\u0430\u043F\u0443\u0441\u0442\u0438\u0442\u044C \u043F\u043B\u0435\u0439\u043B\u0438\u0441\u0442");
    startBtn.addEventListener("click", (event) => {
      event.preventDefault();
      context.requestStartPlayback?.();
    });
    const addCurrentBtn = document.createElement("button");
    addCurrentBtn.type = "button";
    addCurrentBtn.className = "yta-player-controls__add";
    addCurrentBtn.textContent = "\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u0432 \u043F\u043B\u0435\u0439\u043B\u0438\u0441\u0442";
    addCurrentBtn.title = "\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u0442\u0435\u043A\u0443\u0449\u0435\u0435 \u0432\u0438\u0434\u0435\u043E \u0432 \u043F\u043B\u0435\u0439\u043B\u0438\u0441\u0442";
    addCurrentBtn.setAttribute(
      "aria-label",
      "\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u0442\u0435\u043A\u0443\u0449\u0435\u0435 \u0432\u0438\u0434\u0435\u043E \u0432 \u043F\u043B\u0435\u0439\u043B\u0438\u0441\u0442"
    );
    addCurrentBtn.hidden = true;
    bindAddCurrentButton(addCurrentBtn, context);
    const postponeBtn = document.createElement("button");
    postponeBtn.type = "button";
    postponeBtn.className = "ytp-button yta-player-controls__postpone";
    postponeBtn.title = "\u041E\u0442\u043B\u043E\u0436\u0438\u0442\u044C (\u043E\u0441\u0442\u0430\u0432\u0438\u0442\u044C \u0432 \u043E\u0447\u0435\u0440\u0435\u0434\u0438)";
    postponeBtn.setAttribute(
      "aria-label",
      "\u041E\u0442\u043B\u043E\u0436\u0438\u0442\u044C \u0442\u0435\u043A\u0443\u0449\u0435\u0435 \u0432\u0438\u0434\u0435\u043E \u0438 \u043E\u0441\u0442\u0430\u0432\u0438\u0442\u044C \u0432 \u043E\u0447\u0435\u0440\u0435\u0434\u0438"
    );
    const postponeIcon = document.createElement("span");
    postponeIcon.className = "yta-player-controls__postpone-icon";
    postponeIcon.textContent = "\u21B7";
    const postponeLabel = document.createElement("span");
    postponeLabel.textContent = "\u041E\u0442\u043B\u043E\u0436\u0438\u0442\u044C";
    postponeBtn.append(postponeIcon, postponeLabel);
    postponeBtn.addEventListener("click", (event) => {
      event.preventDefault();
      context.requestPostpone?.();
    });
    const prevBtn = document.createElement("button");
    prevBtn.type = "button";
    prevBtn.className = "ytp-button";
    prevBtn.textContent = "\u23EE";
    prevBtn.title = "\u041F\u0440\u0435\u0434\u044B\u0434\u0443\u0449\u0435\u0435";
    prevBtn.setAttribute("aria-label", "\u041F\u0440\u0435\u0434\u044B\u0434\u0443\u0449\u0435\u0435 \u0432\u0438\u0434\u0435\u043E");
    prevBtn.addEventListener("click", (event) => {
      event.preventDefault();
      context.requestPrevious?.();
    });
    const nextBtn = document.createElement("button");
    nextBtn.type = "button";
    nextBtn.className = "ytp-button";
    nextBtn.textContent = "\u23ED";
    nextBtn.title = "\u0421\u043B\u0435\u0434\u0443\u044E\u0449\u0435\u0435";
    nextBtn.setAttribute("aria-label", "\u0421\u043B\u0435\u0434\u0443\u044E\u0449\u0435\u0435 \u0432\u0438\u0434\u0435\u043E");
    nextBtn.addEventListener("click", (event) => {
      event.preventDefault();
      context.requestNext?.();
    });
    topRow.append(addCurrentBtn);
    bottomRow.append(startBtn, postponeBtn, prevBtn, nextBtn);
    container.append(topRow, bottomRow);
    host.appendChild(container);
    playerControls.container = container;
    playerControls.start = startBtn;
    playerControls.postpone = postponeBtn;
    playerControls.prev = prevBtn;
    playerControls.next = nextBtn;
    playerControls.addCurrent = addCurrentBtn;
  }
  function ensurePlayerControls(context = {}) {
    if (determinePageContext() !== "watch") {
      destroyPlayerControls();
      return;
    }
    const host = resolvePlayerHost();
    if (!host) {
      destroyPlayerControls();
      return;
    }
    if (!playerControls.container) {
      createPlayerControls(host, context);
    }
    observePlayerHost(host);
    updatePlayerControlsUI2(context);
  }
  function updatePlayerControlsUI2(context = {}) {
    const queueIds = inlinePlaylistState.orderedVideoIds || [];
    const queueLength = queueIds.length;
    const currentId = getCurrentVideoId();
    const inQueueIndex = currentId && inlinePlaylistState.indexById.has(currentId) ? inlinePlaylistState.indexById.get(currentId) : -1;
    const hasQueue = queueLength > 0;
    const videoInQueue = inQueueIndex !== -1;
    const listFrozen = Boolean(inlinePlaylistState.freeze);
    const historyAvailable = typeof inlinePlaylistState.historyLength === "number" && inlinePlaylistState.historyLength > 0;
    const queueHasPrevious = typeof inlinePlaylistState.currentIndex === "number" && inlinePlaylistState.currentIndex > 0;
    const hasPrev = videoInQueue && (historyAvailable || queueHasPrevious);
    const hasNext = videoInQueue && queueLength > 1;
    const shouldShowStart = hasQueue && !videoInQueue;
    const controlsAvailable = canHandlePlaybackActions();
    if (playerControls.addCurrent) {
      const caps = getContextCapabilities("watch");
      const canAdd = Boolean(caps?.canAddCurrent);
      const loading = playerControls.addCurrent.dataset.loading === "1";
      playerControls.addCurrent.hidden = !canAdd;
      playerControls.addCurrent.disabled = !canAdd || loading;
    }
    if (playerControls.start) {
      playerControls.start.hidden = !shouldShowStart;
      playerControls.start.disabled = !hasQueue;
    }
    if (playerControls.prev) {
      playerControls.prev.hidden = !videoInQueue || !hasPrev;
      playerControls.prev.disabled = !controlsAvailable || !hasPrev;
    }
    if (playerControls.next) {
      const showNext = videoInQueue && queueLength > 1;
      playerControls.next.hidden = !showNext;
      playerControls.next.disabled = !controlsAvailable || !showNext;
    }
    if (playerControls.postpone) {
      const showPostpone = videoInQueue && queueLength > 1 && !listFrozen;
      playerControls.postpone.hidden = !showPostpone;
      playerControls.postpone.disabled = !controlsAvailable || !showPostpone;
    }
    if (playerControls.container) {
      playerControls.container.dataset.mode = shouldShowStart ? "start" : "queue";
      const host = resolvePlayerHost();
      if (host && playerControls.container.parentElement !== host) {
        playerControls.container.remove();
        host.appendChild(playerControls.container);
      }
      if (host) {
        observePlayerHost(host);
      }
    }
  }

  // src/content/playback/notification.js
  var PLAYBACK_NOTIFICATION_DURATION = 8e3;
  function ensurePlaybackNotificationElements() {
    if (playbackNotification.container) {
      if (!document.contains(playbackNotification.container)) {
        document.body.appendChild(playbackNotification.container);
      }
      return playbackNotification.container;
    }
    if (!document.body) {
      return null;
    }
    const container = document.createElement("div");
    container.className = "yta-playback-notification";
    container.setAttribute("role", "status");
    container.setAttribute("aria-live", "polite");
    const content = document.createElement("div");
    content.className = "yta-playback-notification__content";
    const title = document.createElement("div");
    title.className = "yta-playback-notification__title";
    const body = document.createElement("div");
    body.className = "yta-playback-notification__body";
    content.append(title, body);
    container.append(content);
    container.addEventListener("click", () => hidePlaybackNotification(true));
    document.body.appendChild(container);
    playbackNotification.container = container;
    playbackNotification.title = title;
    playbackNotification.body = body;
    return container;
  }
  function hidePlaybackNotification(immediate = false) {
    if (playbackNotification.timeout) {
      window.clearTimeout(playbackNotification.timeout);
      playbackNotification.timeout = null;
    }
    const container = playbackNotification.container;
    if (!container) {
      return;
    }
    container.dataset.visible = "0";
    const teardown = () => {
      if (playbackNotification.container === container) {
        container.remove();
        playbackNotification.container = null;
        playbackNotification.title = null;
        playbackNotification.body = null;
      }
    };
    if (immediate) {
      teardown();
    } else {
      window.setTimeout(teardown, 250);
    }
  }
  function showPlaybackNotification({ title, body, duration, persist } = {}) {
    if (determinePageContext() !== "watch") {
      return;
    }
    const container = ensurePlaybackNotificationElements();
    if (!container) {
      return;
    }
    const resolvedTitle = title && String(title).trim() ? String(title).trim() : "\u0421\u043F\u0438\u0441\u043E\u043A \u0437\u0430\u043A\u043E\u043D\u0447\u0438\u043B\u0441\u044F";
    const resolvedBody = body && String(body).trim() ? String(body).trim() : "\u041E\u0447\u0435\u0440\u0435\u0434\u044C \u043F\u0443\u0441\u0442\u0430\u044F";
    if (playbackNotification.title) {
      playbackNotification.title.textContent = resolvedTitle;
    }
    if (playbackNotification.body) {
      playbackNotification.body.textContent = resolvedBody;
    }
    container.dataset.visible = "1";
    if (playbackNotification.timeout) {
      window.clearTimeout(playbackNotification.timeout);
    }
    if (persist) {
      playbackNotification.timeout = null;
      return;
    }
    const timeout = Math.max(2e3, Number(duration) || PLAYBACK_NOTIFICATION_DURATION);
    playbackNotification.timeout = window.setTimeout(() => {
      hidePlaybackNotification();
    }, timeout);
  }

  // src/content/playback/errorMonitoring.js
  var playerErrorObserverState = {
    observer: null,
    host: null
  };
  var playerErrorEventsBound = false;
  function extractPlayerErrorMessage(details) {
    if (!details) {
      return "";
    }
    if (typeof details === "string") {
      return details;
    }
    if (typeof details.message === "string" && details.message.trim()) {
      return details.message;
    }
    if (typeof details.errorMessage === "string" && details.errorMessage.trim()) {
      return details.errorMessage;
    }
    if (typeof details.reason === "string" && details.reason.trim()) {
      return details.reason;
    }
    if (typeof details.status === "string" && details.status.trim()) {
      return details.status;
    }
    if (typeof details.errorCode === "string" && details.errorCode.trim()) {
      return details.errorCode;
    }
    if (typeof details.data === "object" && details.data !== null) {
      return extractPlayerErrorMessage(details.data);
    }
    return "";
  }
  function readPlayerResponseCandidates() {
    const candidates = [];
    if (window.ytInitialPlayerResponse && typeof window.ytInitialPlayerResponse === "object") {
      candidates.push(window.ytInitialPlayerResponse);
    }
    const rawResponse = window.ytplayer?.config?.args?.player_response;
    if (rawResponse) {
      if (typeof rawResponse === "object") {
        candidates.push(rawResponse);
      } else if (typeof rawResponse === "string") {
        try {
          const parsed = JSON.parse(rawResponse);
          if (parsed && typeof parsed === "object") {
            candidates.push(parsed);
          }
        } catch (_) {
        }
      }
    }
    return candidates;
  }
  function extractPlayabilityIssue() {
    const responses = readPlayerResponseCandidates();
    for (const response of responses) {
      const status = String(response?.playabilityStatus?.status || "").trim();
      if (!status || status === "OK") {
        continue;
      }
      const reason = response?.playabilityStatus?.reason || response?.playabilityStatus?.errorScreen?.playerErrorMessage?.simpleText || response?.playabilityStatus?.messages?.[0] || status;
      return { status, reason };
    }
    return null;
  }
  function isElementVisible(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) {
      return false;
    }
    if (element.hasAttribute("hidden")) {
      return false;
    }
    const style = window.getComputedStyle(element);
    if (!style || style.display === "none" || style.visibility === "hidden") {
      return false;
    }
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }
  function detectUnavailableWatchState(context = {}) {
    const run = () => {
      if (determinePageContext() !== "watch") {
        return false;
      }
      const playabilityIssue = extractPlayabilityIssue();
      if (playabilityIssue) {
        handleVideoUnavailable(
          { reason: playabilityIssue.reason || playabilityIssue.status },
          context
        );
        return true;
      }
      const host = document.querySelector("ytd-watch-flexy");
      if (host && host.hasAttribute("player-unavailable")) {
        const reason = host.getAttribute("player-unavailable") || "";
        const message = host.getAttribute("player-error-message") || reason;
        if (message && message.trim()) {
          handleVideoUnavailable({ reason: message }, context);
          return true;
        }
      }
      const offlineSlate = document.querySelector(".ytp-offline-slate");
      if (offlineSlate && isElementVisible(offlineSlate)) {
        const mainTextElement = offlineSlate.querySelector(
          ".ytp-offline-slate-main-text"
        );
        const subtitleTextElement = offlineSlate.querySelector(
          ".ytp-offline-slate-subtitle-text"
        );
        const mainText = (mainTextElement?.textContent || mainTextElement?.getAttribute("aria-label") || "").trim();
        const subtitleText = (subtitleTextElement?.textContent || subtitleTextElement?.getAttribute("aria-label") || "").trim();
        handleVideoUnavailable({
          reason: [mainText, subtitleText].filter(Boolean).join(". ") || "OFFLINE_SLATE"
        }, context);
        return true;
      }
      const promo = document.querySelector("ytd-background-promo-renderer");
      if (promo && isElementVisible(promo)) {
        const title = promo.querySelector(".promo-title");
        const body = promo.querySelector(".promo-body-text");
        const text = body && body.textContent && body.textContent.trim() || title && title.textContent && title.textContent.trim() || "";
        handleVideoUnavailable({ reason: text }, context);
        return true;
      }
      const errorRenderer = document.querySelector("ytd-player-error-message-renderer");
      if (errorRenderer && isElementVisible(errorRenderer)) {
        const text = errorRenderer.textContent ? errorRenderer.textContent.trim() : "";
        handleVideoUnavailable({ reason: text }, context);
        return true;
      }
      const playabilityError = document.querySelector(
        "yt-playability-error-supported-renderers"
      );
      if (playabilityError && isElementVisible(playabilityError)) {
        const text = playabilityError.textContent ? playabilityError.textContent.trim() : "";
        if (text) {
          handleVideoUnavailable({ reason: text }, context);
          return true;
        }
      }
      return false;
    };
    if (typeof ytaDiagMeasure === "function") {
      return ytaDiagMeasure("player.detectUnavailableWatchState", run);
    }
    return run();
  }
  function handleVideoUnavailable(details = {}, context = {}) {
    const videoId = getCurrentVideoId();
    if (!videoId) {
      return;
    }
    if (state.lastUnavailableVideoId === videoId) {
      return;
    }
    state.lastUnavailableVideoId = videoId;
    const reason = extractPlayerErrorMessage(details) || "";
    const trimmedReason = reason.trim();
    const body = trimmedReason ? `\u0412\u0438\u0434\u0435\u043E \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u043D\u043E (${trimmedReason}). \u041F\u0435\u0440\u0435\u0445\u043E\u0436\u0443 \u043A \u0441\u043B\u0435\u0434\u0443\u044E\u0449\u0435\u043C\u0443` : "\u0412\u0438\u0434\u0435\u043E \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u043D\u043E. \u041F\u0435\u0440\u0435\u0445\u043E\u0436\u0443 \u043A \u0441\u043B\u0435\u0434\u0443\u044E\u0449\u0435\u043C\u0443";
    showPlaybackNotification({
      title: "\u0412\u0438\u0434\u0435\u043E \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u043D\u043E",
      body,
      duration: 6e3
    });
    sendMessage("player:videoUnavailable", { videoId, reason: trimmedReason }).then(
      (resp) => {
        const result = context.handlePlaybackAdvanceResponse?.(resp, {
          origin: "auto",
          sourceVideoId: videoId
        });
        if (!result || result.handled === false) {
          context.setControlsActive?.(false);
        }
      }
    );
  }
  function teardownPlayerErrorObserver() {
    if (playerErrorObserverState.observer) {
      try {
        playerErrorObserverState.observer.disconnect();
      } catch (_) {
      }
    }
    playerErrorObserverState.observer = null;
    playerErrorObserverState.host = null;
  }
  function handlePlayerErrorMutation(target, context) {
    if (!target) {
      return;
    }
    if (detectUnavailableWatchState(context)) {
      return;
    }
    const message = target.getAttribute("player-error-message");
    if (message && message.trim()) {
      handleVideoUnavailable({ reason: message }, context);
    }
  }
  function ensurePlayerErrorObserver(context) {
    if (playerErrorObserverState.host && !document.contains(playerErrorObserverState.host)) {
      teardownPlayerErrorObserver();
    }
    const host = document.querySelector("ytd-watch-flexy");
    if (!host) {
      teardownPlayerErrorObserver();
      return;
    }
    if (playerErrorObserverState.host === host) {
      return;
    }
    teardownPlayerErrorObserver();
    const observer2 = new MutationObserver(() => {
      handlePlayerErrorMutation(host, context);
    });
    observer2.observe(host, {
      attributes: true,
      attributeFilter: ["player-error-message"]
    });
    playerErrorObserverState.observer = observer2;
    playerErrorObserverState.host = host;
    handlePlayerErrorMutation(host, context);
  }
  function ensurePlayerErrorEvents(context) {
    if (playerErrorEventsBound) {
      return;
    }
    const errorListener = (event) => {
      if (!event) return;
      handleVideoUnavailable(event.detail || event, context);
    };
    const pageDataListener = (event) => {
      const detail = event?.detail;
      if (!detail) {
        return;
      }
      const playerResponse = detail.pageData?.playerResponse || detail.playerResponse || detail.response?.playerResponse;
      if (!playerResponse) {
        return;
      }
      const status = playerResponse?.playabilityStatus?.status || "";
      if (!status || status === "OK") {
        return;
      }
      const reason = playerResponse.playabilityStatus?.reason || playerResponse.playabilityStatus?.errorScreen?.playerErrorMessage?.simpleText || status;
      handleVideoUnavailable({ reason }, context);
    };
    window.addEventListener("yt-player-error", errorListener, true);
    window.addEventListener("yt-page-data-updated", pageDataListener, true);
    playerErrorEventsBound = true;
  }
  function ensurePlayerErrorMonitoring(context = {}) {
    ensurePlayerErrorEvents(context);
    ensurePlayerErrorObserver(context);
  }

  // src/content/playback/queueEnd.js
  var VIDEO_END_MANUAL_ACTION_GUARD_MS = 2e3;
  var QUEUE_END_ANNOUNCE_WINDOW_MS = 45e3;
  var queueEndAnnouncement = {
    pending: false,
    queuedAt: 0,
    listId: null,
    listName: "",
    sourceVideoId: null,
    lastAnnouncedVideoId: null
  };
  var userActionTracker = {
    lastAt: 0,
    bound: false
  };
  function recordUserAction() {
    userActionTracker.lastAt = Date.now();
  }
  function ensureUserActionListeners() {
    if (userActionTracker.bound) {
      return;
    }
    document.addEventListener("pointerdown", recordUserAction, true);
    document.addEventListener("keydown", recordUserAction, true);
    userActionTracker.bound = true;
  }
  function hasRecentUserAction(windowMs = VIDEO_END_MANUAL_ACTION_GUARD_MS) {
    if (!userActionTracker.lastAt) {
      return false;
    }
    return Date.now() - userActionTracker.lastAt <= windowMs;
  }
  function isAutoplayEnabled() {
    const toggle = document.querySelector(".ytp-autonav-toggle-button");
    if (!toggle) {
      return false;
    }
    const ariaPressed = toggle.getAttribute("aria-pressed");
    if (ariaPressed === "true") {
      return true;
    }
    if (ariaPressed === "false") {
      return false;
    }
    const ariaChecked = toggle.getAttribute("aria-checked");
    if (ariaChecked === "true") {
      return true;
    }
    if (ariaChecked === "false") {
      return false;
    }
    if (toggle.classList.contains("ytp-autonav-toggle-button-on")) {
      return true;
    }
    if (toggle.classList.contains("ytp-autonav-toggle-button-off")) {
      return false;
    }
    const label = (toggle.getAttribute("aria-label") || "").toLowerCase();
    if (label.includes("\u0432\u043A\u043B\u044E\u0447") || label.includes("on")) {
      return true;
    }
    if (label.includes("\u0432\u044B\u043A\u043B\u044E\u0447") || label.includes("off")) {
      return false;
    }
    return false;
  }
  function clearQueueEndAnnouncement() {
    queueEndAnnouncement.pending = false;
    queueEndAnnouncement.queuedAt = 0;
    queueEndAnnouncement.listId = null;
    queueEndAnnouncement.listName = "";
    queueEndAnnouncement.sourceVideoId = null;
  }
  function queueQueueEndAnnouncement(presentation, options = {}) {
    if (!presentation || typeof presentation !== "object") {
      return false;
    }
    if (options.origin !== "auto") {
      return false;
    }
    const queue = Array.isArray(presentation?.currentQueue?.queue) ? presentation.currentQueue.queue : [];
    if (queue.length > 0) {
      return false;
    }
    if (presentation.currentVideoId) {
      return false;
    }
    const sourceVideoId = typeof options.sourceVideoId === "string" ? options.sourceVideoId : null;
    if (sourceVideoId) {
      const wasInList = inlinePlaylistState.videoIds?.has(sourceVideoId) || inlinePlaylistState.currentVideoId === sourceVideoId;
      if (!wasInList) {
        return false;
      }
    }
    queueEndAnnouncement.pending = true;
    queueEndAnnouncement.queuedAt = Date.now();
    queueEndAnnouncement.listId = presentation?.currentQueue?.id || presentation?.currentListId || null;
    queueEndAnnouncement.listName = typeof presentation?.currentQueue?.name === "string" ? presentation.currentQueue.name.trim() : "";
    queueEndAnnouncement.sourceVideoId = sourceVideoId;
    return true;
  }
  function shouldShowQueueEndAnnouncement(videoId) {
    if (!queueEndAnnouncement.pending || !videoId) {
      return false;
    }
    if (queueEndAnnouncement.lastAnnouncedVideoId === videoId) {
      return false;
    }
    const now = Date.now();
    if (queueEndAnnouncement.queuedAt && now - queueEndAnnouncement.queuedAt > QUEUE_END_ANNOUNCE_WINDOW_MS) {
      clearQueueEndAnnouncement();
      return false;
    }
    if (userActionTracker.lastAt >= queueEndAnnouncement.queuedAt) {
      clearQueueEndAnnouncement();
      return false;
    }
    if (!isAutoplayEnabled()) {
      clearQueueEndAnnouncement();
      return false;
    }
    const inQueue = inlinePlaylistState.videoIds?.has(videoId) || inlinePlaylistState.currentVideoId === videoId;
    if (inQueue) {
      return false;
    }
    return true;
  }
  function maybeShowQueueEndAnnouncement(videoId) {
    if (!shouldShowQueueEndAnnouncement(videoId)) {
      return false;
    }
    const body = queueEndAnnouncement.listName ? `\u041E\u0447\u0435\u0440\u0435\u0434\u044C \xAB${queueEndAnnouncement.listName}\xBB \u043F\u0443\u0441\u0442\u0430\u044F` : queueEndAnnouncement.listId && queueEndAnnouncement.listId !== DEFAULT_LIST_ID ? "\u0414\u043E\u043F\u043E\u043B\u043D\u0438\u0442\u0435\u043B\u044C\u043D\u044B\u0439 \u0441\u043F\u0438\u0441\u043E\u043A \u043F\u0443\u0441\u0442\u043E\u0439" : "\u041E\u0447\u0435\u0440\u0435\u0434\u044C \u043F\u0443\u0441\u0442\u0430\u044F";
    showPlaybackNotification({
      title: "\u0421\u043F\u0438\u0441\u043E\u043A \u0437\u0430\u043A\u043E\u043D\u0447\u0438\u043B\u0441\u044F",
      body,
      duration: 6e3
    });
    queueEndAnnouncement.lastAnnouncedVideoId = videoId;
    clearQueueEndAnnouncement();
    return true;
  }

  // src/content/playback/actions.js
  function requestNext(context = {}) {
    if (!canHandlePlaybackActions()) return;
    const videoId = getCurrentVideoId();
    recordUserAction();
    clearQueueEndAnnouncement();
    sendMessage("player:requestNext", { videoId }).then(
      (resp) => context.handlePlaybackAdvanceResponse?.(resp, {
        origin: "manual",
        sourceVideoId: videoId
      })
    );
  }
  function requestPrevious() {
    if (!canHandlePlaybackActions()) return;
    recordUserAction();
    clearQueueEndAnnouncement();
    sendMessage("player:requestPrevious", {
      videoId: getCurrentVideoId()
    });
  }
  function requestPostpone(context = {}) {
    if (!canHandlePlaybackActions()) return;
    const videoId = getCurrentVideoId();
    recordUserAction();
    clearQueueEndAnnouncement();
    sendMessage("player:requestPostpone", { videoId }).then(
      (resp) => context.handlePlaybackAdvanceResponse?.(resp, {
        origin: "manual",
        sourceVideoId: videoId
      })
    );
  }
  function requestStartPlayback(context = {}) {
    const queueIds = inlinePlaylistState.orderedVideoIds || [];
    if (!queueIds.length) return;
    const targetId = queueIds[0];
    if (!targetId) return;
    const payload = { videoId: targetId };
    if (inlinePlaylistState.currentListId) {
      payload.listId = inlinePlaylistState.currentListId;
    }
    recordUserAction();
    clearQueueEndAnnouncement();
    sendMessage("playlist:play", payload).then((presentation) => {
      if (presentation && typeof presentation === "object") {
        context.updateInlinePlaylistState?.(presentation);
      }
    });
  }
  function navigateToVideoId(videoId) {
    const targetId = parseVideoId(videoId);
    if (!targetId) {
      return false;
    }
    let targetUrl = null;
    try {
      const base = window.location.origin || "https://www.youtube.com";
      const url = new URL("/watch", base);
      url.searchParams.set("v", targetId);
      targetUrl = url.toString();
    } catch (err) {
      targetUrl = `https://www.youtube.com/watch?v=${targetId}`;
    }
    if (!targetUrl) {
      return false;
    }
    if (parseVideoId(window.location.href) === targetId) {
      return true;
    }
    if (window.location.href === targetUrl) {
      return true;
    }
    try {
      window.location.assign(targetUrl);
      return true;
    } catch (assignError) {
      try {
        window.location.href = targetUrl;
        return true;
      } catch (hrefError) {
        console.warn("Failed to navigate to next video", hrefError);
      }
    }
    return false;
  }
  function recoverVideoEnded(videoId, context = {}) {
    if (!videoId) {
      return { handled: true };
    }
    const orderedIds = Array.isArray(inlinePlaylistState.orderedVideoIds) ? inlinePlaylistState.orderedVideoIds : [];
    if (!orderedIds.length) {
      const presentation2 = {
        currentListId: inlinePlaylistState.currentListId || null,
        currentQueue: {
          id: inlinePlaylistState.currentListId || null,
          name: inlinePlaylistState.currentListName || "",
          freeze: Boolean(inlinePlaylistState.freeze),
          queue: [],
          currentIndex: null
        },
        currentVideoId: null,
        history: Array.from(
          { length: Math.max(Number(inlinePlaylistState.historyLength) || 0, 0) },
          () => ({ id: null })
        ),
        lists: Array.isArray(inlinePlaylistState.lists) ? inlinePlaylistState.lists.map((list) => ({ ...list })) : []
      };
      context.updateInlinePlaylistState?.(presentation2);
      queueQueueEndAnnouncement(presentation2, {
        origin: "auto",
        sourceVideoId: videoId
      });
      return { handled: false, state: presentation2 };
    }
    const listId = inlinePlaylistState.currentListId || null;
    if (!listId) {
      requestStartPlayback(context);
      return { handled: true };
    }
    const inQueue = orderedIds.includes(videoId);
    if (!inQueue) {
      requestStartPlayback(context);
      return { handled: true };
    }
    const knownCurrent = typeof inlinePlaylistState.currentVideoId === "string" ? inlinePlaylistState.currentVideoId : null;
    if (knownCurrent && knownCurrent !== videoId) {
      return { handled: true };
    }
    const queueEntries = Array.isArray(inlinePlaylistState.queueEntries) ? inlinePlaylistState.queueEntries : [];
    const remainingEntries = queueEntries.filter(
      (entry) => entry && entry.id && entry.id !== videoId
    );
    const remainingIds = orderedIds.filter((id) => id !== videoId);
    const previousIndex = orderedIds.indexOf(videoId);
    const nextIndex = remainingIds.length > 0 ? Math.min(previousIndex, remainingIds.length - 1) : null;
    const nextId = nextIndex !== null ? remainingIds[nextIndex] : null;
    const historyLength = Math.max(Number(inlinePlaylistState.historyLength) || 0, 0) + 1;
    const historyEntries = Array.from(
      { length: historyLength },
      (_, index) => index === 0 ? { id: videoId } : { id: null }
    );
    const presentation = {
      currentListId: listId,
      currentQueue: {
        id: listId,
        name: inlinePlaylistState.currentListName || "",
        freeze: Boolean(inlinePlaylistState.freeze),
        queue: remainingEntries,
        currentIndex: nextIndex
      },
      currentVideoId: nextId,
      history: historyEntries,
      lists: Array.isArray(inlinePlaylistState.lists) ? inlinePlaylistState.lists.map((list) => ({ ...list })) : []
    };
    context.updateInlinePlaylistState?.(presentation);
    if (nextId) {
      const navigated = navigateToVideoId(nextId);
      if (!navigated) {
        console.warn("Failed to locally advance playback after disconnect");
      }
      return { handled: true, state: presentation };
    }
    queueQueueEndAnnouncement(presentation, {
      origin: "auto",
      sourceVideoId: videoId
    });
    return { handled: false, state: presentation };
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
  function normalizeProgressPercent(entry) {
    const percent = clampProgressPercent(entry?.percent);
    return percent && percent > 0 ? percent : null;
  }
  function getProgressPercent(progressById, videoId) {
    if (!videoId || !progressById) {
      return null;
    }
    if (typeof progressById !== "object") {
      return null;
    }
    return normalizeProgressPercent(progressById[videoId]);
  }

  // src/content/playback/progressWatchdog.js
  var PROGRESS_UPDATE_INTERVAL_MS = 5e3;
  var PLAYBACK_WATCHDOG_INTERVAL_MS = 3e3;
  var PLAYBACK_START_TIMEOUT_MS = 15e3;
  var PLAYBACK_NO_SOURCE_TIMEOUT_MS = 7e3;
  var VIDEO_END_FALLBACK_STABILITY_MS = 450;
  var VIDEO_END_NAVIGATION_PROGRESS = 97;
  var VIDEO_END_NAVIGATION_REMAINING_SECONDS = 2.5;
  var END_NEAR_PROGRESS = 99;
  var END_NEAR_REMAINING_SECONDS = 1.25;
  var videoEndState = {
    videoId: null,
    handled: false
  };
  var videoEndFallbackState = {
    videoId: null,
    matchedAt: 0
  };
  var playbackWatchdog = {
    timerId: null,
    lastVideoId: null,
    pendingSince: 0,
    lastVideoSeenAt: 0,
    playStarted: false
  };
  function shouldMonitorPlayback() {
    if (determinePageContext() !== "watch") {
      return false;
    }
    const currentId = getCurrentVideoId();
    if (!currentId) {
      return false;
    }
    const inQueue = inlinePlaylistState?.videoIds?.has(currentId) || inlinePlaylistState?.currentVideoId === currentId;
    return Boolean(inQueue);
  }
  function resetPlaybackWatchdog(videoId = null) {
    playbackWatchdog.lastVideoId = videoId;
    playbackWatchdog.pendingSince = videoId ? Date.now() : 0;
    playbackWatchdog.lastVideoSeenAt = 0;
    playbackWatchdog.playStarted = false;
  }
  function markPlaybackStarted() {
    playbackWatchdog.playStarted = true;
  }
  function stopPlaybackWatchdog() {
    if (playbackWatchdog.timerId !== null) {
      window.clearInterval(playbackWatchdog.timerId);
      playbackWatchdog.timerId = null;
    }
  }
  function playbackWatchdogTick(context = {}) {
    const run = () => {
      if (!shouldMonitorPlayback()) {
        stopPlaybackWatchdog();
        resetPlaybackWatchdog(null);
        return;
      }
      if (context.detectUnavailableWatchState?.()) {
        return;
      }
      const currentId = getCurrentVideoId();
      if (!currentId) {
        resetPlaybackWatchdog(null);
        return;
      }
      if (playbackWatchdog.lastVideoId !== currentId) {
        resetPlaybackWatchdog(currentId);
      }
      const now = Date.now();
      if (!playbackWatchdog.pendingSince) {
        playbackWatchdog.pendingSince = now;
      }
      const video = state.videoElement || document.querySelector("video");
      if (!video) {
        if (now - playbackWatchdog.pendingSince > PLAYBACK_START_TIMEOUT_MS) {
          context.handleVideoUnavailable?.({ reason: "\u041F\u043B\u0435\u0435\u0440 \u043D\u0435 \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u043B\u0441\u044F" });
        }
        return;
      }
      if (!playbackWatchdog.lastVideoSeenAt) {
        playbackWatchdog.lastVideoSeenAt = now;
      }
      const mediaNoSource = typeof HTMLMediaElement !== "undefined" && video.networkState === HTMLMediaElement.NETWORK_NO_SOURCE;
      if (mediaNoSource && !playbackWatchdog.playStarted) {
        const elapsed = now - (playbackWatchdog.lastVideoSeenAt || now);
        if (elapsed > PLAYBACK_NO_SOURCE_TIMEOUT_MS) {
          context.handleVideoUnavailable?.({ reason: "MEDIA_NO_SOURCE" });
        }
        return;
      }
      if (video?.error) {
        const code = typeof video.error.code === "number" ? `MEDIA_ERROR_${video.error.code}` : "MEDIA_ERROR";
        context.handleVideoUnavailable?.({ reason: code });
        return;
      }
      if (!playbackWatchdog.playStarted) {
        const active = !video.paused || video.currentTime > 0;
        if (active) {
          markPlaybackStarted();
          return;
        }
        const elapsed = now - (playbackWatchdog.lastVideoSeenAt || now);
        if (elapsed > PLAYBACK_START_TIMEOUT_MS) {
          context.handleVideoUnavailable?.({ reason: "\u0412\u0438\u0434\u0435\u043E \u043D\u0435 \u0437\u0430\u043F\u0443\u0441\u043A\u0430\u0435\u0442\u0441\u044F" });
        }
      }
      handleVideoProgressUpdate(context, { source: "watchdog" });
    };
    if (typeof ytaDiagMeasure === "function") {
      ytaDiagMeasure("player.playbackWatchdogTick", run);
      return;
    }
    run();
  }
  function ensurePlaybackWatchdog(context = {}) {
    if (!shouldMonitorPlayback()) {
      stopPlaybackWatchdog();
      return;
    }
    if (playbackWatchdog.timerId !== null) {
      return;
    }
    playbackWatchdog.timerId = window.setInterval(
      () => playbackWatchdogTick(context),
      PLAYBACK_WATCHDOG_INTERVAL_MS
    );
    playbackWatchdogTick(context);
  }
  function resetVideoEndState(videoId = null) {
    videoEndState.videoId = videoId;
    videoEndState.handled = false;
    videoEndFallbackState.videoId = videoId;
    videoEndFallbackState.matchedAt = 0;
  }
  function markVideoEndHandled(videoId) {
    videoEndState.videoId = videoId;
    videoEndState.handled = true;
    videoEndFallbackState.videoId = videoId;
    videoEndFallbackState.matchedAt = 0;
  }
  function beginVideoEndHandling(videoId) {
    if (!videoId) {
      return false;
    }
    if (videoEndState.videoId !== videoId) {
      resetVideoEndState(videoId);
    }
    if (videoEndState.handled) {
      return false;
    }
    markVideoEndHandled(videoId);
    return true;
  }
  function maybeTriggerVideoEndFallback(percent = null, context = {}, options = {}) {
    const source = options && typeof options.source === "string" ? options.source : "unknown";
    const video = state.videoElement;
    const videoId = getCurrentVideoId();
    if (!video || !videoId) {
      resetVideoEndState(null);
      return;
    }
    if (videoEndState.videoId !== videoId) {
      resetVideoEndState(videoId);
    }
    if (videoEndState.handled) {
      return;
    }
    if (video.seeking) {
      videoEndFallbackState.matchedAt = 0;
      return;
    }
    if (source === "pause") {
      videoEndFallbackState.matchedAt = 0;
      return;
    }
    if (video.ended) {
      context.handleVideoEnded?.();
      return;
    }
    const duration = Number(video.duration);
    const current = Number(video.currentTime);
    const remaining = Number.isFinite(duration) && Number.isFinite(current) ? duration - current : null;
    const normalizedPercent = percent !== null && percent !== void 0 ? clampProgressPercent(percent) : null;
    const reachedProgress = normalizedPercent !== null && normalizedPercent >= END_NEAR_PROGRESS;
    const reachedRemaining = Number.isFinite(remaining) && remaining <= END_NEAR_REMAINING_SECONDS;
    const reachedNavigationProgress = normalizedPercent !== null && normalizedPercent >= VIDEO_END_NAVIGATION_PROGRESS;
    const reachedNavigationRemaining = Number.isFinite(remaining) && remaining <= VIDEO_END_NAVIGATION_REMAINING_SECONDS;
    const acceptsNavigationThreshold = source === "navigation" || source === "seeked";
    const likelyVideoEnd = acceptsNavigationThreshold ? reachedNavigationProgress || reachedNavigationRemaining : reachedProgress && reachedRemaining;
    if (!likelyVideoEnd) {
      videoEndFallbackState.matchedAt = 0;
      return;
    }
    if (context.hasRecentUserAction?.()) {
      videoEndFallbackState.matchedAt = 0;
      return;
    }
    if (acceptsNavigationThreshold) {
      context.handleVideoEnded?.();
      return;
    }
    const now = Date.now();
    if (videoEndFallbackState.videoId !== videoId) {
      videoEndFallbackState.videoId = videoId;
      videoEndFallbackState.matchedAt = 0;
    }
    if (!videoEndFallbackState.matchedAt) {
      videoEndFallbackState.matchedAt = now;
      return;
    }
    if (now - videoEndFallbackState.matchedAt < VIDEO_END_FALLBACK_STABILITY_MS) {
      return;
    }
    context.handleVideoEnded?.();
  }
  function resetProgressTracker(videoId) {
    progressTracker.videoId = videoId || null;
    progressTracker.lastSentPercent = null;
    progressTracker.lastSentAt = 0;
  }
  function maybeSendVideoProgress(rawPercent, { force = false } = {}) {
    const videoId = getCurrentVideoId();
    if (!videoId) {
      return;
    }
    if (progressTracker.videoId !== videoId) {
      resetProgressTracker(videoId);
    }
    const percent = clampProgressPercent(rawPercent);
    if (percent === null) {
      return;
    }
    const now = Date.now();
    if (!force) {
      if (percent <= 0) {
        return;
      }
      if (progressTracker.lastSentPercent !== null) {
        if (percent === progressTracker.lastSentPercent) {
          return;
        }
        const elapsed = now - (progressTracker.lastSentAt || 0);
        if (percent < progressTracker.lastSentPercent && percent < 100) {
          if (elapsed < PROGRESS_UPDATE_INTERVAL_MS) {
            return;
          }
        } else if (elapsed < PROGRESS_UPDATE_INTERVAL_MS && percent < 100) {
          return;
        }
      }
    }
    progressTracker.videoId = videoId;
    progressTracker.lastSentPercent = percent;
    progressTracker.lastSentAt = now;
    sendMessage("player:progress", {
      videoId,
      percent,
      timestamp: now
    }).catch((err) => {
      console.debug("Failed to report playback progress", err);
    });
  }
  function handleVideoProgressUpdate(context = {}, options = {}) {
    const video = state.videoElement;
    if (!video) {
      return;
    }
    const duration = Number(video.duration);
    const current = Number(video.currentTime);
    if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(current)) {
      return;
    }
    if (current > 0) {
      markPlaybackStarted();
    }
    const ratio = duration > 0 ? current / duration * 100 : 0;
    maybeSendVideoProgress(ratio);
    const source = options && typeof options.source === "string" ? options.source : "progress";
    maybeTriggerVideoEndFallback(ratio, context, { source });
  }
  function maybeFinalizeVideoEndedBeforeNavigation(context = {}) {
    const video = state.videoElement;
    if (!video) {
      return;
    }
    if (video.ended) {
      maybeTriggerVideoEndFallback(100, context, { source: "navigation" });
      return;
    }
    const duration = Number(video.duration);
    const current = Number(video.currentTime);
    if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(current)) {
      return;
    }
    const ratio = current / duration * 100;
    maybeTriggerVideoEndFallback(ratio, context, { source: "navigation" });
  }
  function resetVideoEndFallbackMatch() {
    videoEndFallbackState.matchedAt = 0;
  }

  // src/content/collection/progressNotification.js
  var autoCollectDisplay = {
    active: false
  };
  function formatAutoCollectProgress(event = {}) {
    switch (event.phase) {
      case "start":
        return "\u0418\u0449\u0443 \u043D\u043E\u0432\u044B\u0435 \u0432\u0438\u0434\u0435\u043E...";
      case "channelsLoaded":
        return `\u041F\u043E\u0434\u043F\u0438\u0441\u043E\u043A: ${event.channelCount || 0}, \u043F\u043B\u0435\u0439\u043B\u0438\u0441\u0442\u043E\u0432: ${event.playlistCount || 0}`;
      case "playlistFetch":
        return `\u0417\u0430\u0433\u0440\u0443\u0436\u0430\u0435\u043C \u043F\u043B\u0435\u0439\u043B\u0438\u0441\u0442 ${event.index || 0}/${event.total || 0}`;
      case "playlistFetched":
        return `\u041F\u043B\u0435\u0439\u043B\u0438\u0441\u0442 ${event.index || 0}/${event.total || 0}: +${event.videoCount || 0}`;
      case "aggregate":
        return `\u0421\u043E\u0431\u0440\u0430\u043D\u043E ${event.videoCount || 0} \u0432\u0438\u0434\u0435\u043E`;
      case "filtering":
        return `\u0424\u0438\u043B\u044C\u0442\u0440\u0443\u044E ${event.videoCount || 0} \u0432\u0438\u0434\u0435\u043E`;
      case "filterProgress": {
        const processed = Number(event.processed) || 0;
        const total = Number(event.total) || processed;
        return `\u0424\u0438\u043B\u044C\u0442\u0440\u0443\u044E ${processed}/${total}`;
      }
      case "filterStats": {
        const totals = event.totals || {};
        const total = Number(event.total) || Number(event.initialCount) || 0;
        const passed = totals.passed || event.videoCount || 0;
        return total ? `\u041F\u043E\u0441\u043B\u0435 \u0444\u0438\u043B\u044C\u0442\u0440\u0430 ${passed}/${total}` : `\u041F\u043E\u0441\u043B\u0435 \u0444\u0438\u043B\u044C\u0442\u0440\u0430 ${passed}`;
      }
      case "filtered":
        return `\u041F\u043E\u0441\u043B\u0435 \u0444\u0438\u043B\u044C\u0442\u0440\u0430 \u043E\u0441\u0442\u0430\u043B\u043E\u0441\u044C ${event.videoCount || 0}`;
      case "readyToAdd":
        return event.skippedExisting ? `\u0413\u043E\u0442\u043E\u0432\u043E \u043A \u0434\u043E\u0431\u0430\u0432\u043B\u0435\u043D\u0438\u044E ${event.videoCount || 0} \u0432\u0438\u0434\u0435\u043E (\u0443\u0436\u0435 \u0432 \u043E\u0447\u0435\u0440\u0435\u0434\u0438 ${event.skippedExisting})` : `\u0413\u043E\u0442\u043E\u0432\u043E \u043A \u0434\u043E\u0431\u0430\u0432\u043B\u0435\u043D\u0438\u044E ${event.videoCount || 0} \u0432\u0438\u0434\u0435\u043E`;
      case "adding":
        return `\u0414\u043E\u0431\u0430\u0432\u043B\u044F\u044E ${event.addCount || 0} \u0432\u0438\u0434\u0435\u043E \u0432 \u043E\u0447\u0435\u0440\u0435\u0434\u044C`;
      default:
        return "";
    }
  }
  function handleCollectionProgressEvent(event = {}) {
    if (!event || event.origin !== "auto") {
      return;
    }
    const phase = event.phase || "";
    if (phase === "start") {
      autoCollectDisplay.active = true;
      showPlaybackNotification({
        title: "\u0421\u0431\u043E\u0440 \u043F\u043E\u0434\u043F\u0438\u0441\u043E\u043A",
        body: formatAutoCollectProgress(event) || "\u0417\u0430\u043F\u0443\u0441\u043A\u0430\u044E \u0441\u0431\u043E\u0440 \u043F\u043E\u0434\u043F\u0438\u0441\u043E\u043A...",
        persist: true
      });
      return;
    }
    if (!autoCollectDisplay.active) {
      return;
    }
    if (phase === "complete") {
      autoCollectDisplay.active = false;
      const added = Number(event.added) || 0;
      const fetched = Number(event.fetched) || added;
      const queueLength = Number(event.queueLength) || 0;
      const summary = added ? `\u0414\u043E\u0431\u0430\u0432\u043B\u0435\u043D\u043E ${added} \u0438\u0437 ${fetched}` : "\u041D\u043E\u0432\u044B\u0445 \u0432\u0438\u0434\u0435\u043E \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u043E";
      const queueLabel = queueLength ? ` \xB7 \u0412 \u043E\u0447\u0435\u0440\u0435\u0434\u0438 ${queueLength}` : "";
      showPlaybackNotification({
        title: "\u0421\u0431\u043E\u0440 \u043F\u043E\u0434\u043F\u0438\u0441\u043E\u043A \u0437\u0430\u0432\u0435\u0440\u0448\u0451\u043D",
        body: `${summary}${queueLabel}`,
        duration: 6e3
      });
      return;
    }
    if (phase === "error") {
      autoCollectDisplay.active = false;
      const message = event.message || "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0441\u043E\u0431\u0440\u0430\u0442\u044C \u043F\u043E\u0434\u043F\u0438\u0441\u043A\u0438";
      showPlaybackNotification({
        title: "\u0421\u0431\u043E\u0440 \u043F\u043E\u0434\u043F\u0438\u0441\u043E\u043A",
        body: message,
        duration: 6e3
      });
      return;
    }
    const progress = formatAutoCollectProgress(event);
    if (progress) {
      showPlaybackNotification({
        title: "\u0421\u0431\u043E\u0440 \u043F\u043E\u0434\u043F\u0438\u0441\u043E\u043A",
        body: progress,
        persist: true
      });
    }
  }

  // src/content/playback/controls.js
  var playerErrorContext = {
    handlePlaybackAdvanceResponse,
    setControlsActive
  };
  var playbackActionContext = {
    handlePlaybackAdvanceResponse,
    updateInlinePlaylistState
  };
  var playerControlsViewContext = {
    handleAddCurrentFromPage,
    requestNext: requestNext2,
    requestPostpone: requestPostpone2,
    requestPrevious: requestPrevious2,
    requestStartPlayback: requestStartPlayback2
  };
  function detectUnavailableWatchState2() {
    return detectUnavailableWatchState(playerErrorContext);
  }
  function handleVideoUnavailable2(details = {}) {
    return handleVideoUnavailable(details, playerErrorContext);
  }
  function ensurePlayerErrorMonitoring2() {
    return ensurePlayerErrorMonitoring(playerErrorContext);
  }
  function ensurePlaybackWatchdog2() {
    ensurePlaybackWatchdog({
      detectUnavailableWatchState: detectUnavailableWatchState2,
      handleVideoEnded,
      handleVideoUnavailable: handleVideoUnavailable2,
      hasRecentUserAction
    });
  }
  function maybeFinalizeVideoEndedBeforeNavigation2() {
    maybeFinalizeVideoEndedBeforeNavigation({
      handleVideoEnded,
      hasRecentUserAction
    });
  }
  function handleVideoProgressUpdate2() {
    handleVideoProgressUpdate({
      handleVideoEnded,
      hasRecentUserAction
    });
  }
  function handleVideoSeeked() {
    handleVideoProgressUpdate(
      {
        handleVideoEnded,
        hasRecentUserAction
      },
      { source: "seeked" }
    );
  }
  function handlePlaybackAdvanceResponse(response, context = {}) {
    if (response?.state && typeof response.state === "object") {
      updateInlinePlaylistState(response.state);
    }
    if (response && response.handled === false && response.state) {
      if (context.origin === "auto") {
        queueQueueEndAnnouncement(response.state, context);
      } else {
        clearQueueEndAnnouncement();
      }
    }
    return response;
  }
  function shouldKeepControlsAfterAdvanceFailure(sourceVideoId = null) {
    const currentId = getCurrentVideoId();
    if (currentId && (inlinePlaylistState.videoIds?.has(currentId) || inlinePlaylistState.currentVideoId === currentId)) {
      return true;
    }
    if (sourceVideoId && (inlinePlaylistState.videoIds?.has(sourceVideoId) || inlinePlaylistState.currentVideoId === sourceVideoId)) {
      return true;
    }
    return false;
  }
  function ensurePlayerControls2() {
    ensurePlayerControls(playerControlsViewContext);
  }
  function updatePlayerControlsUI() {
    updatePlayerControlsUI2(playerControlsViewContext);
  }
  function setControlsActive(active) {
    const value = Boolean(active);
    if (state.controlsActive === value) return;
    state.controlsActive = value;
    ensurePlayerControls2();
    updateMediaSessionHandlers();
    updatePlayerControlsUI();
    updatePageActions();
    updateInlineQueueUI();
  }
  function updateMediaSessionHandlers() {
    if (!("mediaSession" in navigator)) {
      return;
    }
    try {
      if (canHandlePlaybackActions()) {
        navigator.mediaSession.setActionHandler("nexttrack", requestNext2);
        navigator.mediaSession.setActionHandler("previoustrack", requestPrevious2);
      } else {
        navigator.mediaSession.setActionHandler("nexttrack", null);
        navigator.mediaSession.setActionHandler("previoustrack", null);
      }
    } catch (err) {
      console.warn("Failed to update media session handlers", err);
    }
  }
  function requestNext2() {
    requestNext(playbackActionContext);
  }
  function requestPrevious2() {
    requestPrevious();
  }
  function requestPostpone2() {
    requestPostpone(playbackActionContext);
  }
  function requestStartPlayback2() {
    requestStartPlayback(playbackActionContext);
  }
  function handleVideoStarted() {
    ensureUserActionListeners();
    hidePlaybackNotification(true);
    const videoId = parseVideoId(window.location.href);
    if (!videoId) return;
    resetVideoEndState(videoId);
    state.currentVideoId = videoId;
    state.lastUnavailableVideoId = null;
    resetProgressTracker(videoId);
    if (state.videoElement && !state.videoElement.paused) {
      markPlaybackStarted();
    }
    ensurePlaybackWatchdog2();
    handleVideoProgressUpdate2();
    if (state.lastReportedVideoId === videoId) return;
    state.lastReportedVideoId = videoId;
    sendMessage("player:videoStarted", { videoId }).then((resp) => {
      if (resp && typeof resp === "object") {
        const presentation = resp.state && typeof resp.state === "object" ? resp.state : null;
        if (presentation) {
          updateInlinePlaylistState(presentation);
        }
      }
      setControlsActive(Boolean(resp?.controlled));
      maybeShowQueueEndAnnouncement(videoId);
    });
  }
  function handleVideoError(event) {
    const mediaError = event?.target?.error;
    if (mediaError && typeof mediaError === "object") {
      const detail = {};
      if (typeof mediaError.message === "string") {
        detail.message = mediaError.message;
      }
      if (typeof mediaError.code === "number") {
        detail.reason = `MEDIA_ERROR_${mediaError.code}`;
      }
      handleVideoUnavailable2(detail);
      return;
    }
    if (event?.detail) {
      handleVideoUnavailable2(event.detail);
      return;
    }
    handleVideoUnavailable2(event || {});
  }
  function handleVideoPaused() {
    resetVideoEndFallbackMatch();
  }
  function handleVideoEnded() {
    const videoId = getCurrentVideoId();
    if (!videoId) return;
    if (!beginVideoEndHandling(videoId)) {
      return;
    }
    maybeSendVideoProgress(100, { force: true });
    sendMessage(
      "player:videoEnded",
      { videoId },
      {
        onDisconnect: () => recoverVideoEnded(videoId, playbackActionContext)
      }
    ).then((resp) => {
      const result = handlePlaybackAdvanceResponse(resp, {
        origin: "auto",
        sourceVideoId: videoId
      });
      if (!result || result.handled === false) {
        setControlsActive(shouldKeepControlsAfterAdvanceFailure(videoId));
      }
    });
  }
  function detachVideoListeners() {
    if (!state.videoElement) return;
    state.videoElement.removeEventListener("ended", handleVideoEnded);
    state.videoElement.removeEventListener("play", handleVideoStarted);
    state.videoElement.removeEventListener("playing", handleVideoStarted);
    state.videoElement.removeEventListener("loadeddata", handleVideoStarted);
    state.videoElement.removeEventListener("timeupdate", handleVideoProgressUpdate2);
    state.videoElement.removeEventListener("durationchange", handleVideoProgressUpdate2);
    state.videoElement.removeEventListener("seeked", handleVideoSeeked);
    state.videoElement.removeEventListener("pause", handleVideoPaused);
    state.videoElement.removeEventListener("error", handleVideoError);
    state.videoElement = null;
    resetProgressTracker(null);
    resetVideoEndState(null);
  }
  function attachVideoListeners(video) {
    if (state.videoElement === video) return;
    detachVideoListeners();
    state.videoElement = video;
    video.addEventListener("ended", handleVideoEnded);
    video.addEventListener("play", handleVideoStarted);
    video.addEventListener("playing", handleVideoStarted);
    video.addEventListener("loadeddata", handleVideoStarted);
    video.addEventListener("timeupdate", handleVideoProgressUpdate2);
    video.addEventListener("durationchange", handleVideoProgressUpdate2);
    video.addEventListener("seeked", handleVideoSeeked);
    video.addEventListener("pause", handleVideoPaused);
    video.addEventListener("error", handleVideoError);
    handleVideoStarted();
  }
  function scanForVideo() {
    ensurePlayerErrorMonitoring2();
    const video = document.querySelector("video");
    if (video) {
      attachVideoListeners(video);
      ensurePlayerControls2();
      ensurePlaybackWatchdog2();
      return true;
    }
    detectUnavailableWatchState2();
    ensurePlaybackWatchdog2();
    return false;
  }

  // src/content/inline-queue/layout.js
  var inlineQueueMountRetry = null;
  var inlineQueueLayoutMedia = null;
  var inlineQueueLayoutMediaHandler = null;
  var inlineQueueWatchObserver = null;
  var inlineQueueWatchObserverTarget = null;
  var renderInlineQueue = null;
  function configureInlineQueueLayout(renderCallback) {
    renderInlineQueue = typeof renderCallback === "function" ? renderCallback : null;
  }
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
      disconnectInlineQueueWatchObserver();
      return;
    }
    if (!inlineQueueWatchObserver) {
      inlineQueueWatchObserver = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (mutation.type === "attributes" && (mutation.attributeName === "is-two-columns" || mutation.attributeName === "is-two-columns_")) {
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
  function disconnectInlineQueueWatchObserver() {
    if (inlineQueueWatchObserver) {
      inlineQueueWatchObserver.disconnect();
      inlineQueueWatchObserverTarget = null;
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
      renderInlineQueue?.();
    }, 300);
  }
  function resolveInlineQueueHostElement() {
    const watchFlexy = document.querySelector("ytd-watch-flexy");
    let preferSecondary = null;
    if (watchFlexy) {
      const attrTwoColumns = watchFlexy.getAttribute("is-two-columns") ?? watchFlexy.getAttribute("is-two-columns_");
      if (attrTwoColumns === "true") {
        preferSecondary = true;
      } else if (attrTwoColumns === "false") {
        preferSecondary = false;
      } else if (watchFlexy.hasAttribute("is-two-columns") || watchFlexy.hasAttribute("is-two-columns_")) {
        preferSecondary = true;
      } else if (typeof watchFlexy.isTwoColumns === "boolean") {
        preferSecondary = watchFlexy.isTwoColumns;
      }
    }
    if (preferSecondary === null) {
      preferSecondary = typeof window.matchMedia === "function" ? window.matchMedia("(min-width: 1312px)").matches : true;
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

  // src/content/video-cards/progress.js
  var PROGRESS_ELEMENT_CLASS = "video-thumb__progress";
  var PROGRESS_BAR_CLASS = "video-thumb__progress-bar";
  function applyCardProgress(card, videoId) {
    if (!(card instanceof HTMLElement)) {
      return;
    }
    const hostCandidate = card.querySelector(`.${THUMB_HOST_CLASS}`);
    const host = hostCandidate instanceof HTMLElement ? hostCandidate : card;
    const percent = getProgressPercent(inlinePlaylistState?.progress, videoId);
    let container = host.querySelector(`.${PROGRESS_ELEMENT_CLASS}`);
    if (!percent) {
      if (container) {
        container.remove();
      }
      return;
    }
    if (!container) {
      container = document.createElement("div");
      container.className = PROGRESS_ELEMENT_CLASS;
      const bar = document.createElement("div");
      bar.className = PROGRESS_BAR_CLASS;
      container.appendChild(bar);
      host.appendChild(container);
    }
    const barEl = container.querySelector(`.${PROGRESS_BAR_CLASS}`) || (() => {
      const bar = document.createElement("div");
      bar.className = PROGRESS_BAR_CLASS;
      container.appendChild(bar);
      return bar;
    })();
    barEl.style.width = `${percent}%`;
  }
  function syncVideoCardProgress(root = document, cardMark) {
    const scope = root instanceof Document || root instanceof HTMLElement ? root : document;
    const cards = scope.querySelectorAll(
      `[${cardMark}][data-yta-target-type="video"]`
    );
    cards.forEach((card) => {
      const videoId = card.getAttribute("data-yta-target-id") || "";
      applyCardProgress(card, videoId);
    });
  }

  // src/content/inline-queue/state.js
  var pendingInlineRefresh = false;
  function syncAllInlineButtons() {
    document.querySelectorAll(`.${ADD_BUTTON_CLASS}`).forEach((button) => syncInlineButtonState(button));
  }
  function syncVideoCardProgress2() {
    try {
      syncVideoCardProgress(document, CARD_MARK);
    } catch (err) {
      console.debug("Failed to sync card progress", err);
    }
  }
  function normalizePresentation(rawPresentation) {
    if (!rawPresentation || typeof rawPresentation !== "object") {
      return null;
    }
    let presentation = rawPresentation;
    if (!presentation.currentQueue && presentation.state && typeof presentation.state === "object") {
      presentation = presentation.state;
    }
    return presentation && typeof presentation === "object" ? presentation : null;
  }
  function scheduleInlinePlaylistRefresh(context) {
    if (pendingInlineRefresh) {
      return;
    }
    pendingInlineRefresh = true;
    window.setTimeout(async () => {
      try {
        await refreshInlinePlaylistState2(context);
      } finally {
        pendingInlineRefresh = false;
      }
    }, 0);
  }
  function normalizeQueueEntries(queueEntries) {
    const normalizedEntries = [];
    const orderedIds = [];
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
        channelUrl: typeof entry.channelUrl === "string" && entry.channelUrl ? entry.channelUrl : null,
        thumbnail: entry.thumbnail || "",
        publishedAt: entry.publishedAt || null,
        duration: entry.duration ?? null,
        addedAt: entry.addedAt ?? null
      };
      normalizedEntries.push(normalized);
    });
    return { normalizedEntries, orderedIds };
  }
  function updateInlinePlaylistState2(rawPresentation, context = {}) {
    const presentation = normalizePresentation(rawPresentation);
    if (!presentation) {
      return;
    }
    if (presentation.currentQueue && !Array.isArray(presentation.currentQueue.queue)) {
      scheduleInlinePlaylistRefresh(context);
      return;
    }
    const queueEntries = Array.isArray(presentation?.currentQueue?.queue) ? presentation.currentQueue.queue : [];
    const { normalizedEntries, orderedIds } = normalizeQueueEntries(queueEntries);
    const listId = presentation?.currentQueue?.id || presentation?.currentListId || null;
    const listFrozen = Boolean(presentation?.currentQueue?.freeze);
    const rawIndex = presentation?.currentQueue?.currentIndex;
    const normalizedIndex = Number.isInteger(rawIndex) && rawIndex >= 0 && rawIndex < orderedIds.length ? rawIndex : orderedIds.length ? 0 : null;
    const historyLength = Array.isArray(presentation?.history) ? presentation.history.length : 0;
    const newSet = new Set(orderedIds);
    let changed = inlinePlaylistState.currentListId !== listId || inlinePlaylistState.currentIndex !== normalizedIndex || inlinePlaylistState.historyLength !== historyLength || inlinePlaylistState.orderedVideoIds.length !== orderedIds.length;
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
    const listsMeta = Array.isArray(presentation?.lists) ? presentation.lists : [];
    inlinePlaylistState.lists = listsMeta.map((list) => ({
      id: typeof list?.id === "string" ? list.id : null,
      name: typeof list?.name === "string" ? list.name : "",
      freeze: Boolean(list?.freeze),
      length: typeof list?.length === "number" && Number.isFinite(list.length) ? list.length : 0,
      revision: typeof list?.revision === "number" && Number.isFinite(list.revision) ? list.revision : 0
    })).filter((list) => list.id);
    inlinePlaylistState.currentListName = typeof presentation?.currentQueue?.name === "string" ? presentation.currentQueue.name : "";
    inlinePlaylistState.currentVideoId = typeof presentation?.currentVideoId === "string" && presentation.currentVideoId ? presentation.currentVideoId : null;
    inlinePlaylistState.progress = presentation.videoProgress && typeof presentation.videoProgress === "object" ? presentation.videoProgress : {};
    if (changed) {
      syncAllInlineButtons();
    }
    if (typeof context.syncVideoCardProgress === "function") {
      context.syncVideoCardProgress(document);
    } else {
      syncVideoCardProgress2();
    }
    context.updatePlayerControlsUI?.();
    context.updateInlineQueueUI?.();
    context.updatePageActions?.();
    context.ensurePlaybackWatchdog?.();
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
      if (!status || status !== "pending" && status !== "success") {
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
  async function refreshInlinePlaylistState2(context = {}) {
    const presentation = await sendMessage("playlist:getState");
    if (presentation && typeof presentation === "object") {
      updateInlinePlaylistState2(presentation, context);
    }
  }

  // src/content/inline-queue/navigation.js
  function getChromeRuntime() {
    if (typeof chrome === "undefined") {
      return null;
    }
    return chrome?.runtime || null;
  }
  function openExtensionUrl(url) {
    if (!url) {
      return;
    }
    const opened = window.open(url, "_blank", "noopener,noreferrer");
    if (!opened) {
      window.location.href = url;
    }
  }
  function buildRuntimeUrl(path, configure) {
    const runtime = getChromeRuntime();
    if (!runtime?.getURL) {
      return null;
    }
    try {
      const url = new URL(runtime.getURL(path));
      if (typeof configure === "function") {
        configure(url);
      }
      return url.toString();
    } catch {
      return null;
    }
  }
  function logRuntimeMessageError(label, err, action) {
    if (isRecoverableRuntimeError(err)) {
      return;
    }
    console.warn(`${label} message ${action}`, err);
  }
  function sendRuntimeMessage(message, fallback, errorLabel) {
    const runtime = getChromeRuntime();
    if (!runtime?.sendMessage) {
      fallback();
      return;
    }
    try {
      runtime.sendMessage(message, (response) => {
        const lastError = getChromeRuntime()?.lastError;
        if (lastError) {
          logRuntimeMessageError(errorLabel, lastError, "failed");
          fallback();
          return;
        }
        if (response && response.error) {
          console.warn(`${errorLabel} rejected`, response.error);
          fallback();
        }
      });
    } catch (err) {
      logRuntimeMessageError(errorLabel, err, "threw");
      fallback();
    }
  }
  function openQuickFilterForVideo(videoId) {
    const normalized = typeof videoId === "string" ? videoId.trim() : "";
    if (!normalized) {
      return;
    }
    const fallback = () => {
      openExtensionUrl(
        buildRuntimeUrl("src/settings/settings.html", (url) => {
          url.searchParams.set("quickFilterVideo", normalized);
        })
      );
    };
    sendRuntimeMessage(
      { type: "options:openQuickFilter", videoId: normalized },
      fallback,
      "Quick filter"
    );
  }
  function openListManager(listId, listName = "") {
    const normalizedId = typeof listId === "string" ? listId.trim() : "";
    if (!normalizedId) {
      return;
    }
    const normalizedName = typeof listName === "string" ? listName.trim() : "";
    const fallback = () => {
      openExtensionUrl(
        buildRuntimeUrl("src/popup/lists.html", (url) => {
          url.searchParams.set("listId", normalizedId);
          if (normalizedName) {
            url.searchParams.set("listName", normalizedName);
          }
        })
      );
    };
    sendRuntimeMessage(
      {
        type: "options:openListSettings",
        listId: normalizedId,
        listName: normalizedName || void 0
      },
      fallback,
      "List settings"
    );
  }

  // src/content/inline-queue/itemActions.js
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
    sendMessage("playlist:play", payload).catch((err) => {
      console.warn("Failed to start playback from inline queue", err);
    }).finally(() => {
      if (!videoItem.isConnected) {
        return;
      }
      delete videoItem.dataset.loading;
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
  function handleInlineQueueRemove(button, context = {}) {
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
    context.setInlineQueuePendingFocus?.(focusTargetId || videoId);
    const payload = { videoId };
    if (inlinePlaylistState.currentListId) {
      payload.listId = inlinePlaylistState.currentListId;
    }
    sendMessage("playlist:remove", payload).then((state2) => {
      if (state2 && typeof state2 === "object") {
        context.updateInlinePlaylistState?.(state2);
      }
    }).catch((err) => {
      console.warn("Failed to remove video from inline queue", err);
    }).finally(() => {
      if (!target.isConnected) {
        return;
      }
      target.disabled = false;
      delete target.dataset.loading;
    });
  }
  function handleInlineQueuePostpone(button, context = {}) {
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
    context.setInlineQueuePendingFocus?.(focusTargetId || videoId);
    const request = isCurrent ? sendMessage("playlist:postpone", { videoId }) : sendMessage("playlist:postponeVideo", { videoId, listId });
    request.then((response) => {
      if (!response) {
        context.clearInlineQueuePendingFocus?.();
        return;
      }
      if (isCurrent) {
        if (response.handled === false) {
          context.clearInlineQueuePendingFocus?.();
          return;
        }
        const presentation = response.state || response;
        if (presentation && typeof presentation === "object") {
          context.updateInlinePlaylistState?.(presentation);
        } else {
          context.clearInlineQueuePendingFocus?.();
        }
      } else if (typeof response === "object") {
        context.updateInlinePlaylistState?.(response);
      } else {
        context.clearInlineQueuePendingFocus?.();
      }
    }).catch((err) => {
      console.warn("Failed to postpone video from inline queue", err);
      context.clearInlineQueuePendingFocus?.();
    }).finally(() => {
      if (!target.isConnected) {
        return;
      }
      target.disabled = false;
      delete target.dataset.loading;
    });
  }
  function handleInlineQueueMove(button, context = {}) {
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
    context.showInlineMoveMenu?.(videoId, inlinePlaylistState.currentListId, target);
  }
  function handleInlineQueueListClick(event, context = {}) {
    const quickFilterBtn = event.target.closest(".video-quick-filter");
    if (quickFilterBtn) {
      event.preventDefault();
      event.stopPropagation();
      const videoItem2 = quickFilterBtn.closest(".video-item");
      const videoId = quickFilterBtn.dataset.videoId || videoItem2?.dataset.videoId || "";
      if (videoId) {
        openQuickFilterForVideo(videoId);
      }
      return;
    }
    const removeBtn = event.target.closest(".video-remove");
    if (removeBtn) {
      event.preventDefault();
      event.stopPropagation();
      handleInlineQueueRemove(removeBtn, context);
      return;
    }
    const postponeBtn = event.target.closest(".video-postpone");
    if (postponeBtn) {
      event.preventDefault();
      event.stopPropagation();
      handleInlineQueuePostpone(postponeBtn, context);
      return;
    }
    const moveBtn = event.target.closest(".video-move");
    if (moveBtn) {
      event.preventDefault();
      event.stopPropagation();
      handleInlineQueueMove(moveBtn, context);
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
    context.hideInlineMoveMenu?.();
    activateInlineQueueItem(videoItem);
  }
  function handleInlineQueueListKeyDown(event, context = {}) {
    if (event.defaultPrevented) {
      return;
    }
    const videoItem = event.target.closest(".video-item");
    if (!videoItem) {
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      context.hideInlineMoveMenu?.();
      activateInlineQueueItem(videoItem);
    }
  }

  // src/content/inline-queue/moveMenu.js
  var inlineMoveMenu = {
    container: null,
    buttons: null,
    message: null,
    videoId: null,
    listId: null,
    anchor: null,
    visible: false
  };
  var inlineMoveMenuContext = {
    updateInlinePlaylistState: null
  };
  function configureInlineMoveMenu(context = {}) {
    inlineMoveMenuContext = {
      updateInlinePlaylistState: typeof context.updateInlinePlaylistState === "function" ? context.updateInlinePlaylistState : null
    };
  }
  function ensureInlineMoveMenuElements() {
    if (inlineMoveMenu.container && inlineMoveMenu.buttons && inlineMoveMenu.message) {
      return inlineMoveMenu;
    }
    const container = document.createElement("div");
    container.className = "yta-inline-move-menu";
    container.dataset.visible = "0";
    const message = document.createElement("div");
    message.className = "yta-inline-move-menu__message";
    message.textContent = "\u041F\u0435\u0440\u0435\u043D\u0435\u0441\u0442\u0438 \u0432 \u0441\u043F\u0438\u0441\u043E\u043A:";
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
    if (inlineMoveMenu.anchor && inlineMoveMenu.anchor instanceof HTMLElement && inlineMoveMenu.anchor.contains(event.target)) {
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
    sendMessage("playlist:moveVideo", { videoId, targetListId }).then((state2) => {
      if (state2 && typeof state2 === "object") {
        inlineMoveMenuContext.updateInlinePlaylistState?.(state2);
      }
    }).catch((err) => {
      console.warn("Failed to move video from inline queue", err);
    });
  }
  function renderInlineMoveMenuTargets(menu, listId) {
    const lists = Array.isArray(inlinePlaylistState.lists) ? inlinePlaylistState.lists : [];
    const targets = lists.filter(
      (entry) => entry && entry.id && entry.id !== listId
    );
    menu.buttons.textContent = "";
    if (!targets.length) {
      menu.buttons.dataset.empty = "1";
      menu.message.textContent = "\u041D\u0435\u0442 \u0434\u0440\u0443\u0433\u0438\u0445 \u0441\u043F\u0438\u0441\u043A\u043E\u0432";
      return;
    }
    menu.buttons.dataset.empty = "0";
    menu.message.textContent = "\u041F\u0435\u0440\u0435\u043D\u0435\u0441\u0442\u0438 \u0432 \u0441\u043F\u0438\u0441\u043E\u043A:";
    targets.forEach((list) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "yta-inline-move-menu__option";
      btn.dataset.targetList = list.id;
      const label = typeof list.name === "string" && list.name.trim() ? list.name.trim() : list.id === DEFAULT_LIST_ID ? "\u0421\u043F\u0438\u0441\u043E\u043A \u043F\u043E \u0443\u043C\u043E\u043B\u0447\u0430\u043D\u0438\u044E" : "\u0421\u043F\u0438\u0441\u043E\u043A";
      btn.textContent = label;
      menu.buttons.appendChild(btn);
    });
  }
  function positionInlineMoveMenu(menu, anchor) {
    menu.container.dataset.visible = "1";
    menu.container.style.visibility = "hidden";
    menu.container.style.top = "0px";
    menu.container.style.left = "0px";
    const menuRect = menu.container.getBoundingClientRect();
    const anchorRect = anchor.getBoundingClientRect();
    const margin = 12;
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
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
  }
  function addInlineMoveMenuListeners() {
    document.addEventListener("pointerdown", handleInlineMoveMenuPointerDown, {
      capture: true
    });
    document.addEventListener("keydown", handleInlineMoveMenuKeyDown, {
      capture: true
    });
    window.addEventListener("scroll", handleInlineMoveMenuScroll, true);
    window.addEventListener("resize", handleInlineMoveMenuScroll, true);
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
    renderInlineMoveMenuTargets(menu, listId);
    inlineMoveMenu.videoId = videoId;
    inlineMoveMenu.listId = listId || null;
    inlineMoveMenu.anchor = anchor;
    inlineMoveMenu.visible = true;
    positionInlineMoveMenu(menu, anchor);
    addInlineMoveMenuListeners();
  }

  // src/content/inline-queue/scrollFocus.js
  var INLINE_QUEUE_SCROLL_EPSILON = 0.5;
  var inlineQueuePendingFocusId = null;
  var inlineQueuePendingFocusListId = null;
  var inlineQueuePendingScrollTop = null;
  var inlineQueueScrollFocusContext = {
    getInlineQueueUI: null
  };
  function configureInlineQueueScrollFocus(context = {}) {
    inlineQueueScrollFocusContext = {
      getInlineQueueUI: typeof context.getInlineQueueUI === "function" ? context.getInlineQueueUI : null
    };
  }
  function getInlineQueueUI() {
    return inlineQueueScrollFocusContext.getInlineQueueUI?.() || {};
  }
  function getInlineQueueList() {
    const ui = getInlineQueueUI();
    return ui.list instanceof HTMLElement ? ui.list : null;
  }
  function getInlineQueueContainer() {
    const ui = getInlineQueueUI();
    return ui.container instanceof HTMLElement ? ui.container : null;
  }
  function setInlineQueuePendingFocus(videoId) {
    if (typeof videoId !== "string" || !videoId) {
      return;
    }
    inlineQueuePendingFocusId = videoId;
    inlineQueuePendingFocusListId = inlinePlaylistState.currentListId || null;
    const list = getInlineQueueList();
    if (list && typeof list.scrollTop === "number") {
      inlineQueuePendingScrollTop = list.scrollTop;
    } else {
      inlineQueuePendingScrollTop = null;
    }
  }
  function clearInlineQueuePendingFocus() {
    inlineQueuePendingFocusId = null;
    inlineQueuePendingFocusListId = null;
    inlineQueuePendingScrollTop = null;
  }
  function getInlineQueuePendingScrollTop() {
    return inlineQueuePendingScrollTop;
  }
  function setInlineQueuePendingScrollTop(scrollTop) {
    inlineQueuePendingScrollTop = typeof scrollTop === "number" && Number.isFinite(scrollTop) ? scrollTop : null;
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
  function getInlineQueueParent(node) {
    if (!node) {
      return null;
    }
    if (node.parentElement instanceof HTMLElement) {
      return node.parentElement;
    }
    if (typeof ShadowRoot !== "undefined" && node.parentNode && node.parentNode instanceof ShadowRoot) {
      return node.parentNode.host || null;
    }
    return null;
  }
  function maybeScrollInlineQueueAncestors(delta) {
    let current = getInlineQueueContainer();
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
    const scrollingElement = document.scrollingElement || document.documentElement || document.body;
    if (!scrollingElement) {
      return false;
    }
    const prev = scrollingElement.scrollTop;
    const maxScroll = Math.max(
      0,
      scrollingElement.scrollHeight - scrollingElement.clientHeight
    );
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
    const container = getInlineQueueContainer();
    if (!container) {
      return false;
    }
    const viewportHeight = window.innerHeight || document.documentElement && document.documentElement.clientHeight || 0;
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
    const container = getInlineQueueContainer();
    if (!container || typeof delta !== "number" || delta === 0) {
      return false;
    }
    const viewportHeight = window.innerHeight || document.documentElement && document.documentElement.clientHeight || 0;
    if (!viewportHeight) {
      return maybeScrollDocument(delta);
    }
    const rect = container.getBoundingClientRect();
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
  function maybeAutoScrollInlineQueueList(pointerY, threshold, maxStep) {
    const list = getInlineQueueList();
    if (!list || typeof pointerY !== "number") {
      return false;
    }
    const { scrollHeight, clientHeight } = list;
    if (scrollHeight <= clientHeight) {
      return false;
    }
    const rect = list.getBoundingClientRect();
    const topDistance = pointerY - rect.top;
    const bottomDistance = rect.bottom - pointerY;
    let delta = 0;
    if (topDistance <= threshold) {
      const distance = Math.max(0, topDistance);
      const intensity = (threshold - distance) / threshold;
      delta = -Math.ceil(intensity * maxStep);
    } else if (bottomDistance <= threshold) {
      const distance = Math.max(0, bottomDistance);
      const intensity = (threshold - distance) / threshold;
      delta = Math.ceil(intensity * maxStep);
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
  function restoreInlineQueueScroll(list, desiredScrollTop) {
    if (!list || typeof list.scrollTop !== "number") {
      return;
    }
    const scrollHeight = Number(list.scrollHeight) || 0;
    const clientHeight = Number(list.clientHeight) || 0;
    const maxScroll = Math.max(0, scrollHeight - clientHeight);
    const rawTarget = Number(desiredScrollTop);
    const target = Number.isFinite(rawTarget) ? Math.max(0, Math.min(maxScroll, rawTarget)) : Math.max(0, Math.min(maxScroll, list.scrollTop));
    if (Math.abs(list.scrollTop - target) > INLINE_QUEUE_SCROLL_EPSILON) {
      list.scrollTop = target;
    }
  }
  function applyInlineQueuePendingFocus() {
    const list = getInlineQueueList();
    if (!inlineQueuePendingFocusId || !list) {
      clearInlineQueuePendingFocus();
      return;
    }
    const expectedListId = inlineQueuePendingFocusListId || null;
    const currentListId = inlinePlaylistState.currentListId || null;
    if (expectedListId !== null && expectedListId !== currentListId) {
      clearInlineQueuePendingFocus();
      return;
    }
    const items = list.querySelectorAll(".video-item");
    let target = null;
    for (const element of items) {
      if (element instanceof HTMLElement && element.dataset.videoId === inlineQueuePendingFocusId) {
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
        const listRect = list.getBoundingClientRect();
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

  // src/content/inline-queue/dragDrop.js
  var inlineQueueDragState = {
    videoId: null,
    dropIndex: null,
    draggingEl: null,
    pendingVideoId: null,
    pendingElement: null
  };
  var inlineQueueAutoScrollState = {
    pointerY: null,
    rafId: null
  };
  var INLINE_QUEUE_AUTO_SCROLL_THRESHOLD = 64;
  var INLINE_QUEUE_AUTO_SCROLL_MAX_STEP = 18;
  var inlineQueueDragDropContext = {
    hideInlineMoveMenu: null,
    updateInlinePlaylistState: null
  };
  function configureInlineQueueDragDrop(context = {}) {
    inlineQueueDragDropContext = {
      hideInlineMoveMenu: typeof context.hideInlineMoveMenu === "function" ? context.hideInlineMoveMenu : null,
      updateInlinePlaylistState: typeof context.updateInlinePlaylistState === "function" ? context.updateInlinePlaylistState : null
    };
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
    if (inlineQueueDragState.pendingElement instanceof HTMLElement && typeof inlineQueueDragState.pendingVideoId === "string" && inlineQueueDragState.pendingVideoId) {
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
    inlineQueueDragDropContext.hideInlineMoveMenu?.();
    inlineQueueDragState.videoId = videoId;
    inlineQueueDragState.dropIndex = null;
    inlineQueueDragState.draggingEl = item;
    item.classList.add("dragging");
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      try {
        event.dataTransfer.setData("text/plain", videoId);
      } catch (_) {
      }
      if (item !== targetItem && item instanceof HTMLElement) {
        setInlineQueueDragImage(event, item);
      }
    }
  }
  function setInlineQueueDragImage(event, item) {
    try {
      const rect = item.getBoundingClientRect();
      const offsetX = typeof event.clientX === "number" ? event.clientX - rect.left : rect.width / 2;
      const offsetY = typeof event.clientY === "number" ? event.clientY - rect.top : rect.height / 2;
      event.dataTransfer.setDragImage(item, offsetX, offsetY);
    } catch (_) {
      try {
        event.dataTransfer.setDragImage(item, 0, 0);
      } catch (__) {
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
    const handle = event.currentTarget instanceof HTMLElement ? event.currentTarget : event.target instanceof HTMLElement ? event.target.closest(".video-handle") : null;
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
    const scrolledNow = maybeAutoScrollInlineQueueList(
      pointerY,
      INLINE_QUEUE_AUTO_SCROLL_THRESHOLD,
      INLINE_QUEUE_AUTO_SCROLL_MAX_STEP
    );
    scheduleInlineQueueAutoScroll(pointerY, scrolledNow);
    clearInlineQueueDropIndicators();
    const list = getInlineQueueList();
    if (!list) {
      inlineQueueDragState.dropIndex = null;
      return;
    }
    const targetItem = event.target.closest(".video-item");
    const items = Array.from(list.querySelectorAll(".video-item"));
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
    const queueIds = Array.isArray(inlinePlaylistState.orderedVideoIds) ? inlinePlaylistState.orderedVideoIds : [];
    const videoId = inlineQueueDragState.videoId;
    const fromIndex = queueIds.indexOf(videoId);
    if (fromIndex === -1) {
      resetInlineQueueDragState();
      return;
    }
    let targetIndex = inlineQueueDragState.dropIndex;
    if (typeof targetIndex !== "number") {
      targetIndex = resolveInlineQueueDropIndex(event, queueIds.length);
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
    reorderInlineQueueVideo(videoId, adjustedIndex);
  }
  function resolveInlineQueueDropIndex(event, fallbackIndex) {
    const direct = event.target.closest(".video-item");
    const list = getInlineQueueList();
    if (!direct || !list) {
      return fallbackIndex;
    }
    const items = Array.from(list.querySelectorAll(".video-item"));
    const rect = direct.getBoundingClientRect();
    const before = event.clientY < rect.top + rect.height / 2;
    const baseIndex = items.indexOf(direct);
    return before ? baseIndex : baseIndex + 1;
  }
  function reorderInlineQueueVideo(videoId, targetIndex) {
    const payload = { videoId, targetIndex };
    if (inlinePlaylistState.currentListId) {
      payload.listId = inlinePlaylistState.currentListId;
    }
    setInlineQueuePendingFocus(videoId);
    sendMessage("playlist:reorder", payload).then((state2) => {
      if (state2 && typeof state2 === "object") {
        inlineQueueDragDropContext.updateInlinePlaylistState?.(state2);
      } else {
        clearInlineQueuePendingFocus();
      }
    }).catch((err) => {
      console.warn("Failed to reorder inline queue", err);
      clearInlineQueuePendingFocus();
    });
  }
  function handleInlineQueueDragEnd() {
    resetInlineQueueDragState();
  }
  function clearInlineQueueDropIndicators() {
    const list = getInlineQueueList();
    if (!list) {
      return;
    }
    list.querySelectorAll(".drop-before, .drop-after").forEach((el) => el.classList.remove("drop-before", "drop-after"));
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
    const scrolled = maybeAutoScrollInlineQueueList(
      pointerY,
      INLINE_QUEUE_AUTO_SCROLL_THRESHOLD,
      INLINE_QUEUE_AUTO_SCROLL_MAX_STEP
    );
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
  function stopInlineQueueAutoScroll() {
    if (inlineQueueAutoScrollState.rafId) {
      window.cancelAnimationFrame(inlineQueueAutoScrollState.rafId);
      inlineQueueAutoScrollState.rafId = null;
    }
    inlineQueueAutoScrollState.pointerY = null;
  }

  // src/content/inline-queue/ui.js
  var INLINE_QUEUE_SCROLL_EPSILON2 = 0.5;
  var inlineQueueUI = {
    container: null,
    brand: null,
    title: null,
    nowPlaying: null,
    progress: null,
    freeze: null,
    list: null,
    empty: null
  };
  var shellHandlers = {
    handleInlineQueueDragEnd: null,
    handleInlineQueueDragOver: null,
    handleInlineQueueDragStart: null,
    handleInlineQueueDrop: null,
    handleInlineQueueListClick: null,
    handleInlineQueueListKeyDown: null
  };
  function configureInlineQueueUI(handlers = {}) {
    shellHandlers = { ...shellHandlers, ...handlers };
  }
  function handleInlineQueueTitleClick(event) {
    if (event) {
      event.preventDefault();
    }
    const target = event?.currentTarget;
    const listId = target?.dataset?.listId || inlinePlaylistState.currentListId || "";
    const listName = target?.dataset?.listName || inlinePlaylistState.currentListName || "";
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
  function handleInlineQueueProgressClick(event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    autoScrollInlineQueueToCurrentItem(inlinePlaylistState.currentVideoId || null);
  }
  function handleInlineQueueProgressKeyDown(event) {
    if (!event) {
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      event.stopPropagation();
      autoScrollInlineQueueToCurrentItem(inlinePlaylistState.currentVideoId || null);
    }
  }
  function resetInlineQueueUIRefs() {
    inlineQueueUI.container = null;
    inlineQueueUI.brand = null;
    inlineQueueUI.title = null;
    inlineQueueUI.nowPlaying = null;
    inlineQueueUI.progress = null;
    inlineQueueUI.freeze = null;
    inlineQueueUI.list = null;
    inlineQueueUI.empty = null;
  }
  function teardownInlineQueueShell() {
    cancelInlineQueueRenderRetry();
    hideInlineMoveMenu();
    resetInlineQueueDragState();
    clearInlineQueuePendingFocus();
    if (inlineQueueUI.container && inlineQueueUI.container.isConnected) {
      inlineQueueUI.container.remove();
    }
    resetInlineQueueUIRefs();
    disconnectInlineQueueWatchObserver();
  }
  function hideInlineQueueSoft() {
    cancelInlineQueueRenderRetry();
    hideInlineMoveMenu();
    resetInlineQueueDragState();
    clearInlineQueuePendingFocus();
    if (!inlineQueueUI.container) {
      return;
    }
    inlineQueueUI.container.hidden = true;
    inlineQueueUI.container.dataset.visible = "0";
  }
  function bindInlineQueueList(list) {
    if (!list.dataset.ytaInlineBound) {
      list.addEventListener("click", shellHandlers.handleInlineQueueListClick);
      list.addEventListener("keydown", shellHandlers.handleInlineQueueListKeyDown);
      list.addEventListener("dragstart", shellHandlers.handleInlineQueueDragStart);
      list.addEventListener("dragover", shellHandlers.handleInlineQueueDragOver);
      list.addEventListener("drop", shellHandlers.handleInlineQueueDrop);
      list.addEventListener("dragend", shellHandlers.handleInlineQueueDragEnd);
      list.dataset.ytaInlineBound = "1";
    }
  }
  function bindInlineQueueContainer(container) {
    if (!container.dataset.ytaInlineDragBound) {
      container.addEventListener("dragover", shellHandlers.handleInlineQueueDragOver);
      container.addEventListener("drop", shellHandlers.handleInlineQueueDrop);
      container.dataset.ytaInlineDragBound = "1";
    }
  }
  function createInlineQueueElements() {
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
    title.textContent = "\u0413\u043B\u0430\u0432\u043D\u044B\u0439 \u043F\u043B\u0435\u0439\u043B\u0438\u0441\u0442";
    title.tabIndex = 0;
    title.setAttribute("role", "link");
    title.dataset.ytaInlineListTitle = "1";
    title.addEventListener("click", handleInlineQueueTitleClick);
    title.addEventListener("keydown", handleInlineQueueTitleKeyDown);
    headerLine.appendChild(title);
    const nowPlaying = document.createElement("span");
    nowPlaying.className = "yta-inline-queue__now-playing";
    nowPlaying.hidden = true;
    headerLine.appendChild(nowPlaying);
    const progress = document.createElement("span");
    progress.className = "yta-inline-queue__progress";
    progress.hidden = true;
    progress.tabIndex = -1;
    progress.setAttribute("role", "button");
    progress.addEventListener("click", handleInlineQueueProgressClick);
    progress.addEventListener("keydown", handleInlineQueueProgressKeyDown);
    progress.dataset.ytaInlineProgressBound = "1";
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
    empty.textContent = "\u0412 \u043E\u0447\u0435\u0440\u0435\u0434\u0438 \u043F\u043E\u043A\u0430 \u043D\u0435\u0442 \u0432\u0438\u0434\u0435\u043E. \u0414\u043E\u0431\u0430\u0432\u044C\u0442\u0435 \u0438\u0445 \u0447\u0435\u0440\u0435\u0437 \u0440\u0430\u0441\u0448\u0438\u0440\u0435\u043D\u0438\u0435.";
    container.append(header, empty, list);
    inlineQueueUI.container = container;
    inlineQueueUI.brand = brand;
    inlineQueueUI.title = title;
    inlineQueueUI.nowPlaying = nowPlaying;
    inlineQueueUI.progress = progress;
    inlineQueueUI.freeze = freeze;
    inlineQueueUI.list = list;
    inlineQueueUI.empty = empty;
    bindInlineQueueList(list);
    bindInlineQueueContainer(container);
  }
  function ensureInlineQueueElements() {
    const resolved = resolveInlineQueueHostElement();
    if (!resolved) {
      return null;
    }
    ensureInlineQueueLayoutListener();
    ensureInlineQueueWatchObserver();
    if (!inlineQueueUI.container) {
      createInlineQueueElements();
    }
    const { host, placement } = resolved;
    if (!host || !inlineQueueUI.container) {
      return null;
    }
    const container = inlineQueueUI.container;
    let mounted = false;
    if (placement === "stack") {
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
  function getInlineQueueCurrentItem(targetVideoId = null) {
    if (!inlineQueueUI.list) {
      return null;
    }
    if (targetVideoId) {
      const byId = inlineQueueUI.list.querySelector(
        `.video-item[data-video-id='${CSS.escape(targetVideoId)}']`
      );
      if (byId instanceof HTMLElement) {
        return byId;
      }
    }
    return inlineQueueUI.list.querySelector(
      ".yta-inline-queue__item[data-current='1'] .video-item"
    ) || inlineQueueUI.list.querySelector(".video-item.active");
  }
  function scrollInlineQueueToCurrentItem(targetVideoId = null) {
    if (!inlineQueueUI.list) {
      return false;
    }
    const currentItem = getInlineQueueCurrentItem(targetVideoId);
    if (!currentItem) {
      return false;
    }
    const list = inlineQueueUI.list;
    const listRect = list.getBoundingClientRect();
    const itemRect = currentItem.getBoundingClientRect();
    const delta = itemRect.top - listRect.top;
    if (Math.abs(delta) > INLINE_QUEUE_SCROLL_EPSILON2) {
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
  function autoScrollInlineQueueToCurrentItem(targetVideoId = null) {
    return scrollInlineQueueToCurrentItem(targetVideoId);
  }

  // src/content/inline-queue/item.js
  var INLINE_QUEUE_DURATION_PATTERN = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/;
  var inlineQueueDateFormatter = new Intl.DateTimeFormat("ru-RU", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
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
    const minutes = Math.floor(total % 3600 / 60);
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
        separator.textContent = "\xB7";
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
    return hasContent ? details : null;
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
        textClassName: "video-detail__text yta-inline-queue__detail-link"
      });
    }
    const published = formatInlineQueueDate(entry?.publishedAt);
    if (published) {
      parts.push({ text: published, textClassName: "video-detail__text" });
    }
    return createInlineQueueDetailContainer(parts);
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
    const currentListId = typeof options.currentListId === "string" ? options.currentListId : "";
    const progressPercent = typeof options.progressPercent === "number" ? options.progressPercent : null;
    const item = document.createElement("li");
    item.className = "yta-inline-queue__item";
    const videoItem = document.createElement("div");
    videoItem.className = "video-item";
    if (allowPostpone) {
      videoItem.classList.add("video-item--has-postpone");
    }
    videoItem.dataset.videoId = entry.id;
    videoItem.dataset.index = String(index);
    if (currentListId) {
      videoItem.dataset.listId = currentListId;
    }
    videoItem.tabIndex = 0;
    videoItem.setAttribute("role", "button");
    const baseTitle = entry.title || "\u0411\u0435\u0437 \u043D\u0430\u0437\u0432\u0430\u043D\u0438\u044F";
    videoItem.setAttribute("aria-label", baseTitle);
    videoItem.title = baseTitle;
    const handle = document.createElement("button");
    handle.type = "button";
    handle.className = "video-handle";
    handle.title = "\u041F\u0435\u0440\u0435\u0442\u0430\u0449\u0438\u0442\u044C";
    handle.setAttribute("aria-label", "\u041F\u0435\u0440\u0435\u0442\u0430\u0449\u0438\u0442\u044C");
    handle.draggable = true;
    if (typeof options.onHandlePointerDown === "function") {
      handle.addEventListener("pointerdown", options.onHandlePointerDown);
      handle.addEventListener("mousedown", options.onHandlePointerDown);
    }
    videoItem.appendChild(handle);
    const thumbWrapper = document.createElement("div");
    thumbWrapper.className = "video-thumb-wrapper";
    const thumb = document.createElement("img");
    thumb.className = "video-thumb";
    thumb.decoding = "async";
    thumb.loading = "lazy";
    const thumbUrl = resolveThumbnailUrl(
      entry,
      entry.id ? `https://i.ytimg.com/vi/${entry.id}/mqdefault.jpg` : ""
    );
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
        "\u26A1",
        "\u0421\u043E\u0437\u0434\u0430\u0442\u044C \u0444\u0438\u043B\u044C\u0442\u0440 \u0434\u043B\u044F \u0432\u0438\u0434\u0435\u043E"
      );
      quickFilterBtn.dataset.videoId = entry.id;
      videoItem.appendChild(quickFilterBtn);
    }
    const removeBtn = createInlineQueueActionButton(
      "video-remove",
      "\u2715",
      "\u0423\u0434\u0430\u043B\u0438\u0442\u044C \u0438\u0437 \u043E\u0447\u0435\u0440\u0435\u0434\u0438"
    );
    videoItem.appendChild(removeBtn);
    if (allowPostpone) {
      const postponeBtn = createInlineQueueActionButton(
        "video-postpone",
        "\u2935",
        "\u041E\u0442\u043B\u043E\u0436\u0438\u0442\u044C \u0432 \u043A\u043E\u043D\u0435\u0446 \u0441\u043F\u0438\u0441\u043A\u0430"
      );
      videoItem.appendChild(postponeBtn);
    }
    const moveBtn = createInlineQueueActionButton(
      "video-move",
      "\u21C4",
      "\u041F\u0435\u0440\u0435\u043D\u0435\u0441\u0442\u0438 \u0432 \u0434\u0440\u0443\u0433\u043E\u0439 \u0441\u043F\u0438\u0441\u043E\u043A"
    );
    videoItem.appendChild(moveBtn);
    if (isCurrent) {
      videoItem.classList.add("active");
      item.dataset.current = "1";
    }
    item.appendChild(videoItem);
    return item;
  }

  // src/content/inline-queue/renderer.js
  var inlineQueueCountFormatter = new Intl.NumberFormat("ru-RU");
  function resolveInlineQueueCurrentEntry({
    entries,
    currentIndex,
    currentVideoId
  }) {
    if (currentIndex !== null && currentIndex >= 0 && currentIndex < entries.length) {
      return entries[currentIndex];
    }
    if (currentVideoId) {
      return entries.find((entry) => entry?.id === currentVideoId) || null;
    }
    return null;
  }
  function updateHeader(ui, entries, currentIndex, currentVideoId, currentEntry) {
    if (ui.brand) {
      ui.brand.textContent = "YTautoPlaylist";
    }
    if (ui.title) {
      const listName = (inlinePlaylistState.currentListName || "").trim();
      ui.title.textContent = listName || "\u0413\u043B\u0430\u0432\u043D\u044B\u0439 \u043F\u043B\u0435\u0439\u043B\u0438\u0441\u0442";
      ui.title.dataset.listId = inlinePlaylistState.currentListId || "";
      ui.title.dataset.listName = listName || "";
      ui.title.setAttribute(
        "aria-label",
        listName ? `\u041E\u0442\u043A\u0440\u044B\u0442\u044C \u0443\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u0435 \u0441\u043F\u0438\u0441\u043A\u043E\u043C "${listName}"` : "\u041E\u0442\u043A\u0440\u044B\u0442\u044C \u0443\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u0435 \u0441\u043F\u0438\u0441\u043A\u043E\u043C"
      );
    }
    if (ui.nowPlaying) {
      const channelTitle = (currentEntry?.channelTitle || "").trim();
      const videoTitle = (currentEntry?.title || "").trim();
      const nowPlayingText = [channelTitle, videoTitle].filter(Boolean).join(" \u2014 ");
      if (nowPlayingText) {
        ui.nowPlaying.title = nowPlayingText;
        ui.nowPlaying.hidden = false;
        ui.nowPlaying.textContent = nowPlayingText;
      } else {
        ui.nowPlaying.textContent = "";
        ui.nowPlaying.removeAttribute("title");
        ui.nowPlaying.hidden = true;
      }
    }
    if (ui.progress) {
      let progressText = "";
      if (entries.length && currentIndex !== null && currentIndex < entries.length) {
        const currentNumber = inlineQueueCountFormatter.format(currentIndex + 1);
        const totalNumber = inlineQueueCountFormatter.format(entries.length);
        progressText = `\u0412\u0438\u0434\u0435\u043E ${currentNumber} \u0438\u0437 ${totalNumber}`;
      } else if (currentVideoId && !inlinePlaylistState.videoIds.has(currentVideoId)) {
        progressText = "\u0421\u043C\u043E\u0442\u0440\u0438\u043C \u0434\u0440\u0443\u0433\u043E\u0435 \u0432\u0438\u0434\u0435\u043E";
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
        ui.freeze.textContent = "\u0410\u0432\u0442\u043E\u043E\u0447\u0438\u0441\u0442\u043A\u0430 \u0432\u044B\u043A\u043B\u044E\u0447\u0435\u043D\u0430";
        ui.freeze.hidden = false;
      } else {
        ui.freeze.hidden = true;
      }
    }
  }
  function renderItems(ui, entries, currentEntryId, options) {
    const allowPostpone = !inlinePlaylistState.freeze && entries.length > 1;
    entries.forEach((entry, index) => {
      if (!entry || typeof entry !== "object" || !entry.id) {
        return;
      }
      const isCurrent = Boolean(currentEntryId) && entry.id === currentEntryId;
      const item = createInlineQueueItem(entry, index, isCurrent, {
        allowPostpone,
        currentListId: inlinePlaylistState.currentListId,
        onHandlePointerDown: options.handleInlineQueueHandlePointerDown,
        progressPercent: getProgressPercent(
          inlinePlaylistState.progress,
          entry.id
        )
      });
      ui.list.appendChild(item);
    });
  }
  function createInlineQueueRenderer(options = {}) {
    let lastAutoScrollVideoId = null;
    let lastAutoScrollListId = null;
    function resetAutoScrollState() {
      lastAutoScrollVideoId = null;
      lastAutoScrollListId = null;
    }
    function hideSoft() {
      hideInlineQueueSoft();
      resetAutoScrollState();
    }
    function updateInlineQueueUI2() {
      const context = typeof options.determinePageContext === "function" ? options.determinePageContext() : "other";
      const controlsActive = Boolean(state && state.controlsActive);
      if (context !== "watch" || !controlsActive) {
        hideSoft();
        return;
      }
      if (typeof options.getCurrentVideoId === "function" && inlinePlaylistState.currentVideoId) {
        const pageVideoId = options.getCurrentVideoId();
        if (pageVideoId && inlinePlaylistState.currentVideoId !== pageVideoId && !inlinePlaylistState.videoIds.has(pageVideoId)) {
          hideSoft();
          return;
        }
      }
      const ui = ensureInlineQueueElements();
      if (!ui) {
        scheduleInlineQueueRenderRetry();
        return;
      }
      cancelInlineQueueRenderRetry();
      options.hideInlineMoveMenu?.();
      options.resetInlineQueueDragState?.();
      const entries = Array.isArray(inlinePlaylistState.queueEntries) ? inlinePlaylistState.queueEntries : [];
      const currentIndex = typeof inlinePlaylistState.currentIndex === "number" && inlinePlaylistState.currentIndex >= 0 ? inlinePlaylistState.currentIndex : null;
      const currentVideoId = inlinePlaylistState.currentVideoId;
      const currentEntry = resolveInlineQueueCurrentEntry({
        entries,
        currentIndex,
        currentVideoId
      });
      ui.container.hidden = false;
      ui.container.dataset.visible = "1";
      ui.container.dataset.listId = inlinePlaylistState.currentListId || "";
      updateHeader(ui, entries, currentIndex, currentVideoId, currentEntry);
      const previousScrollTop = ui.list && typeof ui.list.scrollTop === "number" ? ui.list.scrollTop : 0;
      const pendingScrollTop = getInlineQueuePendingScrollTop();
      const desiredScrollTop = pendingScrollTop !== null ? pendingScrollTop : previousScrollTop;
      ui.list.textContent = "";
      renderItems(ui, entries, currentEntry?.id || null, options);
      restoreInlineQueueScroll(ui.list, desiredScrollTop);
      applyInlineQueuePendingFocus();
      ui.container.dataset.empty = entries.length > 0 ? "0" : "1";
      const targetId = currentEntry?.id || null;
      const shouldAutoScroll = Boolean(targetId) && (lastAutoScrollVideoId !== targetId || lastAutoScrollListId !== (inlinePlaylistState.currentListId || null));
      if (shouldAutoScroll) {
        window.requestAnimationFrame(() => {
          if (autoScrollInlineQueueToCurrentItem(targetId) && inlineQueueUI.list) {
            lastAutoScrollVideoId = targetId;
            lastAutoScrollListId = inlinePlaylistState.currentListId || null;
            setInlineQueuePendingScrollTop(inlineQueueUI.list.scrollTop);
          }
        });
      }
    }
    return {
      hideInlineQueueSoft: hideSoft,
      resetAutoScrollState,
      updateInlineQueueUI: updateInlineQueueUI2
    };
  }

  // src/content/inline-queue/index.js
  var inlineQueueRenderer = createInlineQueueRenderer({
    determinePageContext,
    getCurrentVideoId,
    handleInlineQueueHandlePointerDown,
    hideInlineMoveMenu,
    resetInlineQueueDragState
  });
  configureInlineQueueLayout(() => updateInlineQueueUI());
  configureInlineQueueScrollFocus({
    getInlineQueueUI: () => inlineQueueUI
  });
  configureInlineQueueUI({
    handleInlineQueueDragEnd,
    handleInlineQueueDragOver,
    handleInlineQueueDragStart,
    handleInlineQueueDrop,
    handleInlineQueueListClick: handleInlineQueueListClick2,
    handleInlineQueueListKeyDown: handleInlineQueueListKeyDown2
  });
  configureInlineQueueDragDrop({
    hideInlineMoveMenu,
    updateInlinePlaylistState
  });
  configureInlineMoveMenu({
    updateInlinePlaylistState
  });
  function teardownInlineQueue() {
    teardownInlineQueueShell();
    inlineQueueRenderer.resetAutoScrollState();
  }
  var inlineQueueItemActionContext = {
    clearInlineQueuePendingFocus,
    hideInlineMoveMenu,
    setInlineQueuePendingFocus,
    showInlineMoveMenu,
    updateInlinePlaylistState
  };
  function handleInlineQueueListClick2(event) {
    handleInlineQueueListClick(event, inlineQueueItemActionContext);
  }
  function handleInlineQueueListKeyDown2(event) {
    handleInlineQueueListKeyDown(event, inlineQueueItemActionContext);
  }
  var updateInlineQueueUI = inlineQueueRenderer.updateInlineQueueUI;
  var inlinePlaylistStateSyncContext = {
    ensurePlaybackWatchdog: ensurePlaybackWatchdog2,
    updateInlineQueueUI,
    updatePageActions,
    updatePlayerControlsUI
  };
  function updateInlinePlaylistState(rawPresentation) {
    updateInlinePlaylistState2(rawPresentation, inlinePlaylistStateSyncContext);
  }
  async function refreshInlinePlaylistState() {
    await refreshInlinePlaylistState2(inlinePlaylistStateSyncContext);
  }

  // src/content/video-cards/overlays.js
  function createVideoCardOverlayController({ inlineOverlayObservers: inlineOverlayObservers2 }) {
    function stopInlineOverlayObserver(host) {
      const observer2 = inlineOverlayObservers2.get(host);
      if (observer2) {
        observer2.disconnect();
        inlineOverlayObservers2.delete(host);
      }
    }
    function findDirectOverlay(host) {
      if (!(host instanceof HTMLElement)) {
        return null;
      }
      return Array.from(host.children).find(
        (child) => child instanceof HTMLElement && child.classList.contains(INLINE_BUTTON_OVERLAY_CLASS)
      ) || null;
    }
    function findDirectOverlayButton(overlay) {
      if (!(overlay instanceof HTMLElement)) {
        return null;
      }
      return Array.from(overlay.children).find(
        (child) => child instanceof HTMLButtonElement && child.classList.contains(ADD_BUTTON_CLASS)
      ) || null;
    }
    function ensureInlineOverlay(host) {
      if (!(host instanceof HTMLElement)) {
        return null;
      }
      host.classList.add(CARD_OVERLAY_HOST_CLASS);
      let overlay = findDirectOverlay(host);
      if (!overlay) {
        overlay = document.createElement("div");
        overlay.className = INLINE_BUTTON_OVERLAY_CLASS;
        host.appendChild(overlay);
      }
      return overlay;
    }
    function observeInlineOverlay(host, button) {
      if (!(host instanceof HTMLElement)) {
        return null;
      }
      const ensure = () => {
        const overlay = ensureInlineOverlay(host);
        if (overlay && button && button.parentElement !== overlay) {
          overlay.appendChild(button);
        }
        return overlay;
      };
      const existing = inlineOverlayObservers2.get(host);
      if (existing) {
        return ensure();
      }
      const observer2 = new MutationObserver(() => {
        if (!host.isConnected) {
          stopInlineOverlayObserver(host);
          return;
        }
        ensure();
      });
      observer2.observe(host, { childList: true });
      inlineOverlayObservers2.set(host, observer2);
      return ensure();
    }
    function resolveOverlayHost(card) {
      if (!(card instanceof HTMLElement)) return card;
      const previewHost = card.querySelector("ytd-video-preview #player-container") || card.querySelector("ytd-video-preview") || card.querySelector("#inline-preview-player")?.closest(".html5-video-player") || null;
      if (previewHost instanceof HTMLElement) {
        return previewHost;
      }
      return card;
    }
    return {
      findDirectOverlay,
      findDirectOverlayButton,
      observeInlineOverlay,
      resolveOverlayHost,
      stopInlineOverlayObserver
    };
  }

  // src/content/video-cards/previewOverlay.js
  function createPreviewOverlayController({
    inlineButtonsByVideoId: inlineButtonsByVideoId2,
    observeInlineOverlay
  }) {
    const state2 = {
      previewEl: null,
      button: null,
      homeOverlay: null
    };
    let observer2 = null;
    let watcherReady = false;
    let syncPending = false;
    function detach() {
      if (state2.button && state2.homeOverlay?.isConnected) {
        state2.homeOverlay.appendChild(state2.button);
      }
      state2.previewEl = null;
      state2.button = null;
      state2.homeOverlay = null;
    }
    function attach(preview) {
      if (!(preview instanceof HTMLElement)) {
        detach();
        return;
      }
      if (!isShortsPreview(preview)) {
        detach();
        return;
      }
      const videoId = parseVideoIdFromPreview(preview);
      if (!videoId) {
        detach();
        return;
      }
      const button = inlineButtonsByVideoId2.get(videoId);
      if (!(button instanceof HTMLButtonElement)) {
        detach();
        return;
      }
      const host = preview.querySelector("#player-container") || preview.querySelector("#media-container") || preview;
      const overlay = observeInlineOverlay(host, null) || host;
      if (!overlay) {
        detach();
        return;
      }
      const currentHome = button.parentElement;
      if (overlay !== currentHome) {
        state2.homeOverlay = currentHome;
        overlay.appendChild(button);
      } else {
        state2.homeOverlay = currentHome;
      }
      state2.previewEl = preview;
      state2.button = button;
    }
    function ensureWatcher() {
      if (watcherReady) return;
      watcherReady = true;
      const sync = () => {
        const preview = document.querySelector("ytd-video-preview:not([hidden])") || document.querySelector("#video-preview:not([hidden])");
        if (preview) {
          attach(preview);
        } else {
          detach();
        }
      };
      const scheduleSync = () => {
        if (syncPending) return;
        syncPending = true;
        if (typeof window.requestAnimationFrame === "function") {
          window.requestAnimationFrame(() => {
            syncPending = false;
            sync();
          });
        } else {
          window.setTimeout(() => {
            syncPending = false;
            sync();
          }, 0);
        }
      };
      observer2 = new MutationObserver(scheduleSync);
      observer2.observe(document.documentElement || document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["hidden"]
      });
      sync();
    }
    return {
      detach,
      ensureWatcher,
      hasButton(button) {
        return state2.button === button;
      },
      stop() {
        observer2?.disconnect();
        observer2 = null;
        watcherReady = false;
        syncPending = false;
        detach();
      }
    };
  }
  function parseVideoIdFromPreview(preview) {
    if (!(preview instanceof HTMLElement)) return "";
    const anchor = preview.querySelector("a[href*='watch']:not([href='#'])") || preview.querySelector("a.ytp-title-link[href]");
    if (anchor) {
      const href = anchor.getAttribute("href") || anchor.href || "";
      const parsed = parseVideoId(href);
      if (parsed) return parsed;
    }
    const inlinePlayer = preview.querySelector("#inline-preview-player");
    if (inlinePlayer) {
      const dataVideoId = inlinePlayer.getAttribute("data-video-id");
      const parsed = parseVideoId(dataVideoId);
      if (parsed) return parsed;
    }
    const mediaLink = preview.querySelector("#media-container-link");
    if (mediaLink) {
      const href = mediaLink.getAttribute("href") || "";
      const parsed = parseVideoId(href);
      if (parsed) return parsed;
    }
    const previewContainer = preview.querySelector("#video-preview-container");
    if (previewContainer) {
      const href = previewContainer.getAttribute("href") || "";
      const parsed = parseVideoId(href);
      if (parsed) return parsed;
    }
    const player = preview.querySelector("ytd-player#inline-player");
    if (player) {
      const dataId = player.getAttribute("video-id") || player.getAttribute("data-video-id") || player.getAttribute("player-video-id");
      const parsed = parseVideoId(dataId);
      if (parsed) return parsed;
    }
    return "";
  }
  function isShortsPreview(preview) {
    if (!(preview instanceof HTMLElement)) return false;
    if (preview.querySelector("a[href*='/shorts/']")) {
      return true;
    }
    const attrHref = preview.getAttribute("href") || preview.getAttribute("data-ytEndpoint") || "";
    if (typeof attrHref === "string" && attrHref.includes("/shorts/")) {
      return true;
    }
    return false;
  }

  // src/content/video-cards/addFlow.js
  var PLAYLIST_SUCCESS_NOTIFICATION_THRESHOLD = 2e3;
  async function applyInlineAddResponse(response) {
    const { state: state2, added, requested, missing } = normalizeAddResponse(response);
    if (state2) {
      updateInlinePlaylistState(state2);
    } else {
      await refreshInlinePlaylistState();
    }
    return { added, requested, missing };
  }
  function clearPlaylistSuccessTimer(button, playlistSuccessTimers2) {
    const existing = playlistSuccessTimers2.get(button);
    if (existing) {
      window.clearTimeout(existing);
      playlistSuccessTimers2.delete(button);
    }
  }
  function maybeShowPlaylistSuccessNotification(metrics, durationMs) {
    if (typeof durationMs !== "number" || durationMs < PLAYLIST_SUCCESS_NOTIFICATION_THRESHOLD) {
      return;
    }
    if (typeof showPageActionStatus !== "function") {
      return;
    }
    const { added, requested, missing } = normalizeAddResponse(metrics);
    if (added || missing || requested !== null) {
      const summary = formatAddResultMessage({
        added,
        requested,
        missing,
        scopeLabel: "\u0432\u0438\u0434\u0435\u043E \u043F\u043B\u0435\u0439\u043B\u0438\u0441\u0442\u0430",
        alreadyMessage: "\u0412\u0441\u0435 \u0432\u0438\u0434\u0435\u043E \u043F\u043B\u0435\u0439\u043B\u0438\u0441\u0442\u0430 \u0443\u0436\u0435 \u0432 \u0441\u043F\u0438\u0441\u043A\u0435"
      });
      if (summary && summary.message) {
        showPageActionStatus(summary.message, summary.kind, 3600);
        return;
      }
    }
    const baseMessage = added ? `\u0414\u043E\u0431\u0430\u0432\u043B\u0435\u043D\u043E ${added} \u0432\u0438\u0434\u0435\u043E \u0438\u0437 \u043F\u043B\u0435\u0439\u043B\u0438\u0441\u0442\u0430` : missing ? `\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0434\u043E\u0431\u0430\u0432\u0438\u0442\u044C ${missing} \u0432\u0438\u0434\u0435\u043E \u0438\u0437 \u043F\u043B\u0435\u0439\u043B\u0438\u0441\u0442\u0430` : "\u041F\u043B\u0435\u0439\u043B\u0438\u0441\u0442 \u043E\u0431\u0440\u0430\u0431\u043E\u0442\u0430\u043D";
    const kind = added ? "success" : missing ? "error" : "info";
    showPageActionStatus(baseMessage, kind, 3600);
  }
  function showPlaylistSuccess(button, metrics, durationMs, playlistSuccessTimers2) {
    if (!(button instanceof HTMLButtonElement)) {
      return;
    }
    clearPlaylistSuccessTimer(button, playlistSuccessTimers2);
    button.dataset.ytaStatus = "success";
    button.disabled = true;
    syncInlineButtonState(button);
    playlistSuccessTimers2.delete(button);
    maybeShowPlaylistSuccessNotification(metrics, durationMs);
  }
  async function sendInlineAddRequest({ playlistId, videoId, listId }) {
    const payload = playlistId ? {
      playlistId,
      listId: listId || void 0
    } : {
      videoIds: [videoId],
      listId: listId || void 0
    };
    return playlistId ? sendMessage("playlist:addPlaylist", payload) : sendMessage("playlist:addByIds", payload);
  }

  // src/content/video-cards/buttonOwnership.js
  function createCardButtonOwnership({
    overlays: overlays2,
    previewOverlay: previewOverlay2,
    playlistSuccessTimers: playlistSuccessTimers2,
    inlineButtonsByVideoId: inlineButtonsByVideoId2,
    inlineButtonOwners: inlineButtonOwners2
  }) {
    function forgetButtonVideo(button) {
      const previousVideoId = parseVideoId(button?.dataset?.videoId);
      if (previousVideoId) {
        inlineButtonsByVideoId2.delete(previousVideoId);
      }
    }
    function removeOwnedButton(button) {
      if (!(button instanceof HTMLButtonElement)) return;
      clearPlaylistSuccessTimer(button, playlistSuccessTimers2);
      forgetButtonVideo(button);
      if (previewOverlay2.hasButton(button)) {
        previewOverlay2.detach();
      }
      inlineButtonOwners2.delete(button);
      button.remove();
    }
    function getButtonOwnerCard(button) {
      if (!(button instanceof HTMLButtonElement)) return null;
      const explicitOwner = inlineButtonOwners2.get(button);
      if (explicitOwner instanceof HTMLElement) return explicitOwner;
      const closestCard = button.closest(VIDEO_CARD_SELECTOR);
      return closestCard instanceof HTMLElement ? closestCard : null;
    }
    function findCardOwnedButtons(card) {
      if (!(card instanceof HTMLElement)) return [];
      return Array.from(card.querySelectorAll(`.${ADD_BUTTON_CLASS}`)).filter(
        (button) => getButtonOwnerCard(button) === card
      );
    }
    function findCardPrimaryButton(card, overlay) {
      if (!(card instanceof HTMLElement)) return null;
      const directButton = overlays2.findDirectOverlayButton(overlay);
      if (directButton && getButtonOwnerCard(directButton) === card) {
        return directButton;
      }
      const ownedButtons = findCardOwnedButtons(card);
      return ownedButtons.length ? ownedButtons[0] : null;
    }
    function removeExtraCardButtons(card, keepButton) {
      const ownedButtons = findCardOwnedButtons(card);
      ownedButtons.forEach((button) => {
        if (button !== keepButton) {
          removeOwnedButton(button);
        }
      });
    }
    function bindButtonTarget(button, target) {
      if (!(button instanceof HTMLButtonElement) || !target) return;
      const previousVideoId = parseVideoId(button.dataset.videoId);
      if (target.type === "playlist") {
        if (previousVideoId) {
          inlineButtonsByVideoId2.delete(previousVideoId);
        }
        button.dataset.playlistId = target.id;
        delete button.dataset.videoId;
        button.title = "\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u0432\u0441\u0435 \u0432\u0438\u0434\u0435\u043E \u043F\u043B\u0435\u0439\u043B\u0438\u0441\u0442\u0430 \u0432 \u043E\u0447\u0435\u0440\u0435\u0434\u044C";
        if (previewOverlay2.hasButton(button)) {
          previewOverlay2.detach();
        }
        return;
      }
      if (previousVideoId && previousVideoId !== target.id) {
        inlineButtonsByVideoId2.delete(previousVideoId);
      }
      button.dataset.videoId = target.id;
      delete button.dataset.playlistId;
      button.title = "\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u0432 \u043E\u0447\u0435\u0440\u0435\u0434\u044C \u0440\u0430\u0441\u0448\u0438\u0440\u0435\u043D\u0438\u044F";
      inlineButtonsByVideoId2.set(target.id, button);
    }
    return {
      bindButtonTarget,
      findCardOwnedButtons,
      findCardPrimaryButton,
      forgetButtonVideo,
      removeExtraCardButtons,
      removeOwnedButton
    };
  }

  // src/content/video-cards/cleanup.js
  function createVideoCardCleanup({
    applyProgress,
    buttonOwnership,
    inlineButtonsByVideoId: inlineButtonsByVideoId2,
    inlineOverlayHosts: inlineOverlayHosts2,
    overlays: overlays2,
    previewOverlay: previewOverlay2,
    scheduleRetry
  }) {
    function cleanupInlineQueueAddButtons(scope, inlineQueueSelector) {
      const roots = [];
      if (scope instanceof HTMLElement && scope.matches(inlineQueueSelector)) {
        roots.push(scope);
      }
      if (scope?.querySelectorAll) {
        roots.push(...scope.querySelectorAll(inlineQueueSelector));
      }
      roots.forEach((root) => {
        if (!(root instanceof HTMLElement)) return;
        root.querySelectorAll(`.${ADD_BUTTON_CLASS}`).forEach((button) => {
          buttonOwnership.removeOwnedButton(button);
        });
        root.querySelectorAll(`.${INLINE_BUTTON_OVERLAY_CLASS}`).forEach((overlay) => {
          overlay.remove();
        });
        root.querySelectorAll(`.${CARD_OVERLAY_HOST_CLASS}`).forEach((node) => {
          node.classList.remove(CARD_OVERLAY_HOST_CLASS);
        });
        root.querySelectorAll(`.${THUMB_HOST_CLASS}`).forEach((node) => {
          node.classList.remove(THUMB_HOST_CLASS);
        });
        root.querySelectorAll(`[${CARD_MARK}]`).forEach((node) => {
          node.removeAttribute(CARD_MARK);
          node.removeAttribute("data-yta-target-type");
          node.removeAttribute("data-yta-target-id");
          node.removeAttribute("data-yta-video-id");
        });
      });
    }
    function clearCardDecoration(card, { retry = false } = {}) {
      if (!(card instanceof HTMLElement)) return;
      card.classList.remove(CARD_OVERLAY_HOST_CLASS);
      card.removeAttribute("data-yta-video-id");
      card.removeAttribute("data-yta-target-id");
      card.removeAttribute("data-yta-target-type");
      card.removeAttribute(CARD_MARK);
      buttonOwnership.findCardOwnedButtons(card).forEach((button) => {
        buttonOwnership.removeOwnedButton(button);
      });
      const previousHost = inlineOverlayHosts2.get(card);
      if (previousHost) {
        overlays2.stopInlineOverlayObserver(previousHost);
        inlineOverlayHosts2.delete(card);
        previousHost.classList.remove(CARD_OVERLAY_HOST_CLASS);
        const overlay = overlays2.findDirectOverlay(previousHost);
        if (overlay && !overlays2.findDirectOverlayButton(overlay)) {
          overlay.remove();
        }
      } else {
        overlays2.stopInlineOverlayObserver(card);
        const overlay = overlays2.findDirectOverlay(card);
        if (overlay && !overlays2.findDirectOverlayButton(overlay)) {
          overlay.remove();
        }
      }
      applyProgress(card, null);
      if (retry) {
        scheduleRetry(card);
      }
    }
    function resetVideoCardDecorations2(root = document) {
      const run = () => {
        const scope = root instanceof Document || root instanceof HTMLElement ? root : document;
        previewOverlay2.detach();
        inlineButtonsByVideoId2.clear();
        scope.querySelectorAll(`.${ADD_BUTTON_CLASS}`).forEach((button) => {
          buttonOwnership.removeOwnedButton(button);
        });
        scope.querySelectorAll(VIDEO_CARD_SELECTOR).forEach((card) => {
          clearCardDecoration(card, { retry: false });
        });
        scope.querySelectorAll(`.${THUMB_HOST_CLASS}`).forEach((host) => {
          if (host instanceof HTMLElement) {
            host.classList.remove(THUMB_HOST_CLASS);
          }
        });
      };
      if (typeof ytaDiagMeasure === "function") {
        ytaDiagMeasure("videoCards.resetVideoCardDecorations", run);
        return;
      }
      run();
    }
    return {
      cleanupInlineQueueAddButtons,
      clearCardDecoration,
      resetVideoCardDecorations: resetVideoCardDecorations2
    };
  }

  // src/content/video-cards/decorations.js
  var INLINE_QUEUE_SELECTOR = ".yta-inline-queue";
  var MAX_CARD_RETRY_ATTEMPTS = 6;
  function clearCardRetryTimeout(card) {
    const retryState = cardRetryState.get(card);
    if (!retryState?.timeout) return;
    clearTimeout(retryState.timeout);
    cardRetryState.set(card, {
      attempts: retryState.attempts,
      timeout: null
    });
  }
  function forgetCardRetry(card) {
    cardRetryState.delete(card);
  }
  function scheduleCardRetry(card, retryCallback) {
    if (!(card instanceof HTMLElement)) return;
    const existing = cardRetryState.get(card) || { attempts: 0, timeout: null };
    if (existing.timeout || existing.attempts >= MAX_CARD_RETRY_ATTEMPTS) return;
    const attempts = existing.attempts + 1;
    const delay2 = Math.min(500, 75 * attempts);
    const timeout = window.setTimeout(() => {
      if (!document.contains(card)) {
        cardRetryState.delete(card);
        return;
      }
      cardRetryState.set(card, { attempts, timeout: null });
      retryCallback(card);
    }, delay2);
    cardRetryState.set(card, { attempts, timeout });
  }
  function shouldEnhanceVideoCardCandidate({
    insideInlineQueue,
    hasNestedCandidate
  }) {
    return !insideInlineQueue && !hasNestedCandidate;
  }
  function createVideoCardDecorationController({
    overlays: overlays2,
    previewOverlay: previewOverlay2,
    playlistSuccessTimers: playlistSuccessTimers2,
    inlineOverlayHosts: inlineOverlayHosts2,
    inlineButtonsByVideoId: inlineButtonsByVideoId2,
    inlineButtonOwners: inlineButtonOwners2
  }) {
    const buttonOwnership = createCardButtonOwnership({
      overlays: overlays2,
      previewOverlay: previewOverlay2,
      playlistSuccessTimers: playlistSuccessTimers2,
      inlineButtonsByVideoId: inlineButtonsByVideoId2,
      inlineButtonOwners: inlineButtonOwners2
    });
    const cleanup = createVideoCardCleanup({
      applyProgress: applyCardProgress,
      buttonOwnership,
      inlineButtonsByVideoId: inlineButtonsByVideoId2,
      inlineOverlayHosts: inlineOverlayHosts2,
      overlays: overlays2,
      previewOverlay: previewOverlay2,
      scheduleRetry: (card) => scheduleCardRetry(card, decorateVideoCard)
    });
    function isInsideInlineQueue(node) {
      return node instanceof HTMLElement && typeof node.closest === "function" && Boolean(node.closest(INLINE_QUEUE_SELECTOR));
    }
    function resolveFreshTargetForButton(button) {
      if (!(button instanceof HTMLButtonElement)) return null;
      const ownerCard = inlineButtonOwners2.get(button);
      if (ownerCard instanceof HTMLElement && ownerCard.isConnected) {
        return determineCardTarget(ownerCard) || null;
      }
      const closestCard = button.closest(VIDEO_CARD_SELECTOR);
      if (closestCard instanceof HTMLElement && closestCard.isConnected) {
        return determineCardTarget(closestCard) || null;
      }
      return null;
    }
    async function handleAddButtonClick(event, button) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      const freshTarget = resolveFreshTargetForButton(button);
      if (!freshTarget) return;
      buttonOwnership.bindButtonTarget(button, freshTarget);
      const videoId = button.dataset.videoId;
      const playlistId = button.dataset.playlistId;
      if (!videoId && !playlistId) return;
      if (button.dataset.ytaStatus === "pending") return;
      if (videoId && (button.dataset.ytaStatus === "present" || isVideoInCurrentList(videoId))) {
        return;
      }
      clearPlaylistSuccessTimer(button, playlistSuccessTimers2);
      const startedAt = playlistId ? Date.now() : 0;
      let addMetrics = { added: 0, requested: null, missing: 0 };
      button.dataset.ytaStatus = "pending";
      button.disabled = true;
      syncInlineButtonState(button);
      try {
        const response = await sendInlineAddRequest({
          playlistId,
          videoId,
          listId: inlinePlaylistState.currentListId || void 0
        });
        addMetrics = await applyInlineAddResponse(response);
      } catch (err) {
        delete button.dataset.ytaStatus;
        button.disabled = false;
        syncInlineButtonState(button);
        return;
      }
      if (playlistId) {
        showPlaylistSuccess(
          button,
          addMetrics,
          startedAt ? Date.now() - startedAt : 0,
          playlistSuccessTimers2
        );
      } else {
        delete button.dataset.ytaStatus;
        syncInlineButtonState(button);
      }
    }
    function createAddButton(overlay, overlayHost) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = ADD_BUTTON_CLASS;
      button.addEventListener(
        "click",
        (event) => {
          void handleAddButtonClick(event, button);
        },
        true
      );
      overlay.appendChild(button);
      overlays2.observeInlineOverlay(overlayHost, button);
      return button;
    }
    function decorateVideoCard(card) {
      if (!(card instanceof HTMLElement)) return;
      if (isInsideInlineQueue(card)) {
        cleanup.clearCardDecoration(card, { retry: false });
        return;
      }
      previewOverlay2.ensureWatcher();
      clearCardRetryTimeout(card);
      const target = determineCardTarget(card);
      if (!target) {
        cleanup.clearCardDecoration(card, { retry: true });
        return;
      }
      forgetCardRetry(card);
      const previousType = card.getAttribute("data-yta-target-type");
      const previousId = card.getAttribute("data-yta-target-id");
      card.setAttribute("data-yta-target-type", target.type);
      card.setAttribute("data-yta-target-id", target.id);
      card.removeAttribute("data-yta-video-id");
      let host = card.querySelector("ytd-thumbnail") || card.querySelector("a#thumbnail") || card.querySelector("yt-img-shadow") || card.querySelector(".ytLockupViewModelContentImage") || card.querySelector(".yt-lockup-view-model__content-image") || card.querySelector("yt-thumbnail-view-model") || card.querySelector(".shortsLockupViewModelHostThumbnailParentContainer") || card.querySelector(".shortsLockupViewModelHostThumbnailContainer") || card.querySelector("a.shortsLockupViewModelHostEndpoint");
      if (host instanceof HTMLElement) {
        host.classList.add(THUMB_HOST_CLASS);
      } else {
        host = card;
        host.classList.add(THUMB_HOST_CLASS);
      }
      const overlayHost = overlays2.resolveOverlayHost(card) || card;
      const previousHost = inlineOverlayHosts2.get(card);
      if (previousHost && previousHost !== overlayHost) {
        overlays2.stopInlineOverlayObserver(previousHost);
      }
      inlineOverlayHosts2.set(card, overlayHost);
      overlayHost.classList.add(CARD_OVERLAY_HOST_CLASS);
      const overlay = overlays2.observeInlineOverlay(overlayHost, null) || overlayHost;
      let button = buttonOwnership.findCardPrimaryButton(card, overlay);
      if (!button && target.type === "video") {
        const mappedButton = inlineButtonsByVideoId2.get(target.id);
        if (mappedButton instanceof HTMLButtonElement) {
          button = mappedButton;
        }
      }
      if (button && button.parentElement !== overlay) {
        overlay.appendChild(button);
      }
      if (!button) {
        button = createAddButton(overlay, overlayHost);
      } else {
        overlays2.observeInlineOverlay(overlayHost, button);
      }
      if (previousType === "video" && previousId && (target.type !== "video" || previousId !== target.id)) {
        inlineButtonsByVideoId2.delete(previousId);
      }
      buttonOwnership.bindButtonTarget(button, target);
      inlineButtonOwners2.set(button, card);
      buttonOwnership.removeExtraCardButtons(card, button);
      if (target.type === "playlist" && previousId && previousId !== target.id) {
        inlineButtonsByVideoId2.delete(previousId);
      }
      syncInlineButtonState(button);
      applyCardProgress(card, target.type === "video" ? target.id : null);
      if (previousType === target.type && previousId === target.id && card.hasAttribute(CARD_MARK)) {
        return;
      }
      card.setAttribute(CARD_MARK, "1");
    }
    function enhanceVideoCards2(root = document) {
      const run = () => {
        if (!root) return;
        cleanup.cleanupInlineQueueAddButtons(root, INLINE_QUEUE_SELECTOR);
        if (root instanceof HTMLElement && root.matches(VIDEO_CARD_SELECTOR) && shouldEnhanceVideoCardCandidate({
          insideInlineQueue: isInsideInlineQueue(root),
          hasNestedCandidate: hasNestedCardCandidate(root, VIDEO_CARD_SELECTOR)
        })) {
          decorateVideoCard(root);
        } else if (root instanceof HTMLElement && root.matches(VIDEO_CARD_SELECTOR)) {
          cleanup.clearCardDecoration(root, { retry: false });
        }
        if (root.querySelectorAll) {
          root.querySelectorAll(VIDEO_CARD_SELECTOR).forEach((card) => {
            const shouldEnhance = shouldEnhanceVideoCardCandidate({
              insideInlineQueue: isInsideInlineQueue(card),
              hasNestedCandidate: hasNestedCardCandidate(card, VIDEO_CARD_SELECTOR)
            });
            if (!shouldEnhance) {
              cleanup.clearCardDecoration(card, { retry: false });
              return;
            }
            decorateVideoCard(card);
          });
        }
      };
      if (typeof ytaDiagMeasure === "function") {
        ytaDiagMeasure("videoCards.enhanceVideoCards", run);
        return;
      }
      run();
    }
    return {
      enhanceVideoCards: enhanceVideoCards2,
      resetVideoCardDecorations: cleanup.resetVideoCardDecorations
    };
  }

  // src/content/video-cards/index.js
  var playlistSuccessTimers = /* @__PURE__ */ new WeakMap();
  var inlineOverlayObservers = /* @__PURE__ */ new WeakMap();
  var inlineOverlayHosts = /* @__PURE__ */ new WeakMap();
  var inlineButtonsByVideoId = /* @__PURE__ */ new Map();
  var inlineButtonOwners = /* @__PURE__ */ new WeakMap();
  var overlays = createVideoCardOverlayController({
    inlineOverlayObservers
  });
  var previewOverlay = createPreviewOverlayController({
    inlineButtonsByVideoId,
    observeInlineOverlay: overlays.observeInlineOverlay
  });
  var decorations = createVideoCardDecorationController({
    overlays,
    previewOverlay,
    playlistSuccessTimers,
    inlineOverlayHosts,
    inlineButtonsByVideoId,
    inlineButtonOwners
  });
  var enhanceVideoCards = decorations.enhanceVideoCards;
  var resetVideoCardDecorations = decorations.resetVideoCardDecorations;

  // src/content/core/navigation.js
  var pendingUiFrame = null;
  var pendingUiFrameType = null;
  var pendingUiScan = false;
  function measure(name, run) {
    if (typeof ytaDiagMeasure === "function") {
      return ytaDiagMeasure(name, run);
    }
    return run();
  }
  function flushScheduledUiUpdate() {
    measure("navigation.flushScheduledUiUpdate", () => {
      pendingUiFrame = null;
      pendingUiFrameType = null;
      const shouldScan = pendingUiScan;
      pendingUiScan = false;
      if (shouldScan) {
        scanForVideo();
      }
      updatePageActions();
      ensurePlayerControls2();
    });
  }
  function scheduleUiUpdate({ scan = false } = {}) {
    if (scan) {
      pendingUiScan = true;
    }
    if (pendingUiFrame !== null) {
      return;
    }
    if (typeof window.requestAnimationFrame === "function") {
      pendingUiFrameType = "raf";
      pendingUiFrame = window.requestAnimationFrame(() => {
        pendingUiFrame = null;
        pendingUiFrameType = null;
        flushScheduledUiUpdate();
      });
    } else {
      pendingUiFrameType = "timeout";
      pendingUiFrame = window.setTimeout(() => {
        pendingUiFrame = null;
        pendingUiFrameType = null;
        flushScheduledUiUpdate();
      }, 0);
    }
  }
  function cancelScheduledUiUpdate() {
    if (pendingUiFrame === null) {
      return;
    }
    if (pendingUiFrameType === "timeout") {
      window.clearTimeout(pendingUiFrame);
    } else if (pendingUiFrameType === "raf" && typeof window.cancelAnimationFrame === "function") {
      window.cancelAnimationFrame(pendingUiFrame);
    }
    pendingUiFrame = null;
    pendingUiFrameType = null;
    pendingUiScan = false;
  }
  function cancelPageCollection(label) {
    if (typeof cancelAddAllFromPage === "function") {
      try {
        cancelAddAllFromPage({ silent: true });
      } catch (err) {
        console.warn(`Failed to cancel page collection on ${label}`, err);
      }
      return;
    }
    if (typeof pageActions === "object" && pageActions?.collectAbort) {
      try {
        pageActions.collectAbort.abort();
      } catch (err) {
        console.warn(`Failed to abort page collection controller on ${label}`, err);
      }
    }
  }
  function enhanceCardsFromMutationNode(node) {
    if (!(node instanceof HTMLElement)) {
      if (node && node.nodeType === Node.DOCUMENT_FRAGMENT_NODE && typeof node.querySelector === "function") {
        measure("navigation.enhanceVideoCards.fragment", () => {
          enhanceVideoCards(node);
        });
        return Boolean(node.querySelector("video"));
      }
      return false;
    }
    if (node.closest?.(
      "#movie_player, .html5-video-player, ytd-player, #player-container-outer"
    )) {
      return node.tagName === "VIDEO" || Boolean(node.querySelector?.("video"));
    }
    measure("navigation.enhanceVideoCards.node", () => {
      enhanceVideoCards(node);
    });
    return node.tagName === "VIDEO" || Boolean(node.querySelector?.("video"));
  }
  var observer = new MutationObserver((mutations) => {
    measure("navigation.mutationObserver", () => {
      let shouldScanVideo = false;
      for (const mutation of mutations) {
        if (mutation.type !== "childList") {
          continue;
        }
        mutation.addedNodes.forEach((node) => {
          if (enhanceCardsFromMutationNode(node)) {
            shouldScanVideo = true;
          }
        });
        mutation.removedNodes.forEach((node) => {
          if (!(node instanceof HTMLElement)) return;
          if (node === state.videoElement || node.contains(state.videoElement)) {
            shouldScanVideo = true;
          }
        });
      }
      const needsScan = shouldScanVideo || !state.videoElement || state.videoElement && !document.contains(state.videoElement);
      scheduleUiUpdate({ scan: needsScan });
    });
  });
  function resetStateForNavigation(event = null) {
    const eventType = typeof event?.type === "string" ? event.type : "";
    const isNavigateStart = eventType === "yt-navigate-start";
    measure("navigation.resetStateForNavigation", () => {
      maybeFinalizeVideoEndedBeforeNavigation2();
      if (isNavigateStart) {
        cancelScheduledUiUpdate();
        cancelPageCollection("navigation start");
        return;
      }
      try {
        resetVideoCardDecorations();
      } catch (err) {
        console.warn("Failed to reset video card decorations", err);
      }
      cancelScheduledUiUpdate();
      cancelPageCollection("navigation");
      detachVideoListeners();
      state.controlsActive = false;
      state.currentVideoId = parseVideoId(window.location.href) || null;
      state.lastReportedVideoId = null;
      state.lastUnavailableVideoId = null;
      resetPlaybackWatchdog(state.currentVideoId || null);
      stopPlaybackWatchdog();
      hidePlaybackNotification(true);
      updateMediaSessionHandlers();
      updatePlayerControlsUI();
      updatePageActions();
      try {
        teardownInlineQueue();
      } catch (err) {
        console.warn("Failed to reset inline queue UI", err);
      }
      void refreshInlinePlaylistState();
      setTimeout(() => {
        scanForVideo();
        enhanceVideoCards();
        ensurePlayerControls2();
        updatePageActions();
      }, 0);
    });
  }

  // src/content/core/interceptors.js
  function setupControlInterceptors() {
    document.addEventListener(
      "click",
      (event) => {
        if (!canHandlePlaybackActions()) return;
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
          requestNext2();
        } else if (hasPrev) {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
          requestPrevious2();
        }
      },
      true
    );
    document.addEventListener(
      "keydown",
      (event) => {
        const code = event.code;
        const key = event.key;
        const isMediaNext = code === "MediaTrackNext" || key === "MediaTrackNext";
        const isMediaPrevious = code === "MediaTrackPrevious" || key === "MediaTrackPrevious";
        if (isMediaNext || isMediaPrevious) {
          if (!canHandlePlaybackActions()) return;
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
          if (isMediaNext) {
            requestNext2();
          } else {
            requestPrevious2();
          }
          return;
        }
        if (!canHandlePlaybackActions()) return;
        if (event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
          const lower = (event.key || "").toLowerCase();
          if (lower === "n") {
            event.preventDefault();
            requestNext2();
          } else if (lower === "p") {
            event.preventDefault();
            requestPrevious2();
          }
        }
      },
      true
    );
  }

  // src/content/core/messages.js
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message.type !== "string") return;
    if (message.type === "player:getPlaybackStatus") {
      const video = state.videoElement || document.querySelector("video");
      if (!video) {
        sendResponse({ hasVideo: false });
        return false;
      }
      sendResponse({ hasVideo: true, playing: !video.paused && !video.ended });
      return false;
    }
    if (message.type === "player:togglePlayback") {
      const video = state.videoElement || document.querySelector("video");
      if (!video) {
        sendResponse({ handled: false, hasVideo: false });
        return false;
      }
      const mode = message?.mode || message?.action || "toggle";
      const wantsPlay = mode === "play" || mode === "toggle" && (video.paused || video.ended);
      if (mode === "pause" || mode === "toggle" && !wantsPlay) {
        video.pause();
        sendResponse({ handled: true, playing: false, hasVideo: true });
        return false;
      }
      try {
        const result = video.play();
        if (result && typeof result.then === "function") {
          result.then(() => {
            sendResponse({ handled: true, playing: true, hasVideo: true });
          }).catch((err) => {
            console.warn("Failed to resume playback", err);
            sendResponse({
              handled: false,
              playing: !video.paused && !video.ended,
              hasVideo: true,
              error: err?.message
            });
          });
          return true;
        }
        sendResponse({ handled: true, playing: true, hasVideo: true });
      } catch (err) {
        console.warn("Failed to resume playback", err);
        sendResponse({
          handled: false,
          playing: !video.paused && !video.ended,
          hasVideo: true,
          error: err?.message
        });
      }
      return false;
    }
    if (message.type === "collector:getCapabilities") {
      const context = determinePageContext();
      const caps = getContextCapabilities(context);
      sendResponse({ context, ...caps, controlling: Boolean(state.controlsActive) });
      return false;
    }
    if (message.type === "collector:collect") {
      const scope = message.scope || "current";
      const caps = getContextCapabilities();
      if (scope === "current" && !caps.canAddCurrent || scope === "page" && !caps.canAddAll || scope === "visible" && !caps.canAddVisible) {
        sendResponse({ videoIds: [], error: "NOT_ALLOWED" });
        return false;
      }
      if (scope === "page") {
        collectPageVideosWithContinuation().then((result) => {
          const videoIds2 = Array.isArray(result?.videoIds) ? result.videoIds : Array.isArray(result) ? result : [];
          sendResponse({
            videoIds: videoIds2,
            aborted: Boolean(result?.aborted),
            total: Number.isInteger(result?.total) ? result.total : videoIds2.length
          });
        }).catch((err) => {
          console.error("Failed to collect page videos", err);
          sendResponse({
            videoIds: [],
            error: err?.message || "FAILED_TO_COLLECT"
          });
        });
        return true;
      }
      const videoIds = collectVideoIds(scope);
      sendResponse({ videoIds });
      return false;
    }
    if (message.type === "playlist:collectProgress") {
      if (typeof handleCollectionProgressEvent === "function") {
        handleCollectionProgressEvent(message.event || message);
      }
      return false;
    }
    if (message.type === "playlist:stateUpdated") {
      if (message.state && typeof message.state === "object") {
        updateInlinePlaylistState(message.state);
      }
      const current = getCurrentVideoId();
      const playlistState = message.state || {};
      const currentQueue = Array.isArray(playlistState?.currentQueue?.queue) ? playlistState.currentQueue.queue : [];
      if (current && playlistState.currentVideoId === current) {
        setControlsActive(true);
      } else if (current && !currentQueue.some((item) => item && item.id === current)) {
        setControlsActive(false);
      }
    }
    return false;
  });

  // src/content/index.js
  function init() {
    injectStyles();
    void refreshInlinePlaylistState();
    ensurePlayerControls2();
    if (typeof ytaDiagMeasure === "function") {
      ytaDiagMeasure("init.enhanceVideoCards.document", () => {
        enhanceVideoCards(document);
      });
    } else {
      enhanceVideoCards(document);
    }
    updatePageActions();
    ensurePlayerControls2();
    scanForVideo();
    observer.observe(document.documentElement || document.body, {
      childList: true,
      subtree: true
    });
    setupControlInterceptors();
    window.addEventListener("yt-navigate-start", resetStateForNavigation, true);
    window.addEventListener("yt-navigate-finish", resetStateForNavigation, true);
    window.addEventListener("popstate", resetStateForNavigation);
    window.addEventListener("yt-page-data-updated", () => {
      if (determinePageContext() === "watch") {
        return;
      }
      setTimeout(() => {
        if (typeof ytaDiagMeasure === "function") {
          ytaDiagMeasure("init.ytPageDataUpdated.enhanceDocument", () => {
            enhanceVideoCards(document);
          });
        } else {
          enhanceVideoCards(document);
        }
      }, 0);
    });
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
