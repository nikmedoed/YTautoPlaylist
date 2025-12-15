import { createMoveMenu } from "./lib/moveMenu.js";
import { createStatusController } from "./modules/status.js";
import { createQueueController } from "./modules/queue.js";
import { createHistoryController } from "./modules/history.js";
import { createCollectionController } from "./modules/collection.js";
const queueList = document.getElementById("queueList");
const historyList = document.getElementById("historyList");
const queueEmpty = document.getElementById("queueEmpty");
const historyEmpty = document.getElementById("historyEmpty");
const historyModeButtons = Array.from(
  document.querySelectorAll(".history-tab")
);
const statusBox = document.getElementById("status");
const statusText = document.getElementById("statusText");
const collectionProgress = document.getElementById("collectionProgress");
const collectionTitle =
  collectionProgress?.querySelector?.(".collection-info h4") || null;
const collectionStageText = document.getElementById("collectionStage");
const collectionCounters = document.getElementById("collectionCounters");
const collectionLog = document.getElementById("collectionLog");
const collectionArea = document.getElementById("collectionArea");
const collectionNote = document.getElementById("collectionNote");

const listSwitcher = document.getElementById("listSwitcher");
const queueFreezeIndicator = document.getElementById("queueFreezeIndicator");
const addCurrentBtn = document.getElementById("addCurrent");
const addVisibleBtn = document.getElementById("addVisible");
const addAllBtn = document.getElementById("addAll");
const collectBtn = document.getElementById("collectSubscriptions");
const startPlaybackBtn = document.getElementById("startPlayback");
const playPrevBtn = document.getElementById("playPrev");
const postponeBtn = document.getElementById("postponeCurrent");
const playNextBtn = document.getElementById("playNext");
const togglePlaybackBtn = document.getElementById("togglePlayback");
const playbackControls = document.querySelector(".playback-controls");
const openManagerBtn = document.getElementById("openManager");
const openFilterSettingsBtn = document.getElementById("openFilterSettings");
const addRow = document.querySelector(".control-row--add");

const fallbackThumbnail = chrome.runtime.getURL("icon/icon.png");
const DEFAULT_LIST_ID = "default";
const VIDEO_COUNT_ICON = "🎬";

let playlistState = null;
let isCollecting = false;
let capabilitiesState = {
  canAddCurrent: false,
  canAddVisible: false,
  canAddAll: false,
  context: "unknown",
  controlling: false,
};
let activePlaybackTabId = null;
let playbackStatus = {
  playing: false,
  hasVideo: false,
  known: false,
};
let lastPlaybackStatusRequest = 0;
let playbackStatusPromise = null;
let collectionCooldownTimer = null;
let collectionCooldownTarget = 0;


const { setStatus, hideStatus } = createStatusController({ statusBox, statusText });

const moveMenu = createMoveMenu({
  getOptions: ({ sourceListId }) => {
    const lists = Array.isArray(playlistState?.lists) ? playlistState.lists : [];
    return lists
      .filter((list) => list.id !== sourceListId)
      .map((list) => ({ id: list.id, label: list.name }));
  },
  onEmpty: () => {
    setStatus("Нет других списков", "info", 2500);
  },
  onSelect: async (targetListId, context) => {
    if (!targetListId || !context?.videoId) return;
    setStatus("Переношу видео...", "info");
    try {
      const state = await sendMessage("playlist:moveVideo", {
        videoId: context.videoId,
        targetListId,
      });
      if (state) {
        renderState(state);
        setStatus("Видео перенесено", "success", 2500);
      }
    } catch (err) {
      console.error(err);
      setStatus("Не удалось перенести", "error", 3000);
    }
  },
});

function showMoveMenu(videoId, sourceListId, anchor) {
  moveMenu.show(anchor, { videoId, sourceListId });
}

const queueController = createQueueController({
  queueList,
  queueEmpty,
  queueFreezeIndicator,
  fallbackThumbnail,
  showMoveMenu,
  hideMoveMenu: () => moveMenu.hide(),
  setStatus,
  sendMessage,
  onStateChange: (state) => renderState(state),
  getPlaylistState: () => playlistState,
  defaultListId: DEFAULT_LIST_ID,
});

const historyController = createHistoryController({
  historyList,
  historyEmpty,
  fallbackThumbnail,
  getListName,
  setStatus,
  hideMoveMenu: () => moveMenu.hide(),
  sendMessage,
  onStateChange: (state) => renderState(state),
  modeButtons: historyModeButtons,
});

const collectionController = createCollectionController({
  progressEl: collectionProgress,
  titleEl: collectionTitle,
  stageTextEl: collectionStageText,
  countersEl: collectionCounters,
  logEl: collectionLog,
  setStatus,
});

