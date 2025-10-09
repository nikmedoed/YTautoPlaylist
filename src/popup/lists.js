const DEFAULT_LIST_ID = "default";

const fallbackThumbnail = chrome.runtime.getURL("icon/icon.png");

const listsBody = document.getElementById("listsBody");
const detailList = document.getElementById("detailList");
const detailEmpty = document.getElementById("detailEmpty");
const detailTitle = document.getElementById("detailTitle");
const detailMeta = document.getElementById("detailMeta");
const selectAllBtn = document.getElementById("selectAllBtn");
const clearSelectionBtn = document.getElementById("clearSelectionBtn");
const bulkMoveBtn = document.getElementById("bulkMoveBtn");
const bulkDeleteBtn = document.getElementById("bulkDeleteBtn");
const selectionCounter = document.getElementById("selectionCounter");
const statusBox = document.getElementById("status");
const statusText = document.getElementById("statusText");

const openCreateModalBtn = document.getElementById("openCreateModal");
const openImportModalBtn = document.getElementById("openImportModal");

const modalBackdrop = document.getElementById("modalBackdrop");
const createModal = document.getElementById("createModal");
const importModal = document.getElementById("importModal");
const editModal = document.getElementById("editModal");

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

let appState = null;
let selectedListId = null;
let selectedListDetails = null;
let statusTimeout = null;
let editingListId = null;
let pendingShiftSelect = false;

const selectionState = {
  selected: new Set(),
  lastIndex: null,
};

const dragState = {
  videoId: null,
  overRow: null,
  after: false,
  listId: null,
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
  const lists = Array.isArray(appState?.lists) ? appState.lists : [];
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

function showMoveMenu(videoIds, sourceListId, anchor) {
  if (!Array.isArray(videoIds) || !videoIds.length) return;
  if (!populateMoveMenu(sourceListId)) {
    setStatus("Нет других списков", "info", 2500);
    return;
  }
  const uniqueIds = Array.from(new Set(videoIds.filter(Boolean)));
  if (!uniqueIds.length) return;
  moveContext = { videoIds: uniqueIds, sourceListId };
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
  const videoIds = Array.isArray(moveContext.videoIds)
    ? moveContext.videoIds
    : [];
  hideMoveMenu();
  if (!targetListId || !videoIds.length) return;
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
    clearSelection();
  } catch (err) {
    console.error("Failed to move videos", err);
    setStatus("Не удалось перенести", "error", 3000);
  }
});

document.addEventListener("click", (event) => {
  if (moveMenu.dataset.visible !== "1") return;
  if (moveMenu.contains(event.target)) return;
  if (event.target.closest(".video-move")) return;
  if (event.target === bulkMoveBtn) return;
  hideMoveMenu();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && moveMenu.dataset.visible === "1") {
    hideMoveMenu();
  }
});

function clearDragIndicators() {
  detailList
    .querySelectorAll(".manage-video-item.drop-before, .manage-video-item.drop-after")
    .forEach((card) => card.classList.remove("drop-before", "drop-after"));
}

function resetDragState() {
  if (dragState.videoId) {
    const row = detailList.querySelector(
      `.manage-list-row[data-id="${dragState.videoId}"]`
    );
    row?.querySelector(".manage-video-item")?.classList.remove("dragging");
  }
  clearDragIndicators();
  dragState.videoId = null;
  dragState.overRow = null;
  dragState.after = false;
  dragState.listId = null;
}

function handleDragStart(event) {
  const interactive = event.target.closest(
    "button, a, input, select, textarea, label"
  );
  const overHandle = event.target.closest(".video-handle");
  if (interactive && !overHandle) {
    event.preventDefault();
    return;
  }
  const card = event.target.closest(".manage-video-item");
  if (!card) {
    event.preventDefault();
    return;
  }
  const row = card.closest(".manage-list-row");
  if (!row) {
    event.preventDefault();
    return;
  }
  dragState.videoId = row.dataset.id || null;
  dragState.listId = row.dataset.listId || null;
  dragState.overRow = null;
  dragState.after = false;
  card.classList.add("dragging");
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", dragState.videoId || "");
  }
}

