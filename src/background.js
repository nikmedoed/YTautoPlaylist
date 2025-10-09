import {
  addList,
  addVideos,
  clearCurrentTab,
  clearPendingDefaultRefresh,
  consumePendingNotifications,
  exportList,
  getHistoryLimit,
  getNextQueueEntry,
  getPresentationState,
  getState,
  importList,
  getListDetails,
  moveAllVideos,
  markVideoWatched,
  moveVideoToList,
  playHistoryEntry,
  removeList,
  removeVideo,
  renameList,
  reorderQueue,
  setCurrentList,
  setCurrentTab,
  setCurrentVideo,
  setListFreeze,
  suspendPlayback,
  shouldAutoRefreshDefault,
  DEFAULT_LIST,
} from "./playlistStore.js";
import { getVideoInfo } from "./youTubeApiConnectors.js";
import { collectVideos } from "./playlist.js";
import { parseVideoId, storeDate } from "./utils.js";

// Avoid sending multiple prompts to the same handler
const MESSAGE_SOURCE = "background";
const MAX_API_BATCH = 50;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function buildWatchUrl(videoId) {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

function pickThumbnail(thumbnails) {
  if (!thumbnails) return "";
  return (
    thumbnails?.medium?.url ||
    thumbnails?.high?.url ||
    thumbnails?.standard?.url ||
    thumbnails?.maxres?.url ||
    thumbnails?.default?.url ||
    ""
  );
}

function toQueueEntry(video, overrides = {}) {
  const published =
    video.publishedAt instanceof Date
      ? video.publishedAt.toISOString()
      : typeof video.publishedAt === "string"
      ? video.publishedAt
      : null;
  return {
    id: video.id,
    title: video.title || "",
    channelId: video.channelId || "",
    channelTitle: video.channelTitle || "",
    thumbnail: overrides.thumbnail ?? pickThumbnail(video.thumbnails),
    publishedAt: published,
    duration: video.duration || null,
    addedAt: Date.now(),
  };
}

async function ensureTab(tabId) {
  if (typeof tabId !== "number" || !Number.isInteger(tabId)) return null;
  try {
    return await chrome.tabs.get(tabId);
  } catch (_) {
    return null;
  }
}

async function resolvePreferredTab(preferredIds = []) {
  for (const id of preferredIds) {
    const tab = await ensureTab(id);
    if (tab) return tab;
  }
  const [activeTab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });
  if (activeTab) return activeTab;
  return null;
}

async function notifyState() {
  try {
    const presentation = await getPresentationState();
    await chrome.runtime.sendMessage({
      source: MESSAGE_SOURCE,
      type: "playlist:stateUpdated",
      state: presentation,
    });
  } catch (err) {
    if (
      !err ||
      typeof err.message !== "string" ||
      !/receiving end/i.test(err.message)
    ) {
      console.warn("Failed to broadcast playlist state", err);
    }
  }
}

function sendCollectionProgress(event) {
  if (!event || typeof event !== "object") return;
  try {
    chrome.runtime.sendMessage({
      source: MESSAGE_SOURCE,
      type: "playlist:collectProgress",
      event,
    });
  } catch (err) {
    if (
      !err ||
      typeof err.message !== "string" ||
      !/receiving end/i.test(err.message)
    ) {
      console.warn("Failed to send collection progress", err);
    }
  }
}

async function dispatchNotifications() {
  const notifications = await consumePendingNotifications();
  if (!notifications || !notifications.length) return;
  for (const note of notifications) {
    if (note.type === "listEmpty") {
      const title = "Список закончился";
      const message = note.name
        ? `Очередь «${note.name}» пустая`
        : "Дополнительный список пустой";
      try {
        chrome.notifications.create(
          `yta_list_empty_${note.listId || Date.now()}`,
          {
            type: "basic",
            iconUrl: chrome.runtime.getURL("icon/icon.png"),
            title,
            message,
          }
        );
      } catch (err) {
        console.warn("Failed to show notification", err);
      }
    }
  }
}

