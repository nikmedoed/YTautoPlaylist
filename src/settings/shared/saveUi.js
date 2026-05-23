// Settings save UI helper. Shows save state, timestamps, and transient persistence feedback.
import { getFiltersLastSaved } from "../../filter.js";

let toastTimer = null;

export function showToast(text, isError = false) {
  const toast = document.getElementById("saveToast");
  if (!toast) return;
  toast.textContent = text;
  toast.className = `notification ${isError ? "is-danger" : "is-success"} is-light`;
  toast.style.display = "";
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.style.display = "none";
    toastTimer = null;
  }, 3000);
}

export function updateLastSaveDisplay(lastSaveInfo) {
  const savedTime = getFiltersLastSaved();
  const text = savedTime
    ? `Последнее сохранение: ${savedTime.toLocaleString()}`
    : "Изменения ещё не сохранялись";
  if (lastSaveInfo) {
    lastSaveInfo.textContent = text;
  }
}

export function createSaveUiState(saveButtons) {
  let hasUnsavedChanges = false;
  let isSaving = false;
  let pendingChangesDuringSave = false;

  function updateSaveButtons() {
    const shouldHide = !hasUnsavedChanges;
    saveButtons.forEach((btn) => {
      if (!btn) return;
      btn.classList.toggle("is-hidden", shouldHide);
      btn.disabled = shouldHide || isSaving;
      btn.classList.toggle("is-loading", isSaving);
    });
  }

  function setUnsavedChanges(value) {
    if (!value) {
      pendingChangesDuringSave = false;
    }
    if (hasUnsavedChanges === value) return;
    hasUnsavedChanges = value;
    updateSaveButtons();
  }

  function markUnsaved() {
    if (isSaving) {
      pendingChangesDuringSave = true;
    }
    if (!hasUnsavedChanges) {
      setUnsavedChanges(true);
    }
  }

  function setSaving(value) {
    isSaving = Boolean(value);
    updateSaveButtons();
  }

  function consumePendingChangesDuringSave() {
    const pending = pendingChangesDuringSave;
    pendingChangesDuringSave = false;
    return pending;
  }

  return {
    consumePendingChangesDuringSave,
    isSaving: () => isSaving,
    markUnsaved,
    setSaving,
    setUnsavedChanges,
    updateSaveButtons,
  };
}
