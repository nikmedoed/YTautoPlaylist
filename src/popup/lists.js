import { parseVideoId } from "../utils.js";
import { createMoveMenu } from "./lib/moveMenu.js";
import { createVideoItem } from "./lib/videoItem.js";
import { buildDetailParts } from "./lib/detailParts.js";
import { openQuickFilter } from "./lib/quickFilter.js";
import { createStatusController } from "./modules/status.js";
import { createSelectionController } from "./modules/selection.js";
import { createPlaylistCreationTracker } from "./modules/playlistCreationTracker.js";
import { createManagerSection } from "./modules/managerSection.js";
import { createDragController } from "./modules/dragController.js";

const DEFAULT_LIST_ID = "default";

const fallbackThumbnail = chrome.runtime.getURL("icon/icon.png");

const listsBody = document.getElementById("listsBody");
const detailList = document.getElementById("detailList");
const queueSection = document.querySelector(".queue");
const detailEmpty = document.getElementById("detailEmpty");
const selectAllBtn = document.getElementById("selectAllBtn");
const clearSelectionBtn = document.getElementById("clearSelectionBtn");
const bulkMoveBtn = document.getElementById("bulkMoveBtn");
const bulkDeleteBtn = document.getElementById("bulkDeleteBtn");
const clearListBtn = document.getElementById("clearListBtn");
const floatingSelectionActions = document.getElementById(
  "floatingSelectionActions",
);
const statusBox = document.getElementById("status");
const statusText = document.getElementById("statusText");
const statusProgress = document.getElementById("statusProgress");
const statusProgressBar = document.getElementById("statusProgressBar");

const managerCollectionArea = document.getElementById("managerCollectionArea");
const managerCollectBtn = document.getElementById("managerCollectSubscriptions");
const managerCollectionNote = document.getElementById("managerCollectionNote");
const managerCollectionProgress = document.getElementById("managerCollectionProgress");
const managerCollectionTitle =
  managerCollectionProgress?.querySelector?.(".collection-info h4") || null;
const managerCollectionStage = document.getElementById("managerCollectionStage");
const managerCollectionCounters = document.getElementById("managerCollectionCounters");
const managerCollectionLog = document.getElementById("managerCollectionLog");

const openCreateModalBtn = document.getElementById("openCreateModal");
const openImportModalBtn = document.getElementById("openImportModal");
const openAddLinksModalBtn = document.getElementById("openAddLinksModal");

const modalBackdrop = document.getElementById("modalBackdrop");
const createModal = document.getElementById("createModal");
const importModal = document.getElementById("importModal");
const editModal = document.getElementById("editModal");
const addLinksModal = document.getElementById("addLinksModal");

const createForm = document.getElementById("createForm");
const createName = document.getElementById("createName");
const createFreeze = document.getElementById("createFreeze");

const importForm = document.getElementById("importForm");
const importFile = document.getElementById("importFile");
const importModeSelect = document.getElementById("importModeSelect");
const importTargetField = document.getElementById("importTargetField");
const importTargetSelect = document.getElementById("importTargetSelect");

const editForm = document.getElementById("editForm");
const editName = document.getElementById("editName");
const editFreeze = document.getElementById("editFreeze");
const addLinksForm = document.getElementById("addLinksForm");
const addLinksTextarea = document.getElementById("addLinksTextarea");

const searchParams = new URLSearchParams(window.location.search);
const requestedListId = (searchParams.get("listId") || "").trim();
const requestedListName = (searchParams.get("listName") || "").trim();
let requestedListApplied = false;

let appState = null;
let selectedListId = null;
let selectedListDetails = null;
let editingListId = null;
let pendingShiftSelect = false;

function getListMetaById(lists, listId) {
  if (!Array.isArray(lists) || !listId) {
    return null;
  }
  return lists.find((item) => item?.id === listId) || null;
}

