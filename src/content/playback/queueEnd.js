// Queue end handling view. Displays end-of-queue state and related controls when playback has no next item.
import {
  DEFAULT_LIST_ID,
  inlinePlaylistState,
} from "../core/base.js";
import { showPlaybackNotification } from "./notification.js";

const VIDEO_END_MANUAL_ACTION_GUARD_MS = 2000;
const QUEUE_END_ANNOUNCE_WINDOW_MS = 45000;

const queueEndAnnouncement = {
  pending: false,
  queuedAt: 0,
  listId: null,
  listName: "",
  sourceVideoId: null,
  lastAnnouncedVideoId: null,
};

const userActionTracker = {
  lastAt: 0,
  bound: false,
};

export function recordUserAction() {
  userActionTracker.lastAt = Date.now();
}

export function ensureUserActionListeners() {
  if (userActionTracker.bound) {
    return;
  }
  document.addEventListener("pointerdown", recordUserAction, true);
  document.addEventListener("keydown", recordUserAction, true);
  userActionTracker.bound = true;
}

export function hasRecentUserAction(windowMs = VIDEO_END_MANUAL_ACTION_GUARD_MS) {
  if (!userActionTracker.lastAt) {
    return false;
  }
  return Date.now() - userActionTracker.lastAt <= windowMs;
}

function isAutoplayEnabled() {
  const toggle = document.querySelector(".ytp-autonav-toggle-button");
  if (!toggle) {
    return false;
  }
  const ariaPressed = toggle.getAttribute("aria-pressed");
  if (ariaPressed === "true") {
    return true;
  }
  if (ariaPressed === "false") {
    return false;
  }
  const ariaChecked = toggle.getAttribute("aria-checked");
  if (ariaChecked === "true") {
    return true;
  }
  if (ariaChecked === "false") {
    return false;
  }
  if (toggle.classList.contains("ytp-autonav-toggle-button-on")) {
    return true;
  }
  if (toggle.classList.contains("ytp-autonav-toggle-button-off")) {
    return false;
  }
  const label = (toggle.getAttribute("aria-label") || "").toLowerCase();
  if (label.includes("включ") || label.includes("on")) {
    return true;
  }
  if (label.includes("выключ") || label.includes("off")) {
    return false;
  }
  return false;
}

export function clearQueueEndAnnouncement() {
  queueEndAnnouncement.pending = false;
  queueEndAnnouncement.queuedAt = 0;
  queueEndAnnouncement.listId = null;
  queueEndAnnouncement.listName = "";
  queueEndAnnouncement.sourceVideoId = null;
}

export function queueQueueEndAnnouncement(presentation, options = {}) {
  if (!presentation || typeof presentation !== "object") {
    return false;
  }
  if (options.origin !== "auto") {
    return false;
  }
  const queue = Array.isArray(presentation?.currentQueue?.queue)
    ? presentation.currentQueue.queue
    : [];
  if (queue.length > 0) {
    return false;
  }
  if (presentation.currentVideoId) {
    return false;
  }
  const sourceVideoId =
    typeof options.sourceVideoId === "string" ? options.sourceVideoId : null;
  if (sourceVideoId) {
    const wasInList =
      inlinePlaylistState.videoIds?.has(sourceVideoId) ||
      inlinePlaylistState.currentVideoId === sourceVideoId;
    if (!wasInList) {
      return false;
    }
  }
  queueEndAnnouncement.pending = true;
  queueEndAnnouncement.queuedAt = Date.now();
  queueEndAnnouncement.listId =
    presentation?.currentQueue?.id || presentation?.currentListId || null;
  queueEndAnnouncement.listName =
    typeof presentation?.currentQueue?.name === "string"
      ? presentation.currentQueue.name.trim()
      : "";
  queueEndAnnouncement.sourceVideoId = sourceVideoId;
  return true;
}

function shouldShowQueueEndAnnouncement(videoId) {
  if (!queueEndAnnouncement.pending || !videoId) {
    return false;
  }
  if (queueEndAnnouncement.lastAnnouncedVideoId === videoId) {
    return false;
  }
  const now = Date.now();
  if (
    queueEndAnnouncement.queuedAt &&
    now - queueEndAnnouncement.queuedAt > QUEUE_END_ANNOUNCE_WINDOW_MS
  ) {
    clearQueueEndAnnouncement();
    return false;
  }
  if (userActionTracker.lastAt >= queueEndAnnouncement.queuedAt) {
    clearQueueEndAnnouncement();
    return false;
  }
  if (!isAutoplayEnabled()) {
    clearQueueEndAnnouncement();
    return false;
  }
  const inQueue =
    inlinePlaylistState.videoIds?.has(videoId) ||
    inlinePlaylistState.currentVideoId === videoId;
  if (inQueue) {
    return false;
  }
  return true;
}

export function maybeShowQueueEndAnnouncement(videoId) {
  if (!shouldShowQueueEndAnnouncement(videoId)) {
    return false;
  }
  const body = queueEndAnnouncement.listName
    ? `Очередь «${queueEndAnnouncement.listName}» пустая`
    : queueEndAnnouncement.listId && queueEndAnnouncement.listId !== DEFAULT_LIST_ID
    ? "Дополнительный список пустой"
    : "Очередь пустая";
  showPlaybackNotification({
    title: "Список закончился",
    body,
    duration: 6000,
  });
  queueEndAnnouncement.lastAnnouncedVideoId = videoId;
  clearQueueEndAnnouncement();
  return true;
}
