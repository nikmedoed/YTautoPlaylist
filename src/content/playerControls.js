const PLAYBACK_NOTIFICATION_DURATION = 8000;
const PROGRESS_UPDATE_INTERVAL_MS = 5000;
const autoCollectDisplay = {
  active: false,
};
const playerErrorObserverState = {
  observer: null,
  host: null,
};
let playerErrorEventsBound = false;

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
  const resolvedTitle = title && String(title).trim()
    ? String(title).trim()
    : "Список закончился";
  const resolvedBody = body && String(body).trim()
    ? String(body).trim()
    : "Очередь пустая";
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
  const timeout = Math.max(2000, Number(duration) || PLAYBACK_NOTIFICATION_DURATION);
  playbackNotification.timeout = window.setTimeout(() => {
    hidePlaybackNotification();
  }, timeout);
}

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

function detectUnavailableWatchState() {
  if (determinePageContext() !== "watch") {
    return false;
  }
  const host = document.querySelector("ytd-watch-flexy");
  if (host && host.hasAttribute("player-unavailable")) {
    const reason = host.getAttribute("player-unavailable") || "";
    const message = host.getAttribute("player-error-message") || reason;
    if (message && message.trim()) {
      handleVideoUnavailable({ reason: message });
      return true;
    }
  }
  const promo = document.querySelector("ytd-background-promo-renderer");
  if (promo && isElementVisible(promo)) {
    const title = promo.querySelector(".promo-title");
    const body = promo.querySelector(".promo-body-text");
    const text =
      (body && body.textContent && body.textContent.trim()) ||
      (title && title.textContent && title.textContent.trim()) ||
      "";
    handleVideoUnavailable({ reason: text });
    return true;
  }
  const errorRenderer = document.querySelector("ytd-player-error-message-renderer");
  if (errorRenderer && isElementVisible(errorRenderer)) {
    const text = errorRenderer.textContent ? errorRenderer.textContent.trim() : "";
    handleVideoUnavailable({ reason: text });
    return true;
  }
  return false;
}

function handleVideoUnavailable(details = {}) {
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
  const body = trimmedReason
    ? `Видео недоступно (${trimmedReason}). Перехожу к следующему`
    : "Видео недоступно. Перехожу к следующему";
  showPlaybackNotification({
    title: "Видео недоступно",
    body,
    duration: 6000,
  });
  sendMessage("player:videoUnavailable", { videoId, reason: trimmedReason }).then(
    (resp) => {
      const result = handlePlaybackAdvanceResponse(resp);
      if (!result || result.handled === false) {
        setControlsActive(false);
      }
    }
  );
}

function teardownPlayerErrorObserver() {
  if (playerErrorObserverState.observer) {
    try {
      playerErrorObserverState.observer.disconnect();
    } catch (_) {
      /* ignore */
    }
  }
  playerErrorObserverState.observer = null;
  playerErrorObserverState.host = null;
}

function handlePlayerErrorMutation(target) {
  if (!target) {
    return;
  }
  if (detectUnavailableWatchState()) {
    return;
  }
  const message = target.getAttribute("player-error-message");
  if (message && message.trim()) {
    handleVideoUnavailable({ reason: message });
  }
}

function ensurePlayerErrorObserver() {
  if (
    playerErrorObserverState.host &&
    !document.contains(playerErrorObserverState.host)
  ) {
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
  const observer = new MutationObserver(() => {
    handlePlayerErrorMutation(host);
  });
  observer.observe(host, {
    attributes: true,
    attributeFilter: ["player-error-message"],
  });
  playerErrorObserverState.observer = observer;
  playerErrorObserverState.host = host;
  handlePlayerErrorMutation(host);
}

function ensurePlayerErrorEvents() {
  if (playerErrorEventsBound) {
    return;
  }
  const errorListener = (event) => {
    if (!event) return;
    handleVideoUnavailable(event.detail || event);
  };
  const pageDataListener = (event) => {
    const detail = event?.detail;
    if (!detail) {
      return;
    }
    const playerResponse =
      detail.pageData?.playerResponse ||
      detail.playerResponse ||
      detail.response?.playerResponse;
    if (!playerResponse) {
      return;
    }
    const status = playerResponse?.playabilityStatus?.status || "";
    if (!status || status === "OK") {
      return;
    }
    const reason =
      playerResponse.playabilityStatus?.reason ||
      playerResponse.playabilityStatus?.errorScreen?.playerErrorMessage?.simpleText ||
      status;
    handleVideoUnavailable({ reason });
  };
  window.addEventListener("yt-player-error", errorListener, true);
  window.addEventListener("yt-page-data-updated", pageDataListener, true);
  playerErrorEventsBound = true;
}

function ensurePlayerErrorMonitoring() {
  ensurePlayerErrorEvents();
  ensurePlayerErrorObserver();
}

function clampProgressValue(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  const rounded = Math.round(value);
  if (!Number.isFinite(rounded)) {
    return null;
  }
  if (rounded <= 0) {
    return 0;
  }
  if (rounded >= 100) {
    return 100;
  }
  return rounded;
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
  const percent = clampProgressValue(rawPercent);
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
    timestamp: now,
  }).catch((err) => {
    console.debug("Failed to report playback progress", err);
  });
}