function resolveVideoProgressPercent(videoId) {
  if (!videoId || !appState || typeof appState !== "object") {
    return null;
  }
  const map = appState.videoProgress;
  if (!map || typeof map !== "object") {
    return null;
  }
  const entry = map[videoId];
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

function haveListMetaChanged(previous, next) {
  const prev = Array.isArray(previous) ? previous : [];
  const curr = Array.isArray(next) ? next : [];
  if (prev.length !== curr.length) {
    return true;
  }
  for (let index = 0; index < curr.length; index += 1) {
    const a = prev[index];
    const b = curr[index];
    if (!a || !b) {
      return true;
    }
    if (a.id !== b.id) {
      return true;
    }
    if ((a.name || "") !== (b.name || "")) {
      return true;
    }
    if (Boolean(a.freeze) !== Boolean(b.freeze)) {
      return true;
    }
    const aRevision = Number.isFinite(a.revision) ? Number(a.revision) : 0;
    const bRevision = Number.isFinite(b.revision) ? Number(b.revision) : 0;
    if (aRevision !== bRevision) {
      return true;
    }
    const aLength = Number.isFinite(a.length) ? Number(a.length) : 0;
    const bLength = Number.isFinite(b.length) ? Number(b.length) : 0;
    if (aLength !== bLength) {
      return true;
    }
  }
  return false;
}

function shouldReloadSelectedDetails(state) {
  if (!selectedListId) {
    return false;
  }
  const meta = getListMetaById(state?.lists, selectedListId);
  if (!meta) {
    return true;
  }
  if (!selectedListDetails || selectedListDetails.id !== selectedListId) {
    return true;
  }
  if ((selectedListDetails.name || "") !== (meta.name || "")) {
    return true;
  }
  if (Boolean(selectedListDetails.freeze) !== Boolean(meta.freeze)) {
    return true;
  }
  const currentRevision = Number.isFinite(selectedListDetails.revision)
    ? Number(selectedListDetails.revision)
    : 0;
  const metaRevision = Number.isFinite(meta.revision) ? Number(meta.revision) : 0;
  if (currentRevision !== metaRevision) {
    return true;
  }
  const currentLength = Array.isArray(selectedListDetails.queue)
    ? selectedListDetails.queue.length
    : 0;
  const metaLength = Number.isFinite(meta.length) ? Number(meta.length) : 0;
  if (currentLength !== metaLength) {
    return true;
  }
  return false;
}

const dragController = createDragController({
  detailList,
  getQueue: () =>
    Array.isArray(selectedListDetails?.queue)
      ? selectedListDetails.queue
      : [],
  getActiveListId: () => selectedListDetails?.id || null,
  onReorder: async ({ videoId, targetIndex, listId }) => {
    await reorderVideo({ videoId, targetIndex, listId });
  },
});

const { setStatus, hideStatus } = createStatusController({
  statusBox,
  statusText,
  progressEl: statusProgress,
  progressBarEl: statusProgressBar,
});

const selectionController = createSelectionController({
  detailList,
  bulkMoveBtn,
  bulkDeleteBtn,
  floatingActions: floatingSelectionActions,
  queueSection,
});

const {
  registerState: registerPlaylistCreationState,
  releaseState: releasePlaylistCreationState,
  handleProgressMessage: handlePlaylistCreationProgress,
} = createPlaylistCreationTracker({ setStatus });

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const moveMenu = createMoveMenu({
  getOptions: ({ sourceListId }) => {
    const lists = Array.isArray(appState?.lists) ? appState.lists : [];
    return lists
      .filter((list) => list.id !== sourceListId)
      .map((list) => ({ id: list.id, label: list.name }));
  },
  onEmpty: () => {
    setStatus("Нет других списков", "info", 2500);
  },
  onSelect: async (targetListId, context) => {
    const videoIds = Array.isArray(context?.videoIds) ? context.videoIds : [];
    if (!targetListId || !videoIds.length) return;
    const isBulk = videoIds.length > 1;
    const progressLabel = isBulk
      ? `Переношу ${videoIds.length} видео...`
      : "Переношу видео...";
    setStatus(progressLabel, "info");
    try {
      if (videoIds.length === 1) {
        await sendMessage("playlist:moveVideo", {
          videoId: videoIds[0],
          targetListId,
        });
        setStatus("Видео перенесено", "success", 2500);
      } else {
        await sendMessage("playlist:moveVideos", {
          videoIds,
          targetListId,
        });
        setStatus(`Перенесено ${videoIds.length} видео`, "success", 2500);
      }
      await loadState();
      if (isBulk) {
        clearSelection();
      }
    } catch (err) {
      console.error("Failed to move videos", err);
      setStatus("Не удалось перенести", "error", 3000);
    }
  },
});

function normalizeVideoIds(ids) {
  if (!Array.isArray(ids)) {
    return [];
  }
  return ids
    .map((id) => (typeof id === "string" ? id.trim() : ""))
    .filter((id) => id.length > 0);
}

function resolveAnchorElement(anchor) {
  if (anchor && typeof anchor.getBoundingClientRect === "function") {
    return anchor;
  }
  return null;
}

function showMoveMenu(videoIds, sourceListId, anchor) {
  const normalizedIds = normalizeVideoIds(videoIds);
  if (!normalizedIds.length) {
    return;
  }
  const resolvedSourceId =
    typeof sourceListId === "string" && sourceListId.trim()
      ? sourceListId
      : selectedListDetails?.id || null;
  if (!resolvedSourceId) {
    return;
  }
  const anchorEl =
    resolveAnchorElement(anchor) ||
    resolveAnchorElement(bulkMoveBtn) ||
    null;
  moveMenu.show(anchorEl, {
    videoIds: normalizedIds,
    sourceListId: resolvedSourceId,
  });
}

function extractVideoIdsFromText(input) {
  if (!input) {
    return [];
  }
  const chunks = String(input)
    .split(/[\s,;]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const ids = chunks
    .map((value) => parseVideoId(value))
    .filter((id) => typeof id === "string" && id.length === 11);
  return Array.from(new Set(ids));
}

const managerSection = createManagerSection({
  defaultListId: DEFAULT_LIST_ID,
  elements: {
    areaEl: managerCollectionArea,
    collectBtn: managerCollectBtn,
    noteEl: managerCollectionNote,
    progressEl: managerCollectionProgress,
    titleEl: managerCollectionTitle,
    stageEl: managerCollectionStage,
    countersEl: managerCollectionCounters,
    logEl: managerCollectionLog,
  },
  setStatus,
  sendMessage,
  readAppState: () => appState,
  writeAppState: (state) => {
    appState = state;
  },
  ensureSelectedList,
  renderLists,
  loadListDetails,
  loadState,
  getSelectedListId: () => selectedListId,
  setButtonLoading,
});
managerSection.updateAvailability();

function setButtonLoading(button, loading) {
  if (!button) return;
  if (loading) {
    button.disabled = true;
    button.dataset.loading = "1";
  } else {
    button.disabled = false;
    button.removeAttribute("data-loading");
  }
}

async function openUrlInNewTab(url) {
  if (!url) return;
  try {
    await chrome.tabs.create({ url });
  } catch (err) {
    console.warn("Failed to open tab via chrome.tabs.create", err);
    try {
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (fallbackErr) {
      console.error("Failed to open playlist URL", fallbackErr);
    }
  }
}

function mapPlaylistCreationError(reason) {
  switch (reason) {
    case "LIST_EMPTY":
      return "Список пуст — нечего добавить в плейлист";
    case "quotaExceeded":
      return "Превышена квота YouTube API, повторите позже";
    case "rateLimitExceeded":
      return "Слишком много запросов к YouTube API, попробуйте позже";
    case "listId required":
      return "Не удалось определить список";
    default:
      if (typeof reason === "string" && reason.trim()) {
        return `Не удалось создать плейлист: ${reason}`;
      }
      return "Не удалось создать плейлист";
  }
}

async function sendMessage(type, payload = {}) {
  try {
    return await chrome.runtime.sendMessage({ type, ...payload });
  } catch (err) {
    console.error("sendMessage failed", type, err);
    throw err;
  }
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
      ensureSelectedList(state);
      renderLists();
    }
    await loadListDetails(selectedListId, { syncCurrent: false });
    setStatus("Порядок обновлён", "success", 2000);
  } catch (err) {
    console.error("Failed to reorder videos", err);
    setStatus("Не удалось изменить порядок", "error", 3500);
  }
}

async function syncCurrentListSelection(listId) {
  if (!listId) {
    return "failed";
  }
  if (appState?.currentListId === listId) {
    return "unchanged";
  }
  const previousCurrentListId = appState?.currentListId ?? null;
  if (appState) {
    appState.currentListId = listId;
  }
  try {
    const state = await sendMessage("playlist:setCurrentList", { listId });
    if (state && Array.isArray(state.lists)) {
      appState = state;
      ensureSelectedList(state);
      renderLists();
      updateDetailActiveVideo();
      return "changed";
    }
    return "failed";
  } catch (err) {
    if (appState) {
      appState.currentListId = previousCurrentListId;
    }
    console.error("Failed to sync current list", err);
    return "failed";
  }
}

function ensureSelectedList(state) {
  if (!state || !Array.isArray(state.lists) || !state.lists.length) {
    selectedListId = null;
    return;
  }
  if (
    !requestedListApplied &&
    requestedListId &&
    state.lists.some((list) => list.id === requestedListId)
  ) {
    selectedListId = requestedListId;
    requestedListApplied = true;
    setStatus(
      requestedListName
        ? `Открыт список "${requestedListName}"`
        : "Открыт запрошенный список",
      "info",
      2600
    );
    return;
  }
  requestedListApplied = true;
  if (!selectedListId || !state.lists.some((list) => list.id === selectedListId)) {
    selectedListId = state.currentListId || state.lists[0].id;
  }
}

function openModal(modal) {
  if (!modal) return;
  modalBackdrop.hidden = false;
  modal.hidden = false;
  document.body.dataset.modalOpen = "1";
  const firstInput = modal.querySelector("input, select, button:not([data-close-modal])");
  if (firstInput) {
    setTimeout(() => firstInput.focus(), 0);
  }
}

function closeModal(modal) {
  if (!modal) return;
  modal.hidden = true;
  if (
    createModal.hidden &&
    importModal.hidden &&
    editModal.hidden &&
    addLinksModal.hidden
  ) {
    modalBackdrop.hidden = true;
    document.body.dataset.modalOpen = "";
  }
}

function closeAllModals() {
  [createModal, importModal, editModal, addLinksModal].forEach((modal) => {
    if (modal) modal.hidden = true;
  });
  modalBackdrop.hidden = true;
  document.body.dataset.modalOpen = "";
}

async function loadState() {
  const state = await sendMessage("playlist:getState");
  if (!state || !Array.isArray(state.lists)) {
    return;
  }
  appState = state;
  ensureSelectedList(state);
  renderLists();
  populateImportTargets();
  await loadListDetails(selectedListId, { syncCurrent: false });
  managerSection.updateAvailability();
}

function makeActionButton(text, action, listId, options = {}) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = text;
  button.dataset.action = action;
  button.dataset.listId = listId;
  if (options.className) button.className = options.className;
  if (options.disabled) button.disabled = true;
  return button;
}

