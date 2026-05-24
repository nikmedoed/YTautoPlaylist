// Video-card progress sync. Reads stored watch progress and updates card badges after playlist state changes.
import {
  inlinePlaylistState,
  THUMB_HOST_CLASS,
} from "../core/base.js";
import { getProgressPercent } from "../../progress.js";

const PROGRESS_ELEMENT_CLASS = "video-thumb__progress";
const PROGRESS_BAR_CLASS = "video-thumb__progress-bar";

export function applyCardProgress(card, videoId) {
  if (!(card instanceof HTMLElement)) {
    return;
  }
  const hostCandidate = card.querySelector(`.${THUMB_HOST_CLASS}`);
  const host = hostCandidate instanceof HTMLElement ? hostCandidate : card;
  const percent = getProgressPercent(inlinePlaylistState?.progress, videoId);
  let container = host.querySelector(`.${PROGRESS_ELEMENT_CLASS}`);
  if (!percent) {
    if (container) {
      container.remove();
    }
    return;
  }
  if (!container) {
    container = document.createElement("div");
    container.className = PROGRESS_ELEMENT_CLASS;
    const bar = document.createElement("div");
    bar.className = PROGRESS_BAR_CLASS;
    container.appendChild(bar);
    host.appendChild(container);
  }
  const barEl = container.querySelector(`.${PROGRESS_BAR_CLASS}`) || (() => {
    const bar = document.createElement("div");
    bar.className = PROGRESS_BAR_CLASS;
    container.appendChild(bar);
    return bar;
  })();
  barEl.style.width = `${percent}%`;
}

export function syncVideoCardProgress(root = document, cardMark) {
  const scope = root instanceof Document || root instanceof HTMLElement ? root : document;
  const cards = scope.querySelectorAll(
    `[${cardMark}][data-yta-target-type="video"]`
  );
  cards.forEach((card) => {
    const videoId = card.getAttribute("data-yta-target-id") || "";
    applyCardProgress(card, videoId);
  });
}
