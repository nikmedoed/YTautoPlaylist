// Manager state controller. Loads list state, selected-list details, active
// video markers, current-list sync, and background broadcast updates.
import {
  haveListMetaChanged,
  shouldReloadSelectedDetails as shouldReloadDetails,
  updateRemoveWatchedButton as updateRemoveWatchedButtonState,
} from "./detailHelpers.js";
import { createManagerVideoRow } from "./videoRow.js";

// Centralizes manager state transitions: full state load, selected-list detail
// load, active row refresh, and background state broadcasts.
export function createManagerStateController({
  dragController,
  elements,
  fallbackThumbnail,
  getAppState,
  getSelectedListDetails,
  getSelectedListId,
  moveMenu,
  selectionController,
  sendMessage,
  setAppState,
  setSelectedListDetails,
  setSelectedListId,
  setStatus,
  highlightSelectedList,
  populateImportTargets,
  renderLists,
  updateCollectionAvailability = () => {},
  request,
}) {
  const {
    clearListBtn,
    detailEmpty,
    detailList,
    openAddLinksModalBtn,
    removeWatchedBtn,
  } = elements;
  let requestedListApplied = false;

  function updateRemoveWatchedButton() {
    updateRemoveWatchedButtonState(
      removeWatchedBtn,
      getSelectedListDetails(),
      getAppState()?.videoProgress
    );
  }

  async function syncCurrentListSelection(listId) {
    if (!listId) return "failed";
    const appState = getAppState();
    if (appState?.currentListId === listId) return "unchanged";
    const previousCurrentListId = appState?.currentListId ?? null;
    if (appState) appState.currentListId = listId;
    try {
      const state = await sendMessage("playlist:setCurrentList", { listId });
      if (state && Array.isArray(state.lists)) {
        setAppState(state);
        ensureSelectedList(state);
        renderLists();
        updateDetailActiveVideo();
        return "changed";
      }
      return "failed";
    } catch (err) {
      if (appState) appState.currentListId = previousCurrentListId;
      console.error("Failed to sync current list", err);
      return "failed";
    }
  }

  function ensureSelectedList(state) {
    if (!state || !Array.isArray(state.lists) || !state.lists.length) {
      setSelectedListId(null);
      return;
    }
    if (
      !requestedListApplied &&
      request.listId &&
      state.lists.some((list) => list.id === request.listId)
    ) {
      setSelectedListId(request.listId);
      requestedListApplied = true;
      setStatus(
        request.listName
          ? `Открыт список "${request.listName}"`
          : "Открыт запрошенный список",
        "info",
        2600
      );
      return;
    }
    requestedListApplied = true;
    if (
      !getSelectedListId() ||
      !state.lists.some((list) => list.id === getSelectedListId())
    ) {
      setSelectedListId(state.currentListId || state.lists[0].id);
    }
  }

  async function loadState() {
    // Full reload used after mutations: refresh list metadata, selected details,
    // import targets, and collection controls in one predictable pass.
    const state = await sendMessage("playlist:getState");
    if (!state || !Array.isArray(state.lists)) return;
    setAppState(state);
    ensureSelectedList(state);
    renderLists();
    populateImportTargets();
    await loadListDetails(getSelectedListId(), { syncCurrent: false });
    updateCollectionAvailability();
  }

  function renderDetailVideos(details) {
    moveMenu.hide();
    dragController.reset();
    detailList.textContent = "";
    const hasList = Boolean(details?.id);
    if (openAddLinksModalBtn) openAddLinksModalBtn.disabled = !hasList;
    const videos = Array.isArray(details?.queue) ? details.queue : [];
    selectionController.setVideos(videos);
    if (clearListBtn) clearListBtn.disabled = videos.length === 0;
    updateRemoveWatchedButton();
    if (!videos.length) {
      detailEmpty.hidden = false;
      selectionController.updateUI();
      return;
    }
    detailEmpty.hidden = true;
    const frozen = Boolean(details.freeze);
    videos.forEach((video, index) => {
      detailList.appendChild(
        createManagerVideoRow({
          video,
          index,
          listId: details.id,
          frozen,
          fallbackThumbnail,
          videoProgress: getAppState()?.videoProgress,
        })
      );
    });
    selectionController.updateUI();
  }

  function updateDetailActiveVideo() {
    const rows = Array.from(detailList.querySelectorAll(".manage-list-row"));
    rows.forEach((row) => {
      row.classList.remove("active");
      const videoItem = row.querySelector(".manage-video-item");
      if (videoItem) videoItem.classList.remove("active");
    });
    const selectedListDetails = getSelectedListDetails();
    const appState = getAppState();
    if (!selectedListDetails || !appState) return;
    if (!selectedListDetails.id || selectedListDetails.id !== appState.currentListId) {
      return;
    }
    const activeId = appState.currentVideoId;
    if (!activeId) return;
    const activeRow = rows.find((row) => row.dataset.id === activeId);
    if (!activeRow) return;
    activeRow.classList.add("active");
    const activeVideoItem = activeRow.querySelector(".manage-video-item");
    if (activeVideoItem) activeVideoItem.classList.add("active");
  }

  async function loadListDetails(listId, options = {}) {
    // Detail loading is separate from list metadata so drag/drop, bulk actions,
    // and watched removal all render from the same current list snapshot.
    const { syncCurrent = false } = options;
    if (!listId) {
      detailList.textContent = "";
      detailEmpty.hidden = false;
      setSelectedListDetails(null);
      if (clearListBtn) clearListBtn.disabled = true;
      updateRemoveWatchedButton();
      if (openAddLinksModalBtn) openAddLinksModalBtn.disabled = true;
      updateCollectionAvailability();
      updateDetailActiveVideo();
      return;
    }
    setSelectedListId(listId);
    const syncPromise = syncCurrent
      ? syncCurrentListSelection(listId)
      : Promise.resolve();
    const details = await sendMessage("playlist:getList", { listId });
    await syncPromise;
    if (!details) {
      setSelectedListDetails(null);
      if (clearListBtn) clearListBtn.disabled = true;
      updateRemoveWatchedButton();
      return;
    }
    const previousListId = getSelectedListDetails()?.id;
    setSelectedListDetails(details);
    if (previousListId !== details.id) selectionController.clear();
    renderDetailVideos(details);
    highlightSelectedList(details.id);
    updateCollectionAvailability();
    updateDetailActiveVideo();
  }

  function handleStateUpdated(state) {
    // Background updates may only change playback pointers. Reload detail rows
    // only when selected list metadata proves the queue itself changed.
    const previousState = getAppState();
    setAppState(state);
    ensureSelectedList(state);
    const listsChanged = haveListMetaChanged(previousState?.lists, state.lists);
    if (listsChanged) {
      renderLists();
      populateImportTargets();
    } else {
      highlightSelectedList(getSelectedListId());
    }
    if (
      getSelectedListId() &&
      shouldReloadDetails(state, getSelectedListId(), getSelectedListDetails())
    ) {
      loadListDetails(getSelectedListId(), { syncCurrent: false }).catch(() => {});
    } else {
      updateDetailActiveVideo();
      updateRemoveWatchedButton();
      updateCollectionAvailability();
    }
  }

  return {
    ensureSelectedList,
    handleStateUpdated,
    loadListDetails,
    loadState,
    renderLists,
    syncCurrentListSelection,
    updateDetailActiveVideo,
  };
}
