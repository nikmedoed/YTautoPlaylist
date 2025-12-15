const PLAYLIST_CARD_SELECTOR = [
  "ytd-playlist-renderer",
  "ytd-grid-playlist-renderer",
  "ytd-compact-playlist-renderer",
  "ytd-radio-renderer",
  "ytd-compact-radio-renderer",
  ".yt-lockup-view-model--collection",
  ".yt-lockup-view-model--collection-stack-2",
  ".yt-lockup-view-model--collection-stack-3",
].join(",");

const PLAYLIST_ID_PATTERN = /[\w-]{13,64}/;
const PLAYLIST_SUCCESS_NOTIFICATION_THRESHOLD = 2000;

const playlistSuccessTimers = new WeakMap();
const inlineOverlayObservers = new WeakMap();
const inlineOverlayHosts = new WeakMap();
const inlineButtonsByVideoId = new Map();
const previewOverlayState = {
  previewEl: null,
  button: null,
  homeOverlay: null,
};
let previewOverlayObserver = null;
let previewOverlayWatcherReady = false;
let previewOverlaySyncPending = false;

const PROGRESS_ELEMENT_CLASS = "video-thumb__progress";
const PROGRESS_BAR_CLASS = "video-thumb__progress-bar";

function stopInlineOverlayObserver(host) {
  const observer = inlineOverlayObservers.get(host);
  if (observer) {
    observer.disconnect();
    inlineOverlayObservers.delete(host);
  }
}

function ensureInlineOverlay(host) {
  if (!(host instanceof HTMLElement)) {
    return null;
  }
  host.classList.add(CARD_OVERLAY_HOST_CLASS);
  let overlay = host.querySelector(`.${INLINE_BUTTON_OVERLAY_CLASS}`);
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
  const existing = inlineOverlayObservers.get(host);
  if (existing) {
    return ensure();
  }
  const observer = new MutationObserver(() => {
    if (!host.isConnected) {
      stopInlineOverlayObserver(host);
      return;
    }
    ensure();
  });
  observer.observe(host, { childList: true });
  inlineOverlayObservers.set(host, observer);
  return ensure();
}

function resolveOverlayHost(card) {
  if (!(card instanceof HTMLElement)) return card;
  const previewHost =
    card.querySelector("ytd-video-preview #player-container") ||
    card.querySelector("ytd-video-preview") ||
    card.querySelector("#inline-preview-player")?.closest(".html5-video-player") ||
    null;
  if (previewHost instanceof HTMLElement) {
    return previewHost;
  }
  return card;
}

function detachPreviewOverlay() {
  if (previewOverlayState.button && previewOverlayState.homeOverlay?.isConnected) {
    previewOverlayState.homeOverlay.appendChild(previewOverlayState.button);
  }
  previewOverlayState.previewEl = null;
  previewOverlayState.button = null;
  previewOverlayState.homeOverlay = null;
}

function attachPreviewOverlay(preview) {
  if (!(preview instanceof HTMLElement)) {
    detachPreviewOverlay();
    return;
  }
  if (!isShortsPreview(preview)) {
    detachPreviewOverlay();
    return;
  }
  const videoId = parseVideoIdFromPreview(preview);
  if (!videoId) {
    detachPreviewOverlay();
    return;
  }
  const button = inlineButtonsByVideoId.get(videoId);
  if (!(button instanceof HTMLButtonElement)) {
    detachPreviewOverlay();
    return;
  }
  const host =
    preview.querySelector("#player-container") ||
    preview.querySelector("#media-container") ||
    preview;
  const overlay = observeInlineOverlay(host, null) || host;
  if (!overlay) {
    detachPreviewOverlay();
    return;
  }
  const currentHome = button.parentElement;
  if (overlay !== currentHome) {
    previewOverlayState.homeOverlay = currentHome;
    overlay.appendChild(button);
  } else {
    previewOverlayState.homeOverlay = currentHome;
  }
  previewOverlayState.previewEl = preview;
  previewOverlayState.button = button;
}

