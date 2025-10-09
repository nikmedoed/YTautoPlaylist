const queueList = document.getElementById("queueList");
const historyList = document.getElementById("historyList");
const queueEmpty = document.getElementById("queueEmpty");
const historyEmpty = document.getElementById("historyEmpty");
const queueCount = document.getElementById("queueCount");
const statusBox = document.getElementById("status");
const statusText = document.getElementById("statusText");
const collectionProgress = document.getElementById("collectionProgress");
const collectionStageText = document.getElementById("collectionStage");
const collectionCounters = document.getElementById("collectionCounters");
const collectionToggle = document.getElementById("collectionToggle");
const collectionLog = document.getElementById("collectionLog");

const listSelect = document.getElementById("listSelect");
const queueTitle = document.querySelector(".queue header h3");
const addCurrentBtn = document.getElementById("addCurrent");
const addPageBtn = document.getElementById("addPage");
const collectBtn = document.getElementById("collectSubscriptions");
const playNextBtn = document.getElementById("playNext");
const openManagerBtn = document.getElementById("openManager");
const actionsRow = document.querySelector(".control-row--actions");

const fallbackThumbnail = chrome.runtime.getURL("icon/icon.png");
const DEFAULT_LIST_ID = "default";

let playlistState = null;
let statusTimeout = null;
let isCollecting = false;
let capabilitiesState = {
  canAddCurrent: false,
  canAddPage: false,
  context: "unknown",
  controlling: false,
};
const dragState = {
  videoId: null,
  overElement: null,
  after: false,
  listId: null,
};

const COLLECTION_STAGE_DEFS = {
  start: { title: "Подготовка" },
  channels: { title: "Получение подписок" },
  playlists: { title: "Загрузка плейлистов" },
  aggregate: { title: "Сбор результатов" },
  filter: { title: "Фильтрация" },
  prepareAdd: { title: "Подготовка к добавлению" },
  adding: { title: "Добавление в очередь" },
  complete: { title: "Готово" },
  error: { title: "Ошибка" },
};

const COLLECTION_PHASE_STAGE = {
  start: "start",
  channelsLoaded: "channels",
  playlistFetch: "playlists",
  playlistFetched: "playlists",
  aggregate: "aggregate",
  filtering: "filter",
  filtered: "filter",
  readyToAdd: "prepareAdd",
  adding: "adding",
  complete: "complete",
  error: "error",
};

const MAX_STAGE_LOG_ITEMS = 8;

const collectionSummary = {
  startDate: null,
  channelCount: 0,
  playlistsTotal: 0,
  playlistsDone: 0,
  playlistCurrent: 0,
  playlistId: null,
  lastPlaylistVideoCount: 0,
  fetched: 0,
  filtered: 0,
  ready: 0,
  adding: 0,
  queueBefore: 0,
  added: 0,
  errorMessage: "",
};

const collectionState = {
  active: false,
  currentStage: null,
  collapsed: true,
  stages: new Map(),
};

const moveMenu = document.createElement("div");
moveMenu.className = "move-menu";
const moveMessage = document.createElement("div");
moveMessage.className = "move-menu__message";
const moveButtons = document.createElement("div");
moveButtons.className = "move-menu__buttons";
const moveCancel = document.createElement("button");
moveCancel.type = "button";
moveCancel.textContent = "Отмена";
moveCancel.classList.add("secondary");
moveMenu.append(moveMessage, moveButtons, moveCancel);
document.body.appendChild(moveMenu);
let moveContext = null;

function hideMoveMenu() {
  moveMenu.dataset.visible = "0";
  moveContext = null;
  moveButtons.textContent = "";
}

function populateMoveMenu(sourceListId) {
  moveButtons.textContent = "";
  const lists = Array.isArray(playlistState?.lists) ? playlistState.lists : [];
  const options = lists.filter((list) => list.id !== sourceListId);
  if (!options.length) {
    moveMessage.textContent = "Нет других списков";
    moveButtons.dataset.empty = "1";
    moveCancel.textContent = "Закрыть";
    return false;
  }
  moveMessage.textContent = "Перенести в:";
  moveButtons.dataset.empty = "0";
  moveCancel.textContent = "Отмена";
  options.forEach((list) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = list.name;
    button.dataset.targetListId = list.id;
    moveButtons.appendChild(button);
  });
  return true;
}

function showMoveMenu(videoId, sourceListId, anchor) {
  if (!populateMoveMenu(sourceListId)) {
    setStatus("Нет других списков", "info", 2500);
    return;
  }
  moveContext = { videoId };
  const rect = anchor.getBoundingClientRect();
  moveMenu.dataset.visible = "1";
  requestAnimationFrame(() => {
    const top = rect.bottom + window.scrollY + 6;
    let left = rect.left + window.scrollX;
    const width = moveMenu.offsetWidth;
    if (left + width > window.scrollX + window.innerWidth - 12) {
      left = window.scrollX + window.innerWidth - width - 12;
    }
    moveMenu.style.top = `${top}px`;
    moveMenu.style.left = `${left}px`;
  });
}

moveCancel.addEventListener("click", () => {
  hideMoveMenu();
});