function handleDragOver(event) {
  if (!dragState.videoId) return;
  event.preventDefault();
  const row = event.target.closest(".manage-list-row");
  if (!row || row.dataset.id === dragState.videoId) {
    return;
  }
  if (
    dragState.listId &&
    row.dataset.listId &&
    row.dataset.listId !== dragState.listId
  ) {
    return;
  }
  const card = row.querySelector(".manage-video-item");
  const rect = card?.getBoundingClientRect() || row.getBoundingClientRect();
  const after = event.clientY - rect.top > rect.height / 2;
  if (dragState.overRow !== row || dragState.after !== after) {
    clearDragIndicators();
    card?.classList.add(after ? "drop-after" : "drop-before");
    dragState.overRow = row;
    dragState.after = after;
  }
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = "move";
  }
}

async function handleDrop(event) {
  if (!dragState.videoId) return;
  event.preventDefault();
  const directRow = event.target.closest(".manage-list-row");
  let targetRow = directRow || dragState.overRow;
  if (
    targetRow &&
    dragState.listId &&
    targetRow.dataset.listId &&
    targetRow.dataset.listId !== dragState.listId
  ) {
    resetDragState();
    return;
  }
  const rows = Array.from(detailList.querySelectorAll(".manage-list-row"));
  let targetIndex;
  if (!targetRow) {
    targetIndex = rows.length;
  } else {
    targetIndex = rows.indexOf(targetRow);
    if (targetIndex === -1) {
      resetDragState();
      return;
    }
    const card = targetRow.querySelector(".manage-video-item");
    const rect = card?.getBoundingClientRect() || targetRow.getBoundingClientRect();
    const after =
      directRow === targetRow
        ? event.clientY - rect.top > rect.height / 2
        : dragState.after;
    if (after) targetIndex += 1;
  }

  const queue = Array.isArray(selectedListDetails?.queue)
    ? selectedListDetails.queue
    : [];
  const fromIndex = queue.findIndex((video) => video.id === dragState.videoId);
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
      listId: dragState.listId || selectedListDetails?.id || null,
    });
    if (state && Array.isArray(state.lists)) {
      appState = state;
      ensureSelectedList(state);
      renderLists();
    }
    await loadListDetails(selectedListId);
    setStatus("Порядок обновлён", "success", 2000);
  } catch (err) {
    console.error("Failed to reorder videos", err);
    setStatus("Не удалось изменить порядок", "error", 3500);
  } finally {
    resetDragState();
  }
}

function handleDragEnd() {
  resetDragState();
}

function resolveThumbnail(entry) {
  if (entry && typeof entry.thumbnail === "string" && entry.thumbnail) {
    return entry.thumbnail;
  }
  return fallbackThumbnail;
}

async function sendMessage(type, payload = {}) {
  try {
    return await chrome.runtime.sendMessage({ type, ...payload });
  } catch (err) {
    console.error("sendMessage failed", type, err);
    throw err;
  }
}

function setStatus(text, kind = "info", timeout = 2500) {
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
  }
}

function ensureSelectedList(state) {
  if (!state || !Array.isArray(state.lists) || !state.lists.length) {
    selectedListId = null;
    return;
  }
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
    editModal.hidden
  ) {
    modalBackdrop.hidden = true;
    document.body.dataset.modalOpen = "";
  }
}

function closeAllModals() {
  [createModal, importModal, editModal].forEach((modal) => {
    if (modal) modal.hidden = true;
  });
  modalBackdrop.hidden = true;
  document.body.dataset.modalOpen = "";
}

