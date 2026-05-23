// Injected index styles. Exports CSS text used by the content script for YouTube-page UI.
import { STYLE_ID } from "../core/base.js";
import { getInlineQueueItemStyles } from "./inline-queue-items.js";
import { getInlineQueueShellStyles } from "./inline-queue.js";
import { getPageActionStyles } from "./page-actions.js";
import { getPlaybackStyles } from "./playback.js";
import { getVideoCardStyles } from "./video-cards.js";

export function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `${getVideoCardStyles()}
  ${getPlaybackStyles()}
  ${getInlineQueueShellStyles()}
  ${getInlineQueueItemStyles()}
  ${getPageActionStyles()}`;
  document.head.appendChild(style);
}
