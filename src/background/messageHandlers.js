import {
  addList,
  addVideos,
  exportList,
  getNextQueueEntry,
  getPresentationState,
  getState,
  getListDetails,
  getAutoCollectMeta,
  setAutoCollectStartDate,
  importList,
  moveAllVideos,
  moveVideoToList,
  removeList,
  removeVideos,
  postponeVideo,
  renameList,
  reorderQueue,
  restoreDeletedEntry,
  setCurrentList,
  setCurrentTab,
  setCurrentVideo,
  setListFreeze,
  suspendPlayback,
  clearCurrentTab,
  DEFAULT_LIST_ID,
  HISTORY_LIMIT,
  recordVideoProgress,
} from "../playlistStore.js";
import { addListToWL, createPlayList } from "../youTubeApiConnectors.js";
import { parseVideoId, parsePlaylistId } from "../utils.js";
import { formatStorageTimestamp } from "../time.js";
import { notifyState } from "./channel.js";
import {
  collectAndAppendSubscriptions,
  dispatchNotifications,
  ensureDefaultQueueFilled,
} from "./stateSync.js";
import {
  fetchVideoEntries,
  fetchPlaylistVideoIds,
  requestVideoIdsFromActiveTab,
} from "./collector.js";
import {
  advanceToNext,
  playFromHistory,
  playVideo,
  postponeCurrent,
} from "./playback.js";

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
  return getPresentationState();
}

async function addEntries(entries, listId = null, options = {}) {
  if (!Array.isArray(entries) || !entries.length) {
    return getPresentationState();
  }
  const { ensureDefault = true } = options;
  return mutateAndPresent(() => addVideos(entries, listId), {
    dispatch: true,
    ensureDefault,
  });
}

async function handleAddByIds(message) {
  const ids = Array.isArray(message.videoIds) ? message.videoIds : [];
  const uniqueIds = Array.from(
    new Set(
      ids
        .map((value) => parseVideoId(value))
        .filter((id) => typeof id === "string" && id.length === 11)
    )
  );
  const entries = await fetchVideoEntries(uniqueIds);
  const fetchedIds = new Set(entries.map((entry) => entry?.id).filter(Boolean));
  const missing = uniqueIds.filter((id) => !fetchedIds.has(id)).length;
  const state = await addEntries(entries, message.listId || null, {
    ensureDefault: Boolean(message?.ensureDefault),
  });
  return {
    state,
    requested: uniqueIds.length,
    fetched: entries.length,
    missing,
  };
}

async function handleRemoveVideos(videoIds, listId = null) {
  const ids = Array.isArray(videoIds) ? videoIds : [videoIds];
  const filtered = Array.from(
    new Set(
      ids
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter((id) => id.length > 0)
    )
  );
  if (!filtered.length) {
    return getPresentationState();
  }
  await applyMutation(
    () => removeVideos(filtered, { listId }),
    { notify: false }
  );
  await notifyState();
  await dispatchNotifications();
  await ensureDefaultQueueFilled();
  return getPresentationState();
}

async function handleMoveVideos(videoIds, targetListId) {
  if (!targetListId) return getPresentationState();
  const ids = Array.isArray(videoIds)
    ? Array.from(new Set(videoIds.filter(Boolean)))
    : [];
  if (!ids.length) return getPresentationState();
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
  return getPresentationState();
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
  if (!state || !state.lists || !videoId) {
    return null;
  }
  const currentListId = state.currentListId;
  if (currentListId && state.lists[currentListId]) {
    const list = state.lists[currentListId];
    const idx = list.queue.findIndex((item) => item.id === videoId);
    if (idx !== -1) {
      return { list, index: idx };
    }
  }
  for (const list of Object.values(state.lists)) {
    const idx = list.queue.findIndex((item) => item.id === videoId);
    if (idx !== -1) {
      return { list, index: idx };
    }
  }
  return null;
}

function coerceDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date;
}

