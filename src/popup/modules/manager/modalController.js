// Manager modal controller. Owns create/import/edit/add-links modal submit flows and field state.
import {
  formatAddResultMessage,
  normalizeAddResponse,
} from "../../../addResultMessages.js";
import { extractVideoIdsFromText, setButtonLoading } from "./runtime.js";

// Wires every manager modal and keeps submit handling next to the fields it reads.
export function createManagerModalController({
  defaultListId,
  elements,
  getAppState,
  getSelectedListDetails,
  loadState,
  sendMessage,
  setStatus,
  toggleImportTarget,
}) {
  const {
    modalBackdrop,
    createModal,
    importModal,
    editModal,
    addLinksModal,
    openCreateModalBtn,
    openImportModalBtn,
    openAddLinksModalBtn,
    createForm,
    createName,
    createFreeze,
    importForm,
    importFile,
    importModeSelect,
    importTargetSelect,
    editForm,
    editName,
    editFreeze,
    addLinksForm,
    addLinksTextarea,
  } = elements;

  const modals = [createModal, importModal, editModal, addLinksModal];
  let editingListId = null;

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
    if (modals.every((item) => item?.hidden)) {
      modalBackdrop.hidden = true;
      document.body.dataset.modalOpen = "";
    }
  }

  function closeAllModals() {
    modals.forEach((modal) => {
      if (modal) {
        modal.hidden = true;
      }
    });
    modalBackdrop.hidden = true;
    document.body.dataset.modalOpen = "";
  }

  function openEditModal(listId) {
    const lists = Array.isArray(getAppState()?.lists) ? getAppState().lists : [];
    const list = lists.find((item) => item.id === listId);
    if (!list) return;
    editingListId = listId;
    editName.value = list.name;
    editFreeze.checked = list.id === defaultListId ? false : Boolean(list.freeze);
    editFreeze.disabled = list.id === defaultListId;
    openModal(editModal);
  }

  function register() {
    registerModalDismiss();
    registerOpenButtons();
    registerForms();
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

  function registerOpenButtons() {
    openCreateModalBtn.addEventListener("click", () => {
      resetCreateModal();
      openModal(createModal);
    });

    openImportModalBtn.addEventListener("click", () => {
      resetImportModal();
      const lists = Array.isArray(getAppState()?.lists) ? getAppState().lists : [];
      if (!lists.length) {
        setStatus("Нет списков для добавления, будет создан новый", "info", 2500);
      }
      openModal(importModal);
    });

    openAddLinksModalBtn?.addEventListener("click", () => {
      if (!getSelectedListDetails()?.id) {
        setStatus("Сначала откройте список", "info", 2500);
        return;
      }
      resetAddLinksModal();
      openModal(addLinksModal);
    });
  }

  function registerForms() {
    createForm.addEventListener("submit", handleCreateSubmit);
    importModeSelect.addEventListener("change", toggleImportTarget);
    importForm.addEventListener("submit", handleImportSubmit);
    editForm.addEventListener("submit", handleEditSubmit);
    addLinksForm?.addEventListener("submit", handleAddLinksSubmit);
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

  async function handleCreateSubmit(event) {
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
  }

  async function handleImportSubmit(event) {
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
  }

  async function handleEditSubmit(event) {
    event.preventDefault();
    if (!editingListId) return;
    const lists = Array.isArray(getAppState()?.lists) ? getAppState().lists : [];
    const list = lists.find((item) => item.id === editingListId);
    if (!list) return;
    const tasks = [];
    const nextName = editName.value.trim();
    if (nextName && nextName !== list.name) {
      tasks.push(sendMessage("playlist:renameList", { listId: list.id, name: nextName }));
    }
    if (list.id !== defaultListId && Boolean(editFreeze.checked) !== Boolean(list.freeze)) {
      tasks.push(sendMessage("playlist:setFreeze", { listId: list.id, freeze: editFreeze.checked }));
    }
    if (tasks.length) {
      await Promise.all(tasks);
      await loadState();
      setStatus("Настройки сохранены", "success");
    }
    closeModal(editModal);
    editingListId = null;
  }

  async function handleAddLinksSubmit(event) {
    event.preventDefault();
    const selectedListDetails = getSelectedListDetails();
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
    try {
      const response = await sendMessage("playlist:addByIds", {
        videoIds: ids,
        listId: selectedListDetails.id,
        ensureDefault: false,
      });
      await loadState();
      setAddLinksResultStatus(response, ids.length);
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
  }

  function setAddLinksResultStatus(response, fallbackRequested) {
    const { added, requested, missing } = normalizeAddResponse(response);
    const summary = formatAddResultMessage({
      added,
      requested: requested ?? fallbackRequested,
      missing,
      alreadyMessage: "Все видео уже в списке",
    });
    setStatus(summary.message, summary.kind, 3800);
  }

  return {
    closeAllModals,
    closeModal,
    openEditModal,
    openModal,
    register,
  };
}
