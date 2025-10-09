const DEFAULT_LIST_ID = "default";

const fallbackThumbnail = chrome.runtime.getURL("icon/icon.png");

const listsBody = document.getElementById("listsBody");
const detailList = document.getElementById("detailList");
const detailEmpty = document.getElementById("detailEmpty");
const detailTitle = document.getElementById("detailTitle");
const detailMeta = document.getElementById("detailMeta");
const moveAllBtn = document.getElementById("moveAllBtn");
const moveAllTarget = document.getElementById("moveAllTarget");
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

function renderMoveAllOptions(sourceId) {
  moveAllTarget.textContent = "";
  const options = collectListsMeta().filter((list) => list.id !== sourceId);
  options.forEach((list) => {
    const option = document.createElement("option");
    option.value = list.id;
    option.textContent = list.name;
    moveAllTarget.appendChild(option);
  });
  moveAllBtn.disabled = options.length === 0;
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

function createVideoItem(video, index, listId) {
  const li = document.createElement("li");
  li.className = "video-item manage-video-item";
  li.dataset.id = video.id;
  li.dataset.index = String(index);
  li.dataset.listId = listId;

  const handle = document.createElement("button");
  handle.type = "button";
  handle.className = "video-handle";
  handle.textContent = "⋮⋮";
  handle.disabled = true;
  handle.tabIndex = -1;
  handle.setAttribute("aria-hidden", "true");

  const thumb = document.createElement("img");
  thumb.className = "video-thumb";
  thumb.src = resolveThumbnail(video);
  thumb.alt = video.title || "Видео";
  thumb.loading = "lazy";

  const body = document.createElement("div");
  body.className = "video-body";

  const title = document.createElement("div");
  title.className = "video-title";
  title.textContent = video.title || "Без названия";

  const details = document.createElement("div");
  details.className = "video-details";
  const parts = [];
  if (video.channelTitle) parts.push(video.channelTitle);
  if (video.publishedAt) parts.push(new Date(video.publishedAt).toLocaleString("ru-RU"));
  if (video.duration) parts.push(formatDuration(video.duration));
  details.textContent = parts.join(" • ");

  const actions = document.createElement("div");
  actions.className = "video-actions";

  const moveWrapper = document.createElement("div");
  moveWrapper.className = "video-move-block";
  const select = document.createElement("select");
  select.dataset.videoId = video.id;
  select.dataset.listId = listId;
  const targetLists = collectListsMeta().filter((list) => list.id !== listId);
  targetLists.forEach((list) => {
    const option = document.createElement("option");
    option.value = list.id;
    option.textContent = list.name;
    select.appendChild(option);
  });
  select.disabled = targetLists.length === 0;

  const moveBtn = document.createElement("button");
  moveBtn.type = "button";
  moveBtn.className = "secondary";
  moveBtn.dataset.action = "move";
  moveBtn.dataset.videoId = video.id;
  moveBtn.dataset.listId = listId;
  moveBtn.textContent = "Перенести";
  moveBtn.disabled = targetLists.length === 0;

  moveWrapper.append(select, moveBtn);

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.dataset.action = "remove";
  removeBtn.dataset.videoId = video.id;
  removeBtn.dataset.listId = listId;
  removeBtn.textContent = "Удалить";

  actions.append(moveWrapper, removeBtn);
  body.append(title, details, actions);
  li.append(handle, thumb, body);
  return li;
}

function renderDetailVideos(details) {
  detailList.textContent = "";
  const videos = Array.isArray(details.queue) ? details.queue : [];
  if (!videos.length) {
    detailEmpty.hidden = false;
    return;
  }
  detailEmpty.hidden = true;
  videos.forEach((video, index) => {
    detailList.appendChild(createVideoItem(video, index, details.id));
  });
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
  selectedListDetails = details;
  detailTitle.textContent = details.name;
  const removalText =
    details.id === DEFAULT_LIST_ID
      ? "Автоудаление включено"
      : details.freeze
      ? "Просмотренные остаются"
      : "Просмотренные удаляются";
  detailMeta.textContent = `${details.length || 0} видео • ${removalText}`;
  renderMoveAllOptions(details.id);
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

function getSelectedMoveTarget(selectElement) {
  if (!selectElement) return null;
  return selectElement.value || null;
}

async function applyMoveAll() {
  if (!selectedListDetails) return;
  const targetListId = moveAllTarget.value;
  if (!targetListId) return;
  if (!confirm("Перенести все видео в выбранный список?")) return;
  await sendMessage("playlist:moveAll", {
    sourceListId: selectedListDetails.id,
    targetListId,
  });
  await loadState();
  setStatus("Видео перенесены", "success");
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
    case "move": {
      const select = button
        .closest(".video-move-block")
        ?.querySelector("select");
      const targetListId = getSelectedMoveTarget(select);
      if (!targetListId) {
        setStatus("Выберите список для переноса", "info", 2500);
        return;
      }
      await sendMessage("playlist:moveVideo", { videoId, targetListId });
      await loadState();
      setStatus("Видео перенесено", "success");
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

moveAllBtn.addEventListener("click", applyMoveAll);
listsBody.addEventListener("click", handleListAction);
detailList.addEventListener("click", handleDetailAction);

registerModalDismiss();

loadState().catch((err) => {
  console.error("Failed to load lists state", err);
  setStatus("Не удалось загрузить списки", "error", 4000);
});
