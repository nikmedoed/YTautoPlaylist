// Manager detail-row actions. Handles row-level remove, postpone, play, move, and open-link commands.
export function createManagerDetailActions({
  applyRemoveLocally,
  getAppState,
  handleRemoveResult,
  loadState,
  openQuickFilter,
  sendMessage,
  setStatus,
  showMoveMenu,
}) {
  return async function handleDetailAction(event) {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const { action, videoId, listId } = button.dataset;
    if (!action || !videoId) return;
    if (action !== "quickFilter" && !listId) return;
    switch (action) {
      case "quickFilter":
        openQuickFilter(videoId);
        break;
      case "remove": {
        try {
          const appliedOptimistically =
            typeof applyRemoveLocally === "function"
              ? applyRemoveLocally([videoId], listId)
              : false;
          const response = await sendMessage("playlist:remove", {
            videoId,
            listId,
            videoIds: [videoId],
          });
          if (typeof handleRemoveResult === "function") {
            handleRemoveResult(response, [videoId], listId);
          } else if (!appliedOptimistically) {
            await loadState();
          }
          setStatus("Видео удалено", "info");
        } catch (err) {
          console.error("Failed to delete video", err);
          setStatus("Не удалось удалить", "error", 3500);
          loadState().catch(() => {});
        }
        break;
      }
      case "move":
        showMoveMenu([videoId], listId, button);
        break;
      case "postpone":
        await postponeVideo({ videoId, listId });
        break;
      default:
        break;
    }
  };

  async function postponeVideo({ videoId, listId }) {
    const appState = getAppState();
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
  }
}
