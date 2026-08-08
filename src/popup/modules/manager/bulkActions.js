// Manager bulk-action wiring. Contains delete selected, clear list, remove watched, and move selected button behavior.
export function registerManagerBulkActions({
  applyRemoveLocally,
  buttons,
  clearSelection,
  getSelectedListDetails,
  getWatchedVideoIds,
  handleRemoveResult,
  loadState,
  selectionController,
  sendMessage,
  setStatus,
  showMoveMenu,
  updateRemoveWatchedButton,
}) {
  // Bulk manager actions for deleting, clearing, and moving videos in the
  // selected list. Handlers are kept explicit because their UI recovery differs.
  const { bulkDeleteBtn, bulkMoveBtn, clearListBtn, removeWatchedBtn } = buttons;

  async function removeFromSelectedList(videoIds) {
    const selectedListDetails = getSelectedListDetails();
    if (!selectedListDetails?.id || !videoIds.length) return false;
    const listId = selectedListDetails.id;
    const appliedOptimistically =
      typeof applyRemoveLocally === "function"
        ? applyRemoveLocally(videoIds, listId)
        : false;
    const response = await sendMessage("playlist:remove", {
      listId,
      videoIds,
    });
    if (typeof handleRemoveResult === "function") {
      handleRemoveResult(response, videoIds, listId);
    } else if (!appliedOptimistically) {
      await loadState();
    }
    return true;
  }

  if (removeWatchedBtn) {
    removeWatchedBtn.addEventListener("click", async () => {
      const selectedListDetails = getSelectedListDetails();
      if (!selectedListDetails?.id) return;
      const videoIds = getWatchedVideoIds(selectedListDetails);
      const count = videoIds.length;
      if (!count) {
        setStatus("В этом списке нет просмотренных видео", "info", 3000);
        updateRemoveWatchedButton();
        return;
      }
      const title = selectedListDetails.name || "список";
      const message =
        count === 1
          ? `Удалить 1 просмотренное видео из списка «${title}»?`
          : `Удалить ${count} просмотренных видео из списка «${title}»?`;
      if (!confirm(`${message}\n\nБудут удалены все видео с прогрессом более 95%.`)) {
        return;
      }
      removeWatchedBtn.disabled = true;
      try {
        await removeFromSelectedList(videoIds);
        setStatus(
          count === 1
            ? "Просмотренное видео удалено"
            : `Удалено ${count} просмотренных видео`,
          "success",
          2500
        );
      } catch (err) {
        console.error("Failed to delete watched videos", err);
        setStatus("Не удалось удалить просмотренные", "error", 3500);
        loadState().catch(() => {});
        updateRemoveWatchedButton();
      }
    });
  }

  if (bulkMoveBtn) {
    bulkMoveBtn.addEventListener("click", (event) => {
      const selectedListDetails = getSelectedListDetails();
      const selectedIds = selectionController.getSelectedIds();
      if (!selectedListDetails || selectedIds.length === 0) return;
      showMoveMenu(selectedIds, selectedListDetails.id, event.currentTarget);
    });
  }

  if (bulkDeleteBtn) {
    bulkDeleteBtn.addEventListener("click", async () => {
      const selectedListDetails = getSelectedListDetails();
      if (!selectedListDetails) return;
      const videoIds = selectionController.getSelectedIds();
      if (videoIds.length === 0) return;
      const count = videoIds.length;
      try {
        await removeFromSelectedList(videoIds);
        clearSelection();
        setStatus(count > 1 ? `Удалено ${count} видео` : "Видео удалено", "success", 2500);
      } catch (err) {
        console.error("Failed to delete selected videos", err);
        setStatus("Не удалось удалить", "error", 3500);
        loadState().catch(() => {});
      }
    });
  }

  if (clearListBtn) {
    clearListBtn.addEventListener("click", async () => {
      const selectedListDetails = getSelectedListDetails();
      const queue = Array.isArray(selectedListDetails?.queue)
        ? selectedListDetails.queue
        : [];
      if (!selectedListDetails || queue.length === 0) return;
      const title = selectedListDetails.name || "список";
      if (!confirm(`Очистить список «${title}»?`)) return;
      const videoIds = queue.map((video) => video.id).filter(Boolean);
      if (!videoIds.length) return;
      clearListBtn.disabled = true;
      try {
        await removeFromSelectedList(videoIds);
        clearSelection();
        setStatus("Список очищен", "success", 2500);
      } catch (err) {
        console.error("Failed to clear list", err);
        setStatus("Не удалось очистить список", "error", 3500);
        loadState().catch(() => {});
        if (getSelectedListDetails()?.queue?.length) {
          clearListBtn.disabled = false;
        }
      }
    });
  }
}
