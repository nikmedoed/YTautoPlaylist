// Background queue message handlers. Contains queue state, add, remove, reorder, postpone, restore, move, and playlist import actions.
import {
  getNextQueueEntry,
  getPresentationState,
  getState,
  HISTORY_LIMIT,
  moveAllVideos,
  moveVideoToList,
  postponeVideo,
  reorderQueue,
  restoreDeletedEntry,
  setCurrentList,
} from "../../store/index.js";
import { parsePlaylistId, parseVideoId } from "../../utils.js";
import { fetchPlaylistVideoIds } from "../collector.js";
import {
  addEntries,
  handleAddByIds,
  handleMoveVideos,
  handleRemoveVideos,
  mutateAndPresent,
} from "../services.js";

// Queue/list-item message handlers. This table is the Chrome runtime boundary:
// every key is a message type sent by popup or content scripts.
export const queueHandlers = {
  "playlist:getState": getPresentationState,

  async "playlist:setCurrentList"(message) {
    if (!message?.listId) return getPresentationState();
    return mutateAndPresent(() => setCurrentList(message.listId));
  },

  async "playlist:addByIds"(message, sender) {
    return handleAddByIds(message, sender);
  },

  async "playlist:addPlaylist"(message, sender) {
    // Expands a YouTube playlist URL/id into video ids, then reuses the normal
    // add-by-id path so result counters stay identical.
    const rawId =
      message?.playlistId || message?.id || message?.listId || message?.videoId;
    const playlistId = parsePlaylistId(rawId);
    if (!playlistId) {
      return {
        state: await getPresentationState(),
        requested: 0,
        fetched: 0,
        missing: 0,
        added: 0,
        error: "INVALID_PLAYLIST_ID",
      };
    }
    try {
      const { ids, total } = await fetchPlaylistVideoIds(playlistId, {
        limit: message?.limit,
      });
      if (!Array.isArray(ids) || !ids.length) {
        return {
          state: await getPresentationState(),
          requested: total || 0,
          fetched: 0,
          missing: total || 0,
          added: 0,
        };
      }
      return handleAddByIds({ ...message, videoIds: ids, playlistId }, sender);
    } catch (err) {
      console.warn("Failed to add playlist", playlistId, err);
      return {
        state: await getPresentationState(),
        requested: 0,
        fetched: 0,
        missing: 0,
        added: 0,
        error: err?.message || "PLAYLIST_ADD_FAILED",
      };
    }
  },

  async "playlist:addEntries"(message) {
    const entries = Array.isArray(message.entries) ? message.entries : [];
    return addEntries(entries, message.listId || null, {
      ensureDefault: message?.ensureDefault !== false,
    });
  },

  async "playlist:remove"(message) {
    const ids = Array.isArray(message.videoIds)
      ? message.videoIds
      : [message.videoId];
    return handleRemoveVideos(ids, message.listId || null);
  },

  async "playlist:postponeVideo"(message) {
    const videoId = message?.videoId ? parseVideoId(message.videoId) : null;
    if (!videoId) {
      return getPresentationState();
    }
    return mutateAndPresent(
      () => postponeVideo(videoId, { listId: message.listId || null }),
      { notify: true }
    );
  },

  async "playlist:restoreDeleted"(message) {
    const position =
      typeof message?.position === "number" && Number.isInteger(message.position)
        ? message.position
        : 0;
    return mutateAndPresent(() => restoreDeletedEntry(position), {
      dispatch: true,
      ensureDefault: true,
    });
  },

  async "playlist:getNext"() {
    const state = await getState();
    return getNextQueueEntry(state);
  },

  async "playlist:getHistoryLimit"() {
    return { limit: HISTORY_LIMIT };
  },

  async "playlist:reorder"(message) {
    if (!message?.videoId) {
      return getPresentationState();
    }
    return mutateAndPresent(() =>
      reorderQueue(message.videoId, message.targetIndex, message.listId || null)
    );
  },

  async "playlist:moveVideo"(message) {
    if (!message?.videoId || !message?.targetListId) {
      return getPresentationState();
    }
    return mutateAndPresent(
      () => moveVideoToList(message.videoId, message.targetListId),
      { dispatch: true, ensureDefault: true }
    );
  },

  async "playlist:moveVideos"(message) {
    return handleMoveVideos(message?.videoIds, message?.targetListId);
  },

  async "playlist:moveAll"(message) {
    if (!message?.sourceListId || !message?.targetListId) {
      return getPresentationState();
    }
    return mutateAndPresent(
      () => moveAllVideos(message.sourceListId, message.targetListId),
      { dispatch: true, ensureDefault: true }
    );
  },
};