function buildDefaultPlaylistTitle(queue) {
  let minTs = null;
  let maxTs = null;
  for (const entry of queue) {
    const date = coerceDate(entry?.publishedAt) || coerceDate(entry?.addedAt);
    if (!date) {
      continue;
    }
    const ts = date.getTime();
    if (minTs === null || ts < minTs) {
      minTs = ts;
    }
    if (maxTs === null || ts > maxTs) {
      maxTs = ts;
    }
  }
  if (minTs === null) {
    minTs = Date.now();
  }
  if (maxTs === null) {
    maxTs = minTs;
  }
  return `WL ${formatStorageTimestamp(minTs)} - ${formatStorageTimestamp(maxTs)}`;
}

async function pingActivePlaybackTab(payload) {
  const state = await getPresentationState();
  const tabId = state?.currentTabId;
  const tabIdIsValid = typeof tabId === "number" && Number.isInteger(tabId);
  if (!tabIdIsValid) {
    return { ok: false, reason: "NO_ACTIVE_TAB", state };
  }
  try {
    const response = await chrome.tabs.sendMessage(tabId, payload);
    return { ok: true, tabId, state, response };
  } catch (err) {
    console.warn("Failed to reach playback tab", err);
    if (tabIdIsValid) {
      await clearCurrentTab(tabId);
      await notifyState();
    }
    const updated = await getPresentationState();
    return { ok: false, reason: "TAB_UNREACHABLE", state: updated };
  }
}