moveButtons.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-target-list-id]");
  if (!button || !moveContext) return;
  const targetListId = button.dataset.targetListId;
  hideMoveMenu();
  setStatus("Переношу видео...", "info");
  try {
    const state = await sendMessage("playlist:moveVideo", {
      videoId: moveContext.videoId,
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
});

document.addEventListener("click", (event) => {
  if (moveMenu.dataset.visible !== "1") return;
  if (moveMenu.contains(event.target)) return;
  if (event.target.closest(".video-move")) return;
  hideMoveMenu();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && moveMenu.dataset.visible === "1") {
    hideMoveMenu();
  }
});

function sanitizeText(text) {
  if (!text) return "";
  return text.replace(/\s+/g, " ").trim();
}

function formatDuration(duration) {
  if (!duration) return "";
  if (typeof duration === "number") {
    const sec = Math.max(0, Math.round(duration));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h)
      return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(
        s
      ).padStart(2, "0")}`;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(duration);
  if (!match) return "";
  const h = Number(match[1] || 0);
  const m = Number(match[2] || 0);
  const s = Number(match[3] || 0);
  if (h) {
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(
      s
    ).padStart(2, "0")}`;
  }
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function formatDate(value) {
  if (!value) return "";
  const date =
    typeof value === "number" ? new Date(value) : new Date(String(value));
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("ru-RU", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function diffQueueLength(state) {
  if (!playlistState) return 0;
  const prev = Array.isArray(playlistState?.currentQueue?.queue)
    ? playlistState.currentQueue.queue.length
    : 0;
  const next = Array.isArray(state?.currentQueue?.queue)
    ? state.currentQueue.queue.length
    : 0;
  return next - prev;
}

function formatTime(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function resetCollectionSummary() {
  collectionSummary.startDate = null;
  collectionSummary.channelCount = 0;
  collectionSummary.playlistsTotal = 0;
  collectionSummary.playlistsDone = 0;
  collectionSummary.playlistCurrent = 0;
  collectionSummary.playlistId = null;
  collectionSummary.lastPlaylistVideoCount = 0;
  collectionSummary.fetched = 0;
  collectionSummary.filtered = 0;
  collectionSummary.ready = 0;
  collectionSummary.adding = 0;
  collectionSummary.queueBefore = 0;
  collectionSummary.added = 0;
  collectionSummary.errorMessage = "";
}

function clearCollectionStages() {
  collectionState.stages.forEach((entry) => entry?.container?.remove());
  collectionState.stages.clear();
}

function hideCollectionPanel() {
  if (!collectionProgress) return;
  collectionState.currentStage = null;
  collectionState.active = false;
  collectionState.collapsed = true;
  collectionProgress.hidden = true;
  collectionProgress.classList.remove("finished", "error");
  if (collectionStageText) collectionStageText.textContent = "";
  if (collectionCounters) collectionCounters.textContent = "";
  if (collectionLog) collectionLog.textContent = "";
  clearCollectionStages();
  updateCollectionToggle();
}

function updateCollectionToggle() {
  if (!collectionToggle) return;
  const hidden = !collectionProgress || collectionProgress.hidden;
  collectionToggle.disabled = hidden;
  if (hidden) {
    collectionToggle.textContent = "Показать логи";
    return;
  }
  collectionToggle.textContent = collectionState.collapsed
    ? "Показать логи"
    : "Свернуть";
}

function setCollectionCollapsed(collapsed) {
  collectionState.collapsed = Boolean(collapsed);
  if (collectionProgress) {
    collectionProgress.classList.toggle("collapsed", collectionState.collapsed);
  }
  updateCollectionToggle();
  collectionState.stages.forEach((entry) => {
    if (!entry?.details) return;
    if (
      collectionState.collapsed ||
      entry.container.classList.contains("completed")
    ) {
      entry.details.open = false;
    } else {
      entry.details.open = true;
    }
  });
}

function beginCollectionProgress(event) {
  collectionState.active = true;
  collectionState.currentStage = null;
  collectionState.collapsed = true;
  resetCollectionSummary();
  if (event?.startDate) {
    collectionSummary.startDate = event.startDate;
  }
  clearCollectionStages();
  if (collectionLog) {
    collectionLog.textContent = "";
  }
  if (collectionProgress) {
    collectionProgress.hidden = false;
    collectionProgress.classList.remove("finished", "error");
  }
  if (collectionStageText) collectionStageText.textContent = "";
  if (collectionCounters) collectionCounters.textContent = "";
  setCollectionCollapsed(true);
}

function armCollectionPanel() {
  if (!collectionState.active) return;
  if (collectionProgress) {
    collectionProgress.hidden = false;
    collectionProgress.classList.remove("finished", "error");
  }
  updateCollectionToggle();
}

function ensureCollectionStage(stageId) {
  if (!collectionLog) return null;
  let entry = collectionState.stages.get(stageId);
  if (!entry) {
    const def = COLLECTION_STAGE_DEFS[stageId] || { title: stageId };
    const li = document.createElement("li");
    li.className = "collection-stage";
    const details = document.createElement("details");
    details.open = !collectionState.collapsed;
    const summary = document.createElement("summary");
    const titleSpan = document.createElement("span");
    titleSpan.className = "collection-stage__title";
    titleSpan.textContent = def.title;
    const metaSpan = document.createElement("span");
    metaSpan.className = "collection-stage__meta";
    summary.append(titleSpan, metaSpan);
    const body = document.createElement("div");
    body.className = "collection-stage__body";
    details.append(summary, body);
    li.appendChild(details);
    collectionLog.prepend(li);
    entry = {
      id: stageId,
      container: li,
      details,
      summaryTitle: titleSpan,
      summaryMeta: metaSpan,
      body,
      logs: [],
    };
    collectionState.stages.set(stageId, entry);
  } else {
    collectionLog.prepend(entry.container);
  }
  return entry;
}

function addStageLog(entry, text) {
  if (!entry?.body || !text) return;
  const item = document.createElement("div");
  item.className = "collection-stage__log";
  item.textContent = `[${formatTime()}] ${text}`;
  entry.body.prepend(item);
  entry.logs.unshift(item);
  while (entry.logs.length > MAX_STAGE_LOG_ITEMS) {
    const tail = entry.logs.pop();
    tail?.remove();
  }
}

function shortenId(value, length = 8) {
  if (!value) return "";
  const str = String(value);
  if (str.length <= length) return str;
  const half = Math.max(1, Math.floor((length - 1) / 2));
  return `${str.slice(0, half)}…${str.slice(-half)}`;
}

function formatDateShort(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("ru-RU", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatStageMeta(stageId, event) {
  switch (stageId) {
    case "start": {
      if (collectionSummary.startDate) {
        const text = formatDateShort(collectionSummary.startDate);
        if (text) return `С ${text}`;
      }
      return "Инициализация";
    }
    case "channels": {
      const channels =
        collectionSummary.channelCount || event.channelCount || 0;
      const playlists =
        collectionSummary.playlistsTotal || event.playlistCount || 0;
      return `Каналы ${channels}, плейлисты ${playlists}`;
    }
    case "playlists": {
      if (collectionSummary.playlistsTotal) {
        const current = Math.max(
          collectionSummary.playlistCurrent,
          collectionSummary.playlistsDone
        );
        return `Плейлист ${Math.min(
          current,
          collectionSummary.playlistsTotal
        )}/${collectionSummary.playlistsTotal}`;
      }
      return "Загрузка плейлистов";
    }
    case "aggregate":
      return `Найдено ${collectionSummary.fetched || event.videoCount || 0} видео`;
    case "filter":
      if (event.phase === "filtering") {
        return `Проверяем ${event.videoCount || 0} видео`;
      }
      if (collectionSummary.filtered) {
        return `После фильтра ${collectionSummary.filtered}`;
      }
      return "Фильтрация";
    case "prepareAdd":
      return `Готово к добавлению ${collectionSummary.ready || event.videoCount || 0}`;
    case "adding": {
      const count =
        collectionSummary.adding ??
        (typeof event.addCount === "number" ? event.addCount : 0);
      const before =
        collectionSummary.queueBefore && collectionSummary.queueBefore > 0
          ? `, было ${collectionSummary.queueBefore}`
          : "";
      return count ? `Добавляем ${count}${before}` : "Добавление в очередь";
    }
    case "complete": {
      const added =
        collectionSummary.added ??
        (typeof event.added === "number" ? event.added : 0);
      const fetched =
        collectionSummary.fetched ??
        (typeof event.fetched === "number" ? event.fetched : added);
      if (added) {
        return `Добавлено ${added} из ${fetched || added}`;
      }
      if (fetched) {
        return `Добавлено 0 из ${fetched}`;
      }
      return "Новых видео не найдено";
    }
    case "error":
      return collectionSummary.errorMessage || event.message || "Ошибка";
    default:
      return "";
  }
}

function formatStageLog(event) {
  switch (event.phase) {
    case "start":
      return event.startDate
        ? `Старт с ${formatDateShort(event.startDate)}`
        : "Запуск процесса";
    case "channelsLoaded":
      return `Получено ${
        event.channelCount || 0
      } каналов и ${event.playlistCount || 0} плейлистов`;
    case "playlistFetch":
      return `Запрос плейлиста ${event.index || 0}/${event.total || 0} ${shortenId(
        event.playlistId
      )}`;
    case "playlistFetched":
      return `Загружено ${event.videoCount || 0} видео из ${shortenId(
        event.playlistId
      )}`;
    case "aggregate":
      return `Собрано ${event.videoCount || 0} уникальных видео`;
    case "filtering":
      return `Фильтрация (${event.videoCount || 0})`;
    case "filtered":
      return `После фильтра осталось ${event.videoCount || 0}`;
    case "readyToAdd":
      return `К добавлению ${event.videoCount || 0} видео`;
    case "adding":
      return `Добавляем ${event.addCount || 0} видео (очередь была ${
        event.queueBefore || 0
      })`;
    case "complete":
      return event.added
        ? `В очередь добавлено ${event.added} из ${
            event.fetched || event.added
          }`
        : "Новых видео не найдено";
    case "error":
      return event.message || "Произошла ошибка";
    default:
      return null;
  }
}

function applyStageUpdate(stageId, event) {
  const entry = ensureCollectionStage(stageId);
  if (!entry) return null;
  const meta = formatStageMeta(stageId, event);
  if (entry.summaryMeta) entry.summaryMeta.textContent = meta;
  const logText = formatStageLog(event);
  if (logText) {
    addStageLog(entry, logText);
  }
  return entry;
}

function openStage(stageId) {
  const entry = collectionState.stages.get(stageId);
  if (!entry) return;
  entry.container.classList.remove("completed");
  if (entry.details) {
    entry.details.open = !collectionState.collapsed;
  }
}

function completeStage(stageId, keepOpen = false) {
  const entry = collectionState.stages.get(stageId);
  if (!entry) return;
  entry.container.classList.add("completed");
  if (entry.details) {
    entry.details.open = keepOpen ? !collectionState.collapsed : false;
  }
}

function updateCollectionSummary(event) {
  switch (event.phase) {
    case "start":
      if (event.startDate) {
        collectionSummary.startDate = event.startDate;
      }
      break;
    case "channelsLoaded":
      collectionSummary.channelCount = event.channelCount || 0;
      collectionSummary.playlistsTotal = event.playlistCount || 0;
      break;
    case "playlistFetch":
      collectionSummary.playlistsTotal =
        event.total || collectionSummary.playlistsTotal;
      collectionSummary.playlistCurrent =
        event.index || collectionSummary.playlistCurrent;
      collectionSummary.playlistsDone = Math.max(
        collectionSummary.playlistsDone,
        Math.max(0, (event.index || 1) - 1)
      );
      collectionSummary.playlistId =
        event.playlistId || collectionSummary.playlistId;
      break;
    case "playlistFetched":
      collectionSummary.playlistsTotal =
        event.total || collectionSummary.playlistsTotal;
      collectionSummary.playlistCurrent =
        event.index || collectionSummary.playlistCurrent;
      collectionSummary.playlistsDone = Math.max(
        collectionSummary.playlistsDone,
        event.index || collectionSummary.playlistsDone
      );
      collectionSummary.playlistId =
        event.playlistId || collectionSummary.playlistId;
      collectionSummary.lastPlaylistVideoCount =
        event.videoCount || collectionSummary.lastPlaylistVideoCount;
      break;
    case "aggregate":
      collectionSummary.fetched = event.videoCount || 0;
      break;
    case "filtering":
      collectionSummary.filtered = event.videoCount || 0;
      break;
    case "filtered":
      collectionSummary.filtered =
        event.videoCount || collectionSummary.filtered;
      break;
    case "readyToAdd":
      collectionSummary.ready = event.videoCount || 0;
      break;
    case "adding":
      if (typeof event.addCount === "number") {
        collectionSummary.adding = event.addCount;
      }
      if (typeof event.queueBefore === "number") {
        collectionSummary.queueBefore = event.queueBefore;
      }
      break;
    case "complete":
      if (typeof event.added === "number") {
        collectionSummary.added = event.added;
      }
      if (typeof event.fetched === "number") {
        collectionSummary.fetched = event.fetched;
      }
      break;
    case "error":
      collectionSummary.errorMessage = event.message || "";
      break;
    default:
      break;
  }
}

function updateCollectionHeader(stageId) {
  if (!collectionStageText || !collectionCounters) return;
  const def = COLLECTION_STAGE_DEFS[stageId] || { title: stageId };
  collectionStageText.textContent = def.title;
  const parts = [];
  if (collectionSummary.channelCount) {
    parts.push(`Каналы ${collectionSummary.channelCount}`);
  }
  if (collectionSummary.playlistsTotal) {
    const current = Math.max(
      collectionSummary.playlistCurrent,
      collectionSummary.playlistsDone
    );
    parts.push(
      `Плейлисты ${Math.min(
        current,
        collectionSummary.playlistsTotal
      )}/${collectionSummary.playlistsTotal}`
    );
  }
  if (collectionSummary.fetched) {
    parts.push(`Найдено ${collectionSummary.fetched}`);
  }
  if (
    collectionSummary.filtered &&
    collectionSummary.filtered !== collectionSummary.fetched
  ) {
    parts.push(`После фильтра ${collectionSummary.filtered}`);
  }
  if (collectionSummary.ready) {
    parts.push(`К добавлению ${collectionSummary.ready}`);
  }
  if (collectionSummary.added) {
    parts.push(`Добавлено ${collectionSummary.added}`);
  } else if (collectionSummary.adding) {
    parts.push(`Добавляется ${collectionSummary.adding}`);
  }
  collectionCounters.textContent = parts.join(" · ");
}

function getCollectionStatusInfo(event) {
  if (!event || !event.phase) return null;
  switch (event.phase) {
    case "start":
      return { text: "Сбор подписок...", kind: "info", timeout: 0 };
    case "channelsLoaded":
      return {
        text: `Каналов: ${event.channelCount || 0}, плейлистов: ${
          event.playlistCount || 0
        }`,
        kind: "info",
        timeout: 0,
      };
    case "playlistFetch":
      return {
        text: `Загрузка плейлистов ${event.index || 0}/${event.total || 0}`,
        kind: "info",
        timeout: 0,
      };
    case "playlistFetched":
      return {
        text: `Плейлист ${event.index || 0}/${event.total || 0}: +${
          event.videoCount || 0
        }`,
        kind: "info",
        timeout: 0,
      };
    case "aggregate":
      return {
        text: `Найдено ${event.videoCount || 0} видео`,
        kind: "info",
        timeout: 0,
      };
    case "filtering":
      return {
        text: `Фильтрация ${event.videoCount || 0} видео`,
        kind: "info",
        timeout: 0,
      };
    case "filtered":
      return {
        text: `После фильтров: ${event.videoCount || 0}`,
        kind: "info",
        timeout: 0,
      };
    case "readyToAdd":
      return {
        text: `Готово к добавлению: ${event.videoCount || 0}`,
        kind: "info",
        timeout: 0,
      };
    case "adding":
      return {
        text: `Добавление в очередь (${event.addCount || 0})`,
        kind: "info",
        timeout: 0,
      };
    case "complete": {
      const added = event.added || 0;
      const fetched = event.fetched ?? added;
      return {
        text: added
          ? `Добавлено ${added} из ${fetched ?? added}`
          : "Новых видео не найдено",
        kind: added ? "success" : "info",
        timeout: 5000,
      };
    }
    case "error":
      return {
        text: event.message || "Ошибка при сборе подписок",
        kind: "error",
        timeout: 6000,
      };
    default:
      return null;
  }
}

function setStatus(text, kind = "info", timeout = 2200) {
  if (!text) {
    statusBox.hidden = true;
    statusBox.removeAttribute("data-kind");
    if (statusTimeout) clearTimeout(statusTimeout);
    statusTimeout = null;
    return;
  }
  statusText.textContent = text;
  statusBox.dataset.kind = kind;
  statusBox.hidden = false;
  if (statusTimeout) clearTimeout(statusTimeout);
  if (timeout && timeout > 0) {
    statusTimeout = window.setTimeout(() => {
      statusBox.hidden = true;
      statusBox.removeAttribute("data-kind");
      statusTimeout = null;
    }, timeout);
  } else {
    statusTimeout = null;
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
    canAddPage: Boolean(caps?.canAddPage),
    context: caps?.context || "unknown",
    controlling: Boolean(caps?.controlling),
  };
  if (addCurrentBtn) {
    const shouldShow = capabilitiesState.canAddCurrent && !capabilitiesState.controlling;
    addCurrentBtn.classList.toggle("hidden", !shouldShow);
  }
  if (addPageBtn) {
    addPageBtn.classList.toggle("hidden", !capabilitiesState.canAddPage);
  }
  if (actionsRow) {
    const visible = Array.from(actionsRow.querySelectorAll("button")).filter(
      (btn) => !btn.classList.contains("hidden")
    );
    actionsRow.classList.toggle("hidden", visible.length === 0);
  }
}

async function updateControlCapabilities() {
  if (!chrome?.tabs?.query) {
    applyControlCapabilities({
      canAddCurrent: false,
      canAddPage: false,
      context: "extension",
    });
    return;
  }
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id || !tab.url) {
      applyControlCapabilities({ canAddCurrent: false, canAddPage: false, context: "unknown" });
      return;
    }
    const isYoutube = /https?:\/\/(www\.)?youtube\.com/i.test(tab.url);
    if (!isYoutube) {
      applyControlCapabilities({ canAddCurrent: false, canAddPage: false, context: "external" });
      return;
    }
    const response = await chrome.tabs.sendMessage(tab.id, { type: "collector:getCapabilities" });
    if (response) {
      applyControlCapabilities(response);
    } else {
      applyControlCapabilities({ canAddCurrent: false, canAddPage: false, context: "unknown" });
    }
  } catch (err) {
    applyControlCapabilities({ canAddCurrent: false, canAddPage: false, context: "unknown" });
  }
}

function resolveThumbnail(entry) {
  if (entry && typeof entry.thumbnail === "string" && entry.thumbnail) {
    return entry.thumbnail;
  }
  return fallbackThumbnail;
}

function getListName(listId) {
  if (!playlistState || !Array.isArray(playlistState.lists)) return "";
  const match = playlistState.lists.find((list) => list.id === listId);
  return match ? match.name : "";
}

function renderLists(state) {
  if (!listSelect) return;
  const lists = Array.isArray(state.lists) ? state.lists : [];
  const currentId = state.currentListId;
  const previousValue = listSelect.value;
  listSelect.innerHTML = "";
  lists.forEach((list) => {
    const option = document.createElement("option");
    option.value = list.id;
    option.textContent =
      list.id === DEFAULT_LIST_ID
        ? list.name
        : `${list.name}${list.freeze ? " (без удаления)" : ""}`;
    if (list.length != null) {
      option.textContent += ` — ${list.length}`;
    }
    listSelect.appendChild(option);
  });
  if (currentId && lists.some((list) => list.id === currentId)) {
    listSelect.value = currentId;
  } else if (previousValue && lists.some((list) => list.id === previousValue)) {
    listSelect.value = previousValue;
  }
}

function clearDragIndicators() {
  queueList
    .querySelectorAll(".drop-before, .drop-after")
    .forEach((el) => el.classList.remove("drop-before", "drop-after"));
}

function resetDragState() {
  if (dragState.videoId) {
    const draggingElement = queueList.querySelector(
      `.video-item[data-id="${dragState.videoId}"]`
    );
    draggingElement?.classList.remove("dragging");
  }
  clearDragIndicators();
  dragState.videoId = null;
  dragState.overElement = null;
  dragState.after = false;
  dragState.listId = null;
}

function renderQueue(queueState) {
  queueList.textContent = "";
  const listId =
    queueState?.id || playlistState?.currentQueue?.id || playlistState?.currentListId;
  const listName =
    queueState?.name ||
    playlistState?.currentQueue?.name ||
    "Очередь";
  const items = Array.isArray(queueState?.queue) ? queueState.queue : [];
  queueCount.textContent = items.length ? `${items.length}` : "";
  const currentId = playlistState?.currentVideoId || queueState?.queue?.[
    queueState?.currentIndex ?? -1
  ]?.id;
  if (queueTitle) {
    const freezeLabel = queueState?.freeze && listId && listId !== DEFAULT_LIST_ID ? " • без удаления" : "";
    queueTitle.textContent = `${listName}${freezeLabel}`;
  }
  if (!items.length) {
    queueEmpty.hidden = false;
    return;
  }
  queueEmpty.hidden = true;

  items.forEach((entry, index) => {
    const li = document.createElement("li");
    li.className = "video-item queue-item";
    li.dataset.id = entry.id;
    li.dataset.index = String(index);
    if (listId) li.dataset.listId = listId;
    if (currentId && entry.id === currentId) {
      li.classList.add("active");
    }

    const handle = document.createElement("button");
    handle.type = "button";
    handle.className = "video-handle";
    handle.title = "Перетащить";
    handle.setAttribute("aria-label", "Перетащить");
    handle.setAttribute("draggable", "true");
    li.appendChild(handle);

    const thumb = document.createElement("img");
    thumb.className = "video-thumb";
    thumb.src = resolveThumbnail(entry);
    thumb.alt = entry.title || "Видео";
    thumb.decoding = "async";
    thumb.loading = "lazy";
    li.appendChild(thumb);

    const body = document.createElement("div");
    body.className = "video-body";
    const title = document.createElement("div");
    title.className = "video-title";
    title.textContent = sanitizeText(entry.title) || "Без названия";
    const details = document.createElement("div");
    details.className = "video-details";
    const detParts = [];
    if (entry.channelTitle) detParts.push(entry.channelTitle);
    if (entry.publishedAt) detParts.push(formatDate(entry.publishedAt));
    if (entry.duration) detParts.push(formatDuration(entry.duration));
    details.textContent = detParts.join(" • ");
    body.appendChild(title);
    body.appendChild(details);
    li.appendChild(body);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "icon-button video-remove";
    remove.dataset.action = "remove";
    remove.dataset.listId = listId;
    remove.title = "Удалить из очереди";
    remove.textContent = "✕";
    li.appendChild(remove);

    const move = document.createElement("button");
    move.type = "button";
    move.className = "icon-button video-move";
    move.dataset.action = "move";
    move.dataset.listId = listId;
    move.title = "Перенести в другой список";
    move.textContent = "⇄";
    li.appendChild(move);

    queueList.appendChild(li);
  });
}

function renderHistory(state) {
  historyList.textContent = "";
  const items = Array.isArray(state.history) ? state.history : [];
  if (!items.length) {
    historyEmpty.hidden = false;
    return;
  }
  historyEmpty.hidden = true;
  items.forEach((entry, index) => {
    const li = document.createElement("li");
    li.className = "video-item history-item";
    li.dataset.id = entry.id;
    li.dataset.position = String(index);

    const thumb = document.createElement("img");
    thumb.className = "video-thumb";
    thumb.src = resolveThumbnail(entry);
    thumb.alt = entry.title || "Видео";
    thumb.decoding = "async";
    thumb.loading = "lazy";
    li.appendChild(thumb);

    const body = document.createElement("div");
    body.className = "video-body";
    const title = document.createElement("div");
    title.className = "video-title";
    title.textContent = sanitizeText(entry.title) || "Без названия";
    const details = document.createElement("div");
    details.className = "video-details";
    const detailNodes = [];
    if (entry.channelTitle) {
      detailNodes.push({ text: entry.channelTitle });
    }
    if (entry.watchedAt) {
      detailNodes.push({ text: `Просмотрено: ${formatDate(entry.watchedAt)}` });
    }
    if (entry.duration) {
      detailNodes.push({ text: formatDuration(entry.duration) });
    }
    if (entry.listId) {
      const listName = getListName(entry.listId);
      if (listName) {
        detailNodes.push({ text: listName, className: "list-label" });
      }
    }
    detailNodes.forEach((part, idx) => {
      if (idx > 0) {
        const sep = document.createTextNode(" • ");
        details.appendChild(sep);
      }
      const span = document.createElement("span");
      span.textContent = part.text;
      if (part.className) span.classList.add(part.className);
      details.appendChild(span);
    });
    body.appendChild(title);
    body.appendChild(details);
    li.appendChild(body);

    const restore = document.createElement("button");
    restore.type = "button";
    restore.className = "icon-button history-restore";
    restore.dataset.action = "restore";
    restore.title = "Вернуть в очередь";
    restore.textContent = "↺";
    li.appendChild(restore);

    historyList.appendChild(li);
  });
}

function renderState(state) {
  playlistState = state;
  hideMoveMenu();
  renderLists(state || {});
  const queueState = state?.currentQueue || {
    id: state?.currentListId,
    name: getListName(state?.currentListId) || "Очередь",
    freeze: false,
    queue: [],
    currentIndex: null,
  };
  renderQueue(queueState);
  renderHistory(state || {});
}

async function refreshState() {
  const state = await sendMessage("playlist:getState");
  renderState(state || {});
}

async function addFromScope(scope) {
  const button = scope === "current" ? addCurrentBtn : addPageBtn;
  if (!button || button.classList.contains("hidden")) return;
  if (
    (scope === "current" && !capabilitiesState.canAddCurrent) ||
    (scope === "page" && !capabilitiesState.canAddPage)
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
    if (!ids.length) {
      setStatus("Видео не найдены", "info");
      return;
    }
    const state = await sendMessage("playlist:addByIds", { videoIds: ids });
    if (state) {
      const added = diffQueueLength(state);
      renderState(state);
      if (added > 0) {
        setStatus(`Добавлено ${added} видео`, "success");
      } else {
        setStatus("Все видео уже в очереди", "info");
      }
    } else {
      setStatus("Не удалось обновить очередь", "error", 4000);
    }
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
  armCollectionPanel();
  setStatus("Собираю новые видео...", "info", 0);
  isCollecting = true;
  try {
    const result = await sendMessage("playlist:collectSubscriptions");
    if (result?.state) {
      renderState(result.state);
    }
  } catch (err) {
    console.error(err);
    setStatus("Не удалось собрать подписки", "error", 4000);
  } finally {
    setLoading(collectBtn, false);
    isCollecting = false;
  }
}

async function playNext() {
  setLoading(playNextBtn, true);
  setStatus("Переходим к следующему...", "info");
  try {
    const state = await sendMessage("playlist:playNext", {});
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
  }
}

async function removeQueueItem(item) {
  hideMoveMenu();
  if (!item) return;
  const videoId = item.dataset.id;
  if (!videoId) return;
  try {
    const state = await sendMessage("playlist:remove", { videoId, listId: item.dataset.listId || playlistState?.currentQueue?.id });
    if (state) {
      renderState(state);
      setStatus("Видео удалено", "info");
    }
  } catch (err) {
    console.error(err);
    setStatus("Не удалось удалить видео", "error", 3000);
  }
}

function handleQueueClick(event) {
  const removeBtn = event.target.closest(".video-remove");
  if (removeBtn) {
    event.stopPropagation();
    const item = removeBtn.closest(".video-item");
    removeQueueItem(item);
    return;
  }
  const moveBtn = event.target.closest(".video-move");
  if (moveBtn) {
    event.stopPropagation();
    const item = moveBtn.closest(".video-item");
    if (item) {
      showMoveMenu(item.dataset.id, item.dataset.listId, moveBtn);
    }
    return;
  }
  if (event.target.closest(".video-handle")) {
    return;
  }
  const item = event.target.closest(".video-item");
  if (!item) return;
  const videoId = item.dataset.id;
  if (!videoId) return;
  const listId = item.dataset.listId || playlistState?.currentQueue?.id;
  hideMoveMenu();
  setStatus("Запускаю видео...", "info");
  sendMessage("playlist:play", { videoId, listId })
    .then((state) => {
      if (state) renderState(state);
    })
    .catch((err) => {
      console.error(err);
      setStatus("Не удалось запустить видео", "error", 3000);
    });
}

function handleHistoryClick(event) {
  const restoreBtn = event.target.closest("[data-action='restore']");
  if (!restoreBtn) return;
  event.stopPropagation();
  const li = restoreBtn.closest(".video-item");
  if (!li) return;
  const position = Number(li.dataset.position || "0");
  setStatus("Возвращаю видео...", "info");
  hideMoveMenu();
  sendMessage("playlist:playPrevious", { position, placement: "beforeCurrent" })
    .then((state) => {
      if (state) renderState(state);
    })
    .catch((err) => {
      console.error(err);
      setStatus("Не удалось вернуть видео", "error", 3000);
    });
}

function handleDragStart(event) {
  const handle = event.target.closest(".video-handle");
  if (!handle) {
    event.preventDefault();
    return;
  }
  const item = handle.closest(".video-item");
  if (!item) {
    event.preventDefault();
    return;
  }
  dragState.videoId = item.dataset.id;
  dragState.overElement = null;
  dragState.after = false;
  dragState.listId = item.dataset.listId || playlistState?.currentQueue?.id || null;
  item.classList.add("dragging");
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", dragState.videoId);
  }
}

function handleDragOver(event) {
  if (!dragState.videoId) return;
  event.preventDefault();
  const item = event.target.closest(".video-item");
  if (!item || item.dataset.id === dragState.videoId) {
    return;
  }
  const targetListId = item.dataset.listId;
  if (targetListId && dragState.listId && targetListId !== dragState.listId) {
    return;
  }
  const rect = item.getBoundingClientRect();
  const after = event.clientY - rect.top > rect.height / 2;
  if (dragState.overElement !== item || dragState.after !== after) {
    clearDragIndicators();
    item.classList.add(after ? "drop-after" : "drop-before");
    dragState.overElement = item;
    dragState.after = after;
  }
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = "move";
  }
}

async function handleDrop(event) {
  if (!dragState.videoId) return;
  event.preventDefault();
  const item = event.target.closest(".video-item");
  let targetElement = item || dragState.overElement;
  let targetIndex;
  if (targetElement && dragState.listId && targetElement.dataset.listId && targetElement.dataset.listId !== dragState.listId) {
    resetDragState();
    return;
  }
  if (!targetElement) {
    targetIndex = queueList.children.length;
  } else {
    const items = Array.from(queueList.querySelectorAll(".video-item"));
    targetIndex = items.indexOf(targetElement);
    if (targetIndex === -1) {
      resetDragState();
      return;
    }
    const rect = targetElement.getBoundingClientRect();
    const after =
      item === targetElement
        ? event.clientY - rect.top > rect.height / 2
        : dragState.after;
    if (after) targetIndex += 1;
  }

  const queue = Array.isArray(playlistState?.currentQueue?.queue)
    ? playlistState.currentQueue.queue
    : [];
  const fromIndex = queue.findIndex((entry) => entry.id === dragState.videoId);
  if (fromIndex === -1) {
    resetDragState();
    return;
  }
  if (targetIndex === fromIndex || targetIndex === fromIndex + 1) {
    resetDragState();
    return;
  }

  try {
    const state = await sendMessage("playlist:reorder", {
      videoId: dragState.videoId,
      targetIndex,
    });
    if (state) {
      renderState(state);
      setStatus("Порядок обновлён", "info");
    }
  } catch (err) {
    console.error(err);
    setStatus("Не удалось изменить порядок", "error", 3000);
  } finally {
    resetDragState();
  }
}

function handleDragEnd() {
  resetDragState();
}

function openManager() {
  const url = chrome.runtime.getURL("src/popup/lists.html");
  chrome.tabs.create({ url });
}

function handleCollectionProgress(event) {
  if (!event || !event.phase) return;
  const stageId = COLLECTION_PHASE_STAGE[event.phase] || "start";

  if (event.phase === "start") {
    beginCollectionProgress(event);
  } else if (!collectionState.active) {
    beginCollectionProgress();
  } else {
    armCollectionPanel();
  }

  updateCollectionSummary(event);

  if (
    collectionState.currentStage &&
    collectionState.currentStage !== stageId
  ) {
    completeStage(collectionState.currentStage);
  }

  const entry = applyStageUpdate(stageId, event);
  collectionState.currentStage = stageId;

  if (event.phase === "complete") {
    completeStage(stageId, true);
    isCollecting = false;
    hideCollectionPanel();
  } else if (event.phase === "error") {
    collectionSummary.errorMessage =
      event.message || collectionSummary.errorMessage;
    isCollecting = false;
    hideCollectionPanel();
  } else if (entry) {
    openStage(stageId);
    if (collectionProgress) {
      collectionProgress.classList.remove("finished", "error");
    }
  }

  updateCollectionHeader(stageId);
  const statusInfo = getCollectionStatusInfo(event);
  if (statusInfo) {
    setStatus(statusInfo.text, statusInfo.kind, statusInfo.timeout);
  }
}

listSelect?.addEventListener("change", () => {
  if (!listSelect.value || listSelect.value === playlistState?.currentListId) return;
  setStatus("Переключаю список...", "info");
  sendMessage("playlist:setCurrentList", { listId: listSelect.value })
    .then((state) => {
      if (state) renderState(state);
    })
    .catch((err) => {
      console.error(err);
      setStatus("Не удалось переключить список", "error", 3000);
    });
});

queueList.addEventListener("click", handleQueueClick);
historyList.addEventListener("click", handleHistoryClick);

queueList.addEventListener("dragstart", handleDragStart);
queueList.addEventListener("dragover", handleDragOver);
queueList.addEventListener("drop", handleDrop);
queueList.addEventListener("dragend", handleDragEnd);

addCurrentBtn?.addEventListener("click", () => addFromScope("current"));
addPageBtn?.addEventListener("click", () => addFromScope("page"));
collectBtn?.addEventListener("click", collectSubscriptions);
playNextBtn?.addEventListener("click", playNext);
openManagerBtn?.addEventListener("click", openManager);
collectionToggle?.addEventListener("click", () => {
  if (collectionProgress?.hidden) return;
  setCollectionCollapsed(!collectionState.collapsed);
});
updateCollectionToggle();

chrome.runtime.onMessage.addListener((message) => {
  if (!message || !message.type) return;
  if (message.type === "playlist:stateUpdated") {
    if (message.state) {
      renderState(message.state);
    }
  } else if (message.type === "playlist:collectProgress") {
    handleCollectionProgress(message.event || message);
  }
});

updateControlCapabilities()
  .catch(() => {})
  .finally(() => {
    refreshState();
  });


