import {
  getPresentationState,
  getState,
  markVideoWatched,
  playHistoryEntry,
  setCurrentTab,
  setCurrentVideo,
} from "../playlistStore.js";
import { resolvePreferredTab } from "./chromeTabs.js";
import { notifyState } from "./channel.js";
import { dispatchNotifications, ensureDefaultQueueFilled } from "./stateSync.js";

function buildWatchUrl(videoId) {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

async function openVideo(videoId, options = {}) {
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
  await setCurrentTab(updatedTab.id);
}

export async function playVideo(videoId, options = {}) {
  let workingState = options.stateHint || null;
  if (options.ensureCurrent !== false) {
    workingState = await setCurrentVideo(videoId);
  } else if (!workingState) {
    workingState = await getState();
  }
  await openVideo(videoId, {
    tabId: options.tabId,
    stateHint: workingState,
  });
  await notifyState();
  return workingState ? workingState : await getState();
}

export async function advanceToNext(options = {}) {
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

export async function playFromHistory(options = {}) {
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
