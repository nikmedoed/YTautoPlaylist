// Shared background service helpers. Contains mutation wrappers, add/remove/move flows, metadata lookup, playlist naming, and active-tab messaging.
import {
  addVideos,
  clearCurrentTab,
  DEFAULT_LIST_ID,
  getPresentationState,
  getState,
  moveVideoToList,
  removeVideos,
} from "../store/index.js";
import { parseVideoId } from "../utils.js";
import { formatStorageTimestamp } from "../time.js";
import { notifyState } from "./channel.js";
import { dispatchNotifications, ensureDefaultQueueFilled } from "./collectionSync.js";
import { fetchVideoEntries } from "./collector.js";

function normalizeVideoIdList(values) {
  const source = Array.isArray(values) ? values : [];
  return Array.from(
    new Set(
      source
        .map((value) => parseVideoId(value))
        .filter((id) => typeof id === "string" && id.length === 11)
    )
  );
}

function normalizeStringIdList(values) {
  const source = Array.isArray(values) ? values : [values];
  return Array.from(
    new Set(
      source
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter((value) => value.length > 0)
    )
  );
}

function resolveAddTargetListId(state, requestedListId) {
  const lists =
    state && typeof state === "object" && state.lists && typeof state.lists === "object"
      ? state.lists
      : {};
  if (requestedListId && lists[requestedListId]) {
    return requestedListId;
  }
  if (state?.currentListId && lists[state.currentListId]) {
    return state.currentListId;
  }
  if (lists[DEFAULT_LIST_ID]) {
    return DEFAULT_LIST_ID;
  }
  const ids = Object.keys(lists);
  return ids.length ? ids[0] : DEFAULT_LIST_ID;
}

function countAddedEntriesInQueue(nextState, listId, beforeState) {
  const previousIds = new Set(
    (beforeState?.lists?.[listId]?.queue || [])
      .map((entry) => (entry && typeof entry === "object" ? entry.id : null))
      .filter((id) => typeof id === "string" && id.length > 0)
  );
  const list = nextState?.lists?.[listId];
  const queue = Array.isArray(list?.queue) ? list.queue : [];
  let added = 0;
  for (const entry of queue) {
    const id =
      entry && typeof entry === "object" && typeof entry.id === "string"
        ? entry.id
        : null;
    if (id && !previousIds.has(id)) {
      added += 1;
    }
  }
  return added;
}

export async function applyMutation(mutator, options = {}) {
  const {
    notify = true,
    dispatch = false,
    ensureDefault = false,
  } = options;
  const result = await mutator();
  if (notify) {
    await notifyState();
  }
  if (dispatch) {
    await dispatchNotifications();
  }
  if (ensureDefault) {
    await ensureDefaultQueueFilled();
  }
  return result;
}

export async function mutateAndPresent(mutator, options = {}) {
  await applyMutation(mutator, options);
  return getPresentationState();
}

// Adds arbitrary queue entries, then returns the popup/content presentation
// shape expected by runtime message callers.
export async function addEntries(entries, listId = null, options = {}) {
  if (!Array.isArray(entries) || !entries.length) {
    return getPresentationState();
  }
  const { ensureDefault = true } = options;
  return mutateAndPresent(() => addVideos(entries, listId), {
    dispatch: true,
    ensureDefault,
  });
}

// Adds fetched YouTube metadata to the active list. Content scripts are not
// allowed to choose a list; popup/manager calls may pass an explicit listId.
export async function handleAddByIds(message, sender = null) {
  const uniqueIds = normalizeVideoIdList(message?.videoIds);
  if (!uniqueIds.length) {
    const state = await getPresentationState();
    return {
      state,
      requested: 0,
      fetched: 0,
      missing: 0,
      added: 0,
    };
  }
  const beforeState = await getState();
  const requestedListId = sender?.tab ? null : message?.listId || null;
  const targetListId = resolveAddTargetListId(beforeState, requestedListId);

  const entries = await fetchVideoEntries(uniqueIds);
  const fetchedIds = new Set(entries.map((entry) => entry?.id).filter(Boolean));
  const missing = uniqueIds.filter((id) => !fetchedIds.has(id)).length;
  const state = await addEntries(entries, targetListId, {
    ensureDefault: Boolean(message?.ensureDefault),
  });
  const added = countAddedEntriesInQueue(state, targetListId, beforeState);
  return {
    state,
    requested: uniqueIds.length,
    fetched: entries.length,
    missing,
    added,
  };
}

export async function handleRemoveVideos(videoIds, listId = null) {
  const filtered = normalizeStringIdList(videoIds);
  if (!filtered.length) {
    return getPresentationState();
  }
  return mutateAndPresent(
    () => removeVideos(filtered, { listId }),
    { dispatch: true, ensureDefault: true }
  );
}

export async function handleMoveVideos(videoIds, targetListId) {
  if (!targetListId) {
    return getPresentationState();
  }
  const ids = normalizeStringIdList(videoIds);
  if (!ids.length) {
    return getPresentationState();
  }
  return mutateAndPresent(
    async () => {
      for (const id of ids) {
        await moveVideoToList(id, targetListId);
      }
    },
    { dispatch: true, ensureDefault: true }
  );
}

export async function handleVideoMetadata(message) {
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

export function findVideoInState(state, videoId) {
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
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date;
}

export function buildDefaultPlaylistTitle(queue) {
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

export async function pingActivePlaybackTab(payload) {
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
    await clearCurrentTab(tabId);
    await notifyState();
    const updated = await getPresentationState();
    return { ok: false, reason: "TAB_UNREACHABLE", state: updated };
  }
}

export async function getTabPlaybackStatus(tabId) {
  const tabIdIsValid = typeof tabId === "number" && Number.isInteger(tabId);
  if (!tabIdIsValid) {
    return { ok: false, reason: "INVALID_TAB" };
  }
  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: "player:getPlaybackStatus",
    });
    if (!response || response.hasVideo === false) {
      return { ok: true, tabId, hasVideo: false, playing: false };
    }
    return {
      ok: true,
      tabId,
      hasVideo: true,
      playing: response.playing === true,
    };
  } catch (err) {
    return { ok: false, reason: "TAB_UNREACHABLE", tabId, error: err };
  }
}
