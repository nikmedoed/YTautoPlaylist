// Manager move actions. Moves one or many videos between lists and refreshes
// manager state afterward.
import { createMoveMenu } from "../../lib/moveMenu.js";

// Handles manager row/bulk move menus and refreshes selected list details after moves.
export function createManagerMoveActions({
  bulkMoveBtn,
  clearSelection,
  getAppState,
  getSelectedListDetails,
  loadState,
  sendMessage,
  setStatus,
}) {
  const moveMenu = createMoveMenu({
    getOptions: ({ sourceListId }) => {
      const lists = Array.isArray(getAppState()?.lists) ? getAppState().lists : [];
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
      setStatus(
        isBulk ? `Переношу ${videoIds.length} видео...` : "Переношу видео...",
        "info"
      );
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
        if (isBulk) clearSelection();
      } catch (err) {
        console.error("Failed to move videos", err);
        setStatus("Не удалось перенести", "error", 3000);
      }
    },
  });

  function showMoveMenu(videoIds, sourceListId, anchor) {
    const normalizedIds = Array.isArray(videoIds)
      ? videoIds
          .map((id) => (typeof id === "string" ? id.trim() : ""))
          .filter(Boolean)
      : [];
    if (!normalizedIds.length) return;
    const selectedListDetails = getSelectedListDetails();
    const resolvedSourceId =
      typeof sourceListId === "string" && sourceListId.trim()
        ? sourceListId
        : selectedListDetails?.id || null;
    if (!resolvedSourceId) return;
    let anchorEl = null;
    if (anchor && typeof anchor.getBoundingClientRect === "function") {
      anchorEl = anchor;
    } else if (
      bulkMoveBtn &&
      typeof bulkMoveBtn.getBoundingClientRect === "function"
    ) {
      anchorEl = bulkMoveBtn;
    }
    moveMenu.show(anchorEl, {
      videoIds: normalizedIds,
      sourceListId: resolvedSourceId,
    });
  }

  return { moveMenu, showMoveMenu };
}