function ensurePreviewOverlayWatcher() {
  if (previewOverlayWatcherReady) return;
  previewOverlayWatcherReady = true;
  const sync = () => {
    const preview =
      document.querySelector("ytd-video-preview:not([hidden])") ||
      document.querySelector("#video-preview:not([hidden])");
    if (preview) {
      attachPreviewOverlay(preview);
    } else {
      detachPreviewOverlay();
    }
  };
  const scheduleSync = () => {
    if (previewOverlaySyncPending) return;
    previewOverlaySyncPending = true;
    if (typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(() => {
        previewOverlaySyncPending = false;
        sync();
      });
    } else {
      window.setTimeout(() => {
        previewOverlaySyncPending = false;
        sync();
      }, 0);
    }
  };
  previewOverlayObserver = new MutationObserver(scheduleSync);
  previewOverlayObserver.observe(document.documentElement || document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["hidden"],
  });
  sync();
}

function parseVideoIdFromPreview(preview) {
  if (!(preview instanceof HTMLElement)) return "";
  const anchor =
    preview.querySelector("a[href*='watch']:not([href='#'])") ||
    preview.querySelector("a.ytp-title-link[href]");
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
    const dataId =
      player.getAttribute("video-id") ||
      player.getAttribute("data-video-id") ||
      player.getAttribute("player-video-id");
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
  const attrHref =
    preview.getAttribute("href") ||
    preview.getAttribute("data-ytEndpoint") ||
    "";
  if (typeof attrHref === "string" && attrHref.includes("/shorts/")) {
    return true;
  }
  return false;
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

function resolveVideoProgressPercent(videoId) {
  if (!videoId) {
    return null;
  }
  if (!(inlinePlaylistState?.progress instanceof Map)) {
    return null;
  }
  const entry = inlinePlaylistState.progress.get(videoId);
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

function applyCardProgress(card, videoId) {
  if (!(card instanceof HTMLElement)) {
    return;
  }
  const hostCandidate = card.querySelector(`.${THUMB_HOST_CLASS}`);
  const host = hostCandidate instanceof HTMLElement ? hostCandidate : card;
  const percent = resolveVideoProgressPercent(videoId);
  let container = host.querySelector(`.${PROGRESS_ELEMENT_CLASS}`);
  if (!percent) {
    if (container) {
      container.remove();
    }
    return;
  }
  const clamped = Math.max(0, Math.min(100, percent));
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
  barEl.style.width = `${clamped}%`;
}

function isPlaylistCollectionCard(card) {
  if (!(card instanceof HTMLElement)) return false;
  if (card.matches(PLAYLIST_CARD_SELECTOR)) {
    return true;
  }
  if (card.classList) {
    return Array.from(card.classList).some((cls) =>
      /collection/i.test(cls)
    );
  }
  return (
    Boolean(card.querySelector("yt-collection-thumbnail-view-model")) ||
    Boolean(card.querySelector("yt-collections-stack")) ||
    Boolean(card.querySelector("ytd-playlist-thumbnail"))
  );
}

function findPlaylistIdInCard(card) {
  if (!(card instanceof HTMLElement)) return "";
  const directValues = [
    card.dataset?.playlistId,
    card.dataset?.listId,
    card.dataset?.contentId,
    card.getAttribute("data-playlist-id"),
    card.getAttribute("data-list-id"),
    card.getAttribute("data-content-id"),
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
    const parsed =
      parsePlaylistIdCandidate(node.getAttribute("data-playlist-id")) ||
      parsePlaylistIdCandidate(node.getAttribute("data-list-id")) ||
      parsePlaylistIdCandidate(node.getAttribute("data-content-id"));
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
  const direct =
    card.dataset?.videoId ||
    card.dataset?.ytVideoId ||
    card.dataset?.contentId ||
    card.getAttribute("data-video-id") ||
    card.getAttribute("data-content-id") ||
    card.getAttribute("data-entity-id") ||
    card.getAttribute("data-id") ||
    card.id;
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
    const parsed =
      parseVideoId(contentIdNode.getAttribute("data-content-id")) ||
      parseVideoId(contentIdNode.getAttribute("data-entity-id"));
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
    if (
      !/[?&]v=/.test(href) &&
      !/\/shorts\//.test(href) &&
      !/youtu\.be\//.test(href)
    ) {
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

function captureInlineVideoIdSet() {
  if (
    typeof inlinePlaylistState === "object" &&
    inlinePlaylistState &&
    inlinePlaylistState.videoIds instanceof Set
  ) {
    return new Set(inlinePlaylistState.videoIds);
  }
  return new Set();
}

function computeAddedFromPresentation(presentation, beforeSet) {
  if (
    !presentation ||
    typeof presentation !== "object" ||
    !(beforeSet instanceof Set)
  ) {
    return 0;
  }
  const queue = Array.isArray(presentation?.currentQueue?.queue)
    ? presentation.currentQueue.queue
    : [];
  const seen = new Set();
  let added = 0;
  for (const entry of queue) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const id = entry.id;
    if (typeof id !== "string" || !id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    if (!beforeSet.has(id)) {
      added += 1;
    }
  }
  return added;
}

function computeAddedFromInlineState(beforeSet) {
  if (!(beforeSet instanceof Set)) {
    return 0;
  }
  if (
    typeof inlinePlaylistState !== "object" ||
    !inlinePlaylistState ||
    !(inlinePlaylistState.videoIds instanceof Set)
  ) {
    return 0;
  }
  let added = 0;
  inlinePlaylistState.videoIds.forEach((id) => {
    if (typeof id === "string" && id && !beforeSet.has(id)) {
      added += 1;
    }
  });
  return added;
}

async function applyInlineAddResponse(response, beforeSet) {
  const requested =
    Number.isInteger(response?.requested) && response.requested >= 0
      ? response.requested
      : null;
  const missing =
    Number.isInteger(response?.missing) && response.missing > 0
      ? response.missing
      : 0;
  const stateCandidate =
    response &&
    typeof response === "object" &&
    response.state &&
    typeof response.state === "object"
      ? response.state
      : response && typeof response === "object"
      ? response
      : null;
  let added = 0;
  if (stateCandidate && typeof stateCandidate === "object") {
    added = computeAddedFromPresentation(stateCandidate, beforeSet);
    updateInlinePlaylistState(stateCandidate);
  } else {
    await refreshInlinePlaylistState();
    added = computeAddedFromInlineState(beforeSet);
  }
  return { added, requested, missing };
}

function clearPlaylistSuccessTimer(button) {
  const existing = playlistSuccessTimers.get(button);
  if (existing) {
    window.clearTimeout(existing);
    playlistSuccessTimers.delete(button);
  }
}

function maybeShowPlaylistSuccessNotification(metrics, durationMs) {
  if (
    typeof durationMs !== "number" ||
    durationMs < PLAYLIST_SUCCESS_NOTIFICATION_THRESHOLD
  ) {
    return;
  }
  if (typeof showPageActionStatus !== "function") {
    return;
  }
  const added =
    Number.isInteger(metrics?.added) && metrics.added > 0 ? metrics.added : 0;
  const requested =
    Number.isInteger(metrics?.requested) && metrics.requested >= 0
      ? metrics.requested
      : null;
  const missing =
    Number.isInteger(metrics?.missing) && metrics.missing > 0
      ? metrics.missing
      : 0;
  if (typeof formatAddResultMessage === "function") {
    const summary = formatAddResultMessage({
      added,
      requested,
      missing,
      scopeLabel: "видео плейлиста",
      alreadyMessage: "Все видео плейлиста уже в списке",
    });
    if (summary && summary.message) {
      showPageActionStatus(summary.message, summary.kind, 3600);
      return;
    }
  }
  const baseMessage = added
    ? `Добавлено ${added} видео из плейлиста`
    : missing
    ? `Не удалось добавить ${missing} видео из плейлиста`
    : "Плейлист обработан";
  const kind = added ? "success" : missing ? "error" : "info";
  showPageActionStatus(baseMessage, kind, 3600);
}

function showPlaylistSuccess(button, metrics, durationMs) {
  if (!(button instanceof HTMLButtonElement)) {
    return;
  }
  clearPlaylistSuccessTimer(button);
  button.dataset.ytaStatus = "success";
  button.disabled = true;
  syncInlineButtonState(button);
  playlistSuccessTimers.delete(button);
  maybeShowPlaylistSuccessNotification(metrics, durationMs);
}

function scheduleCardRetry(card) {
  if (!(card instanceof HTMLElement)) return;
  const existing = cardRetryState.get(card) || { attempts: 0, timeout: null };
  if (existing.timeout) {
    return;
  }
  if (existing.attempts >= 6) {
    return;
  }
  const attempts = existing.attempts + 1;
  const delay = Math.min(500, 75 * attempts);
  const timeout = window.setTimeout(() => {
    if (!document.contains(card)) {
      cardRetryState.delete(card);
      return;
    }
    cardRetryState.set(card, { attempts, timeout: null });
    decorateVideoCard(card);
  }, delay);
  cardRetryState.set(card, { attempts, timeout });
}

function decorateVideoCard(card) {
  if (!(card instanceof HTMLElement)) return;
  ensurePreviewOverlayWatcher();
  const retryState = cardRetryState.get(card);
  if (retryState?.timeout) {
    clearTimeout(retryState.timeout);
    cardRetryState.set(card, { attempts: retryState.attempts, timeout: null });
  }
  const target = determineCardTarget(card);
  if (!target) {
    card.classList.remove(CARD_OVERLAY_HOST_CLASS);
    card.removeAttribute("data-yta-video-id");
    card.removeAttribute("data-yta-target-id");
    card.removeAttribute("data-yta-target-type");
    card.removeAttribute(CARD_MARK);
    const existingButton = card.querySelector(`.${ADD_BUTTON_CLASS}`);
    if (existingButton && existingButton.parentElement) {
      clearPlaylistSuccessTimer(existingButton);
      existingButton.remove();
    }
    if (existingButton?.dataset?.videoId) {
      inlineButtonsByVideoId.delete(existingButton.dataset.videoId);
    }
    const previousHost = inlineOverlayHosts.get(card);
    if (previousHost) {
      stopInlineOverlayObserver(previousHost);
      inlineOverlayHosts.delete(card);
    } else {
      stopInlineOverlayObserver(card);
    }
    if (previewOverlayState.button === existingButton) {
      detachPreviewOverlay();
    }
    const overlay = card.querySelector(`.${INLINE_BUTTON_OVERLAY_CLASS}`);
    if (overlay && !overlay.querySelector(`.${ADD_BUTTON_CLASS}`)) {
      overlay.remove();
    }
    applyCardProgress(card, null);
    scheduleCardRetry(card);
    return;
  }
  cardRetryState.delete(card);
  const previousType = card.getAttribute("data-yta-target-type");
  const previousId = card.getAttribute("data-yta-target-id");
  card.setAttribute("data-yta-target-type", target.type);
  card.setAttribute("data-yta-target-id", target.id);
  card.removeAttribute("data-yta-video-id");
  let host =
    card.querySelector("ytd-thumbnail") ||
    card.querySelector("a#thumbnail") ||
    card.querySelector("yt-img-shadow") ||
    card.querySelector(".yt-lockup-view-model__content-image") ||
    card.querySelector("yt-thumbnail-view-model") ||
    card.querySelector(".shortsLockupViewModelHostThumbnailParentContainer") ||
    card.querySelector(".shortsLockupViewModelHostThumbnailContainer") ||
    card.querySelector("a.shortsLockupViewModelHostEndpoint");
  if (host instanceof HTMLElement) {
    host.classList.add(THUMB_HOST_CLASS);
  } else {
    host = card;
    host.classList.add(THUMB_HOST_CLASS);
  }
  const overlayHost = resolveOverlayHost(card) || card;
  const previousHost = inlineOverlayHosts.get(card);
  if (previousHost && previousHost !== overlayHost) {
    stopInlineOverlayObserver(previousHost);
  }
  inlineOverlayHosts.set(card, overlayHost);
  overlayHost.classList.add(CARD_OVERLAY_HOST_CLASS);
  const overlay = observeInlineOverlay(overlayHost, null) || overlayHost;
  let button =
    overlay.querySelector(`.${ADD_BUTTON_CLASS}`) ||
    card.querySelector(`.${ADD_BUTTON_CLASS}`);
  if (button && button.parentElement !== overlay) {
    overlay.appendChild(button);
  }
  if (!button) {
    button = document.createElement("button");
    button.type = "button";
    button.className = ADD_BUTTON_CLASS;
    button.addEventListener(
      "click",
      async (event) => {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        const videoId = button.dataset.videoId;
        const playlistId = button.dataset.playlistId;
        if (!videoId && !playlistId) {
          return;
        }
        if (button.dataset.ytaStatus === "pending") {
          return;
        }
        if (
          videoId &&
          (button.dataset.ytaStatus === "present" || isVideoInCurrentList(videoId))
        ) {
          return;
        }
        clearPlaylistSuccessTimer(button);
        const beforeSet = captureInlineVideoIdSet();
        const startedAt = playlistId ? Date.now() : 0;
        let addMetrics = { added: 0, requested: null, missing: 0 };
        button.dataset.ytaStatus = "pending";
        button.disabled = true;
        syncInlineButtonState(button);
        try {
          const response = playlistId
            ? await sendMessage("playlist:addPlaylist", {
                playlistId,
              })
            : await sendMessage("playlist:addByIds", {
                videoIds: [videoId],
              });
          addMetrics = await applyInlineAddResponse(response, beforeSet);
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
            startedAt ? Date.now() - startedAt : 0
          );
        } else {
          delete button.dataset.ytaStatus;
          syncInlineButtonState(button);
        }
      },
      true
    );
    overlay.appendChild(button);
    observeInlineOverlay(overlayHost, button);
  } else {
    observeInlineOverlay(overlayHost, button);
  }
  if (target.type === "playlist") {
    button.dataset.playlistId = target.id;
    delete button.dataset.videoId;
    button.title = "Добавить все видео плейлиста в очередь";
    if (previousId) {
      inlineButtonsByVideoId.delete(previousId);
    }
    if (previewOverlayState.button === button) {
      detachPreviewOverlay();
    }
  } else {
    if (previousId && previousId !== target.id) {
      inlineButtonsByVideoId.delete(previousId);
    }
    button.dataset.videoId = target.id;
    delete button.dataset.playlistId;
    button.title = "Добавить в очередь расширения";
    inlineButtonsByVideoId.set(target.id, button);
  }
  syncInlineButtonState(button);
  if (target.type === "video") {
    applyCardProgress(card, target.id);
  } else {
    applyCardProgress(card, null);
  }
  if (
    previousType === target.type &&
    previousId === target.id &&
    card.hasAttribute(CARD_MARK)
  ) {
    return;
  }
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

function syncVideoCardProgress(root = document) {
  const scope = root instanceof Document || root instanceof HTMLElement ? root : document;
  const cards = scope.querySelectorAll(
    `[${CARD_MARK}][data-yta-target-type="video"]`
  );
  cards.forEach((card) => {
    const videoId = card.getAttribute("data-yta-target-id") || "";
    applyCardProgress(card, videoId);
  });
}

globalThis.ytaSyncVideoCardProgress = () => {
  try {
    syncVideoCardProgress(document);
  } catch (err) {
    console.debug("Failed to sync video card progress", err);
  }
};