function collectListsMeta() {
  return Array.isArray(appState?.lists) ? appState.lists : [];
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
  await loadListDetails(selectedListId);
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

function renderLists() {
  listsBody.textContent = "";
  const lists = collectListsMeta();
  lists.forEach((list) => {
    const tr = document.createElement("tr");
    tr.dataset.listId = list.id;
    if (list.id === selectedListId) {
      tr.classList.add("active-row");
    }

    const nameTd = document.createElement("td");
    nameTd.textContent = list.name;
    tr.appendChild(nameTd);

    const countTd = document.createElement("td");
    countTd.textContent = String(list.length ?? 0);
    tr.appendChild(countTd);

    const freezeTd = document.createElement("td");
    if (list.id === DEFAULT_LIST_ID) {
      freezeTd.textContent = "Удаляет просмотренные";
    } else {
      freezeTd.textContent = list.freeze
        ? "Сохраняет просмотренные"
        : "Удаляет просмотренные";
    }
    tr.appendChild(freezeTd);

    const actionsTd = document.createElement("td");
    actionsTd.className = "list-actions";
    actionsTd.appendChild(makeActionButton("Открыть", "view", list.id));
    actionsTd.appendChild(makeActionButton("Редактировать", "edit", list.id));
    actionsTd.appendChild(makeActionButton("Экспорт", "export", list.id));
    if (list.id !== DEFAULT_LIST_ID) {
      actionsTd.appendChild(
        makeActionButton("Удалить", "delete", list.id, { className: "secondary" })
      );
    } else {
      const note = document.createElement("span");
      note.className = "list-note";
      note.textContent = "Основной список";
      actionsTd.appendChild(note);
    }
    tr.appendChild(actionsTd);
    listsBody.appendChild(tr);
  });
}

function formatDuration(duration) {
  if (!duration) return "";
  if (typeof duration === "number") {
    const sec = Math.max(0, Math.round(duration));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h) {
      return `${String(h).padStart(2, "0")}:${String(m).padStart(
        2,
        "0"
      )}:${String(s).padStart(2, "0")}`;
    }
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(duration);
  if (!match) return "";
  const h = Number(match[1] || 0);
  const m = Number(match[2] || 0);
  const s = Number(match[3] || 0);
  if (h) {
    return `${String(h).padStart(2, "0")}:${String(m).padStart(
      2,
      "0"
    )}:${String(s).padStart(2, "0")}`;
  }
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function createVideoRow(video, index, listId) {
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

  const card = document.createElement("div");
  card.className = "video-item manage-video-item";
  card.dataset.id = video.id;
  card.dataset.index = String(index);
  card.dataset.listId = listId;
  card.draggable = true;

  const handle = document.createElement("button");
  handle.type = "button";
  handle.className = "video-handle";
  handle.title = "Перетащить";
  handle.setAttribute("aria-label", "Перетащить");
  handle.setAttribute("draggable", "true");
  handle.tabIndex = -1;
  handle.addEventListener("click", (event) => event.preventDefault());
  card.appendChild(handle);

  const thumb = document.createElement("img");
  thumb.className = "video-thumb";
  thumb.src = resolveThumbnail(video);
  thumb.alt = video.title || "Видео";
  thumb.loading = "lazy";
  thumb.decoding = "async";
  card.appendChild(thumb);

  const body = document.createElement("div");
  body.className = "video-body";

  const title = document.createElement("div");
  title.className = "video-title";
  title.textContent = video.title || "Без названия";
  body.appendChild(title);

  const details = document.createElement("div");
  details.className = "video-details";
  const parts = [];
  if (video.channelTitle) parts.push(video.channelTitle);
  if (video.publishedAt) {
    parts.push(new Date(video.publishedAt).toLocaleString("ru-RU"));
  }
  if (video.duration) parts.push(formatDuration(video.duration));
  details.textContent = parts.join(" • ");
  body.appendChild(details);

  card.appendChild(body);

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "icon-button video-remove";
  removeBtn.dataset.action = "remove";
  removeBtn.dataset.videoId = video.id;
  removeBtn.dataset.listId = listId;
  removeBtn.title = "Удалить из списка";
  removeBtn.textContent = "✕";
  card.appendChild(removeBtn);

  const moveBtn = document.createElement("button");
  moveBtn.type = "button";
  moveBtn.className = "icon-button video-move";
  moveBtn.dataset.action = "move";
  moveBtn.dataset.videoId = video.id;
  moveBtn.dataset.listId = listId;
  moveBtn.title = "Перенести в другой список";
  moveBtn.textContent = "⇄";
  card.appendChild(moveBtn);

  row.appendChild(card);
  return row;
}

function renderDetailVideos(details) {
  hideMoveMenu();
  resetDragState();
  detailList.textContent = "";
  const videos = Array.isArray(details.queue) ? details.queue : [];
  selectionState.lastIndex = null;
  const availableIds = new Set(videos.map((video) => video.id));
  selectionState.selected = new Set(
    Array.from(selectionState.selected).filter((id) => availableIds.has(id))
  );
  if (!videos.length) {
    detailEmpty.hidden = false;
    updateSelectionUI();
    return;
  }
  detailEmpty.hidden = true;
  videos.forEach((video, index) => {
    detailList.appendChild(createVideoRow(video, index, details.id));
  });
  updateSelectionUI();
}

function getVideoByIndex(index) {
  if (
    !selectedListDetails ||
    !Array.isArray(selectedListDetails.queue) ||
    index < 0 ||
    index >= selectedListDetails.queue.length
  ) {
    return null;
  }
  return selectedListDetails.queue[index];
}

function updateSelectionUI() {
  const count = selectionState.selected.size;
  detailList.querySelectorAll(".manage-list-row").forEach((row) => {
    const videoId = row.dataset.id;
    const selected = videoId ? selectionState.selected.has(videoId) : false;
    row.classList.toggle("selected", selected);
    const checkbox = row.querySelector('input[type="checkbox"]');
    if (checkbox) {
      checkbox.checked = selected;
    }
  });
  if (selectionCounter) {
    if (count > 0) {
      selectionCounter.hidden = false;
      selectionCounter.textContent = `Выбрано: ${count}`;
    } else {
      selectionCounter.hidden = true;
      selectionCounter.textContent = "";
    }
  }
  if (bulkMoveBtn) {
    bulkMoveBtn.disabled = count === 0;
    bulkMoveBtn.textContent =
      count > 1
        ? `Перенести выбранные (${count})`
        : "Перенести выбранные";
  }
  if (bulkDeleteBtn) {
    bulkDeleteBtn.disabled = count === 0;
    bulkDeleteBtn.textContent =
      count > 1
        ? `Удалить выбранные (${count})`
        : "Удалить выбранные";
  }
}

function clearSelection() {
  selectionState.selected.clear();
  selectionState.lastIndex = null;
  updateSelectionUI();
}

function selectAllVideos() {
  if (!selectedListDetails || !Array.isArray(selectedListDetails.queue)) {
    return;
  }
  selectionState.selected = new Set(
    selectedListDetails.queue.map((video) => video.id)
  );
  selectionState.lastIndex =
    selectedListDetails.queue.length > 0
      ? selectedListDetails.queue.length - 1
      : null;
  updateSelectionUI();
}

function handleSelectionToggle(videoId, index, shouldSelect, useShift) {
  if (!videoId) return;
  if (useShift && selectionState.lastIndex != null) {
    const target = getVideoByIndex(index);
    const last = getVideoByIndex(selectionState.lastIndex);
    if (target && last) {
      const start = Math.min(index, selectionState.lastIndex);
      const end = Math.max(index, selectionState.lastIndex);
      for (let i = start; i <= end; i += 1) {
        const video = getVideoByIndex(i);
        if (!video) continue;
        if (shouldSelect) {
          selectionState.selected.add(video.id);
        } else {
          selectionState.selected.delete(video.id);
        }
      }
    }
  } else {
    if (shouldSelect) {
      selectionState.selected.add(videoId);
    } else {
      selectionState.selected.delete(videoId);
    }
  }
  selectionState.lastIndex = Number.isFinite(index) && index >= 0 ? index : null;
  updateSelectionUI();
}

async function loadListDetails(listId) {
  if (!listId) {
    detailList.textContent = "";
    detailEmpty.hidden = false;
    detailTitle.textContent = "Содержимое списка";
    detailMeta.textContent = "";
    return;
  }
  selectedListId = listId;
  const details = await sendMessage("playlist:getList", { listId });
  if (!details) return;
  const previousListId = selectedListDetails?.id;
  selectedListDetails = details;
  if (previousListId !== details.id) {
    selectionState.selected.clear();
    selectionState.lastIndex = null;
  }
  detailTitle.textContent = details.name;
  const removalText =
    details.id === DEFAULT_LIST_ID
      ? "Автоудаление включено"
      : details.freeze
      ? "Просмотренные остаются"
      : "Просмотренные удаляются";
  detailMeta.textContent = `${details.length || 0} видео • ${removalText}`;
  renderDetailVideos(details);
  highlightSelectedRow(details.id);
}

function highlightSelectedRow(listId) {
  Array.from(listsBody.querySelectorAll("tr")).forEach((row) => {
    row.classList.toggle("active-row", row.dataset.listId === listId);
  });
}

function populateImportTargets() {
  importTargetSelect.textContent = "";
  const lists = collectListsMeta();
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
    case "view":
      await loadListDetails(listId);
      break;
    case "edit":
      openEditModal(listId);
      break;
    case "export":
      await exportList(listId);
      break;
    case "delete":
      await deleteList(listId);
      break;
    default:
      break;
  }
}

async function handleDetailAction(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const { action, videoId, listId } = button.dataset;
  if (!action || !videoId || !listId) return;
  switch (action) {
    case "remove":
      await sendMessage("playlist:remove", { videoId, listId, videoIds: [videoId] });
      await loadState();
      setStatus("Видео удалено", "info");
      break;
    case "move":
      showMoveMenu([videoId], listId, button);
      break;
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
  const name = collectListsMeta().find((list) => list.id === listId)?.name;
  a.href = url;
  a.download = `${name || "list"}.json`;
  a.click();
  URL.revokeObjectURL(url);
  setStatus("Список экспортирован", "success");
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
  const list = collectListsMeta().find((item) => item.id === listId);
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

openCreateModalBtn.addEventListener("click", () => {
  resetCreateModal();
  openModal(createModal);
});

openImportModalBtn.addEventListener("click", () => {
  resetImportModal();
  if (!collectListsMeta().length) {
    setStatus("Нет списков для добавления, будет создан новый", "info", 2500);
  }
  openModal(importModal);
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
  const list = collectListsMeta().find((item) => item.id === editingListId);
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
detailList.addEventListener("dragstart", handleDragStart);
detailList.addEventListener("dragover", handleDragOver);
detailList.addEventListener("drop", handleDrop);
detailList.addEventListener("dragend", handleDragEnd);

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
    if (!selectedListDetails || selectionState.selected.size === 0) return;
    showMoveMenu(Array.from(selectionState.selected), selectedListDetails.id, event.currentTarget);
  });
}

if (bulkDeleteBtn) {
  bulkDeleteBtn.addEventListener("click", async () => {
    if (!selectedListDetails || selectionState.selected.size === 0) return;
    const videoIds = Array.from(selectionState.selected);
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

registerModalDismiss();

loadState().catch((err) => {
  console.error("Failed to load lists state", err);
  setStatus("Не удалось загрузить списки", "error", 4000);
});