const handlers = {
  async "subscriptions:getMeta"() {
    const meta = await getAutoCollectMeta();
    return { meta };
  },
  async "options:openQuickFilter"(message) {
    const videoId = parseVideoId(message?.videoId);
    if (!videoId) {
      return { error: "INVALID_VIDEO_ID" };
    }
    try {
      const base = chrome.runtime.getURL("src/settings/settings.html");
      const url = new URL(base);
      url.searchParams.set("quickFilterVideo", videoId);
      await chrome.tabs.create({ url: url.toString() });
      return { ok: true };
    } catch (err) {
      console.error("Failed to open quick filter page", err);
      return { error: err?.message || "FAILED_TO_OPEN_QUICK_FILTER" };
    }
  },
  async "options:openListSettings"(message) {
    const listId = typeof message?.listId === "string" ? message.listId.trim() : "";
    if (!listId) {
      return { error: "INVALID_LIST_ID" };
    }
    try {
      const base = chrome.runtime.getURL("src/popup/lists.html");
      const url = new URL(base);
      url.searchParams.set("listId", listId);
      const listName =
        typeof message?.listName === "string" ? message.listName.trim() : "";
      if (listName) {
        url.searchParams.set("listName", listName);
      }
      await chrome.tabs.create({ url: url.toString() });
      return { ok: true };
    } catch (err) {
      console.error("Failed to open list settings page", err);
      return { error: err?.message || "FAILED_TO_OPEN_LIST_SETTINGS" };
    }
  },
  async "playlist:getState"() {
    return getPresentationState();
  },
  async "playlist:setCurrentList"(message) {
    if (!message?.listId) return getPresentationState();
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
      return getPresentationState();
    }
    return mutateAndPresent(() =>
      renameList(message.listId, message.name)
    );
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
  async "playlist:addByIds"(message) {
    return handleAddByIds(message);
  },
  async "playlist:addPlaylist"(message) {
    const rawId =
      message?.playlistId || message?.id || message?.listId || message?.videoId;
    const playlistId = parsePlaylistId(rawId);
    if (!playlistId) {
      return {
        state: await getPresentationState(),
        requested: 0,
        fetched: 0,
        missing: 0,
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
        };
      }
      return handleAddByIds({ ...message, videoIds: ids, playlistId });
    } catch (err) {
      console.warn("Failed to add playlist", playlistId, err);
      return {
        state: await getPresentationState(),
        requested: 0,
        fetched: 0,
        missing: 0,
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
  async "playlist:collectSubscriptions"() {
    const meta = await getAutoCollectMeta();
    const nextRunAt = Number(meta?.nextAutoCollectAt) || 0;
    const now = Date.now();
    if (nextRunAt && nextRunAt > now) {
      const presentation = await getPresentationState();
      return {
        error: "ON_COOLDOWN",
        nextRunAt,
        remainingMs: nextRunAt - now,
        state: presentation,
      };
    }
    const result = await collectAndAppendSubscriptions({ origin: "manual" });
    if (result?.state) {
      return result;
    }
    const presentation = await getPresentationState();
    return { ...result, state: presentation };
  },
  async "playlist:remove"(message) {
    const ids = Array.isArray(message.videoIds)
      ? message.videoIds
      : [message.videoId];
    return handleRemoveVideos(ids, message.listId || null);
  },
  async "playlist:play"(message, sender) {
    if (!message?.videoId) {
      return getPresentationState();
    }
    const messageTabId =
      typeof message.tabId === "number" && Number.isInteger(message.tabId)
        ? message.tabId
        : undefined;
    const senderTabId = sender?.tab?.id;
    await applyMutation(
      () => setCurrentVideo(message.videoId, message.listId || null),
      { dispatch: false }
    );
    await playVideo(message.videoId, {
      tabId: messageTabId ?? senderTabId,
      ensureCurrent: false,
      forceNewTab: Boolean(message.forceNewTab),
      activate: message.activate,
    });
    return getPresentationState();
  },
  async "playlist:playNext"(message) {
    return advanceToNext({
      tabId: message.tabId,
      videoId: message.videoId,
    });
  },
  async "playlist:postpone"(message) {
    const videoId = message?.videoId ? parseVideoId(message.videoId) : undefined;
    return postponeCurrent({
      tabId: message.tabId,
      videoId,
    });
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
      reorderQueue(
        message.videoId,
        message.targetIndex,
        message.listId || null
      )
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
    const listId = message?.listId;
    if (!listId) {
      return { error: "listId required" };
    }

    const buildToken = () => {
      if (typeof crypto?.randomUUID === "function") {
        return crypto.randomUUID();
      }
      return `pl-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    };

    const token = buildToken();
    const sendProgress = (payload = {}) => {
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
            if (lastError && lastError.message !== "The message port closed before a response was received.") {
              console.debug("Playlist progress message error", lastError);
            }
          }
        );
      } catch (err) {
        console.debug("Failed to send playlist progress", err);
      }
    };

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
      const items = queue.map((entry) => ({ id: entry?.id })).filter((item) => item.id);
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
      const reason =
        err?.error?.error?.errors?.[0]?.reason ||
        err?.error?.errors?.[0]?.reason ||
        err?.error?.error?.message ||
        err?.error?.message ||
        err?.message ||
        "PLAYLIST_CREATE_FAILED";
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
  async "collector:collect"(message) {
    return requestVideoIdsFromActiveTab(message.scope || "current");
  },
  async setStartDate(message) {
    if (message?.date) {
      try {
        const dt = new Date(message.date);
        if (!Number.isNaN(dt.getTime())) {
          const meta = await setAutoCollectStartDate(dt);
          return { ok: true, lastRunAt: meta.lastRunAt };
        }
      } catch {
        /* ignore invalid date */
      }
    }
    const meta = await getAutoCollectMeta();
    return { ok: true, lastRunAt: meta.lastRunAt };
  },
  async videoDate(message) {
    const info = await handleVideoMetadata(message);
    if (info.error) return info;
    if (info.publishedAt) {
      await setAutoCollectStartDate(info.publishedAt);
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
    const isCurrentTab =
      typeof tabId === "number" && Number.isInteger(tabId)
        ? tabId === state.currentTabId
        : false;
    const located = findVideoInState(state, videoId);
    const inHistory = state.history.find((item) => item.id === videoId);
    if (!located && !inHistory) {
      if (isCurrentTab && state.currentListId && state.currentVideoId) {
        await suspendPlayback();
        const presentation = await notifyState();
        return { controlled: false, state: presentation };
      }
      const presentation = await getPresentationState();
      return { controlled: false, state: presentation };
    }
    const currentListId = state.currentListId;
    const lists = state.lists || {};
    const currentListExists =
      typeof currentListId === "string" && Boolean(lists[currentListId]);
    const locatedListId = located?.list?.id && lists[located.list.id]
      ? located.list.id
      : null;
    const shouldAdoptPlayback =
      locatedListId &&
      (locatedListId === currentListId || !currentListExists);
    if (shouldAdoptPlayback) {
      await setCurrentVideo(videoId, locatedListId);
      if (typeof tabId === "number") {
        await setCurrentTab(tabId);
      }
      const presentation = await notifyState();
      return { controlled: true, state: presentation };
    }
    let presentation = null;
    if (state.currentVideoId) {
      await suspendPlayback();
      presentation = await notifyState();
    } else {
      presentation = await getPresentationState();
    }
    return { controlled: false, state: presentation };
  },
  async "player:progress"(message) {
    const videoId = parseVideoId(message.videoId);
    if (!videoId) {
      return { ok: false, reason: "INVALID_VIDEO" };
    }
    const percent = Number(message.percent);
    if (!Number.isFinite(percent)) {
      return { ok: false, reason: "INVALID_PERCENT" };
    }
    const timestamp = Number.isFinite(Number(message.timestamp))
      ? Number(message.timestamp)
      : Date.now();
    const changed = await recordVideoProgress(videoId, percent, { timestamp });
    if (changed) {
      await notifyState();
    }
    return { ok: true, changed };
  },
  async "player:videoEnded"(message, sender) {
    const tabId = sender?.tab?.id;
    return advanceToNext({
      tabId,
      videoId: parseVideoId(message.videoId),
    });
  },
  async "player:videoUnavailable"(message, sender) {
    const tabId = sender?.tab?.id;
    const videoId = parseVideoId(message.videoId);
    if (!videoId) {
      return { handled: false, reason: "NO_VIDEO" };
    }
    const state = await getState();
    const located = findVideoInState(state, videoId);
    if (!located) {
      return {
        handled: false,
        reason: "NOT_IN_QUEUE",
        state: await getPresentationState(),
      };
    }
    const reason =
      typeof message.reason === "string" && message.reason.trim()
        ? message.reason.trim()
        : null;
    if (reason) {
      console.warn("Video unavailable, skipping", videoId, reason);
    } else {
      console.warn("Video unavailable, skipping", videoId);
    }
    if (state.currentVideoId !== videoId) {
      const presentation = await handleRemoveVideos([videoId], located.list?.id || null);
      return { handled: true, skipped: true, state: presentation };
    }
    const response = await advanceToNext({
      tabId,
      videoId,
    });
    return { ...response, skipped: true };
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
  async "player:requestPostpone"(message, sender) {
    const tabId = sender?.tab?.id;
    return postponeCurrent({
      tabId,
      videoId: parseVideoId(message.videoId),
    });
  },
  async "player:getPlaybackStatus"() {
    const result = await pingActivePlaybackTab({ type: "player:getPlaybackStatus" });
    if (!result.ok) {
      return { active: false, playing: false, reason: result.reason };
    }
    const response = result.response || {};
    if (!response || response.hasVideo === false) {
      await clearCurrentTab(result.tabId);
      await notifyState();
      return { active: false, playing: false, reason: "NO_VIDEO" };
    }
    return { active: true, playing: response.playing === true };
  },
  async "player:togglePlayback"(message) {
    const result = await pingActivePlaybackTab({
      type: "player:togglePlayback",
      mode: message?.mode || message?.action || "toggle",
    });
    if (!result.ok) {
      return { handled: false, reason: result.reason };
    }
    const response = result.response || {};
    if (!response || response.hasVideo === false) {
      await clearCurrentTab(result.tabId);
      await notifyState();
      return { handled: false, reason: "NO_VIDEO" };
    }
    return {
      handled: response.handled !== false,
      playing: response.playing === true,
    };
  },
};

export function getHandler(type) {
  return handlers[type];
}