let defaultAutoCollectRunning = false;
async function ensureDefaultQueueFilled() {
  if (defaultAutoCollectRunning) return;
  const needRefresh = await shouldAutoRefreshDefault();
  if (!needRefresh) return;
  defaultAutoCollectRunning = true;
  try {
    await clearPendingDefaultRefresh();
    await collectAndAppendSubscriptions();
  } catch (err) {
    console.error("Auto-collection failed", err);
  } finally {
    defaultAutoCollectRunning = false;
  }
}

async function openVideoInternal(videoId, options = {}) {
  const stateHint = options.stateHint || null;
  const preferred = [];
  if (typeof options.tabId === "number") preferred.push(options.tabId);
  if (
    stateHint &&
    typeof stateHint.currentTabId === "number" &&
    !preferred.includes(stateHint.currentTabId)
  ) {
    preferred.push(stateHint.currentTabId);
  }
  const targetTab = await resolvePreferredTab(preferred);
  const url = buildWatchUrl(videoId);
  let updatedTab = null;
  if (targetTab) {
    try {
      updatedTab = await chrome.tabs.update(targetTab.id, {
        url,
        active: true,
      });
    } catch (err) {
      console.warn("Failed to reuse tab, opening new one", err);
      updatedTab = null;
    }
  }
  if (!updatedTab) {
    updatedTab = await chrome.tabs.create({ url, active: true });
  }
  const stateWithTab = await setCurrentTab(updatedTab.id);
  return stateWithTab;
}

async function playVideo(videoId, options = {}) {
  let workingState = options.stateHint || null;
  if (options.ensureCurrent !== false) {
    workingState = await setCurrentVideo(videoId);
  } else if (!workingState) {
    workingState = await getState();
  }
  const finalState = await openVideoInternal(videoId, {
    tabId: options.tabId,
    stateHint: workingState,
  });
  await notifyState();
  return finalState;
}

async function advanceToNext(options = {}) {
  const before = await getState();
  const targetId = options.videoId || before.currentVideoId;
  const listId = before.activeListId || before.currentListId;
  if (!targetId) {
    const presentation = await getPresentationState();
    return { handled: false, state: presentation };
  }
  await markVideoWatched(targetId, { listId });
  await notifyState();
  await dispatchNotifications();
  await ensureDefaultQueueFilled();
  const afterPresentation = await getPresentationState();
  if (!afterPresentation.currentVideoId) {
    return { handled: false, state: afterPresentation };
  }
  await playVideo(afterPresentation.currentVideoId, {
    tabId: options.tabId || before.currentTabId,
    ensureCurrent: false,
  });
  const finalPresentation = await getPresentationState();
  return { handled: true, state: finalPresentation };
}

async function playFromHistory(options = {}) {
  await playHistoryEntry(options.position || 0, {
    placement: options.placement || "front",
  });
  await notifyState();
  await dispatchNotifications();
  const presentation = await getPresentationState();
  if (!presentation.currentVideoId) {
    return { handled: false, state: presentation };
  }
  await playVideo(presentation.currentVideoId, {
    tabId: options.tabId,
    ensureCurrent: false,
  });
  const finalPresentation = await getPresentationState();
  return { handled: true, state: finalPresentation };
}

async function fetchVideoMetadata(videoIds) {
  const ids = Array.from(
    new Set(
      videoIds
        .map(parseVideoId)
        .filter((id) => typeof id === "string" && id.length === 11)
    )
  );
  if (!ids.length) {
    return [];
  }
  const result = [];
  for (let i = 0; i < ids.length; i += MAX_API_BATCH) {
    const chunk = ids.slice(i, i + MAX_API_BATCH);
    const info = await getVideoInfo(chunk);
    const map = new Map();
    info.forEach((video) => {
      map.set(video.id, video);
    });
    chunk.forEach((id) => {
      const data = map.get(id);
      if (data) {
        result.push(
          toQueueEntry(data, { thumbnail: pickThumbnail(data.thumbnails) })
        );
      }
    });
  }
  return result;
}

