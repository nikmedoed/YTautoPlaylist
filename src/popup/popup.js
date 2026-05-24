// Main popup entrypoint. Wires DOM elements to queue, history, collection, add, and playback controllers.
import { createMoveMenu } from "./lib/moveMenu.js";
import { createStatusController } from "./modules/shared/status.js";
import { createQueueController } from "./modules/queue/index.js";
import { createHistoryController } from "./modules/history/index.js";
import { createCollectionController } from "./modules/collection/index.js";
import { createAddActionsController } from "./modules/shared/addActions.js";
import { createCollectionAvailabilityController } from "./modules/collection/availability.js";
import {
  renderListSwitcher,
  updateListSelection as updateSwitcherSelection,
} from "./modules/manager/listSwitcher.js";
import { createPlaybackController } from "./modules/playback/controller.js";
import {
  delay,
  isRecoverableRuntimeError,
  sendMessage,
} from "./lib/runtimeMessages.js";
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

let playlistState = null;
const { setStatus } = createStatusController({ statusBox, statusText });

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

const collectionAvailabilityController = createCollectionAvailabilityController({
  applyState: (state) => renderState(state),
  collectBtn,
  collectionArea,
  collectionNote,
  collectionController,
  defaultListId: DEFAULT_LIST_ID,
  getPlaylistState: () => playlistState,
  getSelectedListId,
  setLoading,
  setStatus,
  sendMessage,
});

const playbackController = createPlaybackController({
  startPlaybackBtn,
  playPrevBtn,
  postponeBtn,
  playNextBtn,
  togglePlaybackBtn,
  playbackControls,
  getPlaylistState: () => playlistState,
  renderState: (state) => renderState(state),
  setLoading,
  setStatus,
  sendMessage,
});

const addActionsController = createAddActionsController({
  addCurrentBtn,
  addVisibleBtn,
  addAllBtn,
  addRow,
  defaultListId: DEFAULT_LIST_ID,
  getSelectedListId,
  renderState: (state) => renderState(state),
  setLoading,
  setStatus,
  sendMessage,
  updatePlaybackControls: playbackController.updatePlaybackControls,
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
addCurrentBtn?.addEventListener("click", () => addActionsController.addFromScope("current"));
addVisibleBtn?.addEventListener("click", () => addActionsController.addFromScope("visible"));
addAllBtn?.addEventListener("click", () => addActionsController.addFromScope("page"));
collectBtn?.addEventListener(
  "click",
  collectionAvailabilityController.collectSubscriptions
);
startPlaybackBtn?.addEventListener("click", playbackController.startPlayback);
togglePlaybackBtn?.addEventListener("click", playbackController.togglePlayback);
playPrevBtn?.addEventListener("click", playbackController.playPrevious);
postponeBtn?.addEventListener("click", playbackController.postponeCurrentVideo);
playNextBtn?.addEventListener("click", playbackController.playNext);
openManagerBtn?.addEventListener("click", openManager);
openFilterSettingsBtn?.addEventListener("click", openFilterSettings);
collectionAvailabilityController.updateAvailability();

chrome.runtime.onMessage.addListener((message) => {
  if (!message || !message.type) return;
  if (message.type === "playlist:stateUpdated") {
    if (message.state) {
      renderState(message.state);
    }
  } else if (message.type === "playlist:collectProgress") {
    collectionAvailabilityController.handleProgressMessage(message);
  }
});

refreshState();

addActionsController.updateControlCapabilities().catch(() => {});

function getListName(listId) {
  if (!playlistState || !Array.isArray(playlistState.lists)) return "";
  const match = playlistState.lists.find((list) => list.id === listId);
  return match ? match.name : "";
}

function renderLists(state) {
  renderListSwitcher({
    listSwitcher,
    state,
    defaultListId: DEFAULT_LIST_ID,
  });
}

function updateListSelection(listId) {
  updateSwitcherSelection(listSwitcher, listId);
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
  playbackController.syncState(playlistState);
  collectionAvailabilityController.updateAvailability();
}

async function refreshState() {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const state = await sendMessage("playlist:getState");
      renderState(state || {});
      return;
    } catch (err) {
      if (isRecoverableRuntimeError(err)) {
        if (attempt === 0) {
          await delay(120);
          continue;
        }
        return;
      }
      console.error("Failed to refresh state", err);
      return;
    }
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

