// List manager entrypoint. Coordinates manager state, views, selection, modals, drag and drop, and runtime events.
import { openQuickFilter } from "./lib/quickFilter.js";
import { createDragReorderController } from "./lib/dragReorder.js";
import { createStatusController } from "./modules/shared/status.js";
import { createSelectionController } from "./modules/manager/selection.js";
import { createPlaylistCreationTracker } from "./modules/manager/playlistCreationTracker.js";
import { createManagerDetailActions } from "./modules/manager/detailActions.js";
import { createManagerModalController } from "./modules/manager/modalController.js";
import { createManagerListActions } from "./modules/manager/listActions.js";
import { registerManagerBulkActions } from "./modules/manager/bulkActions.js";
import { createManagerStateController } from "./modules/manager/stateController.js";
import { registerManagerEvents } from "./modules/manager/events.js";
import { createManagerMoveActions } from "./modules/manager/moveActions.js";
import { getManagerElements } from "./modules/manager/elements.js";
import { createCollectionController } from "./modules/collection/index.js";
import { createCollectionAvailabilityController } from "./modules/collection/availability.js";
import { createPopupSyncController } from "./modules/sync/index.js";
import { sendMessage as sendRuntimeMessage } from "./lib/runtimeMessages.js";
import { setButtonLoading } from "./modules/manager/runtime.js";
import {
  getWatchedVideoIds as getWatchedVideoIdsFromDetails,
  updateRemoveWatchedButton as updateRemoveWatchedButtonState,
} from "./modules/manager/detailHelpers.js";
import {
  highlightSelectedList,
  populateImportTargets as renderImportTargets,
  renderListCards,
  toggleImportTarget as updateImportTargetVisibility,
} from "./modules/manager/listView.js";

const DEFAULT_LIST_ID = "default";

const fallbackThumbnail = chrome.runtime.getURL("icon/icon.png");
const elements = getManagerElements(document);

const searchParams = new URLSearchParams(window.location.search);
const requestedListId = (searchParams.get("listId") || "").trim();
const requestedListName = (searchParams.get("listName") || "").trim();

let appState = null;
let selectedListId = null;
let selectedListDetails = null;
let managerStateController;
let managerSection;

const dragController = createDragReorderController({
  container: elements.detailList,
  itemSelector: ".manage-list-row",
  dragElementSelector: ".manage-video-item",
  interactiveSelector: "button, a, input, select, textarea, label",
  nativeHandleRequired: false,
  indicatorClassName: "manage-drop-indicator",
  indicatorLineClassName: "manage-drop-indicator__line",
  getQueue: () => (Array.isArray(selectedListDetails?.queue) ? selectedListDetails.queue : []),
  getActiveListId: () => selectedListDetails?.id || null,
  onReorder: reorderVideo,
});

const { setStatus } = createStatusController({
  statusBox: elements.statusBox,
  statusText: elements.statusText,
  progressEl: elements.statusProgress,
  progressBarEl: elements.statusProgressBar,
});

const selectionController = createSelectionController({
  detailList: elements.detailList,
  bulkMoveBtn: elements.bulkMoveBtn,
  bulkDeleteBtn: elements.bulkDeleteBtn,
  floatingActions: elements.floatingSelectionActions,
  queueSection: elements.queueSection,
});

const {
  registerState: registerPlaylistCreationState,
  releaseState: releasePlaylistCreationState,
  handleProgressMessage: handlePlaylistCreationProgress,
} = createPlaylistCreationTracker({ setStatus });

const { moveMenu, showMoveMenu } = createManagerMoveActions({
  bulkMoveBtn: elements.bulkMoveBtn,
  clearSelection,
  getAppState: () => appState,
  getSelectedListDetails: () => selectedListDetails,
  loadState: () => managerStateController.loadState(),
  sendMessage,
  setStatus,
});

const managerModalController = createManagerModalController({
  defaultListId: DEFAULT_LIST_ID,
  elements: {
    modalBackdrop: elements.modalBackdrop,
    createModal: elements.createModal,
    importModal: elements.importModal,
    editModal: elements.editModal,
    addLinksModal: elements.addLinksModal,
    openCreateModalBtn: elements.openCreateModalBtn,
    openImportModalBtn: elements.openImportModalBtn,
    openAddLinksModalBtn: elements.openAddLinksModalBtn,
    createForm: elements.createForm,
    createName: elements.createName,
    createFreeze: elements.createFreeze,
    importForm: elements.importForm,
    importFile: elements.importFile,
    importModeSelect: elements.importModeSelect,
    importTargetSelect: elements.importTargetSelect,
    editForm: elements.editForm,
    editName: elements.editName,
    editFreeze: elements.editFreeze,
    addLinksForm: elements.addLinksForm,
    addLinksTextarea: elements.addLinksTextarea,
  },
  getAppState: () => appState,
  getSelectedListDetails: () => selectedListDetails,
  loadState: () => managerStateController.loadState(),
  sendMessage,
  setStatus,
  toggleImportTarget,
});