function getSelectedListId() {
  if (playlistState?.currentQueue?.id) {
    return playlistState.currentQueue.id;
  }
  if (playlistState?.currentListId) {
    return playlistState.currentListId;
  }
  return null;
}

function readAutoCollectMeta() {
  const meta = playlistState?.autoCollect || {};
  const cooldownMs = Number(meta.cooldownMs) || 0;
  const lastRunAt = Number(meta.lastRunAt) || 0;
  const storedNext = Number(meta.nextAutoCollectAt) || 0;
  let nextRun = storedNext;
  if (!nextRun && cooldownMs > 0 && lastRunAt > 0) {
    nextRun = lastRunAt + cooldownMs;
  }
  return {
    lastRunAt,
    lastAdded: Number(meta.lastAdded) || 0,
    lastFetched: Number(meta.lastFetched) || 0,
    nextAutoCollectAt: storedNext,
    nextRunAt: nextRun > 0 ? nextRun : 0,
    cooldownMs,
  };
}

function formatTimeOfDay(timestamp) {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

function formatCooldownMessage(remainingMs, targetTime) {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [];
  if (hours > 0) {
    parts.push(`${hours} ч`);
  }
  if (minutes > 0 || hours > 0) {
    parts.push(`${minutes} мин`);
  }
  if (!parts.length) {
    parts.push(`${seconds} сек`);
  }
  const timeLabel = formatTimeOfDay(targetTime);
  return timeLabel
    ? `Сбор будет доступен через ${parts.join(" ")} (≈ ${timeLabel})`
    : `Сбор будет доступен через ${parts.join(" ")}`;
}

function stopCollectionCooldownTimer() {
  if (collectionCooldownTimer) {
    clearInterval(collectionCooldownTimer);
    collectionCooldownTimer = null;
  }
}

function updateCollectionCooldownMessage() {
  if (!collectionNote) {
    stopCollectionCooldownTimer();
    collectionCooldownTarget = 0;
    return;
  }
  if (!collectionCooldownTarget) {
    stopCollectionCooldownTimer();
    collectionNote.hidden = true;
    collectionNote.textContent = "";
    return;
  }
  const remaining = Math.max(0, collectionCooldownTarget - Date.now());
  if (remaining <= 0) {
    collectionCooldownTarget = 0;
    stopCollectionCooldownTimer();
    collectionNote.hidden = true;
    collectionNote.textContent = "";
    updateCollectionAvailability();
    return;
  }
  collectionNote.hidden = false;
  collectionNote.textContent = formatCooldownMessage(
    remaining,
    collectionCooldownTarget
  );
}

function startCollectionCooldownTimer(targetTime) {
  collectionCooldownTarget = Number(targetTime) || 0;
  if (!collectionCooldownTarget) {
    updateCollectionCooldownMessage();
    return;
  }
  updateCollectionCooldownMessage();
  if (!collectionCooldownTimer) {
    collectionCooldownTimer = window.setInterval(
      updateCollectionCooldownMessage,
      1000
    );
  }
}

function shouldShowCollectionArea() {
  if (collectionController.isActive()) {
    return true;
  }
  return getSelectedListId() === DEFAULT_LIST_ID;
}

function updateCollectionAvailability() {
  if (!collectBtn && !collectionArea) return;
  const selectedListId = getSelectedListId();
  const isDefaultList = selectedListId === DEFAULT_LIST_ID;
  const autoMeta = readAutoCollectMeta();
  const now = Date.now();
  const nextRunAt = autoMeta.nextRunAt || autoMeta.nextAutoCollectAt || 0;
  const onCooldown = isDefaultList && nextRunAt > now;
  const showArea = shouldShowCollectionArea();
  const busy = isCollecting || collectionController.isActive();

  if (collectionArea) {
    const hidden = !showArea;
    collectionArea.hidden = hidden;
    collectionArea.classList.toggle("hidden", hidden);
    if (hidden) {
      stopCollectionCooldownTimer();
      if (collectionNote) {
        collectionNote.hidden = true;
        collectionNote.textContent = "";
      }
    } else {
      collectionController.showIfHasHistory();
    }
  }

  if (collectBtn) {
    const showButton = isDefaultList && !onCooldown && !busy;
    collectBtn.classList.toggle("hidden", !showButton);
    if (showButton) {
      const loading = collectBtn.dataset.loading === "1";
      collectBtn.disabled = loading || busy;
    } else {
      collectBtn.disabled = true;
    }
  }

  if (collectionNote) {
    if (isDefaultList && onCooldown) {
      startCollectionCooldownTimer(nextRunAt);
    } else {
      collectionNote.hidden = true;
      collectionNote.textContent = "";
      stopCollectionCooldownTimer();
    }
  }
}

function countAddedEntries(state) {
  const prevQueue = Array.isArray(playlistState?.currentQueue?.queue)
    ? playlistState.currentQueue.queue
    : [];
  const nextQueue = Array.isArray(state?.currentQueue?.queue)
    ? state.currentQueue.queue
    : [];
  const prevIds = new Set(
    prevQueue
      .map((entry) => (entry && typeof entry === "object" ? entry.id : null))
      .filter((id) => typeof id === "string" && id)
  );
  let added = 0;
  for (const entry of nextQueue) {
    if (!entry || typeof entry !== "object") continue;
    const id = entry.id;
    if (typeof id !== "string" || !id) continue;
    if (!prevIds.has(id)) {
      added += 1;
    }
  }
  return added;
}

function normalizeAddResponse(response) {
  if (!response || typeof response !== "object") {
    return { state: null, requested: null, missing: 0 };
  }
  const state =
    response.state && typeof response.state === "object"
      ? response.state
      : response;
  const requested =
    Number.isInteger(response.requested) && response.requested >= 0
      ? response.requested
      : null;
  const missing =
    Number.isInteger(response.missing) && response.missing > 0
      ? response.missing
      : 0;
  return { state, requested, missing };
}

function formatAddResultMessage({
  added = 0,
  requested = null,
  missing = 0,
  scopeLabel = "",
  alreadyMessage = "",
} = {}) {
  const addedCount = Number.isInteger(added) && added > 0 ? added : 0;
  const totalRequested =
    Number.isInteger(requested) && requested >= 0 ? requested : null;
  const missingCount = Number.isInteger(missing) && missing > 0 ? missing : 0;
  const duplicates =
    totalRequested !== null
      ? Math.max(0, totalRequested - missingCount - addedCount)
      : null;
  const fragments = [];
  if (addedCount > 0) {
    let base = `Добавлено ${addedCount} видео`;
    if (duplicates && duplicates > 0) {
      base += ` (ещё ${duplicates} видео уже были)`;
    } else if (totalRequested !== null && totalRequested !== addedCount) {
      base += ` из ${totalRequested}`;
    }
    fragments.push(base);
  } else if (duplicates && duplicates > 0) {
    if (alreadyMessage) {
      fragments.push(alreadyMessage);
    } else if (scopeLabel) {
      fragments.push(`Все ${scopeLabel} уже в списке`);
    } else if (totalRequested !== null && totalRequested > 0) {
      fragments.push(`Все ${totalRequested} видео уже в списке`);
    } else {
      fragments.push(`Все видео уже в списке`);
    }
  } else if (totalRequested === 0) {
    fragments.push("Видео не найдены");
  } else if (scopeLabel) {
    fragments.push(`Не удалось добавить ${scopeLabel}`);
  } else {
    fragments.push("Видео не добавлены");
  }
  if (missingCount > 0) {
    fragments.push(`Не удалось получить данные для ${missingCount} видео`);
  }
  const message = fragments.join(". ");
  const kind = addedCount > 0 ? "success" : missingCount > 0 ? "error" : "info";
  return { message, kind };
}

function computePlaybackMeta(state) {
  const queue = Array.isArray(state?.currentQueue?.queue)
    ? state.currentQueue.queue
    : [];
  const queueIds = queue
    .map((entry) => (entry && typeof entry === "object" ? entry.id : null))
    .filter((id) => typeof id === "string" && id);
  const queueId = state?.currentQueue?.id || null;
  const activeListId = state?.currentListId || null;
  const queueMatchesActive = Boolean(
    activeListId && queueId && queueId === activeListId
  );
  const pointerIndex =
    Number.isInteger(state?.currentQueue?.currentIndex) &&
    state.currentQueue.currentIndex >= 0 &&
    state.currentQueue.currentIndex < queueIds.length
      ? state.currentQueue.currentIndex
      : queueIds.length
      ? 0
      : -1;
  const currentId = queueMatchesActive ? state?.currentVideoId || null : null;
  const currentIndex = currentId ? queueIds.indexOf(currentId) : -1;
  const inQueue = currentIndex !== -1;
  const historyLength = Array.isArray(state?.history)
    ? state.history.length
    : 0;
  const controlling = queueMatchesActive && inQueue;
  return {
    queue,
    queueIds,
    pointerIndex,
    currentIndex,
    inQueue,
    queueMatchesActive,
    controlling,
    frozen: Boolean(state?.currentQueue?.freeze),
    hasPrev: controlling && (currentIndex > 0 || historyLength > 0),
    hasNext: controlling && currentIndex < queueIds.length - 1,
  };
}

function applyPlaybackStatus(status = {}) {
  playbackStatus = {
    playing: Boolean(status.playing),
    hasVideo: Boolean(status.hasVideo),
    known: status.known === false ? false : true,
  };
}

function updatePlaybackControls() {
  const meta = computePlaybackMeta(playlistState || {});
  const queueHasEntries = meta.queueIds.length > 0;
  const activeListId = playlistState?.currentListId || null;
  const hasKnownVideo = Boolean(activeListId) && Boolean(playlistState?.currentVideoId);
  const hasActiveTab = Boolean(activeListId) && Number.isInteger(playlistState?.currentTabId);
  const hasPlaybackContext = hasActiveTab && hasKnownVideo;
  const hasActivePlayback = hasPlaybackContext && meta.controlling;
  const shouldShowStart = queueHasEntries && !hasPlaybackContext;
  let showPlaybackCluster = false;
  if (startPlaybackBtn) {
    startPlaybackBtn.classList.toggle("hidden", !shouldShowStart);
    if (!startPlaybackBtn.dataset.loading) {
      startPlaybackBtn.disabled = !queueHasEntries;
    }
  }
  if (togglePlaybackBtn) {
    const allowToggle =
      hasActivePlayback && (playbackStatus.hasVideo || !playbackStatus.known);
    togglePlaybackBtn.classList.toggle("hidden", !allowToggle);
    showPlaybackCluster = showPlaybackCluster || allowToggle;
    if (!togglePlaybackBtn.dataset.loading) {
      togglePlaybackBtn.disabled = false;
    }
    if (allowToggle) {
      const isPlaying = playbackStatus.known ? playbackStatus.playing : true;
      const icon = togglePlaybackBtn.querySelector(".icon");
      if (icon) {
        icon.textContent = isPlaying ? "⏸" : "▶";
      }
      togglePlaybackBtn.dataset.state = isPlaying ? "playing" : "paused";
      togglePlaybackBtn.setAttribute("aria-label", isPlaying ? "Пауза" : "Воспроизвести");
      togglePlaybackBtn.title = isPlaying ? "Пауза" : "Воспроизвести";
    }
  }
  const showQueueControls = hasActivePlayback;
  if (playPrevBtn) {
    const showPrev = showQueueControls && meta.hasPrev;
    playPrevBtn.classList.toggle("hidden", !showPrev);
    showPlaybackCluster = showPlaybackCluster || showPrev;
    if (!playPrevBtn.dataset.loading) {
      playPrevBtn.disabled = false;
    }
  }
  if (playNextBtn) {
    const showNext = showQueueControls && meta.hasNext;
    playNextBtn.classList.toggle("hidden", !showNext);
    showPlaybackCluster = showPlaybackCluster || showNext;
    if (!playNextBtn.dataset.loading) {
      playNextBtn.disabled = false;
    }
  }
  if (postponeBtn) {
    const showPostpone = showQueueControls && meta.hasNext && !meta.frozen;
    postponeBtn.classList.toggle("hidden", !showPostpone);
    if (!postponeBtn.dataset.loading) {
      postponeBtn.disabled = false;
    }
  }
  if (playbackControls) {
    const shouldShowCluster = showPlaybackCluster;
    playbackControls.classList.toggle("hidden", !shouldShowCluster);
    if (shouldShowCluster) {
      playbackControls.removeAttribute("aria-hidden");
    } else {
      playbackControls.setAttribute("aria-hidden", "true");
    }
  }
}

async function addFromScope(scope) {
  const button =
    scope === "current"
      ? addCurrentBtn
      : scope === "visible"
      ? addVisibleBtn
      : addAllBtn;
  if (!button || button.classList.contains("hidden")) return;
  if (
    (scope === "current" && !capabilitiesState.canAddCurrent) ||
    (scope === "visible" && !capabilitiesState.canAddVisible) ||
    (scope === "page" && !capabilitiesState.canAddAll)
  ) {
    return;
  }
  setLoading(button, true);
  setStatus("Ищу видео...", "info");
  try {
    const collect = await sendMessage("collector:collect", { scope });
    if (collect?.error) {
      if (collect.error === "NOT_ALLOWED") {
        setStatus("Эта кнопка недоступна на текущей странице", "info", 3500);
      } else {
        setStatus("Не получилось собрать список", "error", 4000);
      }
      return;
    }
    const ids = Array.isArray(collect?.videoIds) ? collect.videoIds : [];
    if (collect?.aborted) {
      setStatus(
        ids.length
          ? `Сбор остановлен на ${ids.length}`
          : "Сбор остановлен",
        "info",
        3600
      );
      return;
    }
    if (!ids.length) {
      setStatus("Видео не найдены", "info");
      return;
    }
    const uniqueRequested = Array.from(new Set(ids)).length;
    const response = await sendMessage("playlist:addByIds", { videoIds: ids });
    const { state, requested, missing } = normalizeAddResponse(response);
    if (!state) {
      setStatus("Не удалось обновить очередь", "error", 4000);
      return;
    }
    const added = countAddedEntries(state);
    renderState(state);
    const totalRequested = requested ?? uniqueRequested;
    const summary = formatAddResultMessage({
      added,
      requested: totalRequested,
      missing,
      scopeLabel:
        scope === "visible"
          ? "видимые видео"
          : scope === "page"
          ? "видео на странице"
          : "",
      alreadyMessage: scope === "current" ? "Видео уже в очереди" : "",
    });
    setStatus(summary.message, summary.kind);
  } catch (err) {
    setStatus("Ошибка добавления видео", "error", 4000);
    console.error(err);
  } finally {
    setLoading(button, false);
  }
}

async function collectSubscriptions() {
  if (collectBtn?.classList.contains("hidden")) return;
  if (isCollecting) return;
  setLoading(collectBtn, true);
  setStatus("Собираю новые видео...", "info", 0);
  updateCollectionAvailability();
  isCollecting = true;
  try {
    const result = await sendMessage("playlist:collectSubscriptions");
    if (result?.error === "ON_COOLDOWN") {
      if (result?.state) {
        renderState(result.state);
      }
      const nextRunAt = Number(result.nextRunAt) || 0;
      const remaining = Number(result.remainingMs) ||
        (nextRunAt ? Math.max(0, nextRunAt - Date.now()) : 0);
      const message = remaining
        ? formatCooldownMessage(remaining, nextRunAt)
        : "Сбор можно запускать не чаще раза в час";
      setStatus(message, "info", 4000);
      return;
    }
    if (result?.state) {
      renderState(result.state);
    }
  } catch (err) {
    console.error(err);
    setStatus("Не удалось собрать подписки", "error", 4000);
  } finally {
    setLoading(collectBtn, false);
    isCollecting = false;
    updateCollectionAvailability();
  }
}

async function startPlayback() {
  if (!startPlaybackBtn) return;
  const meta = computePlaybackMeta(playlistState || {});
  if (!meta.queueIds.length) {
    setStatus("Очередь пустая", "info", 3000);
    return;
  }
  const entry = meta.queue[0];
  if (!entry || !entry.id) {
    setStatus("Не удалось определить видео", "error", 3500);
    return;
  }
  setLoading(startPlaybackBtn, true);
  setStatus("Запускаю плейлист...", "info");
  try {
    const state = await sendMessage("playlist:play", {
      videoId: entry.id,
      listId: playlistState?.currentQueue?.id || playlistState?.currentListId || null,
      forceNewTab: true,
      activate: true,
    });
    if (state) {
      renderState(state);
      setStatus("Плейлист запущен", "success", 2500);
    } else {
      setStatus("Не удалось запустить плейлист", "error", 3500);
    }
  } catch (err) {
    console.error(err);
    setStatus("Не удалось запустить плейлист", "error", 4000);
  } finally {
    setLoading(startPlaybackBtn, false);
  }
}

async function togglePlayback() {
  if (!togglePlaybackBtn) return;
  if (togglePlaybackBtn.dataset.loading === "1") return;
  togglePlaybackBtn.dataset.loading = "1";
  togglePlaybackBtn.disabled = true;
  try {
    const response = await sendMessage("player:togglePlayback", {});
    if (response?.state && response.state.currentTabId !== playlistState?.currentTabId) {
      renderState(response.state);
      return;
    }
    if (response?.reason === "NO_ACTIVE_TAB" || response?.reason === "TAB_UNREACHABLE") {
      setStatus("Нет активного воспроизведения", "info", 2500);
      applyPlaybackStatus({ playing: false, hasVideo: false, known: true });
      updatePlaybackControls();
      return;
    }
    if (response?.reason === "NO_VIDEO") {
      setStatus("Видео не найдено на вкладке", "info", 2500);
      applyPlaybackStatus({ playing: false, hasVideo: false, known: true });
      updatePlaybackControls();
      return;
    }
    if (response?.handled === false) {
      setStatus("Не удалось управлять воспроизведением", "error", 3200);
      return;
    }
    if (response) {
      const playing = response.playing === true;
      applyPlaybackStatus({ playing, hasVideo: true, known: true });
      updatePlaybackControls();
      setStatus(
        playing ? "Воспроизведение возобновлено" : "Видео на паузе",
        playing ? "success" : "info",
        1800
      );
    }
  } catch (err) {
    console.error("Toggle playback failed", err);
    setStatus("Не удалось управлять воспроизведением", "error", 3500);
    applyPlaybackStatus({ playing: false, hasVideo: false, known: true });
    updatePlaybackControls();
  } finally {
    togglePlaybackBtn.removeAttribute("data-loading");
    togglePlaybackBtn.disabled = false;
    refreshPlaybackStatus({ force: true }).catch(() => {});
  }
}

function hasActivePlaybackTab() {
  return (
    Boolean(playlistState?.currentListId) &&
    Boolean(playlistState?.currentVideoId) &&
    Number.isInteger(playlistState?.currentTabId)
  );
}

async function refreshPlaybackStatus({ force = false } = {}) {
  if (!hasActivePlaybackTab()) {
    playbackStatusPromise = null;
    lastPlaybackStatusRequest = 0;
    applyPlaybackStatus({ playing: false, hasVideo: false, known: true });
    updatePlaybackControls();
    return;
  }
  const now = Date.now();
  if (!force && playbackStatusPromise) {
    return playbackStatusPromise;
  }
  if (!force && now - lastPlaybackStatusRequest < 400) {
    return playbackStatusPromise || Promise.resolve();
  }
  lastPlaybackStatusRequest = now;
  playbackStatusPromise = sendMessage("player:getPlaybackStatus", {})
    .then((response) => {
      playbackStatusPromise = null;
      if (response?.state && response.state.currentTabId !== playlistState?.currentTabId) {
        renderState(response.state);
        return;
      }
      if (response?.active) {
        applyPlaybackStatus({
          playing: response.playing === true,
          hasVideo: true,
          known: true,
        });
        updatePlaybackControls();
        return;
      }
      if (response?.reason === "NO_VIDEO" || response?.reason === "TAB_UNREACHABLE") {
        applyPlaybackStatus({ playing: false, hasVideo: false, known: true });
        updatePlaybackControls();
        return;
      }
      if (response?.reason === "NO_ACTIVE_TAB") {
        applyPlaybackStatus({ playing: false, hasVideo: false, known: true });
        updatePlaybackControls();
      }
    })
    .catch((err) => {
      playbackStatusPromise = null;
      if (!err || !/receiving end/i.test(err.message || "")) {
        console.error("Failed to get playback status", err);
      }
      applyPlaybackStatus({ playing: false, hasVideo: false, known: true });
      updatePlaybackControls();
    });
  return playbackStatusPromise;
}

async function playPrevious() {
  if (!playPrevBtn) return;
  setLoading(playPrevBtn, true);
  setStatus("Возвращаюсь к предыдущему...", "info");
  try {
    const state = await sendMessage("playlist:playPrevious", {
      placement: "beforeCurrent",
      tabId: Number.isInteger(playlistState?.currentTabId)
        ? playlistState.currentTabId
        : undefined,
    });
    if (state?.handled === false) {
      setStatus("Предыдущее видео не найдено", "info", 3000);
      return;
    }
    if (state?.state) {
      renderState(state.state);
      setStatus("Предыдущее видео запущено", "success", 2500);
    } else if (state) {
      renderState(state);
    }
  } catch (err) {
    console.error(err);
    setStatus("Не удалось переключиться", "error", 4000);
  } finally {
    setLoading(playPrevBtn, false);
    refreshPlaybackStatus({ force: true }).catch(() => {});
  }
}

async function postponeCurrentVideo() {
  if (!postponeBtn) return;
  if (playlistState?.currentQueue?.freeze) {
    setStatus("Список заморожен, нельзя отложить", "info", 3000);
    return;
  }
  setLoading(postponeBtn, true);
  setStatus("Откладываю видео...", "info");
  try {
    const payload = {
      tabId: Number.isInteger(playlistState?.currentTabId)
        ? playlistState.currentTabId
        : undefined,
    };
    if (playlistState?.currentVideoId) {
      payload.videoId = playlistState.currentVideoId;
    }
    const state = await sendMessage("playlist:postpone", payload);
    if (state?.handled === false) {
      setStatus("Нет следующего видео", "info", 3000);
      return;
    }
    if (state?.state) {
      renderState(state.state);
    } else if (state) {
      renderState(state);
    }
    setStatus("Видео отложено", "success", 2500);
  } catch (err) {
    console.error(err);
    setStatus("Не удалось отложить", "error", 4000);
  } finally {
    setLoading(postponeBtn, false);
    refreshPlaybackStatus({ force: true }).catch(() => {});
  }
}

async function playNext() {
  setLoading(playNextBtn, true);
  setStatus("Переходим к следующему...", "info");
  try {
    const state = await sendMessage("playlist:playNext", {
      tabId: Number.isInteger(playlistState?.currentTabId)
        ? playlistState.currentTabId
        : undefined,
    });
    if (state?.handled === false) {
      setStatus("Следующее видео не найдено", "info");
      return;
    }
    if (state?.state) {
      renderState(state.state);
      setStatus("Следующее видео запущено", "success");
    } else if (state) {
      renderState(state);
    }
  } catch (err) {
    console.error(err);
    setStatus("Не удалось переключиться", "error", 4000);
  } finally {
    setLoading(playNextBtn, false);
    refreshPlaybackStatus({ force: true }).catch(() => {});
  }
}

function openManager() {
  const url = chrome.runtime.getURL("src/popup/lists.html");
  chrome.tabs.create({ url });
}

function openFilterSettings() {
  if (chrome?.runtime?.openOptionsPage) {
    chrome.runtime.openOptionsPage();
    return;
  }
  const url = chrome.runtime.getURL("src/settings/settings.html");
  chrome.tabs.create({ url });
}

listSwitcher?.addEventListener("change", () => {
  const value = listSwitcher.value;
  if (value) {
    selectList(value);
  }
});
addCurrentBtn?.addEventListener("click", () => addFromScope("current"));
addVisibleBtn?.addEventListener("click", () => addFromScope("visible"));
addAllBtn?.addEventListener("click", () => addFromScope("page"));
collectBtn?.addEventListener("click", collectSubscriptions);
startPlaybackBtn?.addEventListener("click", startPlayback);
togglePlaybackBtn?.addEventListener("click", togglePlayback);
playPrevBtn?.addEventListener("click", playPrevious);
postponeBtn?.addEventListener("click", postponeCurrentVideo);
playNextBtn?.addEventListener("click", playNext);
openManagerBtn?.addEventListener("click", openManager);
openFilterSettingsBtn?.addEventListener("click", openFilterSettings);
updateCollectionAvailability();

chrome.runtime.onMessage.addListener((message) => {
  if (!message || !message.type) return;
  if (message.type === "playlist:stateUpdated") {
    if (message.state) {
      renderState(message.state);
    }
  } else if (message.type === "playlist:collectProgress") {
    const phase = collectionController.handleEvent(message.event || message);
    if (phase === "complete" || phase === "error") {
      isCollecting = false;
    }
    updateCollectionAvailability();
  }
});

refreshState();

updateControlCapabilities().catch(() => {});

function getListName(listId) {
  if (!playlistState || !Array.isArray(playlistState.lists)) return "";
  const match = playlistState.lists.find((list) => list.id === listId);
  return match ? match.name : "";
}

function renderLists(state) {
  if (!listSwitcher) return;
  const lists = Array.isArray(state?.lists) ? state.lists : [];
  const currentId = state?.currentListId || null;
  const hadFocus = document.activeElement === listSwitcher;
  const previousValue = listSwitcher.value;

  listSwitcher.innerHTML = "";

  if (!lists.length) {
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Нет доступных списков";
    placeholder.disabled = true;
    placeholder.selected = true;
    listSwitcher.appendChild(placeholder);
    listSwitcher.disabled = true;
    listSwitcher.value = "";
    return;
  }

  lists.forEach((list) => {
    const option = document.createElement("option");
    option.value = list.id;
    const textParts = [list.name];
    const metaLabelParts = [];
    if (list.length != null) {
      const lengthValue =
        typeof list.length === "number" ? list.length : Number(list.length);
      if (Number.isFinite(lengthValue)) {
        textParts.push(`${lengthValue} ${VIDEO_COUNT_ICON}`);
        const lengthLabel =
          lengthValue === 1 ? "1 видео" : `${lengthValue} видео`;
        metaLabelParts.push(lengthLabel);
      } else {
        const rawLength = String(list.length).trim();
        if (rawLength) {
          textParts.push(`${rawLength} ${VIDEO_COUNT_ICON}`);
          metaLabelParts.push(rawLength);
        }
      }
    }
    if (list.freeze && list.id !== DEFAULT_LIST_ID) {
      metaLabelParts.push("без удаления");
    }
    option.textContent = textParts.join(" · ");
    const ariaLabel = metaLabelParts.length
      ? `${list.name}. ${metaLabelParts.join(", ")}`
      : list.name;
    option.title = ariaLabel;
    option.setAttribute("aria-label", ariaLabel);
    listSwitcher.appendChild(option);
  });

  listSwitcher.disabled = lists.length <= 1;

  const validIds = new Set(lists.map((list) => list.id));
  let nextValue = null;
  if (currentId && validIds.has(currentId)) {
    nextValue = currentId;
  } else if (previousValue && validIds.has(previousValue)) {
    nextValue = previousValue;
  } else {
    nextValue = lists[0]?.id || "";
  }

  updateListSelection(nextValue);

  if (hadFocus) {
    requestAnimationFrame(() => {
      listSwitcher.focus({ preventScroll: true });
    });
  }
}

function updateListSelection(listId) {
  if (!listSwitcher) return;
  if (!listId) {
    if (listSwitcher.options.length) {
      listSwitcher.selectedIndex = 0;
    }
    return;
  }
  const option = Array.from(listSwitcher.options).find((item) => item.value === listId);
  if (option) {
    listSwitcher.value = listId;
  } else if (listSwitcher.options.length) {
    listSwitcher.selectedIndex = 0;
  }
}

function selectList(listId) {
  if (!listId) {
    return;
  }
  updateListSelection(listId);
  if (listId === playlistState?.currentListId) {
    return;
  }
  setStatus("Переключаю список...", "info");
  sendMessage("playlist:setCurrentList", { listId })
    .then((state) => {
      if (state) renderState(state);
    })
    .catch((err) => {
      console.error(err);
      setStatus("Не удалось переключить список", "error", 3000);
    });
}

function renderState(state) {
  playlistState = state || {};
  moveMenu.hide();
  renderLists(playlistState);
  const queueState =
    playlistState?.currentQueue || {
      id: playlistState?.currentListId,
      name: getListName(playlistState?.currentListId) || "Очередь",
      freeze: false,
      queue: [],
      currentIndex: null,
    };
  queueController.render(queueState, playlistState);
  historyController.render(playlistState);
  const hasControlledVideo =
    Boolean(playlistState?.currentListId) && Boolean(playlistState?.currentVideoId);
  const nextActiveTabId =
    hasControlledVideo && Number.isInteger(playlistState?.currentTabId)
      ? playlistState.currentTabId
      : null;
  const activeTabChanged = nextActiveTabId !== activePlaybackTabId;
  activePlaybackTabId = nextActiveTabId;
  if (!activePlaybackTabId) {
    playbackStatusPromise = null;
    lastPlaybackStatusRequest = 0;
    applyPlaybackStatus({ playing: false, hasVideo: false, known: true });
  } else if (activeTabChanged) {
    applyPlaybackStatus({ playing: true, hasVideo: true, known: false });
  }
  updatePlaybackControls();
  if (activePlaybackTabId) {
    refreshPlaybackStatus({ force: activeTabChanged }).catch(() => {});
  }
  updateCollectionAvailability();
}

async function refreshState() {
  try {
    const state = await sendMessage("playlist:getState");
    renderState(state || {});
  } catch (err) {
    console.error("Failed to refresh state", err);
  }
}

function setLoading(button, isLoading) {
  if (!button) return;
  button.disabled = Boolean(isLoading);
  if (isLoading) {
    button.dataset.loading = "1";
  } else {
    button.removeAttribute("data-loading");
  }
}

async function sendMessage(type, payload = {}) {
  try {
    return await chrome.runtime.sendMessage({ type, ...payload });
  } catch (err) {
    if (!err || !/receiving end/i.test(err.message || "")) {
      console.error("Message failed", type, err);
    }
    throw err;
  }
}

function applyControlCapabilities(caps) {
  capabilitiesState = {
    canAddCurrent: Boolean(caps?.canAddCurrent),
    canAddVisible: Boolean(caps?.canAddVisible),
    canAddAll: Boolean(caps?.canAddAll),
    context: caps?.context || "unknown",
    controlling: Boolean(caps?.controlling),
  };
  if (addCurrentBtn) {
    addCurrentBtn.classList.toggle("hidden", !capabilitiesState.canAddCurrent);
  }
  if (addVisibleBtn) {
    addVisibleBtn.classList.toggle("hidden", !capabilitiesState.canAddVisible);
  }
  if (addAllBtn) {
    addAllBtn.classList.toggle("hidden", !capabilitiesState.canAddAll);
  }
  if (addRow) {
    const visible = Array.from(addRow.querySelectorAll("button")).filter(
      (btn) => !btn.classList.contains("hidden")
    );
    addRow.classList.toggle("hidden", visible.length === 0);
  }
  updatePlaybackControls();
}

async function updateControlCapabilities() {
  if (!chrome?.tabs?.query) {
    applyControlCapabilities({
      canAddCurrent: false,
      canAddVisible: false,
      canAddAll: false,
      context: "extension",
    });
    return;
  }
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id || !tab.url) {
      applyControlCapabilities({
        canAddCurrent: false,
        canAddVisible: false,
        canAddAll: false,
        context: "unknown",
      });
      return;
    }
    const isYoutube = /https?:\/\/(www\.)?youtube\.com/i.test(tab.url);
    if (!isYoutube) {
      applyControlCapabilities({
        canAddCurrent: false,
        canAddVisible: false,
        canAddAll: false,
        context: "external",
      });
      return;
    }
    const response = await chrome.tabs.sendMessage(tab.id, { type: "collector:getCapabilities" });
    if (response) {
      applyControlCapabilities(response);
    } else {
      applyControlCapabilities({
        canAddCurrent: false,
        canAddVisible: false,
        canAddAll: false,
        context: "unknown",
      });
    }
  } catch (err) {
    applyControlCapabilities({
      canAddCurrent: false,
      canAddVisible: false,
      canAddAll: false,
      context: "unknown",
    });
  }
}