function handleVideoProgressUpdate() {
  const video = state.videoElement;
  if (!video) {
    return;
  }
  const duration = Number(video.duration);
  const current = Number(video.currentTime);
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(current)) {
    return;
  }
  const ratio = duration > 0 ? (current / duration) * 100 : 0;
  maybeSendVideoProgress(ratio);
}

function formatAutoCollectProgress(event = {}) {
  switch (event.phase) {
    case "start":
      return "Ищу новые видео...";
    case "channelsLoaded":
      return `Подписок: ${event.channelCount || 0}, плейлистов: ${event.playlistCount || 0}`;
    case "playlistFetch":
      return `Загружаем плейлист ${event.index || 0}/${event.total || 0}`;
    case "playlistFetched":
      return `Плейлист ${event.index || 0}/${event.total || 0}: +${event.videoCount || 0}`;
    case "aggregate":
      return `Собрано ${event.videoCount || 0} видео`;
    case "filtering":
      return `Фильтрую ${event.videoCount || 0} видео`;
    case "filterProgress": {
      const processed = Number(event.processed) || 0;
      const total = Number(event.total) || processed;
      return `Фильтрую ${processed}/${total}`;
    }
    case "filterStats": {
      const totals = event.totals || {};
      const total = Number(event.total) || Number(event.initialCount) || 0;
      const passed = totals.passed || event.videoCount || 0;
      return total
        ? `После фильтра ${passed}/${total}`
        : `После фильтра ${passed}`;
    }
    case "filtered":
      return `После фильтра осталось ${event.videoCount || 0}`;
    case "readyToAdd":
      return event.skippedExisting
        ? `Готово к добавлению ${event.videoCount || 0} видео (уже в очереди ${
            event.skippedExisting
          })`
        : `Готово к добавлению ${event.videoCount || 0} видео`;
    case "adding":
      return `Добавляю ${event.addCount || 0} видео в очередь`;
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
      title: "Сбор подписок",
      body: formatAutoCollectProgress(event) || "Запускаю сбор подписок...",
      persist: true,
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
    const summary = added
      ? `Добавлено ${added} из ${fetched}`
      : "Новых видео не найдено";
    const queueLabel = queueLength ? ` · В очереди ${queueLength}` : "";
    showPlaybackNotification({
      title: "Сбор подписок завершён",
      body: `${summary}${queueLabel}`,
      duration: 6000,
    });
    return;
  }
  if (phase === "error") {
    autoCollectDisplay.active = false;
    const message = event.message || "Не удалось собрать подписки";
    showPlaybackNotification({
      title: "Сбор подписок",
      body: message,
      duration: 6000,
    });
    return;
  }
  const progress = formatAutoCollectProgress(event);
  if (progress) {
    showPlaybackNotification({
      title: "Сбор подписок",
      body: progress,
      persist: true,
    });
  }
}

function maybeAnnounceQueueFinished(presentation) {
  if (!presentation || typeof presentation !== "object") {
    return false;
  }
  const queue = Array.isArray(presentation?.currentQueue?.queue)
    ? presentation.currentQueue.queue
    : [];
  if (queue.length > 0) {
    return false;
  }
  if (presentation.currentVideoId) {
    return false;
  }
  const listId = presentation?.currentQueue?.id || presentation?.currentListId || null;
  const listName = presentation?.currentQueue?.name || "";
  const trimmedName = typeof listName === "string" ? listName.trim() : "";
  const body = trimmedName
    ? `Очередь «${trimmedName}» пустая`
    : listId && listId !== DEFAULT_LIST_ID
    ? "Дополнительный список пустой"
    : "Очередь пустая";
  showPlaybackNotification({
    title: "Список закончился",
    body,
    persist: true,
  });
  return true;
}

