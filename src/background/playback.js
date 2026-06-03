// Background playback coordinator. Contains tab selection, YouTube navigation, queue advancement, history playback, and postpone behavior.
import {
  getPresentationState,
  getState,
  markVideoWatched,
  postponeVideo,
  playHistoryEntry,
  setCurrentTab,
  setCurrentVideo,
} from "../store/index.js";
import { parseVideoId } from "../utils.js";
import { notifyState } from "./channel.js";
import { dispatchNotifications, ensureDefaultQueueFilled } from "./collectionSync.js";

function buildWatchUrl(videoId) {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

function extractTabUrl(tab) {
  if (!tab || typeof tab !== "object") {
    return null;
  }
  if (typeof tab.url === "string" && tab.url) {
    return tab.url;
  }
  if (typeof tab.pendingUrl === "string" && tab.pendingUrl) {
    return tab.pendingUrl;
  }
  return null;
}

function isYouTubeUrl(url) {
  if (typeof url !== "string" || !url) {
    return false;
  }
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host === "youtu.be" || host === "www.youtu.be") {
      return true;
    }
    return host === "youtube.com" || host.endsWith(".youtube.com");
  } catch {
    return false;
  }
}

function isSameVideoInTab(tab, videoId) {
  const currentId = parseVideoId(extractTabUrl(tab));
  return Boolean(currentId && currentId === videoId);
}

async function ensureTab(tabId) {
  if (typeof tabId !== "number" || !Number.isInteger(tabId)) return null;
  try {
    return await chrome.tabs.get(tabId);
  } catch {
    return null;
  }
}

async function resolvePreferredTab(preferredIds = []) {
  for (const id of preferredIds) {
    const tab = await ensureTab(id);
    if (tab) return tab;
  }
  return null;
}

function findVideoLocation(state, videoId) {
  if (!state || !videoId || !state.lists) {
    return null;
  }
  for (const [listId, list] of Object.entries(state.lists)) {
    const queue = Array.isArray(list?.queue) ? list.queue : [];
    const index = queue.findIndex((entry) => entry?.id === videoId);
    if (index !== -1) {
      return { listId, index };
    }
  }
  return null;
}

// Opens or reuses a YouTube tab, records playback ownership, and avoids
// navigating when the chosen tab is already on the requested video.
async function openVideo(videoId, options = {}) {
  const stateHint = options.stateHint || null;
  const forceNewTab = Boolean(options.forceNewTab);
  const activate = options.activate !== false;
  const url = buildWatchUrl(videoId);
  let targetTab = null;
  if (!forceNewTab) {
    const preferred = [];
    if (typeof options.tabId === "number") preferred.push(options.tabId);
    if (
      stateHint &&
      typeof stateHint.currentTabId === "number" &&
      !preferred.includes(stateHint.currentTabId)
    ) {
      preferred.push(stateHint.currentTabId);
    }
    const resolved = await resolvePreferredTab(preferred);
    if (resolved) {
      try {
        if (isSameVideoInTab(resolved, videoId)) {
          targetTab = activate
            ? await chrome.tabs.update(resolved.id, { active: true })
            : resolved;
        } else {
          targetTab = await chrome.tabs.update(resolved.id, {
            url,
            active: activate,
          });
        }
      } catch (err) {
        console.warn("Failed to reuse tab, opening new one", err);
        targetTab = null;
      }
    }
  }
  if (!targetTab && !forceNewTab) {
    try {
      const [activeTab] = await chrome.tabs.query({
        active: true,
        lastFocusedWindow: true,
      });
      if (activeTab && isYouTubeUrl(extractTabUrl(activeTab))) {
        try {
          if (isSameVideoInTab(activeTab, videoId)) {
            targetTab = activate
              ? await chrome.tabs.update(activeTab.id, { active: true })
              : activeTab;
          } else {
            targetTab = await chrome.tabs.update(activeTab.id, {
              url,
              active: activate,
            });
          }
        } catch (err) {
          console.warn("Failed to reuse active YouTube tab", err);
          targetTab = null;
        }
      }
    } catch (err) {
      console.warn("Failed to query active tab", err);
    }
  }
  if (!targetTab) {
    targetTab = await chrome.tabs.create({ url, active: activate });
  }
  if (activate && targetTab?.windowId) {
    try {
      await chrome.windows.update(targetTab.windowId, { focused: true });
    } catch (err) {
      console.warn("Failed to focus window", err);
    }
  }
  await setCurrentTab(targetTab.id);
  return targetTab;
}