function createFreezeIndicator(list) {
  const indicator = document.createElement("span");
  indicator.className = "list-card-freeze-indicator";
  indicator.setAttribute("role", "img");

  const isFrozen = Boolean(
    list?.id && list.id !== DEFAULT_LIST_ID && list.freeze
  );

  const icon = isFrozen ? "🧊" : "🔥";
  const label = isFrozen
    ? "Список неизменяемый: видео не удаляются автоматически"
    : "Список автоматически очищается: просмотренные видео удаляются";
  const state = isFrozen ? "frozen" : "active";

  indicator.textContent = icon;
  indicator.setAttribute("data-state", state);
  indicator.setAttribute("title", label);
  indicator.setAttribute("aria-label", label);

  return indicator;
}

function renderLists() {
  listsBody.textContent = "";
  const lists = Array.isArray(appState?.lists) ? appState.lists : [];
  const activeListId = appState?.currentListId || null;
  lists.forEach((list) => {
    const item = document.createElement("li");
    item.className = "list-card";
    item.dataset.listId = list.id;
    if (list.id === selectedListId) {
      item.classList.add("active");
    }

    const main = document.createElement("div");
    main.className = "list-card-main";

    const header = document.createElement("div");
    header.className = "list-card-header";

    const title = document.createElement("div");
    title.className = "list-card-title";
    const isDefaultList = list.id === DEFAULT_LIST_ID;
    if (isDefaultList) {
      title.classList.add("list-card-title--system");
      title.title = "Системный список — редактирование недоступно";
      const lock = document.createElement("span");
      lock.className = "list-card-title-lock";
      lock.textContent = "🔒";
      lock.setAttribute("aria-hidden", "true");
      title.appendChild(lock);
    }
    const freezeIndicator = createFreezeIndicator(list);
    if (freezeIndicator) {
      freezeIndicator.classList.add("list-card-freeze-indicator--inline");
      title.appendChild(freezeIndicator);
    }
    const titleText = document.createElement("span");
    titleText.className = "list-card-title-text";
    titleText.textContent = list.name || "Без названия";
    title.appendChild(titleText);

    if (list.id && list.id === activeListId) {
      const activeBadge = document.createElement("span");
      activeBadge.className = "list-card-toggle list-card-toggle--active";
      activeBadge.textContent = "Смотрим";
      activeBadge.setAttribute(
        "aria-label",
        "Этот список используется для воспроизведения"
      );
      title.appendChild(activeBadge);
    } else if (list.id) {
      const activateButton = document.createElement("button");
      activateButton.type = "button";
      activateButton.className = "list-card-toggle";
      activateButton.dataset.action = "activate";
      activateButton.dataset.listId = list.id;
      activateButton.textContent = "Смотреть этот";
      activateButton.setAttribute(
        "aria-label",
        "Сделать список активным для воспроизведения"
      );
      title.appendChild(activateButton);
    }

    header.appendChild(title);
    main.appendChild(header);

    const meta = document.createElement("div");
    meta.className = "list-card-meta";
    const metaText = document.createElement("span");
    metaText.className = "list-card-meta-text";
    const metaParts = [`${list.length ?? 0} видео`];
    metaParts.push(
      list.freeze ? "Сохраняет просмотренные" : "Удаляет просмотренные"
    );
    metaText.textContent = metaParts.join(" • ");
    meta.appendChild(metaText);
    main.appendChild(meta);

    item.appendChild(main);

    const actions = document.createElement("div");
    actions.className = "list-card-actions";
    if (!isDefaultList) {
      actions.appendChild(makeActionButton("Редактировать", "edit", list.id));
    }
    actions.appendChild(makeActionButton("Экспорт", "export", list.id));
    actions.appendChild(
      makeActionButton("Создать плейлист ютуб", "createYoutubePlaylist", list.id)
    );
    if (list.id !== DEFAULT_LIST_ID) {
      actions.appendChild(
        makeActionButton("Удалить", "delete", list.id, { className: "secondary" })
      );
    }
    item.appendChild(actions);

    item.addEventListener("click", (event) => {
      if (event.target.closest("button")) return;
      loadListDetails(list.id, { syncCurrent: false }).catch(() => {});
    });

    listsBody.appendChild(item);
  });
}

