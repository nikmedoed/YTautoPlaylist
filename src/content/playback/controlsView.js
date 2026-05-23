// Content playback controls view. Builds and updates the injected playback buttons shown on YouTube watch pages.
import {
  canHandlePlaybackActions,
  determinePageContext,
  getContextCapabilities,
  getCurrentVideoId,
  inlinePlaylistState,
  playerControls,
} from "../core/base.js";

export function destroyPlayerControls() {
  if (playerControls.observer) {
    playerControls.observer.disconnect();
    playerControls.observer = null;
  }
  playerControls.host = null;
  if (!playerControls.container) return;
  playerControls.container.remove();
  playerControls.container = null;
  playerControls.prev = null;
  playerControls.next = null;
  playerControls.postpone = null;
  playerControls.start = null;
  playerControls.addCurrent = null;
}

function syncPlayerControlsVisibility(host) {
  if (!playerControls.container) return;
  const hide = host?.classList?.contains("ytp-autohide");
  playerControls.container.dataset.hidden = hide ? "1" : "0";
}

function observePlayerHost(host) {
  if (!host || playerControls.host === host) {
    syncPlayerControlsVisibility(host || playerControls.host);
    return;
  }
  if (playerControls.observer) {
    playerControls.observer.disconnect();
    playerControls.observer = null;
  }
  playerControls.host = host;
  const observer = new MutationObserver(() => {
    syncPlayerControlsVisibility(host);
  });
  observer.observe(host, { attributes: true, attributeFilter: ["class"] });
  playerControls.observer = observer;
  syncPlayerControlsVisibility(host);
}

function resolvePlayerHost() {
  return (
    document.querySelector("#movie_player.html5-video-player") ||
    document.querySelector(".html5-video-player")
  );
}

function bindAddCurrentButton(addCurrentBtn, context) {
  addCurrentBtn.addEventListener("click", (event) => {
    event.preventDefault();
    if (addCurrentBtn.disabled || addCurrentBtn.dataset.loading === "1") {
      return;
    }
    addCurrentBtn.disabled = true;
    addCurrentBtn.dataset.loading = "1";
    const finalize = () => {
      delete addCurrentBtn.dataset.loading;
      updatePlayerControlsUI(context);
    };
    try {
      const result =
        typeof context.handleAddCurrentFromPage === "function"
          ? context.handleAddCurrentFromPage()
          : null;
      if (result && typeof result.finally === "function") {
        result.finally(finalize);
      } else if (result && typeof result.then === "function") {
        result.then(finalize).catch(finalize);
      } else {
        finalize();
      }
    } catch (_) {
      finalize();
    }
  });
}

// Creates the in-player control strip and wires the buttons to the content playback controller.
function createPlayerControls(host, context) {
  const container = document.createElement("div");
  container.className = "yta-player-controls";
  const topRow = document.createElement("div");
  topRow.className = "yta-player-controls__row yta-player-controls__row--top";
  const bottomRow = document.createElement("div");
  bottomRow.className = "yta-player-controls__row yta-player-controls__row--bottom";

  const startBtn = document.createElement("button");
  startBtn.type = "button";
  startBtn.className = "ytp-button yta-player-controls__start";
  startBtn.textContent = "▶ Плейлист";
  startBtn.title = "Запустить плейлист";
  startBtn.setAttribute("aria-label", "Запустить плейлист");
  startBtn.addEventListener("click", (event) => {
    event.preventDefault();
    context.requestStartPlayback?.();
  });

  const addCurrentBtn = document.createElement("button");
  addCurrentBtn.type = "button";
  addCurrentBtn.className = "yta-player-controls__add";
  addCurrentBtn.textContent = "Добавить в плейлист";
  addCurrentBtn.title = "Добавить текущее видео в плейлист";
  addCurrentBtn.setAttribute(
    "aria-label",
    "Добавить текущее видео в плейлист"
  );
  addCurrentBtn.hidden = true;
  bindAddCurrentButton(addCurrentBtn, context);

  const postponeBtn = document.createElement("button");
  postponeBtn.type = "button";
  postponeBtn.className = "ytp-button yta-player-controls__postpone";
  postponeBtn.title = "Отложить (оставить в очереди)";
  postponeBtn.setAttribute(
    "aria-label",
    "Отложить текущее видео и оставить в очереди"
  );
  const postponeIcon = document.createElement("span");
  postponeIcon.className = "yta-player-controls__postpone-icon";
  postponeIcon.textContent = "↷";
  const postponeLabel = document.createElement("span");
  postponeLabel.textContent = "Отложить";
  postponeBtn.append(postponeIcon, postponeLabel);
  postponeBtn.addEventListener("click", (event) => {
    event.preventDefault();
    context.requestPostpone?.();
  });

  const prevBtn = document.createElement("button");
  prevBtn.type = "button";
  prevBtn.className = "ytp-button";
  prevBtn.textContent = "⏮";
  prevBtn.title = "Предыдущее";
  prevBtn.setAttribute("aria-label", "Предыдущее видео");
  prevBtn.addEventListener("click", (event) => {
    event.preventDefault();
    context.requestPrevious?.();
  });

  const nextBtn = document.createElement("button");
  nextBtn.type = "button";
  nextBtn.className = "ytp-button";
  nextBtn.textContent = "⏭";
  nextBtn.title = "Следующее";
  nextBtn.setAttribute("aria-label", "Следующее видео");
  nextBtn.addEventListener("click", (event) => {
    event.preventDefault();
    context.requestNext?.();
  });

  topRow.append(addCurrentBtn);
  bottomRow.append(startBtn, postponeBtn, prevBtn, nextBtn);
  container.append(topRow, bottomRow);
  host.appendChild(container);
  playerControls.container = container;
  playerControls.start = startBtn;
  playerControls.postpone = postponeBtn;
  playerControls.prev = prevBtn;
  playerControls.next = nextBtn;
  playerControls.addCurrent = addCurrentBtn;
}

