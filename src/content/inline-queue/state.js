// Inline queue state manager. Fetches presentation state, tracks current queue data, and schedules UI refreshes.
import {
  ADD_BUTTON_CLASS,
  ADD_BUTTON_DONE_CLASS,
  CARD_MARK,
  inlinePlaylistState,
  sendMessage,
} from "../core/base.js";
import {
  syncVideoCardProgress as syncVideoCardProgressBase,
} from "../video-cards/progress.js";
import { normalizeProgressPercent } from "../../progress.js";

let pendingInlineRefresh = false;

function syncAllInlineButtons() {
  document
    .querySelectorAll(`.${ADD_BUTTON_CLASS}`)
    .forEach((button) => syncInlineButtonState(button));
}

function syncVideoCardProgress() {
  try {
    syncVideoCardProgressBase(document, CARD_MARK);
  } catch (err) {
    console.debug("Failed to sync card progress", err);
  }
}

function normalizePresentation(rawPresentation) {
  if (!rawPresentation || typeof rawPresentation !== "object") {
    return null;
  }
  let presentation = rawPresentation;
  if (
    !presentation.currentQueue &&
    presentation.state &&
    typeof presentation.state === "object"
  ) {
    presentation = presentation.state;
  }
  return presentation && typeof presentation === "object" ? presentation : null;
}

function scheduleInlinePlaylistRefresh(context) {
  if (pendingInlineRefresh) {
    return;
  }
  pendingInlineRefresh = true;
  window.setTimeout(async () => {
    try {
      await refreshInlinePlaylistState(context);
    } finally {
      pendingInlineRefresh = false;
    }
  }, 0);
}

// Keeps only the queue fields rendered in the content script. Membership and
// lookup structures are derived separately instead of storing another entry map.
function normalizeQueueEntries(queueEntries) {
  const normalizedEntries = [];
  const orderedIds = [];
  queueEntries.forEach((entry) => {
    if (!entry || typeof entry !== "object") {
      return;
    }
    const id = typeof entry.id === "string" ? entry.id : null;
    if (!id) {
      return;
    }
    orderedIds.push(id);
    const normalized = {
      id,
      title: entry.title || "",
      channelId: entry.channelId || "",
      channelTitle: entry.channelTitle || "",
      channelUrl:
        typeof entry.channelUrl === "string" && entry.channelUrl
          ? entry.channelUrl
          : null,
      thumbnail: entry.thumbnail || "",
      publishedAt: entry.publishedAt || null,
      duration: entry.duration ?? null,
      addedAt: entry.addedAt ?? null,
    };
    normalizedEntries.push(normalized);
  });
  return { normalizedEntries, orderedIds };
}

function buildProgressMap(presentation) {
  const progressEntries =
    presentation && typeof presentation === "object" && presentation.videoProgress
      ? presentation.videoProgress
      : null;
  const progressMap = new Map();
  if (progressEntries && typeof progressEntries === "object") {
    Object.entries(progressEntries).forEach(([id, entry]) => {
      if (typeof id !== "string" || !id) {
        return;
      }
      const percent = normalizeProgressPercent(entry);
      if (percent === null) {
        return;
      }
      const updatedAt = Number.isFinite(Number(entry?.updatedAt))
        ? Number(entry.updatedAt)
        : 0;
      progressMap.set(id, { percent, updatedAt });
    });
  }
  return progressMap;
}

