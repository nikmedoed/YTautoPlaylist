// Playback notification view. Shows transient content-side feedback for queue playback actions.
import {
  determinePageContext,
  playbackNotification,
} from "../core/base.js";

const PLAYBACK_NOTIFICATION_DURATION = 8000;

function ensurePlaybackNotificationElements() {
  if (playbackNotification.container) {
    if (!document.contains(playbackNotification.container)) {
      document.body.appendChild(playbackNotification.container);
    }
    return playbackNotification.container;
  }
  if (!document.body) {
    return null;
  }
  const container = document.createElement("div");
  container.className = "yta-playback-notification";
  container.setAttribute("role", "status");
  container.setAttribute("aria-live", "polite");
  const content = document.createElement("div");
  content.className = "yta-playback-notification__content";
  const title = document.createElement("div");
  title.className = "yta-playback-notification__title";
  const body = document.createElement("div");
  body.className = "yta-playback-notification__body";
  content.append(title, body);
  container.append(content);
  container.addEventListener("click", () => hidePlaybackNotification(true));
  document.body.appendChild(container);
  playbackNotification.container = container;
  playbackNotification.title = title;
  playbackNotification.body = body;
  return container;
}

export function hidePlaybackNotification(immediate = false) {
  if (playbackNotification.timeout) {
    window.clearTimeout(playbackNotification.timeout);
    playbackNotification.timeout = null;
  }
  const container = playbackNotification.container;
  if (!container) {
    return;
  }
  container.dataset.visible = "0";
  const teardown = () => {
    if (playbackNotification.container === container) {
      container.remove();
      playbackNotification.container = null;
      playbackNotification.title = null;
      playbackNotification.body = null;
    }
  };
  if (immediate) {
    teardown();
  } else {
    window.setTimeout(teardown, 250);
  }
}

export function showPlaybackNotification({ title, body, duration, persist } = {}) {
  if (determinePageContext() !== "watch") {
    return;
  }
  const container = ensurePlaybackNotificationElements();
  if (!container) {
    return;
  }
  const resolvedTitle = title && String(title).trim()
    ? String(title).trim()
    : "Список закончился";
  const resolvedBody = body && String(body).trim()
    ? String(body).trim()
    : "Очередь пустая";
  if (playbackNotification.title) {
    playbackNotification.title.textContent = resolvedTitle;
  }
  if (playbackNotification.body) {
    playbackNotification.body.textContent = resolvedBody;
  }
  container.dataset.visible = "1";
  if (playbackNotification.timeout) {
    window.clearTimeout(playbackNotification.timeout);
  }
  if (persist) {
    playbackNotification.timeout = null;
    return;
  }
  const timeout = Math.max(2000, Number(duration) || PLAYBACK_NOTIFICATION_DURATION);
  playbackNotification.timeout = window.setTimeout(() => {
    hidePlaybackNotification();
  }, timeout);
}