async function addVideosByIds(videoIds) {
  const entries = await fetchVideoMetadata(videoIds);
  await addVideos(entries);
  await notifyState();
  await dispatchNotifications();
  await ensureDefaultQueueFilled();
  return await getPresentationState();
}

async function resolveCollectionStartDate() {
  const stored = await new Promise((resolve) => {
    chrome.storage.sync.get(["lastVideoDate"], (result) => resolve(result));
  });
  if (stored && stored.lastVideoDate) {
    const dt = new Date(stored.lastVideoDate);
    if (!Number.isNaN(dt.getTime())) {
      return dt;
    }
  }
  return new Date(Date.now() - WEEK_MS);
}

async function collectAndAppendSubscriptions() {
  const startDate = await resolveCollectionStartDate();
  sendCollectionProgress({
    phase: "start",
    startDate: startDate.toISOString(),
  });
  try {
    const videos = await collectVideos(startDate, (event) => {
      sendCollectionProgress(event);
    });
    const entries = videos.map((video) => toQueueEntry(video));
    sendCollectionProgress({
      phase: "readyToAdd",
      videoCount: entries.length,
    });
    const before = await getState();
    sendCollectionProgress({
      phase: "adding",
      addCount: entries.length,
      queueBefore:
        before.lists?.[DEFAULT_LIST]?.queue?.length || 0,
    });
    if (entries.length) {
      await addVideos(entries, DEFAULT_LIST);
    }
    if (videos.length) {
      const latest = videos[videos.length - 1].publishedAt;
      if (latest) {
        const dateObj =
          latest instanceof Date ? latest : new Date(latest);
        if (!Number.isNaN(dateObj.getTime())) {
          await storeDate(dateObj);
        }
      }
    }
    await notifyState();
    await dispatchNotifications();
    const after = await getState();
    const previousLength = before.lists?.[DEFAULT_LIST]?.queue?.length || 0;
    const newLength = after.lists?.[DEFAULT_LIST]?.queue?.length || 0;
    const added = Math.max(0, newLength - previousLength);
    sendCollectionProgress({
      phase: "complete",
      added,
      fetched: entries.length,
      queueLength: newLength,
    });
    return {
      added,
      fetched: entries.length,
      state: after,
    };
  } catch (err) {
    sendCollectionProgress({
      phase: "error",
      message: err?.message || "Не удалось собрать подписки",
    });
    throw err;
  }
}

async function handleCollectorRequest(scope) {
  const [activeTab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });
  if (!activeTab) {
    return { videoIds: [], error: "ACTIVE_TAB_NOT_FOUND" };
  }
  try {
    const response = await chrome.tabs.sendMessage(
      activeTab.id,
      {
        type: "collector:collect",
        scope,
      },
      { frameId: 0 }
    );
    if (!response || !Array.isArray(response.videoIds)) {
      return { videoIds: [], error: "NO_DATA" };
    }
    return { videoIds: response.videoIds, tabId: activeTab.id };
  } catch (err) {
    return {
      videoIds: [],
      error:
        err && typeof err.message === "string"
          ? err.message
          : "COLLECTOR_FAILED",
    };
  }
}

