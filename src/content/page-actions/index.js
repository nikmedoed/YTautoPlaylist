// Page-actions feature entrypoint. Coordinates add-current, add-visible, add-page collection, and result rendering.
import {
  determinePageContext,
  getContextCapabilities,
  getCurrentVideoId,
  inlinePlaylistState,
  pageActions,
  playerControls,
  sendMessage,
  state,
} from "../core/base.js";
import {
  collectPageVideosWithContinuation,
  collectVisibleVideoIds,
} from "../collection/collectors.js";
import {
  refreshInlinePlaylistState,
  updateInlinePlaylistState,
} from "../inline-queue/index.js";
import {
  setControlsActive,
  updatePlayerControlsUI,
} from "../playback/controls.js";
import {
  formatAddResultMessage,
  normalizeAddResponse,
} from "../../addResultMessages.js";
import {
  createPageActionViewController,
} from "./view.js";

export { formatAddResultMessage } from "../../addResultMessages.js";

const ACTION_DEFINITIONS = [
  { key: "addCurrent", label: "Добавить в плейлист", handler: handleAddCurrentFromPage },
  { key: "addVisible", label: "Добавить видимые", handler: handleAddVisibleFromPage },
  {
    key: "addAll",
    label: "Добавить все на странице",
    handler: handleAddAllFromPage,
  },
];

const pageActionView = createPageActionViewController({
  determinePageContext,
  getContextCapabilities,
  getCurrentVideoId,
  inlinePlaylistState,
  pageActions,
  state,
  actionDefinitions: ACTION_DEFINITIONS,
  cancelAddAllFromPage,
});

const {
  clearPageActionStatus,
  ensurePageActions,
  scheduleCollapsePageActions,
  setCollectingAllState,
} = pageActionView;

export const showPageActionStatus = pageActionView.showPageActionStatus;
export const updatePageActions = pageActionView.updatePageActions;

export function cancelAddAllFromPage(options = {}) {
  if (!pageActions.collectingAll) return false;
  const { silent = false } = options || {};
  if (pageActions.stop) {
    pageActions.stop.disabled = true;
  }
  if (!pageActions.cancelRequested) {
    pageActions.cancelRequested = true;
    if (!silent) {
      showPageActionStatus("Останавливаю...", "info", 0);
    }
  }
  if (pageActions.collectAbort) {
    try {
      pageActions.collectAbort.abort();
    } catch (err) {
      console.warn("Failed to abort collection", err);
    }
  }
  return true;
}

async function syncPlaybackAfterManualAdd(videoId) {
  if (!videoId) {
    return false;
  }
  const video = state.videoElement || document.querySelector("video");
  const isPlayingInTab = Boolean(video && !video.paused && !video.ended);
  if (!isPlayingInTab) {
    return false;
  }
  state.currentVideoId = videoId;
  try {
    const response = await sendMessage("player:videoStarted", { videoId });
    if (response && typeof response.controlled === "boolean") {
      const controlled = Boolean(response.controlled);
      setControlsActive(controlled);
      if (controlled) {
        return true;
      }
    }
  } catch (err) {
    console.warn("Failed to synchronize playback state", err);
  }
  return false;
}

async function addVideoIds(videoIds, options = {}) {
  const {
    scopeLabel = "",
    alreadyMessage = "",
    fallbackRequested = Array.isArray(videoIds) ? videoIds.length : null,
  } = options;
  const safeIds = Array.isArray(videoIds) ? videoIds : [];
  const payload = {
    videoIds: safeIds,
  };
  if (inlinePlaylistState.currentListId) {
    payload.listId = inlinePlaylistState.currentListId;
  }
  const response = await sendMessage("playlist:addByIds", payload);
  const { state: presentation, requested, missing, added } = normalizeAddResponse(
    response
  );
  if (presentation && typeof presentation === "object") {
    updateInlinePlaylistState(presentation);
  } else {
    await refreshInlinePlaylistState();
  }
  const totalRequested =
    requested ?? (Number.isInteger(fallbackRequested) ? fallbackRequested : 0);
  const summary = formatAddResultMessage({
    added,
    requested: totalRequested,
    missing,
    scopeLabel,
    alreadyMessage,
  });
  return { added, missing, summary };
}

