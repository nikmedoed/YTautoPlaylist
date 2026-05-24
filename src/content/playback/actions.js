// Content playback action bridge. Sends player and playlist commands between YouTube controls and the background service worker.
import {
  canHandlePlaybackActions,
  getCurrentVideoId,
  inlinePlaylistState,
  parseVideoId,
  sendMessage,
} from "../core/base.js";
import {
  clearQueueEndAnnouncement,
  queueQueueEndAnnouncement,
  recordUserAction,
} from "./queueEnd.js";

export function requestNext(context = {}) {
  if (!canHandlePlaybackActions()) return;
  const videoId = getCurrentVideoId();
  if (!videoId) return;
  recordUserAction();
  clearQueueEndAnnouncement();
  sendMessage("player:requestNext", { videoId }).then((resp) =>
    context.handlePlaybackAdvanceResponse?.(resp, {
      origin: "manual",
      sourceVideoId: videoId,
    })
  );
}

export function requestPrevious() {
  if (!canHandlePlaybackActions()) return;
  recordUserAction();
  clearQueueEndAnnouncement();
  sendMessage("player:requestPrevious", {
    videoId: getCurrentVideoId(),
  });
}

export function requestPostpone(context = {}) {
  if (!canHandlePlaybackActions()) return;
  const videoId = getCurrentVideoId();
  recordUserAction();
  clearQueueEndAnnouncement();
  sendMessage("player:requestPostpone", { videoId }).then((resp) =>
    context.handlePlaybackAdvanceResponse?.(resp, {
      origin: "manual",
      sourceVideoId: videoId,
    })
  );
}

export function requestStartPlayback(context = {}) {
  const queueIds = inlinePlaylistState.orderedVideoIds || [];
  if (!queueIds.length) return;
  const targetId = queueIds[0];
  if (!targetId) return;
  const payload = { videoId: targetId };
  if (inlinePlaylistState.currentListId) {
    payload.listId = inlinePlaylistState.currentListId;
  }
  recordUserAction();
  clearQueueEndAnnouncement();
  sendMessage("playlist:play", payload).then((presentation) => {
    if (presentation && typeof presentation === "object") {
      context.updateInlinePlaylistState?.(presentation);
    }
  });
}

export function navigateToVideoId(videoId) {
  const targetId = parseVideoId(videoId);
  if (!targetId) {
    return false;
  }
  let targetUrl = null;
  try {
    const base = window.location.origin || "https://www.youtube.com";
    const url = new URL("/watch", base);
    url.searchParams.set("v", targetId);
    targetUrl = url.toString();
  } catch (err) {
    targetUrl = `https://www.youtube.com/watch?v=${targetId}`;
  }
  if (!targetUrl) {
    return false;
  }
  if (parseVideoId(window.location.href) === targetId) {
    return true;
  }
  if (window.location.href === targetUrl) {
    return true;
  }
  try {
    window.location.assign(targetUrl);
    return true;
  } catch (assignError) {
    try {
      window.location.href = targetUrl;
      return true;
    } catch (hrefError) {
      console.warn("Failed to navigate to next video", hrefError);
    }
  }
  return false;
}

// Handles the fragile end-of-video path by choosing whether to advance, keep controls active, or show queue-end state.
export function recoverVideoEnded(videoId, context = {}) {
  if (!videoId) {
    return { handled: true };
  }
  const orderedIds = Array.isArray(inlinePlaylistState.orderedVideoIds)
    ? inlinePlaylistState.orderedVideoIds
    : [];
  if (!orderedIds.length) {
    const presentation = {
      currentListId: inlinePlaylistState.currentListId || null,
      currentQueue: {
        id: inlinePlaylistState.currentListId || null,
        name: inlinePlaylistState.currentListName || "",
        freeze: Boolean(inlinePlaylistState.freeze),
        queue: [],
        currentIndex: null,
      },
      currentVideoId: null,
      history: Array.from(
        { length: Math.max(Number(inlinePlaylistState.historyLength) || 0, 0) },
        () => ({ id: null })
      ),
      lists: Array.isArray(inlinePlaylistState.lists)
        ? inlinePlaylistState.lists.map((list) => ({ ...list }))
        : [],
    };
    context.updateInlinePlaylistState?.(presentation);
    queueQueueEndAnnouncement(presentation, {
      origin: "auto",
      sourceVideoId: videoId,
    });
    return { handled: false, state: presentation };
  }
  const listId = inlinePlaylistState.currentListId || null;
  if (!listId) {
    requestStartPlayback(context);
    return { handled: true };
  }
  const inQueue = orderedIds.includes(videoId);
  if (!inQueue) {
    requestStartPlayback(context);
    return { handled: true };
  }
  const knownCurrent =
    typeof inlinePlaylistState.currentVideoId === "string"
      ? inlinePlaylistState.currentVideoId
      : null;
  if (knownCurrent && knownCurrent !== videoId) {
    return { handled: true };
  }
  const queueEntries = Array.isArray(inlinePlaylistState.queueEntries)
    ? inlinePlaylistState.queueEntries
    : [];
  const remainingEntries = queueEntries.filter(
    (entry) => entry && entry.id && entry.id !== videoId
  );
  const remainingIds = orderedIds.filter((id) => id !== videoId);
  const previousIndex = orderedIds.indexOf(videoId);
  const nextIndex =
    remainingIds.length > 0
      ? Math.min(previousIndex, remainingIds.length - 1)
      : null;
  const nextId = nextIndex !== null ? remainingIds[nextIndex] : null;
  const historyLength = Math.max(Number(inlinePlaylistState.historyLength) || 0, 0) + 1;
  const historyEntries = Array.from({ length: historyLength }, (_, index) =>
    index === 0 ? { id: videoId } : { id: null }
  );
  const presentation = {
    currentListId: listId,
    currentQueue: {
      id: listId,
      name: inlinePlaylistState.currentListName || "",
      freeze: Boolean(inlinePlaylistState.freeze),
      queue: remainingEntries,
      currentIndex: nextIndex,
    },
    currentVideoId: nextId,
    history: historyEntries,
    lists: Array.isArray(inlinePlaylistState.lists)
      ? inlinePlaylistState.lists.map((list) => ({ ...list }))
      : [],
  };
  context.updateInlinePlaylistState?.(presentation);
  if (nextId) {
    const navigated = navigateToVideoId(nextId);
    if (!navigated) {
      console.warn("Failed to locally advance playback after disconnect");
    }
    return { handled: true, state: presentation };
  }
  queueQueueEndAnnouncement(presentation, {
    origin: "auto",
    sourceVideoId: videoId,
  });
  return { handled: false, state: presentation };
}