function createVideoRow(video, index, listId, { frozen = false } = {}) {
  const row = document.createElement("li");
  row.className = "manage-list-row";
  row.dataset.id = video.id;
  row.dataset.index = String(index);
  row.dataset.listId = listId;

  const selectCell = document.createElement("div");
  selectCell.className = "manage-select";
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.dataset.videoId = video.id;
  checkbox.dataset.index = String(index);
  selectCell.appendChild(checkbox);
  row.appendChild(selectCell);

  const dataset = { id: video.id, index };
  if (listId != null) {
    dataset.listId = listId;
  }

  const detailParts = buildDetailParts(video);

  const removeDataset = { action: "remove", videoId: video.id };
  const moveDataset = { action: "move", videoId: video.id };
  const postponeDataset = { action: "postpone", videoId: video.id };
  const quickFilterDataset = { action: "quickFilter", videoId: video.id };
  if (listId != null) {
    removeDataset.listId = listId;
    moveDataset.listId = listId;
    postponeDataset.listId = listId;
    quickFilterDataset.listId = listId;
  }

  const progressPercent = resolveVideoProgressPercent(video.id);

  const actions = [
    {
      className: "icon-button video-quick-filter",
      textContent: "⚡",
      title: "Создать фильтр для видео",
      dataset: quickFilterDataset,
    },
    {
      className: "icon-button video-remove",
      textContent: "✕",
      title: "Удалить из списка",
      dataset: removeDataset,
    },
    {
      className: "icon-button video-move",
      textContent: "⇄",
      title: "Перенести в другой список",
      dataset: moveDataset,
    },
  ];
  if (!frozen) {
    actions.splice(1, 0, {
      className: "icon-button video-postpone",
      textContent: "⤵",
      title: "Отложить в конец списка",
      dataset: postponeDataset,
    });
  }

  const { element: card } = createVideoItem(video, {
    tag: "div",
    classes: [
      "manage-video-item",
      !frozen ? "video-item--has-postpone" : null,
    ],
    dataset,
    draggable: true,
    handle: {
      draggable: true,
      title: "Перетащить",
      ariaLabel: "Перетащить",
      preventClickDefault: true,
      tabIndex: -1,
    },
    thumbnail: { fallback: fallbackThumbnail },
    details: detailParts,
    actions,
    progress: progressPercent,
  });

  row.appendChild(card);
  return row;
}

