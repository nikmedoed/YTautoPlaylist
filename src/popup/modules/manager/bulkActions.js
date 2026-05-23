// Manager bulk-action wiring. Contains delete selected, clear list, remove watched, and move selected button behavior.
export function registerManagerBulkActions({
  buttons,
  clearSelection,
  getSelectedListDetails,
  getWatchedVideoIds,
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
        await sendMessage("playlist:remove", {
          listId: selectedListDetails.id,
          videoIds,
        });
        await loadState();
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
        await sendMessage("playlist:remove", {
          listId: selectedListDetails.id,
          videoIds,
        });
        await loadState();
        clearSelection();
        setStatus(count > 1 ? `Удалено ${count} видео` : "Видео удалено", "success", 2500);
      } catch (err) {
        console.error("Failed to delete selected videos", err);
        setStatus("Не удалось удалить", "error", 3500);
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
        if (getSelectedListDetails()?.queue?.length) {
          clearListBtn.disabled = false;
        }
      }
    });
  }
}
