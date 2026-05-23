// Manager list action handlers. Contains export, create YouTube playlist, remove list, and related status behavior.
import { delay } from "../../lib/runtimeMessages.js";
import {
  mapPlaylistCreationError,
  normalizeCount,
  openUrlInNewTab,
  setButtonLoading,
} from "./runtime.js";

// Implements list-level manager actions such as create, rename, delete, import, export, and YouTube playlist creation.
export function createManagerListActions({
  defaultListId,
  getAppState,
  loadState,
  managerModalController,
  registerPlaylistCreationState,
  releasePlaylistCreationState,
  sendMessage,
  setStatus,
  syncCurrentListSelection,
}) {
  async function handleListAction(event) {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const { action, listId } = button.dataset;
    if (!action || !listId) return;
    switch (action) {
      case "edit":
        if (listId === defaultListId) {
          setStatus("Основной список нельзя редактировать", "info", 3000);
          break;
        }
        managerModalController.openEditModal(listId);
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
    if (!listId) return;
    const result = await syncCurrentListSelection(listId);
    if (result === "changed") {
      setStatus("Список активирован", "success", 2200);
    } else if (result === "unchanged") {
      setStatus("Этот список уже активен", "info", 2200);
    } else {
      setStatus("Не удалось активировать список", "error", 3500);
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
    const lists = Array.isArray(getAppState()?.lists) ? getAppState().lists : [];
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
    if (button) setButtonLoading(button, true);
    setStatus("Создаю плейлист ютуб...", "info", 0);
    try {
      const result = await sendMessage("playlist:createYouTubePlaylist", { listId });
      if (!result || result.error) {
        setStatus(mapPlaylistCreationError(result?.error), "error", 5000);
        return;
      }
      const total = normalizeCount(result.total);
      const added = normalizeCount(result.added);
      const safeAdded = total ? Math.min(added, total) : added;
      const title = result.title?.trim() || "Плейлист";
      let message = `Плейлист «${title}» создан`;
      if (total) message += ` (${safeAdded}/${total})`;
      setStatus(message, total && safeAdded < total ? "info" : "success", 6000);
      const playlistUrl =
        result.url ||
        (result.playlistId
          ? `https://www.youtube.com/playlist?list=${result.playlistId}`
          : "");
      if (playlistUrl) {
        await delay(500);
        await openUrlInNewTab(playlistUrl);
      }
    } catch (err) {
      console.error("Failed to create YouTube playlist", err);
      setStatus("Не удалось создать плейлист", "error", 5000);
    } finally {
      releasePlaylistCreationState(state);
      if (button) setButtonLoading(button, false);
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

  return { handleListAction };
}