function renderDetailVideos(details) {
  moveMenu.hide();
  dragController.reset();
  detailList.textContent = "";
  const hasList = Boolean(details?.id);
  if (openAddLinksModalBtn) {
    openAddLinksModalBtn.disabled = !hasList;
  }
  const videos = Array.isArray(details?.queue) ? details.queue : [];
  selectionController.setVideos(videos);
  if (clearListBtn) {
    clearListBtn.disabled = videos.length === 0;
  }
  if (!videos.length) {
    detailEmpty.hidden = false;
    selectionController.updateUI();
    return;
  }
  detailEmpty.hidden = true;
  const frozen = Boolean(details.freeze);
  videos.forEach((video, index) => {
    detailList.appendChild(createVideoRow(video, index, details.id, { frozen }));
  });
  selectionController.updateUI();
}

function updateDetailActiveVideo() {
  const rows = Array.from(detailList.querySelectorAll(".manage-list-row"));
  rows.forEach((row) => {
    row.classList.remove("active");
    const videoItem = row.querySelector(".manage-video-item");
    if (videoItem) {
      videoItem.classList.remove("active");
    }
  });
  if (!selectedListDetails || !appState) {
    return;
  }
  if (!selectedListDetails.id || selectedListDetails.id !== appState.currentListId) {
    return;
  }
  const activeId = appState.currentVideoId;
  if (!activeId) {
    return;
  }
  const activeRow = rows.find((row) => row.dataset.id === activeId);
  if (!activeRow) {
    return;
  }
  activeRow.classList.add("active");
  const activeVideoItem = activeRow.querySelector(".manage-video-item");
  if (activeVideoItem) {
    activeVideoItem.classList.add("active");
  }
}

function clearSelection() {
  selectionController.clear();
}

function selectAllVideos() {
  if (!selectedListDetails || !Array.isArray(selectedListDetails.queue)) {
    return;
  }
  selectionController.selectAll();
}

function handleSelectionToggle(videoId, index, shouldSelect, useShift) {
  selectionController.toggle(videoId, index, shouldSelect, useShift);
}

async function loadListDetails(listId, options = {}) {
  const { syncCurrent = false } = options;
  if (!listId) {
    detailList.textContent = "";
    detailEmpty.hidden = false;
    selectedListDetails = null;
    if (clearListBtn) {
      clearListBtn.disabled = true;
    }
    if (openAddLinksModalBtn) {
      openAddLinksModalBtn.disabled = true;
    }
    managerSection.updateAvailability();
    updateDetailActiveVideo();
    return;
  }
  selectedListId = listId;
  const syncPromise = syncCurrent
    ? syncCurrentListSelection(listId)
    : Promise.resolve();
  const details = await sendMessage("playlist:getList", { listId });
  await syncPromise;
  if (!details) {
    selectedListDetails = null;
    if (clearListBtn) {
      clearListBtn.disabled = true;
    }
    return;
  }
  const previousListId = selectedListDetails?.id;
  selectedListDetails = details;
  if (previousListId !== details.id) {
    selectionController.clear();
  }
  renderDetailVideos(details);
  highlightSelectedRow(details.id);
  managerSection.updateAvailability();
  updateDetailActiveVideo();
}

function highlightSelectedRow(listId) {
  Array.from(listsBody.querySelectorAll(".list-card")).forEach((item) => {
    item.classList.toggle("active", item.dataset.listId === listId);
  });
}

function populateImportTargets() {
  importTargetSelect.textContent = "";
  const lists = Array.isArray(appState?.lists) ? appState.lists : [];
  lists.forEach((list) => {
    const option = document.createElement("option");
    option.value = list.id;
    option.textContent = list.name;
    importTargetSelect.appendChild(option);
  });
  toggleImportTarget();
}

function toggleImportTarget() {
  const mode = importModeSelect.value;
  const show = mode === "append" && importTargetSelect.options.length > 0;
  importTargetField.hidden = !show;
  importTargetSelect.disabled = !show;
}

