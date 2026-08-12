// Background list-management message handlers. Contains create, rename, freeze, remove, import/export, and YouTube playlist creation flows.
import {
  addList,
  DEFAULT_LIST_ID,
  exportList,
  getListDetails,
  getPresentationState,
  importList,
  removeList,
  renameList,
  setListFreeze,
} from "../../store/index.js";
import { addListToWL, createPlayList } from "../../youtube-api/playlists.js";
import {
  buildDefaultPlaylistTitle,
  mutateAndPresent,
} from "../services.js";

// List management message handlers, including import/export and YouTube
// playlist creation progress broadcasts.

function buildPlaylistProgressToken() {
  if (typeof crypto?.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `pl-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createPlaylistProgressSender(token, listId) {
  return (payload = {}) => {
    try {
      chrome.runtime.sendMessage(
        {
          type: "playlist:createYouTubePlaylist:progress",
          token,
          listId,
          ...payload,
        },
        () => {
          const lastError = chrome.runtime.lastError;
          if (
            lastError &&
            lastError.message !==
              "The message port closed before a response was received."
          ) {
            console.debug("Playlist progress message error", lastError);
          }
        }
      );
    } catch (err) {
      console.debug("Failed to send playlist progress", err);
    }
  };
}

function extractPlaylistErrorReason(err) {
  return (
    err?.error?.error?.errors?.[0]?.reason ||
    err?.error?.errors?.[0]?.reason ||
    err?.error?.error?.message ||
    err?.error?.message ||
    err?.message ||
    "PLAYLIST_CREATE_FAILED"
  );
}

export const listHandlers = {
  async "playlist:createList"(message) {
    return mutateAndPresent(() =>
      addList({
        name: message?.name,
        freeze: Boolean(message?.freeze),
      })
    );
  },

  async "playlist:renameList"(message) {
    if (!message?.listId || !message?.name) {
      return getPresentationState();
    }
    return mutateAndPresent(() => renameList(message.listId, message.name));
  },

  async "playlist:setFreeze"(message) {
    if (!message?.listId) return getPresentationState();
    return mutateAndPresent(() =>
      setListFreeze(message.listId, Boolean(message.freeze))
    );
  },

  async "playlist:removeList"(message) {
    if (!message?.listId) return getPresentationState();
    return mutateAndPresent(
      () =>
        removeList(message.listId, {
          mode: message.mode === "discard" ? "delete" : "move",
        }),
      { dispatch: true }
    );
  },

  async "playlist:getList"(message) {
    if (!message?.listId) return { error: "listId required" };
    return getListDetails(message.listId);
  },

  async "playlist:exportList"(message) {
    if (!message?.listId) return { error: "listId required" };
    const data = await exportList(message.listId);
    return { data };
  },

  async "playlist:createYouTubePlaylist"(message) {
    // Long-running because it creates the remote playlist and inserts every
    // video while streaming progress back to the manager UI.
    const listId = message?.listId;
    if (!listId) {
      return { error: "listId required" };
    }

    const token = buildPlaylistProgressToken();
    const sendProgress = createPlaylistProgressSender(token, listId);

    try {
      sendProgress({ stage: "start" });
      const details = await getListDetails(listId);
      const queue = Array.isArray(details?.queue) ? details.queue : [];
      if (!queue.length) {
        sendProgress({ stage: "error", reason: "LIST_EMPTY" });
        return { error: "LIST_EMPTY" };
      }
      const title =
        details?.id === DEFAULT_LIST_ID
          ? buildDefaultPlaylistTitle(queue)
          : details?.name?.trim() || "Список";
      const playlist = await createPlayList(title);
      const playlistId = playlist?.id;
      if (!playlistId) {
        sendProgress({ stage: "error", reason: "PLAYLIST_CREATE_FAILED" });
        return { error: "PLAYLIST_CREATE_FAILED" };
      }
      sendProgress({ stage: "playlistCreated", title });
      const items = queue
        .map((entry) => ({ id: entry?.id }))
        .filter((item) => item.id);
      if (!items.length) {
        sendProgress({ stage: "error", reason: "LIST_EMPTY" });
        return { error: "LIST_EMPTY" };
      }
      const total = items.length;
      sendProgress({ stage: "adding", total, added: 0 });
      const added = await addListToWL(playlistId, items, {
        onProgress: ({ added: current, status, reason, delayMs }) => {
          sendProgress({
            stage: "adding",
            total,
            added: current,
            status,
            reason,
            delayMs,
          });
        },
      });
      sendProgress({ stage: "finalizing", total, added });
      const url = `https://www.youtube.com/playlist?list=${playlistId}`;
      sendProgress({ stage: "done", total, added, url, title });
      return { playlistId, url, title, added, total, progressToken: token };
    } catch (err) {
      console.error("Failed to create YouTube playlist", err);
      const reason = extractPlaylistErrorReason(err);
      sendProgress({ stage: "error", reason });
      return { error: reason };
    }
  },

  async "playlist:importList"(message) {
    if (!message?.data) return { error: "data required" };
    return mutateAndPresent(
      () =>
        importList(message.data, {
          mode: message.mode === "append" ? "append" : "new",
          targetListId: message.targetListId || null,
        }),
      { dispatch: true, ensureDefault: true }
    );
  },
};
