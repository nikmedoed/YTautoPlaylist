import {
  addList,
  addVideos,
  exportList,
  getHistoryLimit,
  getNextQueueEntry,
  getPresentationState,
  getState,
  getListDetails,
  importList,
  moveAllVideos,
  moveVideoToList,
  removeList,
  removeVideo,
  renameList,
  reorderQueue,
  setCurrentList,
  setCurrentTab,
  setCurrentVideo,
  setListFreeze,
  suspendPlayback,
} from "../playlistStore.js";
import { parseVideoId } from "../utils.js";
import { notifyState } from "./channel.js";
import {
  collectAndAppendSubscriptions,
  dispatchNotifications,
  ensureDefaultQueueFilled,
} from "./stateSync.js";
import {
  fetchVideoEntries,
  requestVideoIdsFromActiveTab,
} from "./collector.js";
import { advanceToNext, playFromHistory, playVideo } from "./playback.js";

async function presentState() {
  return getPresentationState();
}

async function applyMutation(mutator, options = {}) {
  const {
    notify = true,
    dispatch = false,
    ensureDefault = false,
  } = options;
  const result = await mutator();
  if (notify) await notifyState();
  if (dispatch) await dispatchNotifications();
  if (ensureDefault) await ensureDefaultQueueFilled();
  return result;
}

async function mutateAndPresent(mutator, options = {}) {
  await applyMutation(mutator, options);
  return presentState();
}

async function addEntries(entries, listId = null) {
  if (!Array.isArray(entries) || !entries.length) {
    return presentState();
  }
  return mutateAndPresent(() => addVideos(entries, listId), {
    dispatch: true,
    ensureDefault: true,
  });
}

async function handleAddByIds(message) {
  const entries = await fetchVideoEntries(message.videoIds || []);
  return addEntries(entries, message.listId || null);
}

async function handleRemoveVideos(videoIds, listId = null) {
  const ids = Array.isArray(videoIds) ? videoIds : [videoIds];
  const filtered = ids.filter(Boolean);
  if (!filtered.length) {
    return presentState();
  }
  await applyMutation(
    async () => {
      for (const id of filtered) {
        await removeVideo(id, { listId });
      }
    },
    { notify: false }
  );
  await notifyState();
  await dispatchNotifications();
  await ensureDefaultQueueFilled();
  return presentState();
}

async function handleMoveVideos(videoIds, targetListId) {
  if (!targetListId) return presentState();
  const ids = Array.isArray(videoIds)
    ? Array.from(new Set(videoIds.filter(Boolean)))
    : [];
  if (!ids.length) return presentState();
  await applyMutation(
    async () => {
      for (const id of ids) {
        await moveVideoToList(id, targetListId);
      }
    },
    { notify: false }
  );
  await notifyState();
  await dispatchNotifications();
  await ensureDefaultQueueFilled();
  return presentState();
}

async function handleVideoMetadata(message) {
  const videoId = parseVideoId(message?.videoId);
  if (!videoId) {
    return { error: "Invalid video ID" };
  }
  try {
    const entries = await fetchVideoEntries([videoId]);
    if (!entries.length) {
      return { error: "Video not found" };
    }
    return entries[0];
  } catch (err) {
    return { error: err?.message || "Failed to load video info" };
  }
}

function findVideoInState(state, videoId) {
  for (const list of Object.values(state.lists || {})) {
    const idx = list.queue.findIndex((item) => item.id === videoId);
    if (idx !== -1) {
      return { list, index: idx };
    }
  }
  return null;
}