const handleDetailAction = createManagerDetailActions({
  applyRemoveLocally,
  getAppState: () => appState,
  handleRemoveResult,
  loadState: () => managerStateController.loadState(),
  openQuickFilter,
  sendMessage,
  setStatus,
  showMoveMenu,
});

managerStateController = createManagerStateController({
  dragController,
  elements: {
    clearListBtn: elements.clearListBtn,
    detailEmpty: elements.detailEmpty,
    detailList: elements.detailList,
    openAddLinksModalBtn: elements.openAddLinksModalBtn,
    removeWatchedBtn: elements.removeWatchedBtn,
  },
  fallbackThumbnail,
  getAppState: () => appState,
  getSelectedListDetails: () => selectedListDetails,
  getSelectedListId: () => selectedListId,
  moveMenu,
  selectionController,
  sendMessage,
  setAppState: (state) => {
    appState = state;
  },
  setSelectedListDetails: (details) => {
    selectedListDetails = details;
  },
  setSelectedListId: (listId) => {
    selectedListId = listId;
  },
  setStatus,
  highlightSelectedList: (listId) => highlightSelectedList(elements.listsBody, listId),
  populateImportTargets,
  renderLists,
  updateCollectionAvailability: () => managerSection?.updateAvailability(),
  request: {
    listId: requestedListId,
    listName: requestedListName,
  },
});

const managerSyncController = createPopupSyncController({
  stateEl: elements.managerSyncState,
  metaEl: elements.managerSyncMeta,
  pullBtn: elements.managerSyncPull,
  pushBtn: elements.managerSyncPush,
  restoreBtn: elements.managerSyncRestore,
  sendMessage,
  setStatus,
  refreshState: () => managerStateController.loadState(),
});

const collectionController = createCollectionController({
  progressEl: elements.managerCollectionProgress,
  titleEl: elements.managerCollectionTitle,
  stageTextEl: elements.managerCollectionStage,
  countersEl: elements.managerCollectionCounters,
  logEl: elements.managerCollectionLog,
  setStatus,
});

managerSection = createCollectionAvailabilityController({
  applyState: syncManagerCollectionState,
  collectBtn: elements.managerCollectBtn,
  collectionArea: elements.managerCollectionArea,
  collectionNote: elements.managerCollectionNote,
  collectionController,
  defaultListId: DEFAULT_LIST_ID,
  getPlaylistState: () => appState || {},
  getSelectedListId: () => selectedListId,
  refreshState: managerStateController.loadState,
  sendMessage,
  setLoading: setButtonLoading,
  setStatus,
});
managerSection.updateAvailability();

const { handleListAction } = createManagerListActions({
  defaultListId: DEFAULT_LIST_ID,
  getAppState: () => appState,
  loadState: managerStateController.loadState,
  managerModalController,
  registerPlaylistCreationState,
  releasePlaylistCreationState,
  sendMessage,
  setStatus,
  syncCurrentListSelection: managerStateController.syncCurrentListSelection,
});

function renderLists() {
  const lists = Array.isArray(appState?.lists) ? appState.lists : [];
  renderListCards({
    listsBody: elements.listsBody,
    lists,
    activeListId: appState?.currentListId || null,
    selectedListId,
    defaultListId: DEFAULT_LIST_ID,
    onOpenList: (listId) => {
      managerStateController.loadListDetails(listId, { syncCurrent: false }).catch(() => {});
    },
  });
}

function populateImportTargets() {
  const lists = Array.isArray(appState?.lists) ? appState.lists : [];
  renderImportTargets({
    importTargetSelect: elements.importTargetSelect,
    lists,
    onToggleTarget: toggleImportTarget,
  });
}

function toggleImportTarget() {
  updateImportTargetVisibility({
    importModeSelect: elements.importModeSelect,
    importTargetField: elements.importTargetField,
    importTargetSelect: elements.importTargetSelect,
  });
}

// Collection progress can replace the full playlist state; keep list cards and
// selected details in sync with that snapshot before recalculating availability.
async function syncManagerCollectionState(state) {
  if (!state || !Array.isArray(state.lists)) return;
  appState = state;
  managerStateController.ensureSelectedList(state);
  managerStateController.renderLists();
  if (selectedListId) {
    await managerStateController.loadListDetails(selectedListId, { syncCurrent: false });
  } else {
    managerSection.updateAvailability();
  }
}

async function sendMessage(type, payload = {}) {
  return sendRuntimeMessage(type, payload, { label: "sendMessage failed" });
}

function buildDetailsAfterRemoval(videoIds, listId) {
  if (!selectedListDetails?.id || selectedListDetails.id !== listId) {
    return null;
  }
  const idSet = new Set((Array.isArray(videoIds) ? videoIds : [videoIds]).filter(Boolean));
  if (!idSet.size) return null;
  const queue = Array.isArray(selectedListDetails.queue)
    ? selectedListDetails.queue.filter((video) => !idSet.has(video?.id))
    : [];
  const removed = (selectedListDetails.queue?.length || 0) - queue.length;
  if (removed <= 0) return null;
  return {
    ...selectedListDetails,
    queue,
    length: queue.length,
    revision: (Number.isInteger(selectedListDetails.revision)
      ? selectedListDetails.revision
      : 0) + 1,
  };
}

