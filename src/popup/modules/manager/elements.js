// Manager DOM element lookup. Collects all static elements used by the list manager entrypoint.
const MANAGER_ELEMENT_IDS = [
  "listsBody",
  "detailList",
  "detailEmpty",
  "selectAllBtn",
  "removeWatchedBtn",
  "clearSelectionBtn",
  "bulkPostponeBtn",
  "bulkMoveBtn",
  "bulkDeleteBtn",
  "clearListBtn",
  "floatingSelectionActions",
  "status",
  "statusText",
  "statusProgress",
  "statusProgressBar",
  "managerSyncState",
  "managerSyncMeta",
  "managerSyncPull",
  "managerSyncPush",
  "managerSyncRestore",
  "managerCollectionArea",
  "managerCollectSubscriptions",
  "managerCollectionNote",
  "managerCollectionProgress",
  "managerCollectionStage",
  "managerCollectionCounters",
  "managerCollectionLog",
  "openCreateModal",
  "openImportModal",
  "openAddLinksModal",
  "openYtdlpModal",
  "modalBackdrop",
  "createModal",
  "importModal",
  "editModal",
  "addLinksModal",
  "ytdlpModal",
  "createForm",
  "createName",
  "createFreeze",
  "importForm",
  "importFile",
  "importModeSelect",
  "importTargetField",
  "importTargetSelect",
  "editForm",
  "editName",
  "editFreeze",
  "addLinksForm",
  "addLinksTextarea",
  "ytdlpForm",
  "ytdlpFormat",
  "ytdlpOutputDir",
  "ytdlpArchive",
  "ytdlpNoOverwrites",
  "ytdlpMetadata",
  "ytdlpThumbnail",
  "ytdlpCookies",
  "ytdlpCommand",
  "ytdlpSummary",
  "copyYtdlpCommand",
];

const ELEMENT_ALIASES = {
  managerCollectSubscriptions: "managerCollectBtn",
  openAddLinksModal: "openAddLinksModalBtn",
  openCreateModal: "openCreateModalBtn",
  openImportModal: "openImportModalBtn",
  openYtdlpModal: "openYtdlpModalBtn",
  status: "statusBox",
};

export function getManagerElements(documentRef = document) {
  const elements = Object.fromEntries(
    MANAGER_ELEMENT_IDS.map((id) => {
      const key = ELEMENT_ALIASES[id] || id;
      return [key, documentRef.getElementById(id)];
    })
  );

  return {
    ...elements,
    queueSection: documentRef.querySelector(".queue"),
    managerCollectionTitle:
      elements.managerCollectionProgress?.querySelector?.(".collection-info h4") ||
      null,
  };
}