const handlers = {
  async "playlist:getState"() {
    return presentState();
  },
  async "playlist:setCurrentList"(message) {
    if (!message?.listId) return presentState();
    return mutateAndPresent(() => setCurrentList(message.listId));
  },
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
      return presentState();
    }
    return mutateAndPresent(() =>
      renameList(message.listId, message.name)
    );
  },
  async "playlist:setFreeze"(message) {
    if (!message?.listId) return presentState();
    return mutateAndPresent(() =>
      setListFreeze(message.listId, Boolean(message.freeze))
    );
  },
  async "playlist:removeList"(message) {
    if (!message?.listId) return presentState();
    return mutateAndPresent(
      () =>
        removeList(message.listId, {
          mode: message.mode === "discard" ? "delete" : "move",
        }),
      { dispatch: true }
    );
  },
  async "playlist:addByIds"(message) {
    return handleAddByIds(message);
  },
  async "playlist:addEntries"(message) {
    const entries = Array.isArray(message.entries) ? message.entries : [];
    return addEntries(entries, message.listId || null);
  },
  async "playlist:collectSubscriptions"() {
    const result = await collectAndAppendSubscriptions();
    const presentation = await presentState();
    return {
      ...result,
      state: presentation,
    };
  },
  async "playlist:remove"(message) {
    const ids = Array.isArray(message.videoIds)
      ? message.videoIds
      : [message.videoId];
    return handleRemoveVideos(ids, message.listId || null);
  },
  async "playlist:play"(message) {
    if (!message?.videoId) {
      return presentState();
    }
    await applyMutation(
      () => setCurrentVideo(message.videoId, message.listId || null),
      { dispatch: false }
    );
    await playVideo(message.videoId, {
      tabId: message.tabId,
      ensureCurrent: false,
    });
    return presentState();
  },
  async "playlist:playNext"(message) {
    return advanceToNext({
      tabId: message.tabId,
      videoId: message.videoId,
    });
  },
  async "playlist:playPrevious"(message) {
    const position =
      typeof message.position === "number" && Number.isInteger(message.position)
        ? message.position
        : 0;
    const placement =
      message.placement === "beforeCurrent" ? "beforeCurrent" : "front";
    return playFromHistory({
      position,
      tabId: message.tabId,
      placement,
    });
  },
  async "playlist:getNext"() {
    const state = await getState();
    return getNextQueueEntry(state);
  },
  async "playlist:getHistoryLimit"() {
    return { limit: getHistoryLimit() };
  },
  async "playlist:reorder"(message) {
    if (!message?.videoId) {
      return presentState();
    }
    return mutateAndPresent(() =>
      reorderQueue(
        message.videoId,
        message.targetIndex,
        message.listId || null
      )
    );
  },
  async "playlist:moveVideo"(message) {
    if (!message?.videoId || !message?.targetListId) {
      return presentState();
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
      return presentState();
    }
    return mutateAndPresent(
      () => moveAllVideos(message.sourceListId, message.targetListId),
      { dispatch: true, ensureDefault: true }
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
  async "collector:collect"(message) {
    return requestVideoIdsFromActiveTab(message.scope || "current");
  },
  async setStartDate(message) {
    if (message?.date) {
      try {
        const dt = new Date(message.date);
        if (!Number.isNaN(dt.getTime())) {
          await chrome.storage.sync.set({
            lastVideoDate: dt.toISOString(),
          });
        }
      } catch {
        /* ignore invalid date */
      }
    }
    return { ok: true };
  },
  async videoDate(message) {
    const info = await handleVideoMetadata(message);
    if (info.error) return info;
    if (info.publishedAt) {
      await chrome.storage.sync.set({ lastVideoDate: info.publishedAt });
    }
    return { date: info.publishedAt || null };
  },
  async videoInfo(message) {
    const info = await handleVideoMetadata(message);
    if (info.error) return info;
    return { info };
  },
  async getLogs() {
    return { logs: [] };
  },
  async "player:videoStarted"(message, sender) {
    const videoId = parseVideoId(message.videoId);
    if (!videoId) return { controlled: false };
    const state = await getState();
    const tabId = sender?.tab?.id;
    const located = findVideoInState(state, videoId);
    const inHistory = state.history.find((item) => item.id === videoId);
    if (!located && !inHistory) {
      if (state.activeListId) {
        await suspendPlayback();
        await notifyState();
      }
      return { controlled: false };
    }
    if (
      state.currentVideoId !== videoId ||
      state.activeListId !== located?.list?.id
    ) {
      await setCurrentVideo(videoId, located?.list?.id || null);
    }
    if (typeof tabId === "number") {
      await setCurrentTab(tabId);
    }
    await notifyState();
    return { controlled: true };
  },
  async "player:videoEnded"(message, sender) {
    const tabId = sender?.tab?.id;
    return advanceToNext({
      tabId,
      videoId: parseVideoId(message.videoId),
    });
  },
  async "player:requestNext"(message, sender) {
    const tabId = sender?.tab?.id;
    return advanceToNext({
      tabId,
      videoId: parseVideoId(message.videoId),
    });
  },
  async "player:requestPrevious"(message, sender) {
    const tabId = sender?.tab?.id;
    return playFromHistory({
      tabId,
      position: 0,
      placement: "beforeCurrent",
    });
  },
};

export function getHandler(type) {
  return handlers[type];
}
