// Manager event registration. Wires list, detail, selection, drag, and collection events to injected handlers.
export function registerManagerEvents({
  controllers,
  elements,
  handlers,
  managerSection,
}) {
  const {
    clearSelection,
    handleDetailAction,
    handleListAction,
    handleSelectionToggle,
    selectAllVideos,
  } = handlers;
  const { clearSelectionBtn, detailList, listsBody, managerCollectBtn, selectAllBtn } =
    elements;

  let pendingShiftSelect = false;

  listsBody.addEventListener("click", handleListAction);

  detailList.addEventListener("pointerdown", (event) => {
    pendingShiftSelect = Boolean(
      event.shiftKey && event.target.closest(".manage-select")
    );
  });

  detailList.addEventListener("click", (event) => {
    const checkbox = event.target.closest('.manage-select input[type="checkbox"]');
    if (!checkbox) return;
    const videoId = checkbox.dataset.videoId || "";
    const index = Number(checkbox.dataset.index);
    const useShift = pendingShiftSelect || event.shiftKey;
    pendingShiftSelect = false;
    handleSelectionToggle(
      videoId,
      Number.isNaN(index) ? -1 : index,
      checkbox.checked,
      useShift
    );
    event.stopPropagation();
  });

  detailList.addEventListener("click", handleDetailAction);
  detailList.addEventListener("dragstart", controllers.drag.handleDragStart);
  detailList.addEventListener("dragover", controllers.drag.handleDragOver);
  detailList.addEventListener("drop", controllers.drag.handleDrop);
  detailList.addEventListener("dragend", controllers.drag.handleDragEnd);

  if (selectAllBtn) {
    selectAllBtn.addEventListener("click", selectAllVideos);
  }

  if (clearSelectionBtn) {
    clearSelectionBtn.addEventListener("click", clearSelection);
  }

  if (managerCollectBtn) {
    managerCollectBtn.addEventListener("click", () => {
      Promise.resolve(managerSection.collectSubscriptions()).catch(() => {});
    });
  }
}