async function handleListAction(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const { action, listId } = button.dataset;
  if (!action || !listId) return;
  switch (action) {
    case "edit":
      if (listId === DEFAULT_LIST_ID) {
        setStatus("Основной список нельзя редактировать", "info", 3000);
        break;
      }
      openEditModal(listId);
      break;
    case "export":
      await exportList(listId);
      break;
    case "createYoutubePlaylist":
      await createYouTubePlaylistForList(listId, button);
      break;
    case "delete":
      await deleteList(listId);
      break;
    case "activate":
      await activateList(listId);
      break;
    default:
      break;
  }
}

async function activateList(listId) {
  if (!listId) {
    return;
  }
  const result = await syncCurrentListSelection(listId);
  if (result === "changed") {
    setStatus("Список активирован", "success", 2200);
  } else if (result === "unchanged") {
    setStatus("Этот список уже активен", "info", 2200);
  } else {
    setStatus("Не удалось активировать список", "error", 3500);
  }
}

async function handleDetailAction(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const { action, videoId, listId } = button.dataset;
  if (!action || !videoId) return;
  if (action !== "quickFilter" && !listId) return;
  switch (action) {
    case "quickFilter":
      openQuickFilter(videoId);
      break;
    case "remove":
      await sendMessage("playlist:remove", { videoId, listId, videoIds: [videoId] });
      await loadState();
      setStatus("Видео удалено", "info");
      break;
    case "move":
      showMoveMenu([videoId], listId, button);
      break;
    case "postpone": {
      const isCurrent =
        appState?.currentListId === listId && appState?.currentVideoId === videoId;
      try {
        if (isCurrent) {
          const payload = {
            videoId,
            tabId: Number.isInteger(appState?.currentTabId)
              ? appState.currentTabId
              : undefined,
          };
          const response = await sendMessage("playlist:postpone", payload);
          if (response?.handled === false) {
            setStatus("Нет следующего видео", "info", 3000);
            return;
          }
        } else {
          await sendMessage("playlist:postponeVideo", { videoId, listId });
        }
        await loadState();
        setStatus("Видео отложено", "success", 2200);
      } catch (err) {
        console.error("Failed to postpone video", err);
        setStatus("Не удалось отложить", "error", 3500);
      }
      break;
    }
    default:
      break;
  }
}

async function exportList(listId) {
  const response = await sendMessage("playlist:exportList", { listId });
  if (!response || !response.data) {
    setStatus("Не удалось экспортировать", "error", 3500);
    return;
  }
  const blob = new Blob([JSON.stringify(response.data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const lists = Array.isArray(appState?.lists) ? appState.lists : [];
  const name = lists.find((list) => list.id === listId)?.name;
  a.href = url;
  a.download = `${name || "list"}.json`;
  a.click();
  URL.revokeObjectURL(url);
  setStatus("Список экспортирован", "success");
}

async function createYouTubePlaylistForList(listId, triggerButton) {
  if (!listId) return;
  const button = triggerButton || null;
  const state = registerPlaylistCreationState(listId, button);
  if (button) {
    setButtonLoading(button, true);
  }
  setStatus("Создаю плейлист ютуб...", "info", 0);
  try {
    const result = await sendMessage("playlist:createYouTubePlaylist", { listId });
    if (!result || result.error) {
      releasePlaylistCreationState(state);
      const message = mapPlaylistCreationError(result?.error);
      setStatus(message, "error", 5000);
      return;
    }
    releasePlaylistCreationState(state);
    const normalizeCount = (value) => {
      const num = Number(value);
      return Number.isFinite(num) && num >= 0 ? num : 0;
    };
    const total = normalizeCount(result.total);
    const added = normalizeCount(result.added);
    const safeAdded = total ? Math.min(added, total) : added;
    const title = result.title?.trim() || "Плейлист";
    let message = `Плейлист «${title}» создан`;
    if (total) {
      message += ` (${safeAdded}/${total})`;
    }
    const statusKind = total && safeAdded < total ? "info" : "success";
    setStatus(message, statusKind, 6000);
    const playlistUrl =
      result.url || (result.playlistId ? `https://www.youtube.com/playlist?list=${result.playlistId}` : "");
    if (playlistUrl) {
      await delay(500);
      await openUrlInNewTab(playlistUrl);
    }
  } catch (err) {
    releasePlaylistCreationState(state);
    console.error("Failed to create YouTube playlist", err);
    setStatus("Не удалось создать плейлист", "error", 5000);
  } finally {
    releasePlaylistCreationState(state);
    if (button) {
      setButtonLoading(button, false);
    }
  }
}

async function deleteList(listId) {
  if (!confirm("Удалить список?")) return;
  const move = confirm(
    "Перенести все видео в основной список?\nОК — перенести, Отмена — удалить окончательно."
  );
  await sendMessage("playlist:removeList", {
    listId,
    mode: move ? "move" : "discard",
  });
  await loadState();
  setStatus("Список удалён", "success");
}

function openEditModal(listId) {
  const lists = Array.isArray(appState?.lists) ? appState.lists : [];
  const list = lists.find((item) => item.id === listId);
  if (!list) return;
  editingListId = listId;
  editName.value = list.name;
  editFreeze.checked = list.id === DEFAULT_LIST_ID ? false : Boolean(list.freeze);
  editFreeze.disabled = list.id === DEFAULT_LIST_ID;
  openModal(editModal);
}

function registerModalDismiss() {
  document.querySelectorAll("[data-close-modal]").forEach((button) => {
    button.addEventListener("click", () => {
      closeModal(button.closest(".modal"));
    });
  });
  modalBackdrop.addEventListener("click", closeAllModals);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && document.body.dataset.modalOpen) {
      closeAllModals();
    }
  });
}

