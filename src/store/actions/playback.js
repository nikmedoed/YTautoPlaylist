// Store actions for playback state. Contains current video/tab updates, progress recording, and playback suspension.
import { clampProgressPercent } from "../../progress.js";
import { getState, applyVideoProgress } from "../state/index.js";
import {
  findVideo,
  withState,
} from "./core.js";

export async function setCurrentVideo(videoId, listId = null) {
  if (!videoId) return getState();
  return withState((state) => {
    let targetList = listId ? state.lists[listId] : null;
    let index = -1;
    if (targetList) {
      index = targetList.queue.findIndex((item) => item.id === videoId);
    } else {
      const located = findVideo(state, videoId);
      if (located) {
        targetList = located.list;
        index = located.index;
      }
    }
    if (!targetList || index === -1) {
      return state;
    }
    targetList.currentIndex = index;
    state.currentListId = targetList.id;
    state.currentVideoId = videoId;
    return state;
  });
}

export async function suspendPlayback() {
  return withState((state) => {
    state.currentVideoId = null;
    return state;
  });
}

export async function setCurrentTab(tabId) {
  return withState((state) => {
    state.currentTabId =
      typeof tabId === "number" && Number.isInteger(tabId) ? tabId : null;
    return state;
  });
}

export async function clearCurrentTab(tabId) {
  return withState((state) => {
    if (state.currentTabId === tabId) {
      state.currentTabId = null;
    }
    return state;
  });
}

export async function recordVideoProgress(videoId, percent, options = {}) {
  const id = typeof videoId === "string" ? videoId.trim() : "";
  if (!id) {
    return false;
  }
  const clamped = clampProgressPercent(percent);
  if (clamped === null) {
    return false;
  }
  const timestampCandidate = Number(options.timestamp);
  const timestamp = Number.isFinite(timestampCandidate)
    ? Math.max(0, Math.trunc(timestampCandidate))
    : Date.now();
  const current = await getState();
  const existing =
    current?.videoProgress && typeof current.videoProgress === "object"
      ? current.videoProgress[id] || null
      : null;
  if (clamped <= 0 && !existing) {
    return false;
  }
  if (
    existing &&
    existing.percent === clamped &&
    timestamp <= (Number(existing.updatedAt) || 0)
  ) {
    return false;
  }
  let changed = false;
  await withState((state) => {
    changed = applyVideoProgress(state, id, clamped, { timestamp });
    return state;
  });
  return changed;
}