// Converts the background presentation object into the compact content-side
// state used by card buttons, inline queue rendering, and player controls.
export function updateInlinePlaylistState(rawPresentation, context = {}) {
  const presentation = normalizePresentation(rawPresentation);
  if (!presentation) {
    return;
  }
  if (
    presentation.currentQueue &&
    !Array.isArray(presentation.currentQueue.queue)
  ) {
    scheduleInlinePlaylistRefresh(context);
    return;
  }
  const queueEntries = Array.isArray(presentation?.currentQueue?.queue)
    ? presentation.currentQueue.queue
    : [];
  const { normalizedEntries, orderedIds } = normalizeQueueEntries(queueEntries);
  const listId = presentation?.currentQueue?.id || presentation?.currentListId || null;
  const listFrozen = Boolean(presentation?.currentQueue?.freeze);
  const rawIndex = presentation?.currentQueue?.currentIndex;
  const normalizedIndex =
    Number.isInteger(rawIndex) && rawIndex >= 0 && rawIndex < orderedIds.length
      ? rawIndex
      : orderedIds.length
      ? 0
      : null;
  const historyLength = Array.isArray(presentation?.history)
    ? presentation.history.length
    : 0;
  const newSet = new Set(orderedIds);
  let changed =
    inlinePlaylistState.currentListId !== listId ||
    inlinePlaylistState.currentIndex !== normalizedIndex ||
    inlinePlaylistState.historyLength !== historyLength ||
    inlinePlaylistState.orderedVideoIds.length !== orderedIds.length;
  if (!changed) {
    for (let i = 0; i < orderedIds.length; i += 1) {
      if (inlinePlaylistState.orderedVideoIds[i] !== orderedIds[i]) {
        changed = true;
        break;
      }
    }
  }
  inlinePlaylistState.currentListId = listId;
  inlinePlaylistState.videoIds = newSet;
  inlinePlaylistState.orderedVideoIds = orderedIds;
  inlinePlaylistState.indexById = new Map(
    orderedIds.map((id, index) => [id, index])
  );
  inlinePlaylistState.currentIndex = normalizedIndex;
  inlinePlaylistState.historyLength = historyLength;
  inlinePlaylistState.freeze = listFrozen;
  inlinePlaylistState.queueEntries = normalizedEntries;
  const listsMeta = Array.isArray(presentation?.lists)
    ? presentation.lists
    : [];
  inlinePlaylistState.lists = listsMeta
    .map((list) => ({
      id: typeof list?.id === "string" ? list.id : null,
      name: typeof list?.name === "string" ? list.name : "",
      freeze: Boolean(list?.freeze),
      length:
        typeof list?.length === "number" && Number.isFinite(list.length)
          ? list.length
          : 0,
      revision:
        typeof list?.revision === "number" && Number.isFinite(list.revision)
          ? list.revision
          : 0,
    }))
    .filter((list) => list.id);
  inlinePlaylistState.currentListName =
    typeof presentation?.currentQueue?.name === "string"
      ? presentation.currentQueue.name
      : "";
  inlinePlaylistState.currentVideoId =
    typeof presentation?.currentVideoId === "string" && presentation.currentVideoId
      ? presentation.currentVideoId
      : null;
  inlinePlaylistState.progress = buildProgressMap(presentation);
  if (changed) {
    syncAllInlineButtons();
  }
  if (typeof context.syncVideoCardProgress === "function") {
    context.syncVideoCardProgress(document);
  } else {
    syncVideoCardProgress();
  }
  context.updatePlayerControlsUI?.();
  context.updateInlineQueueUI?.();
  context.updatePageActions?.();
  context.ensurePlaybackWatchdog?.();
}

export function isVideoInCurrentList(videoId) {
  if (!videoId) return false;
  return inlinePlaylistState.videoIds.has(videoId);
}

export function syncInlineButtonState(button) {
  if (!(button instanceof HTMLButtonElement)) {
    return;
  }
  const videoId = button.dataset.videoId;
  const playlistId = button.dataset.playlistId;
  const status = button.dataset.ytaStatus;
  if (!videoId) {
    if (status === "success" && playlistId) {
      button.classList.add(ADD_BUTTON_DONE_CLASS);
      button.disabled = true;
      return;
    }
    button.classList.remove(ADD_BUTTON_DONE_CLASS);
    if (status === "pending") {
      button.disabled = true;
      return;
    }
    if (!status || (status !== "pending" && status !== "success")) {
      delete button.dataset.ytaStatus;
    }
    button.disabled = false;
    return;
  }
  if (isVideoInCurrentList(videoId)) {
    button.classList.add(ADD_BUTTON_DONE_CLASS);
    button.dataset.ytaStatus = "present";
    button.disabled = true;
    return;
  }
  button.classList.remove(ADD_BUTTON_DONE_CLASS);
  if (button.dataset.ytaStatus === "pending") {
    button.disabled = true;
    return;
  }
  delete button.dataset.ytaStatus;
  button.disabled = false;
}

export async function refreshInlinePlaylistState(context = {}) {
  const presentation = await sendMessage("playlist:getState");
  if (presentation && typeof presentation === "object") {
    updateInlinePlaylistState(presentation, context);
  }
}