function resetCreateModal() {
  createForm.reset();
  createFreeze.checked = false;
}

function resetImportModal() {
  importForm.reset();
  importFile.value = "";
  toggleImportTarget();
}

function resetAddLinksModal() {
  addLinksForm?.reset();
  if (addLinksTextarea) {
    addLinksTextarea.value = "";
  }
}

openCreateModalBtn.addEventListener("click", () => {
  resetCreateModal();
  openModal(createModal);
});

openImportModalBtn.addEventListener("click", () => {
  resetImportModal();
  const lists = Array.isArray(appState?.lists) ? appState.lists : [];
  if (!lists.length) {
    setStatus("Нет списков для добавления, будет создан новый", "info", 2500);
  }
  openModal(importModal);
});

openAddLinksModalBtn?.addEventListener("click", () => {
  if (!selectedListDetails?.id) {
    setStatus("Сначала откройте список", "info", 2500);
    return;
  }
  resetAddLinksModal();
  openModal(addLinksModal);
});

createForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = createName.value.trim();
  if (!name) {
    setStatus("Введите название списка", "error", 3000);
    return;
  }
  setStatus("Создаю список...", "info", 0);
  try {
    await sendMessage("playlist:createList", {
      name,
      freeze: Boolean(createFreeze.checked),
    });
    closeModal(createModal);
    await loadState();
    setStatus("Список создан", "success");
  } catch (err) {
    console.error("create list failed", err);
    setStatus("Не удалось создать список", "error", 4000);
  }
});

importModeSelect.addEventListener("change", toggleImportTarget);

importForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const file = importFile.files?.[0];
  if (!file) {
    setStatus("Выберите файл для импорта", "error", 3500);
    return;
  }
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    const mode = importModeSelect.value;
    await sendMessage("playlist:importList", {
      data,
      mode,
      targetListId: mode === "append" ? importTargetSelect.value || null : null,
    });
    closeModal(importModal);
    await loadState();
    setStatus("Список импортирован", "success");
  } catch (err) {
    console.error("import failed", err);
    setStatus("Неверный файл для импорта", "error", 4000);
  } finally {
    importFile.value = "";
  }
});

editForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!editingListId) return;
  const lists = Array.isArray(appState?.lists) ? appState.lists : [];
  const list = lists.find((item) => item.id === editingListId);
  if (!list) return;
  const tasks = [];
  const nextName = editName.value.trim();
  if (nextName && nextName !== list.name) {
    tasks.push(sendMessage("playlist:renameList", { listId: list.id, name: nextName }));
  }
  if (list.id !== DEFAULT_LIST_ID && Boolean(editFreeze.checked) !== Boolean(list.freeze)) {
    tasks.push(sendMessage("playlist:setFreeze", { listId: list.id, freeze: editFreeze.checked }));
  }
  if (tasks.length) {
    await Promise.all(tasks);
    await loadState();
    setStatus("Настройки сохранены", "success");
  }
  closeModal(editModal);
  editingListId = null;
});

addLinksForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!selectedListDetails?.id) {
    setStatus("Сначала откройте список", "error", 3200);
    return;
  }
  const ids = extractVideoIdsFromText(addLinksTextarea?.value || "");
  if (!ids.length) {
    setStatus("Не найдено ни одной ссылки или ID", "error", 3500);
    return;
  }
  const submitBtn = addLinksForm.querySelector('button[type="submit"]');
  if (addLinksTextarea) {
    addLinksTextarea.disabled = true;
  }
  setButtonLoading(submitBtn, true);
  setStatus(`Добавляю ${ids.length} видео...`, "info", 0);
  const beforeCount = Array.isArray(selectedListDetails.queue)
    ? selectedListDetails.queue.length
    : 0;
  try {
    const response = await sendMessage("playlist:addByIds", {
      videoIds: ids,
      listId: selectedListDetails.id,
      ensureDefault: false,
    });
    await loadState();
    const afterCount = Array.isArray(selectedListDetails?.queue)
      ? selectedListDetails.queue.length
      : beforeCount;
    const addedCount = Math.max(0, afterCount - beforeCount);
    const requested = Number.isInteger(response?.requested)
      ? response.requested
      : ids.length;
    const missing = Number.isInteger(response?.missing) ? response.missing : 0;
    let message = "";
    let kind = "success";
    if (addedCount > 0) {
      message =
        requested && addedCount < requested
          ? `Добавлено ${addedCount} из ${requested}`
          : `Добавлено ${addedCount} видео`;
      if (missing > 0) {
        message += `, не удалось получить ${missing}`;
        kind = "info";
      }
    } else {
      message =
        missing > 0 ? "Не удалось добавить видео" : "Все видео уже в списке";
      kind = missing > 0 ? "error" : "info";
    }
    setStatus(message, kind, 3800);
    closeModal(addLinksModal);
  } catch (err) {
    console.error("Failed to add videos by links", err);
    setStatus("Не удалось добавить по ссылкам", "error", 4000);
  } finally {
    setButtonLoading(submitBtn, false);
    if (addLinksTextarea) {
      addLinksTextarea.disabled = false;
      addLinksTextarea.focus();
    }
  }
});