export async function handleAddCurrentFromPage() {
  const caps = getContextCapabilities();
  if (!caps.canAddCurrent) return;
  ensurePageActions();
  clearPageActionStatus({ collapse: true });
  if (pageActions.addCurrent) pageActions.addCurrent.disabled = true;
  const controlsButton =
    playerControls && typeof playerControls === "object"
      ? playerControls.addCurrent
      : null;
  if (controlsButton) {
    controlsButton.disabled = true;
    controlsButton.dataset.loading = "1";
  }
  try {
    const videoId = getCurrentVideoId();
    if (!videoId) {
      showPageActionStatus("Видео не найдено", "error", 3200);
      return;
    }
    state.currentVideoId = videoId;
    const { added, missing, summary } = await addVideoIds([videoId], {
      alreadyMessage: "Видео уже в плейлисте",
      fallbackRequested: 1,
    });
    if (added > 0 && missing === 0) {
      clearPageActionStatus({ collapse: true });
    } else {
      showPageActionStatus(summary.message, summary.kind, 3400);
    }
    await syncPlaybackAfterManualAdd(videoId);
  } catch (err) {
    console.error("Failed to add current video", err);
    showPageActionStatus("Не удалось добавить видео", "error", 3500);
  } finally {
    if (pageActions.addCurrent) pageActions.addCurrent.disabled = false;
    if (controlsButton) {
      delete controlsButton.dataset.loading;
    }
    updatePageActions();
    updatePlayerControlsUI();
  }
}

async function handleAddVisibleFromPage() {
  const caps = getContextCapabilities();
  if (!caps.canAddVisible) return;
  ensurePageActions();
  if (pageActions.addVisible) pageActions.addVisible.disabled = true;
  try {
    const collected = collectVisibleVideoIds({ includeCurrent: false });
    const uniqueIds = Array.from(new Set(collected));
    if (!uniqueIds.length) {
      showPageActionStatus("Видео не найдены", "error", 3200);
      return;
    }
    showPageActionStatus(`Добавляю ${uniqueIds.length} видео...`, "info", 0);
    const { summary } = await addVideoIds(uniqueIds, {
      scopeLabel: "видимые видео",
      fallbackRequested: uniqueIds.length,
    });
    showPageActionStatus(summary.message, summary.kind, 3400);
  } catch (err) {
    console.error("Failed to add visible videos", err);
    showPageActionStatus("Не удалось добавить видео", "error", 3500);
  } finally {
    if (pageActions.addVisible) pageActions.addVisible.disabled = false;
    updatePageActions();
  }
}

async function handleAddAllFromPage() {
  const caps = getContextCapabilities();
  if (!caps.canAddAll) return;
  ensurePageActions();
  if (pageActions.addAll) pageActions.addAll.disabled = true;
  pageActions.cancelRequested = false;
  const controller = new AbortController();
  pageActions.collectAbort = controller;
  setCollectingAllState(true);
  try {
    let reportedTotal = -1;
    showPageActionStatus("Собираю видео...", "info", 0);
    const collected = await collectPageVideosWithContinuation({
      signal: controller.signal,
      shouldStop: () => pageActions.cancelRequested,
      onProgress: ({ total }) => {
        if (pageActions.cancelRequested) return;
        if (total !== reportedTotal) {
          reportedTotal = total;
          showPageActionStatus(`Собрано ${total} видео...`, "info", 0);
        }
      },
    });
    const videoIds = Array.isArray(collected?.videoIds)
      ? collected.videoIds
      : Array.isArray(collected)
      ? collected
      : [];
    const uniqueIds = Array.from(new Set(videoIds));
    const aborted = Boolean(collected?.aborted || pageActions.cancelRequested);
    if (!uniqueIds.length) {
      const message = aborted
        ? "Сбор остановлен. Видео не найдены"
        : "Видео не найдены";
      showPageActionStatus(message, aborted ? "info" : "error", 3200);
      return;
    }
    showPageActionStatus(
      aborted
        ? `Сбор остановлен, добавляю найденные ${uniqueIds.length} видео...`
        : `Добавляю ${uniqueIds.length} видео...`,
      "info",
      0
    );
    if (pageActions.stop) {
      pageActions.stop.disabled = true;
    }
    pageActions.collectAbort = null;
    const { summary } = await addVideoIds(uniqueIds, {
      scopeLabel: aborted ? "найденные видео" : "видео на странице",
      fallbackRequested: uniqueIds.length,
    });
    const finalMessage = aborted
      ? `Сбор остановлен. ${summary.message}`
      : summary.message;
    showPageActionStatus(finalMessage, summary.kind, 3600);
  } catch (err) {
    console.error("Failed to add page videos", err);
    showPageActionStatus("Не удалось добавить видео", "error", 3500);
  } finally {
    pageActions.collectAbort = null;
    const wasCollecting = pageActions.collectingAll;
    setCollectingAllState(false);
    pageActions.cancelRequested = false;
    if (pageActions.addAll) pageActions.addAll.disabled = false;
    if (wasCollecting) {
      scheduleCollapsePageActions(340);
    }
    updatePageActions();
  }
}
