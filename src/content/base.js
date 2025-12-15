const DEFAULT_LIST_ID = "default";

const state = {
  videoElement: null,
  controlsActive: false,
  currentVideoId: null,
  lastReportedVideoId: null,
  lastUnavailableVideoId: null,
};

const playerControls = {
  container: null,
  prev: null,
  next: null,
  postpone: null,
  start: null,
  addCurrent: null,
  position: null,
  host: null,
  observer: null,
};

const pageActions = {
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
  collectAbort: null,
};

const playbackNotification = {
  container: null,
  title: null,
  body: null,
  close: null,
  timeout: null,
};

const progressTracker = {
  videoId: null,
  lastSentPercent: null,
  lastSentAt: 0,
};

const inlinePlaylistState = {
  currentListId: null,
  currentListName: "",
  videoIds: new Set(),
  orderedVideoIds: [],
  indexById: new Map(),
  currentIndex: null,
  historyLength: 0,
  freeze: false,
  currentVideoId: null,
  queueEntries: [],
  entriesById: new Map(),
  lists: [],
  progress: new Map(),
};

const cardRetryState = new WeakMap();

const STYLE_ID = "yta-controller-style";
const CARD_MARK = "data-yta-enhanced";
const THUMB_HOST_CLASS = "yta-thumb-host";
const CARD_OVERLAY_HOST_CLASS = "yta-card-overlay-host";
const INLINE_BUTTON_OVERLAY_CLASS = "yta-inline-overlay";
const ADD_BUTTON_CLASS = "yta-inline-add";
const ADD_BUTTON_DONE_CLASS = "yta-inline-add--done";
const VIDEO_CARD_SELECTOR = [
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
  "div.yt-lockup-view-model",
  "div.ytm-lockup-view-model",
  "ytm-lockup-view-model",
  "ytm-shorts-lockup-view-model",
  ".shortsLockupViewModelHost",
].join(",");

const CONTEXT_CAPABILITIES = {
  watch: { canAddCurrent: true, canAddVisible: false, canAddAll: false },
  channelVideos: { canAddCurrent: false, canAddVisible: true, canAddAll: true },
  channelShorts: { canAddCurrent: false, canAddVisible: true, canAddAll: true },
  channelFeatured: { canAddCurrent: false, canAddVisible: true, canAddAll: false },
  channelHome: { canAddCurrent: false, canAddVisible: true, canAddAll: true },
  channelPlaylists: { canAddCurrent: false, canAddVisible: false, canAddAll: false },
  home: { canAddCurrent: false, canAddVisible: true, canAddAll: false },
  search: { canAddCurrent: false, canAddVisible: true, canAddAll: true },
  playlist: { canAddCurrent: false, canAddVisible: true, canAddAll: true },
  other: { canAddCurrent: false, canAddVisible: false, canAddAll: false },
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
const PAGE_SCROLL_DELAY = 420;

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
  const queueEntries = Array.isArray(inlinePlaylistState.queueEntries)
    ? inlinePlaylistState.queueEntries
    : [];
  if (queueEntries.some((entry) => entry && entry.id)) {
    return true;
  }
  const orderedIds = Array.isArray(inlinePlaylistState.orderedVideoIds)
    ? inlinePlaylistState.orderedVideoIds
    : [];
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
  const controlling = Boolean(state.controlsActive);
  const capabilities = {
    canAddCurrent: false,
    canAddVisible: false,
    canAddAll: false,
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
  const messagePayload =
    arguments.length >= 2 && payloadIsObject ? { ...payload } : {};
  const messageOptions =
    arguments.length >= 3 && options && typeof options === "object"
      ? { ...options }
      : {};
  const runtime = chrome?.runtime;
  if (!runtime || typeof runtime.sendMessage !== "function") {
    return handleRuntimeMessageError(
      { type, ...messagePayload },
      new Error("RUNTIME_UNAVAILABLE"),
      messageOptions
    );
  }

  const message = { type, ...messagePayload };
  const resolveWithError = (err) =>
    handleRuntimeMessageError(message, err, messageOptions);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value ?? null);
    };
    const handleError = (err) => {
      Promise.resolve(resolveWithError(err))
        .then(finish)
        .catch((handlerErr) => {
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
  return String(err);
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