listsBody.addEventListener("click", handleListAction);

detailList.addEventListener("pointerdown", (event) => {
  pendingShiftSelect = Boolean(event.shiftKey && event.target.closest(".manage-select"));
});

detailList.addEventListener("click", (event) => {
  const checkbox = event.target.closest('.manage-select input[type="checkbox"]');
  if (!checkbox) return;
  const videoId = checkbox.dataset.videoId || "";
  const index = Number(checkbox.dataset.index);
  const useShift = pendingShiftSelect || event.shiftKey;
  pendingShiftSelect = false;
  handleSelectionToggle(videoId, Number.isNaN(index) ? -1 : index, checkbox.checked, useShift);
  event.stopPropagation();
});

detailList.addEventListener("click", handleDetailAction);
detailList.addEventListener("dragstart", dragController.handleDragStart);
detailList.addEventListener("dragover", dragController.handleDragOver);
detailList.addEventListener("drop", dragController.handleDrop);
detailList.addEventListener("dragend", dragController.handleDragEnd);

if (selectAllBtn) {
  selectAllBtn.addEventListener("click", () => {
    selectAllVideos();
  });
}

if (clearSelectionBtn) {
  clearSelectionBtn.addEventListener("click", () => {
    clearSelection();
  });
}

if (bulkMoveBtn) {
  bulkMoveBtn.addEventListener("click", (event) => {
    const selectedIds = selectionController.getSelectedIds();
    if (!selectedListDetails || selectedIds.length === 0) return;
    showMoveMenu(selectedIds, selectedListDetails.id, event.currentTarget);
  });
}

if (bulkDeleteBtn) {
  bulkDeleteBtn.addEventListener("click", async () => {
    if (!selectedListDetails) return;
    const videoIds = selectionController.getSelectedIds();
    if (videoIds.length === 0) return;
    try {
      await sendMessage("playlist:remove", {
        listId: selectedListDetails.id,
        videoIds,
      });
      await loadState();
      clearSelection();
      const count = videoIds.length;
      setStatus(
        count > 1 ? `Удалено ${count} видео` : "Видео удалено",
        "success",
        2500
      );
    } catch (err) {
      console.error("Failed to delete selected videos", err);
      setStatus("Не удалось удалить", "error", 3500);
    }
  });
}

if (clearListBtn) {
  clearListBtn.addEventListener("click", async () => {
    const queue = Array.isArray(selectedListDetails?.queue)
      ? selectedListDetails.queue
      : [];
    if (!selectedListDetails || queue.length === 0) {
      return;
    }
    const title = selectedListDetails.name || "список";
    const confirmClear = confirm(`Очистить список «${title}»?`);
    if (!confirmClear) return;
    const videoIds = queue.map((video) => video.id).filter(Boolean);
    if (!videoIds.length) {
      return;
    }
    clearListBtn.disabled = true;
    try {
      await sendMessage("playlist:remove", {
        listId: selectedListDetails.id,
        videoIds,
      });
      await loadState();
      clearSelection();
      setStatus("Список очищен", "success", 2500);
    } catch (err) {
      console.error("Failed to clear list", err);
      setStatus("Не удалось очистить список", "error", 3500);
      if (selectedListDetails?.queue?.length) {
        clearListBtn.disabled = false;
      }
    }
  });
}

if (managerCollectBtn) {
  managerCollectBtn.addEventListener("click", () => {
    Promise.resolve(managerSection.handleCollectClick()).catch(() => {});
  });
}

chrome.runtime.onMessage.addListener((message) => {
  if (!message || !message.type) return;
  if (message.type === "playlist:createYouTubePlaylist:progress") {
    handlePlaylistCreationProgress(message);
    return;
  }
  if (message.type === "playlist:stateUpdated") {
    if (message.state && Array.isArray(message.state.lists)) {
      const previousState = appState;
      appState = message.state;
      ensureSelectedList(appState);
      const listsChanged = haveListMetaChanged(previousState?.lists, appState.lists);
      if (listsChanged) {
        renderLists();
        populateImportTargets();
      } else {
        highlightSelectedRow(selectedListId);
      }
      if (selectedListId && shouldReloadSelectedDetails(appState)) {
        loadListDetails(selectedListId, { syncCurrent: false }).catch(() => {});
      } else {
        updateDetailActiveVideo();
        managerSection.updateAvailability();
      }
    }
  } else if (message.type === "playlist:collectProgress") {
    managerSection.handleProgressEvent(message);
  }
});

registerModalDismiss();

loadState().catch((err) => {
  console.error("Failed to load lists state", err);
  setStatus("Не удалось загрузить списки", "error", 4000);
});
