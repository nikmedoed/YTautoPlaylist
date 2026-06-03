// Background playback message handlers. Contains play, next, previous, postpone, progress, tab ownership, and player status responses.
import {
  clearCurrentTab,
  getPresentationState,
  getState,
  recordVideoProgress,
  setCurrentTab,
  setCurrentVideo,
  suspendPlayback,
} from "../../store/index.js";
import { parseVideoId } from "../../utils.js";
import { notifyState } from "../channel.js";
import {
  advanceToNext,
  playFromHistory,
  playVideo,
  postponeCurrent,
} from "../playback.js";
import {
  applyMutation,
  findVideoInState,
  getTabPlaybackStatus,
  handleRemoveVideos,
  pingActivePlaybackTab,
} from "../services.js";

async function rejectInvalidVideo() {
  return {
    handled: false,
    reason: "INVALID_VIDEO",
    state: await getPresentationState(),
  };
}

// Playback message handlers coordinate queue state with the owning YouTube tab.
// Tab ownership checks are intentionally local here because they decide whether
// content-script playback events should control the extension queue.
export const playbackHandlers = {
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
    const videoId = parseVideoId(message?.videoId);
    if (!videoId) {
      return rejectInvalidVideo();
    }
    return advanceToNext({
      tabId: message.tabId,
      videoId,
    });
  },

  async "playlist:postpone"(message) {
    const videoId = message?.videoId ? parseVideoId(message.videoId) : undefined;
    return postponeCurrent({
      tabId: message.tabId,
      videoId,
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

  async "player:videoStarted"(message, sender) {
    // A YouTube tab reports playback start here. The handler either adopts that
    // tab as the active queue player or rejects it if another tab owns playback.
    const videoId = parseVideoId(message.videoId);
    if (!videoId) return { controlled: false };
    let state = await getState();
    const tabId = sender?.tab?.id;
    const hasSenderTabId = typeof tabId === "number" && Number.isInteger(tabId);
    const hasCurrentTabId =
      typeof state.currentTabId === "number" &&
      Number.isInteger(state.currentTabId);
    if (hasSenderTabId && hasCurrentTabId && tabId !== state.currentTabId) {
      const activeStatus = await getTabPlaybackStatus(state.currentTabId);
      if (!activeStatus.ok || !activeStatus.hasVideo) {
        await clearCurrentTab(state.currentTabId);
        await notifyState();
        state = await getState();
      } else if (state.currentVideoId) {
        return {
          controlled: false,
          reason: "OTHER_TAB_OWNS_PLAYBACK",
          state: await getPresentationState(),
        };
      } else if (activeStatus.playing) {
        return {
          controlled: false,
          reason: "OTHER_TAB_PLAYING",
          state: await getPresentationState(),
        };
      }
    }
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
    const locatedListId =
      located?.list?.id && lists[located.list.id] ? located.list.id : null;
    const shouldAdoptPlayback =
      locatedListId &&
      (isCurrentTab ||
        !hasCurrentTabId ||
        !state.currentVideoId ||
        locatedListId === currentListId ||
        !currentListExists);
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
    // End events can race between tabs, so re-check ownership before advancing.
    const videoId = parseVideoId(message.videoId);
    if (!videoId) {
      return rejectInvalidVideo();
    }
    const tabId = sender?.tab?.id;
    let state = await getState();
    const hasSenderTabId = typeof tabId === "number" && Number.isInteger(tabId);
    const hasCurrentTabId =
      typeof state?.currentTabId === "number" &&
      Number.isInteger(state.currentTabId);
    if (hasSenderTabId && hasCurrentTabId && state.currentTabId !== tabId) {
      const activeStatus = await getTabPlaybackStatus(state.currentTabId);
      if (!activeStatus.ok || !activeStatus.hasVideo) {
        await clearCurrentTab(state.currentTabId);
        await setCurrentTab(tabId);
        await notifyState();
        state = await getState();
      } else if (activeStatus.playing) {
        return {
          handled: false,
          reason: "OTHER_TAB_OWNS_PLAYBACK",
          state: await getPresentationState(),
        };
      }
    }
    return advanceToNext({
      tabId,
      videoId,
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
      const presentation = await handleRemoveVideos(
        [videoId],
        located.list?.id || null
      );
      return { handled: true, skipped: true, state: presentation };
    }
    const response = await advanceToNext({
      tabId,
      videoId,
    });
    return { ...response, skipped: true };
  },

  async "player:requestNext"(message, sender) {
    const videoId = parseVideoId(message.videoId);
    if (!videoId) {
      return rejectInvalidVideo();
    }
    const tabId = sender?.tab?.id;
    return advanceToNext({
      tabId,
      videoId,
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
    const result = await pingActivePlaybackTab({
      type: "player:getPlaybackStatus",
    });
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