export function ensurePlayerControls(context = {}) {
  if (determinePageContext() !== "watch") {
    destroyPlayerControls();
    return;
  }
  const host = resolvePlayerHost();
  if (!host) {
    destroyPlayerControls();
    return;
  }
  if (!playerControls.container) {
    createPlayerControls(host, context);
  }
  observePlayerHost(host);
  updatePlayerControlsUI(context);
}

export function updatePlayerControlsUI(context = {}) {
  const queueIds = inlinePlaylistState.orderedVideoIds || [];
  const queueLength = queueIds.length;
  const currentId = getCurrentVideoId();
  const inQueueIndex =
    currentId && inlinePlaylistState.indexById.has(currentId)
      ? inlinePlaylistState.indexById.get(currentId)
      : -1;
  const hasQueue = queueLength > 0;
  const videoInQueue = inQueueIndex !== -1;
  const listFrozen = Boolean(inlinePlaylistState.freeze);
  const historyAvailable =
    typeof inlinePlaylistState.historyLength === "number" &&
    inlinePlaylistState.historyLength > 0;
  const queueHasPrevious =
    typeof inlinePlaylistState.currentIndex === "number" &&
    inlinePlaylistState.currentIndex > 0;
  const hasPrev = videoInQueue && (historyAvailable || queueHasPrevious);
  const hasNext = videoInQueue && queueLength > 1;
  const shouldShowStart = hasQueue && !videoInQueue;
  const controlsAvailable = canHandlePlaybackActions();
  if (playerControls.addCurrent) {
    const caps = getContextCapabilities("watch");
    const canAdd = Boolean(caps?.canAddCurrent);
    const loading = playerControls.addCurrent.dataset.loading === "1";
    playerControls.addCurrent.hidden = !canAdd;
    playerControls.addCurrent.disabled = !canAdd || loading;
  }
  if (playerControls.start) {
    playerControls.start.hidden = !shouldShowStart;
    playerControls.start.disabled = !hasQueue;
  }
  if (playerControls.prev) {
    playerControls.prev.hidden = !videoInQueue || !hasPrev;
    playerControls.prev.disabled = !controlsAvailable || !hasPrev;
  }
  if (playerControls.next) {
    const showNext = videoInQueue && queueLength > 1;
    playerControls.next.hidden = !showNext;
    playerControls.next.disabled = !controlsAvailable || !showNext;
  }
  if (playerControls.postpone) {
    const showPostpone = videoInQueue && queueLength > 1 && !listFrozen;
    playerControls.postpone.hidden = !showPostpone;
    playerControls.postpone.disabled = !controlsAvailable || !showPostpone;
  }
  if (playerControls.container) {
    playerControls.container.dataset.mode = shouldShowStart ? "start" : "queue";
    const host = resolvePlayerHost();
    if (host && playerControls.container.parentElement !== host) {
      playerControls.container.remove();
      host.appendChild(playerControls.container);
    }
    if (host) {
      observePlayerHost(host);
    }
  }
}