function handlePlaybackAdvanceResponse(response) {
  if (response && response.handled === false && response.state) {
    maybeAnnounceQueueFinished(response.state);
  }
  return response;
}

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
  const observer = new MutationObserver(() => {
    syncPlayerControlsVisibility(host);
  });
  observer.observe(host, { attributes: true, attributeFilter: ["class"] });
  playerControls.observer = observer;
  syncPlayerControlsVisibility(host);
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
    const topRow = document.createElement("div");
    topRow.className = "yta-player-controls__row yta-player-controls__row--top";
    const bottomRow = document.createElement("div");
    bottomRow.className = "yta-player-controls__row yta-player-controls__row--bottom";

    const startBtn = document.createElement("button");
    startBtn.type = "button";
    startBtn.className = "ytp-button yta-player-controls__start";
    startBtn.textContent = "▶ Плейлист";
    startBtn.title = "Запустить плейлист";
    startBtn.setAttribute("aria-label", "Запустить плейлист");
    startBtn.addEventListener("click", (event) => {
      event.preventDefault();
      requestStartPlayback();
    });
    const addCurrentBtn = document.createElement("button");
    addCurrentBtn.type = "button";
    addCurrentBtn.className = "yta-player-controls__add";
    addCurrentBtn.textContent = "Добавить в плейлист";
    addCurrentBtn.title = "Добавить текущее видео в плейлист";
    addCurrentBtn.setAttribute(
      "aria-label",
      "Добавить текущее видео в плейлист"
    );
    addCurrentBtn.hidden = true;
    addCurrentBtn.addEventListener("click", (event) => {
      event.preventDefault();
      if (addCurrentBtn.disabled || addCurrentBtn.dataset.loading === "1") {
        return;
      }
      addCurrentBtn.disabled = true;
      addCurrentBtn.dataset.loading = "1";
      const finalize = () => {
        delete addCurrentBtn.dataset.loading;
        updatePlayerControlsUI();
      };
      try {
        const result =
          typeof handleAddCurrentFromPage === "function"
            ? handleAddCurrentFromPage()
            : null;
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
    const postponeBtn = document.createElement("button");
    postponeBtn.type = "button";
    postponeBtn.className = "ytp-button yta-player-controls__postpone";
    postponeBtn.title = "Отложить (оставить в очереди)";
    postponeBtn.setAttribute(
      "aria-label",
      "Отложить текущее видео и оставить в очереди"
    );
    const postponeIcon = document.createElement("span");
    postponeIcon.className = "yta-player-controls__postpone-icon";
    postponeIcon.textContent = "↷";
    const postponeLabel = document.createElement("span");
    postponeLabel.textContent = "Отложить";
    postponeBtn.append(postponeIcon, postponeLabel);
    postponeBtn.addEventListener("click", (event) => {
      event.preventDefault();
      requestPostpone();
    });
    const prevBtn = document.createElement("button");
    prevBtn.type = "button";
    prevBtn.className = "ytp-button";
    prevBtn.textContent = "⏮";
    prevBtn.title = "Предыдущее";
    prevBtn.setAttribute("aria-label", "Предыдущее видео");
    prevBtn.addEventListener("click", (event) => {
      event.preventDefault();
      requestPrevious();
    });
    const nextBtn = document.createElement("button");
    nextBtn.type = "button";
    nextBtn.className = "ytp-button";
    nextBtn.textContent = "⏭";
    nextBtn.title = "Следующее";
    nextBtn.setAttribute("aria-label", "Следующее видео");
    nextBtn.addEventListener("click", (event) => {
      event.preventDefault();
      requestNext();
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
  observePlayerHost(host);
  updatePlayerControlsUI();
}

function updatePlayerControlsUI() {
  const queueIds = inlinePlaylistState.orderedVideoIds || [];
  const queueLength = queueIds.length;
  const currentId = getCurrentVideoId();
  const inQueueIndex =
    currentId && inlinePlaylistState.indexById.has(currentId)
      ? inlinePlaylistState.indexById.get(currentId)
      : -1;
  const hasQueue = queueLength > 0;
  const videoInQueue = inQueueIndex !== -1;
  const listFrozen = Boolean(inlinePlaylistState.freeze);
  const historyAvailable =
    typeof inlinePlaylistState.historyLength === "number" &&
    inlinePlaylistState.historyLength > 0;
  const queueHasPrevious =
    typeof inlinePlaylistState.currentIndex === "number" &&
    inlinePlaylistState.currentIndex > 0;
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
    const host =
      document.querySelector("#movie_player.html5-video-player") ||
      document.querySelector(".html5-video-player");
    if (host && playerControls.container.parentElement !== host) {
      playerControls.container.remove();
      host.appendChild(playerControls.container);
    }
    if (host) {
      observePlayerHost(host);
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
  if (typeof updateInlineQueueUI === "function") {
    updateInlineQueueUI();
  }
}

function updateMediaSessionHandlers() {
  if (!("mediaSession" in navigator)) {
    return;
  }
  try {
    if (canHandlePlaybackActions()) {
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

function requestNext() {
  if (!canHandlePlaybackActions()) return;
  const videoId = getCurrentVideoId();
  sendMessage("player:requestNext", { videoId }).then(
    handlePlaybackAdvanceResponse
  );
}

function requestPrevious() {
  if (!canHandlePlaybackActions()) return;
  sendMessage("player:requestPrevious", {
    videoId: getCurrentVideoId(),
  });
}

function requestPostpone() {
  if (!canHandlePlaybackActions()) return;
  const videoId = getCurrentVideoId();
  sendMessage("player:requestPostpone", { videoId }).then(
    handlePlaybackAdvanceResponse
  );
}

function requestStartPlayback() {
  const queueIds = inlinePlaylistState.orderedVideoIds || [];
  if (!queueIds.length) return;
  const targetId = queueIds[0];
  if (!targetId) return;
  const payload = { videoId: targetId };
  if (inlinePlaylistState.currentListId) {
    payload.listId = inlinePlaylistState.currentListId;
  }
  sendMessage("playlist:play", payload).then((presentation) => {
    if (presentation && typeof presentation === "object") {
      updateInlinePlaylistState(presentation);
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

function handleVideoStarted() {
  hidePlaybackNotification(true);
  const videoId = parseVideoId(window.location.href);
  if (!videoId) return;
  state.currentVideoId = videoId;
  state.lastUnavailableVideoId = null;
  resetProgressTracker(videoId);
  handleVideoProgressUpdate();
  if (state.lastReportedVideoId === videoId) return;
  state.lastReportedVideoId = videoId;
  sendMessage("player:videoStarted", { videoId }).then((resp) => {
    if (resp && typeof resp === "object") {
      const presentation =
        resp.state && typeof resp.state === "object" ? resp.state : null;
      if (presentation) {
        updateInlinePlaylistState(presentation);
        maybeAnnounceQueueFinished(presentation);
      }
    }
    setControlsActive(Boolean(resp?.controlled));
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
    handleVideoUnavailable(detail);
    return;
  }
  if (event?.detail) {
    handleVideoUnavailable(event.detail);
    return;
  }
  handleVideoUnavailable(event || {});
}

function handleVideoEnded() {
  const videoId = getCurrentVideoId();
  if (!videoId) return;
  maybeSendVideoProgress(100, { force: true });
  sendMessage(
    "player:videoEnded",
    { videoId },
    {
      onDisconnect: () => recoverVideoEnded(videoId),
    }
  ).then((resp) => {
    const result = handlePlaybackAdvanceResponse(resp);
    if (!result || result.handled === false) {
      setControlsActive(false);
    }
  });
}

function recoverVideoEnded(videoId) {
  if (!videoId) {
    return { handled: true };
  }
  const orderedIds = Array.isArray(inlinePlaylistState.orderedVideoIds)
    ? inlinePlaylistState.orderedVideoIds
    : [];
  if (!orderedIds.length) {
    const presentation = {
      currentListId: inlinePlaylistState.currentListId || null,
      currentQueue: {
        id: inlinePlaylistState.currentListId || null,
        name: inlinePlaylistState.currentListName || "",
        freeze: Boolean(inlinePlaylistState.freeze),
        queue: [],
        currentIndex: null,
      },
      currentVideoId: null,
      history: Array.from(
        { length: Math.max(Number(inlinePlaylistState.historyLength) || 0, 0) },
        () => ({ id: null })
      ),
      lists: Array.isArray(inlinePlaylistState.lists)
        ? inlinePlaylistState.lists.map((list) => ({ ...list }))
        : [],
    };
    updateInlinePlaylistState(presentation);
    maybeAnnounceQueueFinished(presentation);
    return { handled: false, state: presentation };
  }
  const listId = inlinePlaylistState.currentListId || null;
  if (!listId) {
    requestStartPlayback();
    return { handled: true };
  }
  const inQueue = orderedIds.includes(videoId);
  if (!inQueue) {
    requestStartPlayback();
    return { handled: true };
  }
  const knownCurrent =
    typeof inlinePlaylistState.currentVideoId === "string"
      ? inlinePlaylistState.currentVideoId
      : null;
  if (knownCurrent && knownCurrent !== videoId) {
    return { handled: true };
  }
  const queueEntries = Array.isArray(inlinePlaylistState.queueEntries)
    ? inlinePlaylistState.queueEntries
    : [];
  const remainingEntries = queueEntries.filter(
    (entry) => entry && entry.id && entry.id !== videoId
  );
  const remainingIds = orderedIds.filter((id) => id !== videoId);
  const previousIndex = orderedIds.indexOf(videoId);
  const nextIndex =
    remainingIds.length > 0
      ? Math.min(previousIndex, remainingIds.length - 1)
      : null;
  const nextId = nextIndex !== null ? remainingIds[nextIndex] : null;
  const historyLength = Math.max(Number(inlinePlaylistState.historyLength) || 0, 0) + 1;
  const historyEntries = Array.from({ length: historyLength }, (_, index) =>
    index === 0 ? { id: videoId } : { id: null }
  );
  const presentation = {
    currentListId: listId,
    currentQueue: {
      id: listId,
      name: inlinePlaylistState.currentListName || "",
      freeze: Boolean(inlinePlaylistState.freeze),
      queue: remainingEntries,
      currentIndex: nextIndex,
    },
    currentVideoId: nextId,
    history: historyEntries,
    lists: Array.isArray(inlinePlaylistState.lists)
      ? inlinePlaylistState.lists.map((list) => ({ ...list }))
      : [],
  };
  updateInlinePlaylistState(presentation);
  if (nextId) {
    const navigated = navigateToVideoId(nextId);
    if (!navigated) {
      console.warn("Failed to locally advance playback after disconnect");
    }
    return { handled: true, state: presentation };
  }
  maybeAnnounceQueueFinished(presentation);
  return { handled: false, state: presentation };
}

function detachVideoListeners() {
  if (!state.videoElement) return;
  state.videoElement.removeEventListener("ended", handleVideoEnded);
  state.videoElement.removeEventListener("play", handleVideoStarted);
  state.videoElement.removeEventListener("playing", handleVideoStarted);
  state.videoElement.removeEventListener("loadeddata", handleVideoStarted);
  state.videoElement.removeEventListener("timeupdate", handleVideoProgressUpdate);
  state.videoElement.removeEventListener("durationchange", handleVideoProgressUpdate);
  state.videoElement.removeEventListener("error", handleVideoError);
  state.videoElement = null;
  resetProgressTracker(null);
}

function attachVideoListeners(video) {
  if (state.videoElement === video) return;
  detachVideoListeners();
  state.videoElement = video;
  video.addEventListener("ended", handleVideoEnded);
  video.addEventListener("play", handleVideoStarted);
  video.addEventListener("playing", handleVideoStarted);
  video.addEventListener("loadeddata", handleVideoStarted);
  video.addEventListener("timeupdate", handleVideoProgressUpdate);
  video.addEventListener("durationchange", handleVideoProgressUpdate);
  video.addEventListener("error", handleVideoError);
  handleVideoStarted();
}

function scanForVideo() {
  ensurePlayerErrorMonitoring();
  const video = document.querySelector("video");
  if (video) {
    attachVideoListeners(video);
    ensurePlayerControls();
    return true;
  }
  detectUnavailableWatchState();
  return false;
}
