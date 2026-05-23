// Video-card add flow. Resolves target list payloads and sends video or playlist add requests.
import {
  sendMessage,
} from "../core/base.js";
import {
  refreshInlinePlaylistState,
  syncInlineButtonState,
  updateInlinePlaylistState,
} from "../inline-queue/index.js";
import {
  showPageActionStatus,
} from "../page-actions/index.js";
import {
  formatAddResultMessage,
  normalizeAddResponse,
} from "../../addResultMessages.js";

const PLAYLIST_SUCCESS_NOTIFICATION_THRESHOLD = 2000;

export async function applyInlineAddResponse(response) {
  const { state, added, requested, missing } = normalizeAddResponse(response);
  if (state) {
    updateInlinePlaylistState(state);
  } else {
    await refreshInlinePlaylistState();
  }
  return { added, requested, missing };
}

export function clearPlaylistSuccessTimer(button, playlistSuccessTimers) {
  const existing = playlistSuccessTimers.get(button);
  if (existing) {
    window.clearTimeout(existing);
    playlistSuccessTimers.delete(button);
  }
}

function maybeShowPlaylistSuccessNotification(metrics, durationMs) {
  if (
    typeof durationMs !== "number" ||
    durationMs < PLAYLIST_SUCCESS_NOTIFICATION_THRESHOLD
  ) {
    return;
  }
  if (typeof showPageActionStatus !== "function") {
    return;
  }
  const { added, requested, missing } = normalizeAddResponse(metrics);
  if (added || missing || requested !== null) {
    const summary = formatAddResultMessage({
      added,
      requested,
      missing,
      scopeLabel: "видео плейлиста",
      alreadyMessage: "Все видео плейлиста уже в списке",
    });
    if (summary && summary.message) {
      showPageActionStatus(summary.message, summary.kind, 3600);
      return;
    }
  }
  const baseMessage = added
    ? `Добавлено ${added} видео из плейлиста`
    : missing
    ? `Не удалось добавить ${missing} видео из плейлиста`
    : "Плейлист обработан";
  const kind = added ? "success" : missing ? "error" : "info";
  showPageActionStatus(baseMessage, kind, 3600);
}

export function showPlaylistSuccess(
  button,
  metrics,
  durationMs,
  playlistSuccessTimers
) {
  if (!(button instanceof HTMLButtonElement)) {
    return;
  }
  clearPlaylistSuccessTimer(button, playlistSuccessTimers);
  button.dataset.ytaStatus = "success";
  button.disabled = true;
  syncInlineButtonState(button);
  playlistSuccessTimers.delete(button);
  maybeShowPlaylistSuccessNotification(metrics, durationMs);
}

export async function sendInlineAddRequest({ playlistId, videoId, listId }) {
  const payload = playlistId
    ? {
        playlistId,
        listId: listId || undefined,
      }
    : {
        videoIds: [videoId],
        listId: listId || undefined,
      };
  return playlistId
    ? sendMessage("playlist:addPlaylist", payload)
    : sendMessage("playlist:addByIds", payload);
}