function applyRemoveLocally(videoIds, listId) {
  const details = buildDetailsAfterRemoval(videoIds, listId);
  if (!details) return false;
  const idSet = new Set((Array.isArray(videoIds) ? videoIds : [videoIds]).filter(Boolean));
  const nextState = appState && Array.isArray(appState.lists)
    ? {
        ...appState,
        lists: appState.lists.map((list) =>
          list.id === listId
            ? { ...list, length: details.length, revision: details.revision }
            : list
        ),
        currentVideoId: idSet.has(appState.currentVideoId) ? null : appState.currentVideoId,
        currentQueue:
          appState.currentQueue?.id === listId
            ? {
                ...appState.currentQueue,
                queue: details.queue,
                currentIndex:
                  details.queue.length === 0
                    ? null
                    : Math.min(
                        appState.currentQueue.currentIndex || 0,
                        details.queue.length - 1
                      ),
              }
            : appState.currentQueue,
      }
    : null;
  if (nextState) {
    managerStateController.applyStateSnapshot(nextState, { details });
  } else {
    managerStateController.applySelectedListDetails(details);
  }
  return true;
}

function handleRemoveResult(state, videoIds, listId) {
  const details = buildDetailsAfterRemoval(videoIds, listId);
  if (state && Array.isArray(state.lists)) {
    managerStateController.applyStateSnapshot(state, { details });
    return;
  }
  if (details) {
    managerStateController.applySelectedListDetails(details);
    return;
  }
  managerStateController.loadState().catch(() => {});
}

async function reorderVideo({ videoId, targetIndex, listId }) {
  if (!videoId || typeof targetIndex !== "number") {
    return;
  }
  try {
    const state = await sendMessage("playlist:reorder", {
      videoId,
      targetIndex,
      listId: listId || selectedListDetails?.id || null,
    });
    if (state && Array.isArray(state.lists)) {
      appState = state;
      managerStateController.ensureSelectedList(state);
      managerStateController.renderLists();
    }
    await managerStateController.loadListDetails(selectedListId, { syncCurrent: false });
    setStatus("Порядок обновлён", "success", 2000);
  } catch (err) {
    console.error("Failed to reorder videos", err);
    setStatus("Не удалось изменить порядок", "error", 3500);
  }
}

function clearSelection() {
  selectionController.clear();
}

registerManagerBulkActions({
  buttons: {
    bulkDeleteBtn: elements.bulkDeleteBtn,
    bulkMoveBtn: elements.bulkMoveBtn,
    clearListBtn: elements.clearListBtn,
    removeWatchedBtn: elements.removeWatchedBtn,
  },
  clearSelection,
  applyRemoveLocally,
  getSelectedListDetails: () => selectedListDetails,
  getWatchedVideoIds: (details = selectedListDetails) =>
    getWatchedVideoIdsFromDetails(details, appState?.videoProgress),
  handleRemoveResult,
  loadState: managerStateController.loadState,
  selectionController,
  sendMessage,
  setStatus,
  showMoveMenu,
  updateRemoveWatchedButton: () =>
    updateRemoveWatchedButtonState(
      elements.removeWatchedBtn,
      selectedListDetails,
      appState?.videoProgress
    ),
});

registerManagerEvents({
  controllers: {
    drag: dragController,
  },
  elements: {
    clearSelectionBtn: elements.clearSelectionBtn,
    detailList: elements.detailList,
    listsBody: elements.listsBody,
    managerCollectBtn: elements.managerCollectBtn,
    selectAllBtn: elements.selectAllBtn,
  },
  handlers: {
    clearSelection,
    handleDetailAction,
    handleListAction,
    handleSelectionToggle: selectionController.toggle,
    selectAllVideos: () => {
      if (Array.isArray(selectedListDetails?.queue)) {
        selectionController.selectAll();
      }
    },
  },
  managerSection,
});

chrome.runtime.onMessage.addListener((message) => {
  if (!message || !message.type) return;
  if (message.type === "playlist:createYouTubePlaylist:progress") {
    handlePlaylistCreationProgress(message);
    return;
  }
  if (message.type === "playlist:stateUpdated") {
    if (message.state && Array.isArray(message.state.lists)) {
      managerStateController.handleStateUpdated(message.state);
      managerSyncController.scheduleRefresh();
    }
    return;
  }
  if (message.type === "playlist:collectProgress") {
    managerSection.handleProgressMessage(message);
  }
});

managerModalController.register();

managerStateController.loadState().catch((err) => {
  console.error("Failed to load lists state", err);
  setStatus("Не удалось загрузить списки", "error", 4000);
});
managerSyncController.refresh({ refreshRemote: true });