const handlers = {
  async "playlist:getState"() {
    return await getPresentationState();
  },
  async "playlist:setCurrentList"(message) {
    if (!message?.listId) return await getPresentationState();
    await setCurrentList(message.listId);
    await notifyState();
    return await getPresentationState();
  },
  async "playlist:createList"(message) {
    await addList({
      name: message?.name,
      freeze: Boolean(message?.freeze),
    });
    await notifyState();
    return await getPresentationState();
  },
  async "playlist:renameList"(message) {
    if (message?.listId && message?.name) {
      await renameList(message.listId, message.name);
      await notifyState();
    }
    return await getPresentationState();
  },
  async "playlist:setFreeze"(message) {
    if (message?.listId) {
      await setListFreeze(message.listId, Boolean(message.freeze));
      await notifyState();
    }
    return await getPresentationState();
  },
  async "playlist:removeList"(message) {
    if (message?.listId) {
      await removeList(message.listId, {
        mode: message.mode === "discard" ? "discard" : "move",
      });
      await notifyState();
      await dispatchNotifications();
    }
    return await getPresentationState();
  },
  async "playlist:addByIds"(message) {
    return await addVideosByIds(message.videoIds || []);
  },
  async "playlist:addEntries"(message) {
    const entries = Array.isArray(message.entries) ? message.entries : [];
    await addVideos(entries, message.listId || null);
    await notifyState();
    await dispatchNotifications();
    await ensureDefaultQueueFilled();
    return await getPresentationState();
  },
  async "playlist:collectSubscriptions"() {
    const result = await collectAndAppendSubscriptions();
    return {
      ...result,
      state: await getPresentationState(),
    };
  },
  async "playlist:remove"(message) {
    const ids = Array.isArray(message.videoIds)
      ? message.videoIds
      : [message.videoId];
    for (const id of ids.filter(Boolean)) {
      await removeVideo(id, { listId: message.listId || null });
    }
    await notifyState();
    await dispatchNotifications();
    await ensureDefaultQueueFilled();
    return await getPresentationState();
  },
  async "playlist:play"(message) {
    if (!message.videoId) {
      return await getPresentationState();
    }
    await setCurrentVideo(message.videoId, message.listId || null);
    await notifyState();
    await playVideo(message.videoId, {
      tabId: message.tabId,
      ensureCurrent: false,
    });
    return await getPresentationState();
  },
  async "playlist:playNext"(message) {
    return await advanceToNext({
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
    return await playFromHistory({
      position,
      tabId: message.tabId,
      placement,
    });
  },
  async "playlist:getNext"() {
    const state = await getState();
    return await getNextQueueEntry(state);
  },
  async "playlist:getHistoryLimit"() {
    return { limit: getHistoryLimit() };
  },
  async "playlist:reorder"(message) {
    if (!message?.videoId) {
      return await getPresentationState();
    }
    await reorderQueue(
      message.videoId,
      message.targetIndex,
      message.listId || null
    );
    await notifyState();
    return await getPresentationState();
  },
  async "playlist:moveVideo"(message) {
    if (!message?.videoId || !message?.targetListId) {
      return await getPresentationState();
    }
    await moveVideoToList(message.videoId, message.targetListId);
    await notifyState();
    await dispatchNotifications();
    await ensureDefaultQueueFilled();
    return await getPresentationState();
  },
  async "playlist:moveVideos"(message) {
    const targetListId = message?.targetListId;
    const ids = Array.isArray(message?.videoIds)
      ? Array.from(new Set(message.videoIds.filter(Boolean)))
      : [];
    if (!targetListId || !ids.length) {
      return await getPresentationState();
    }
    for (const videoId of ids) {
      await moveVideoToList(videoId, targetListId);
    }
    await notifyState();
    await dispatchNotifications();
    await ensureDefaultQueueFilled();
    return await getPresentationState();
  },
  async "playlist:moveAll"(message) {
    if (!message?.sourceListId || !message?.targetListId) {
      return await getPresentationState();
    }
    await moveAllVideos(message.sourceListId, message.targetListId);
    await notifyState();
    await dispatchNotifications();
    await ensureDefaultQueueFilled();
    return await getPresentationState();
  },
  async "playlist:getList"(message) {
    if (!message?.listId) return { error: "listId required" };
    return await getListDetails(message.listId);
  },
  async "playlist:exportList"(message) {
    if (!message?.listId) return { error: "listId required" };
    const data = await exportList(message.listId);
    return { data };
  },
  async "playlist:importList"(message) {
    if (!message?.data) return { error: "data required" };
    await importList(message.data, {
      mode: message.mode === "append" ? "append" : "new",
      targetListId: message.targetListId || null,
    });
    await notifyState();
    await dispatchNotifications();
    await ensureDefaultQueueFilled();
    return await getPresentationState();
  },
  async "collector:collect"(message) {
    return await handleCollectorRequest(message.scope || "current");
  },
  async setStartDate(message) {
    if (message?.date) {
      try {
        const dt = new Date(message.date);
        if (!Number.isNaN(dt.getTime())) {
          await chrome.storage.sync.set({ lastVideoDate: dt.toISOString() });
        }
      } catch (_) {
        /* ignore invalid date */
      }
    }
    return { ok: true };
  },
  async videoDate(message) {
    const videoId = parseVideoId(message?.videoId);
    if (!videoId) {
      return { error: "Invalid video ID" };
    }
    try {
      const info = await fetchVideoMetadata([videoId]);
      if (!info.length) {
        return { error: "Video not found" };
      }
      const publishedAt = info[0].publishedAt;
      if (publishedAt) {
        await chrome.storage.sync.set({ lastVideoDate: publishedAt });
      }
      return { date: publishedAt || null };
    } catch (err) {
      return { error: err?.message || "Failed to load video info" };
    }
  },
  async videoInfo(message) {
    const videoId = parseVideoId(message?.videoId);
    if (!videoId) {
      return { error: "Invalid video ID" };
    }
    try {
      const info = await fetchVideoMetadata([videoId]);
      if (!info.length) {
        return { error: "Video not found" };
      }
      return { info: info[0] };
    } catch (err) {
      return { error: err?.message || "Failed to load video info" };
    }
  },
  async getLogs() {
    return { logs: [] };
  },
  async "player:videoStarted"(message, sender) {
    const videoId = parseVideoId(message.videoId);
    if (!videoId) return { controlled: false };
    const state = await getState();
    const tabId = sender?.tab?.id;
    let located = null;
    for (const list of Object.values(state.lists || {})) {
      const idx = list.queue.findIndex((item) => item.id === videoId);
      if (idx !== -1) {
        located = { listId: list.id, index: idx };
        break;
      }
    }
    const inHistory = state.history.find((item) => item.id === videoId);
    if (!located && !inHistory) {
      if (state.activeListId) {
        await suspendPlayback();
        await notifyState();
      }
      return { controlled: false };
    }
    if (state.currentVideoId !== videoId || state.activeListId !== located?.listId) {
      await setCurrentVideo(videoId, located?.listId || null);
    }
    if (typeof tabId === "number") {
      await setCurrentTab(tabId);
    }
    await notifyState();
    return { controlled: true };
  },
  async "player:videoEnded"(message, sender) {
    const tabId = sender?.tab?.id;
    return await advanceToNext({
      tabId,
      videoId: parseVideoId(message.videoId),
    });
  },
  async "player:requestNext"(message, sender) {
    const tabId = sender?.tab?.id;
    return await advanceToNext({
      tabId,
      videoId: parseVideoId(message.videoId),
    });
  },
  async "player:requestPrevious"(message, sender) {
    const tabId = sender?.tab?.id;
    return await playFromHistory({
      tabId,
      position: 0,
      placement: "beforeCurrent",
    });
  },
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== "string") {
    return false;
  }
  if (message.source === MESSAGE_SOURCE) {
    return false;
  }
  const handler = handlers[message.type];
  if (!handler) {
    return false;
  }
  Promise.resolve(handler(message, sender))
    .then((result) => sendResponse(result))
    .catch((err) => {
      console.error("Message handler failed", message.type, err);
      sendResponse({
        error: err && err.message ? err.message : String(err),
      });
    });
  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  clearCurrentTab(tabId).then(() => notifyState());
});