async function selectPreviousFromQueue(stateHint = null) {
  const workingState = stateHint || (await getState());
  if (!workingState || typeof workingState !== "object") {
    return null;
  }
  const lists = workingState.lists || {};
  const candidateIds = [];
  if (workingState.currentListId && lists[workingState.currentListId]) {
    candidateIds.push(workingState.currentListId);
  }
  for (const id of Object.keys(lists)) {
    if (!candidateIds.includes(id)) {
      candidateIds.push(id);
    }
  }
  for (const id of candidateIds) {
    const list = lists[id];
    if (!list || !Array.isArray(list.queue) || list.queue.length === 0) {
      continue;
    }
    let currentIndex =
      typeof list.currentIndex === "number" &&
      list.currentIndex >= 0 &&
      list.currentIndex < list.queue.length
        ? list.currentIndex
        : null;
    if (currentIndex === null && workingState.currentVideoId) {
      const locatedIndex = list.queue.findIndex(
        (entry) => entry?.id === workingState.currentVideoId
      );
      if (locatedIndex !== -1) {
        currentIndex = locatedIndex;
      }
    }
    if (currentIndex === null || currentIndex <= 0) {
      continue;
    }
    const previousEntry = list.queue[currentIndex - 1];
    if (!previousEntry || !previousEntry.id) {
      continue;
    }
    await setCurrentVideo(previousEntry.id, list.id);
    return previousEntry.id;
  }
  return null;
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
    forceNewTab: options.forceNewTab,
    activate: options.activate,
  });
  await notifyState();
  return workingState ? workingState : await getState();
}

export async function advanceToNext(options = {}) {
  const before = await getState();
  const requestedId = options.videoId || null;
  const currentId = before.currentVideoId || null;
  let targetId = currentId || requestedId;
  let listId = before.currentListId || null;
  const senderTabMatchesCurrent =
    typeof options.tabId === "number" &&
    Number.isInteger(options.tabId) &&
    options.tabId === before.currentTabId;

  if (requestedId && requestedId !== currentId) {
    const requestedLocation = findVideoLocation(before, requestedId);
    if (!requestedLocation) {
      if (!currentId || !senderTabMatchesCurrent) {
        return {
          handled: false,
          reason: "VIDEO_MISMATCH",
          state: await getPresentationState(),
        };
      }
    } else {
      await setCurrentVideo(requestedId, requestedLocation.listId);
      targetId = requestedId;
      listId = requestedLocation.listId;
    }
  }

  if (!targetId) {
    const presentation = await getPresentationState();
    return { handled: false, state: presentation };
  }

  const currentLocation = findVideoLocation(before, targetId);
  if (!currentLocation) {
    return {
      handled: false,
      reason: "TARGET_NOT_IN_QUEUE",
      state: await getPresentationState(),
    };
  }
  if (!listId) {
    listId = currentLocation.listId;
  }

  await markVideoWatched(targetId, { listId });
  await notifyState();
  await dispatchNotifications();
  const afterPresentation = await getPresentationState();
  if (!afterPresentation.currentVideoId || afterPresentation.currentVideoId === targetId) {
    return { handled: false, state: afterPresentation };
  }
  ensureDefaultQueueFilled().catch((err) => {
    console.error("Auto collection after advancing failed", err);
  });
  await playVideo(afterPresentation.currentVideoId, {
    tabId: options.tabId || before.currentTabId,
    ensureCurrent: false,
  });
  const finalPresentation = await getPresentationState();
  return { handled: true, state: finalPresentation };
}

export async function playFromHistory(options = {}) {
  const initialState = await getState();
  const hasHistory = Array.isArray(initialState?.history)
    ? initialState.history.length > 0
    : false;
  if (hasHistory) {
    await playHistoryEntry(options.position || 0, {
      placement: options.placement || "front",
    });
  } else {
    const fallbackId = await selectPreviousFromQueue(initialState);
    if (!fallbackId) {
      const presentation = await getPresentationState();
      return { handled: false, state: presentation };
    }
  }
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

export async function postponeCurrent(options = {}) {
  const requestedId = options.videoId || null;
  let workingState = await getState();

  if (requestedId && workingState.currentVideoId !== requestedId) {
    const updated = await setCurrentVideo(requestedId);
    workingState = updated || (await getState());
    if (workingState.currentVideoId !== requestedId) {
      const presentation = await getPresentationState();
      return { handled: false, state: presentation };
    }
  }

  if (
    typeof options.tabId === "number" &&
    workingState.currentTabId !== options.tabId
  ) {
    workingState = await setCurrentTab(options.tabId);
  }

  const targetId = requestedId || workingState.currentVideoId;
  if (!targetId) {
    const presentation = await getPresentationState();
    return { handled: false, state: presentation };
  }

  const currentList =
    workingState?.currentListId && workingState?.lists
      ? workingState.lists[workingState.currentListId]
      : null;
  if (currentList?.freeze) {
    const presentation = await getPresentationState();
    return { handled: false, state: presentation };
  }

  const previousCurrentId = workingState.currentVideoId;
  await postponeVideo(targetId, { listId: workingState.currentListId });
  await notifyState();
  await dispatchNotifications();
  await ensureDefaultQueueFilled();
  const afterPresentation = await getPresentationState();
  const nextId = afterPresentation.currentVideoId;
  if (!nextId || nextId === previousCurrentId) {
    return { handled: false, state: afterPresentation };
  }
  await playVideo(nextId, {
    tabId:
      typeof options.tabId === "number"
        ? options.tabId
        : workingState.currentTabId,
    ensureCurrent: false,
  });
  const finalPresentation = await getPresentationState();
  return { handled: true, state: finalPresentation };
}
