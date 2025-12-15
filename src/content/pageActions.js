let lastPositionHint = { videoId: null, index: null, total: null };

const DEFAULT_TOGGLE_TITLE = "YTautoPlaylist";
const DEFAULT_COLLAPSE_DELAY = 220;

const ACTION_DEFINITIONS = [
  { key: "addCurrent", label: "Добавить в плейлист", handler: handleAddCurrentFromPage },
  { key: "addVisible", label: "Добавить видимые", handler: handleAddVisibleFromPage },
  {
    key: "addAll",
    label: "Добавить все на странице",
    handler: handleAddAllFromPage,
  },
];

function getRuntimeIconUrl() {
  if (typeof chrome !== "undefined" && chrome?.runtime?.getURL) {
    return chrome.runtime.getURL("icon/icon.png");
  }
  if (typeof browser !== "undefined" && browser?.runtime?.getURL) {
    return browser.runtime.getURL("icon/icon.png");
  }
  return "";
}

function resetToggleLabel() {
  if (!pageActions.toggle) return;
  pageActions.toggle.title = DEFAULT_TOGGLE_TITLE;
  pageActions.toggle.setAttribute("aria-label", DEFAULT_TOGGLE_TITLE);
}

function setToggleLabelSuffix(text) {
  if (!pageActions.toggle) return;
  pageActions.toggle.title = `${DEFAULT_TOGGLE_TITLE} • ${text}`;
  pageActions.toggle.setAttribute("aria-label", `${DEFAULT_TOGGLE_TITLE} — ${text}`);
}

function resetPageActionInfoState() {
  if (pageActions.info) {
    pageActions.info.dataset.visible = "0";
    pageActions.info.textContent = "";
    delete pageActions.info.dataset.dimmed;
  }
  lastPositionHint = { videoId: null, index: null, total: null };
  resetToggleLabel();
}

function togglePageActions() {
  if (!pageActions.container) return;
  if (pageActions.container.dataset.expanded === "1") {
    delete pageActions.container.dataset.pinned;
    collapsePageActions({ force: true });
  } else {
    expandPageActions();
  }
}

function createToggleButton() {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "yta-page-actions__toggle";
  button.setAttribute("aria-label", DEFAULT_TOGGLE_TITLE);
  button.setAttribute("aria-expanded", "false");
  button.title = DEFAULT_TOGGLE_TITLE;
  const iconUrl = getRuntimeIconUrl();
  if (iconUrl) {
    const iconImg = document.createElement("img");
    iconImg.src = iconUrl;
    iconImg.alt = "";
    iconImg.decoding = "async";
    iconImg.loading = "lazy";
    button.appendChild(iconImg);
  } else {
    const fallback = document.createElement("span");
    fallback.className = "yta-page-actions__toggle-fallback";
    fallback.textContent = "YT";
    button.appendChild(fallback);
  }
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    togglePageActions();
  });
  return button;
}

function createActionButton(label, handler) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "yta-page-actions__action";
  button.textContent = label;
  button.addEventListener("click", (event) => {
    event.preventDefault();
    handler();
  });
  return button;
}

function createStopButton() {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "yta-page-actions__stop";
  button.textContent = "Стоп";
  button.hidden = true;
  button.addEventListener("click", (event) => {
    event.preventDefault();
    cancelAddAllFromPage();
  });
  return button;
}

function handleContainerMouseLeave() {
  if (pageActions.toggle && document.activeElement === pageActions.toggle) {
    pageActions.toggle.blur();
  }
  scheduleCollapsePageActions(DEFAULT_COLLAPSE_DELAY);
}

function handleContainerFocusOut(event) {
  if (
    pageActions.container &&
    event.relatedTarget &&
    pageActions.container.contains(event.relatedTarget)
  ) {
    return;
  }
  scheduleCollapsePageActions(DEFAULT_COLLAPSE_DELAY);
}

function setupContainerInteractions(container) {
  container.addEventListener("mouseenter", () => {
    expandPageActions();
  });
  container.addEventListener("mouseleave", handleContainerMouseLeave);
  container.addEventListener("focusin", () => {
    expandPageActions();
  });
  container.addEventListener("focusout", handleContainerFocusOut);
}

function normalizeAddResponse(response) {
  if (!response || typeof response !== "object") {
    return { state: response, requested: null, missing: 0 };
  }
  const state =
    response.state && typeof response.state === "object"
      ? response.state
      : response;
  const requested =
    Number.isInteger(response.requested) && response.requested >= 0
      ? response.requested
      : null;
  const missing =
    Number.isInteger(response.missing) && response.missing > 0
      ? response.missing
      : 0;
  return { state, requested, missing };
}

function formatAddResultMessage(options = {}) {
  const {
    added = 0,
    requested = null,
    missing = 0,
    scopeLabel = "",
    alreadyMessage = "",
  } = options;
  const addedCount = Number.isInteger(added) && added > 0 ? added : 0;
  const totalRequested =
    Number.isInteger(requested) && requested >= 0 ? requested : null;
  const missingCount = Number.isInteger(missing) && missing > 0 ? missing : 0;
  const duplicates =
    totalRequested !== null
      ? Math.max(0, totalRequested - missingCount - addedCount)
      : null;
  const fragments = [];
  if (addedCount > 0) {
    let sentence = `Добавлено ${addedCount} видео`;
    if (duplicates && duplicates > 0) {
      sentence += ` (ещё ${duplicates} видео уже были)`;
    } else if (totalRequested !== null && totalRequested !== addedCount) {
      sentence += ` из ${totalRequested}`;
    }
    fragments.push(sentence);
  } else if (duplicates && duplicates > 0) {
    if (alreadyMessage) {
      fragments.push(alreadyMessage);
    } else if (scopeLabel) {
      fragments.push(`Все ${scopeLabel} уже в списке`);
    } else if (totalRequested !== null && totalRequested > 0) {
      fragments.push(`Все ${totalRequested} видео уже в списке`);
    } else {
      fragments.push(`Все видео уже в списке`);
    }
  } else if (totalRequested === 0) {
    fragments.push(`Видео не найдены`);
  } else if (scopeLabel) {
    fragments.push(`Не удалось добавить ${scopeLabel}`);
  } else {
    fragments.push(`Видео не добавлены`);
  }
  if (missingCount > 0) {
    fragments.push(`Не удалось получить данные для ${missingCount} видео`);
  }
  const message = fragments.join(". ");
  const kind = addedCount > 0 ? "success" : missingCount > 0 ? "error" : "info";
  return { message, kind };
}

function ensurePageActions() {
  if (pageActions.container) return;
  const container = document.createElement("div");
  container.className = "yta-page-actions";
  container.dataset.hidden = "1";
  container.dataset.expanded = "0";

  const toggle = createToggleButton();

  const panel = document.createElement("div");
  panel.className = "yta-page-actions__panel";

  const actionsWrap = document.createElement("div");
  actionsWrap.className = "yta-page-actions__actions";

  ACTION_DEFINITIONS.forEach(({ key, label, handler }) => {
    const button = createActionButton(label, handler);
    actionsWrap.appendChild(button);
    pageActions[key] = button;
  });

  const info = document.createElement("div");
  info.className = "yta-page-actions__info";
  info.dataset.visible = "0";

  const status = document.createElement("div");
  status.className = "yta-page-actions__status";
  status.dataset.visible = "0";

  const stop = createStopButton();

  panel.appendChild(actionsWrap);
  panel.appendChild(info);
  panel.appendChild(status);
  panel.appendChild(stop);

  container.appendChild(toggle);
  container.appendChild(panel);
  document.body.appendChild(container);

  setupContainerInteractions(container);

  pageActions.container = container;
  pageActions.toggle = toggle;
  pageActions.panel = panel;
  pageActions.status = status;
  pageActions.info = info;
  pageActions.stop = stop;

  positionPageActions(determinePageContext());
}

function expandPageActions({ pinned = false } = {}) {
  ensurePageActions();
  if (!pageActions.container) return;
  pageActions.container.dataset.expanded = "1";
  if (pageActions.toggle) {
    pageActions.toggle.setAttribute("aria-expanded", "true");
  }
  if (pinned) {
    pageActions.container.dataset.pinned = "1";
  }
  if (pageActions.collapseTimeout) {
    clearTimeout(pageActions.collapseTimeout);
    pageActions.collapseTimeout = null;
  }
}

function collapsePageActions({ force = false } = {}) {
  if (!pageActions.container) return;
  if (!force) {
    if (pageActions.container.dataset.pinned === "1") return;
    if (pageActions.status?.dataset.visible === "1") return;
    const activeElement = document.activeElement;
    if (pageActions.container.contains(activeElement) && activeElement !== document.body) {
      return;
    }
    if (
      typeof pageActions.container.matches === "function" &&
      pageActions.container.matches(":hover")
    ) {
      return;
    }
  }
  pageActions.container.dataset.expanded = "0";
  if (pageActions.toggle) {
    pageActions.toggle.setAttribute("aria-expanded", "false");
  }
  if (force) {
    if (pageActions.timeout) {
      clearTimeout(pageActions.timeout);
      pageActions.timeout = null;
    }
    if (pageActions.status) {
      pageActions.status.dataset.visible = "0";
      pageActions.status.textContent = "";
    }
    if (pageActions.panel) {
      pageActions.panel.dataset.statusVisible = "0";
    }
    if (pageActions.info) {
      delete pageActions.info.dataset.dimmed;
    }
    delete pageActions.container.dataset.pinned;
    updatePageActionInfo(determinePageContext(), lastCapabilities);
  }
}

function scheduleCollapsePageActions(delay = 200) {
  if (pageActions.collectingAll) {
    return;
  }
  if (determinePageContext() === "watch") {
    return;
  }
  if (pageActions.collapseTimeout) {
    clearTimeout(pageActions.collapseTimeout);
  }
  pageActions.collapseTimeout = window.setTimeout(() => {
    pageActions.collapseTimeout = null;
    collapsePageActions();
  }, delay);
}

function hidePageActions() {
  if (!pageActions.container) return;
  pageActions.container.dataset.hidden = "1";
  delete pageActions.container.dataset.pinned;
  collapsePageActions({ force: true });
}

function positionPageActions(context) {
  if (!pageActions.container) return;
  pageActions.container.dataset.context = context;
  const inPlayer = context === "watch";
  const host = inPlayer
    ? document.getElementById("movie_player") || document.querySelector("#player-container")
    : null;
  if (inPlayer && host) {
    if (pageActions.container.parentElement !== host) {
      pageActions.container.remove();
      host.appendChild(pageActions.container);
    }
    pageActions.container.classList.add("yta-page-actions--player");
    observePageActionsHost(host);
  } else {
    if (pageActions.container.parentElement !== document.body) {
      pageActions.container.remove();
      document.body.appendChild(pageActions.container);
    }
    pageActions.container.classList.remove("yta-page-actions--player");
    observePageActionsHost(null);
  }
}

function syncPageActionsHostVisibility(host) {
  if (!pageActions.container) return;
  if (!host) {
    delete pageActions.container.dataset.controlsHidden;
    return;
  }
  const hidden = host.classList.contains("ytp-autohide");
  if (hidden) {
    pageActions.container.dataset.controlsHidden = "1";
  } else {
    delete pageActions.container.dataset.controlsHidden;
  }
}

function observePageActionsHost(host) {
  if (!pageActions.container) return;
  if (pageActions.host === host) {
    syncPageActionsHostVisibility(host);
    return;
  }
  if (pageActions.hostObserver) {
    pageActions.hostObserver.disconnect();
    pageActions.hostObserver = null;
  }
  pageActions.host = host || null;
  if (host) {
    const observer = new MutationObserver(() => {
      syncPageActionsHostVisibility(host);
    });
    observer.observe(host, { attributes: true, attributeFilter: ["class"] });
    pageActions.hostObserver = observer;
    syncPageActionsHostVisibility(host);
  } else {
    delete pageActions.container.dataset.controlsHidden;
  }
}

function setCollectingAllState(active) {
  pageActions.collectingAll = Boolean(active);
  if (pageActions.container) {
    if (pageActions.collectingAll) {
      pageActions.container.dataset.collecting = "1";
    } else {
      delete pageActions.container.dataset.collecting;
    }
  }
  if (pageActions.stop) {
    if (pageActions.collectingAll) {
      pageActions.stop.hidden = false;
      pageActions.stop.disabled = false;
    } else {
      pageActions.stop.hidden = true;
      pageActions.stop.disabled = false;
    }
  }
}

function cancelAddAllFromPage(options = {}) {
  if (!pageActions.collectingAll) return false;
  const { silent = false } = options || {};
  if (pageActions.stop) {
    pageActions.stop.disabled = true;
  }
  if (!pageActions.cancelRequested) {
    pageActions.cancelRequested = true;
    if (!silent) {
      showPageActionStatus("Останавливаю...", "info", 0);
    }
  }
  if (pageActions.collectAbort) {
    try {
      pageActions.collectAbort.abort();
    } catch (err) {
      console.warn("Failed to abort collection", err);
    }
  }
  return true;
}

function computeAddedAfterUpdate(beforeSet) {
  if (!(beforeSet instanceof Set)) return 0;
  let added = 0;
  inlinePlaylistState.videoIds.forEach((id) => {
    if (!beforeSet.has(id)) {
      added += 1;
    }
  });
  return added;
}

function updatePageActionInfo(context, caps) {
  if (!pageActions.info || !pageActions.toggle) return;
  const isWatchContext = context === "watch";
  if (!isWatchContext || caps?.canAddCurrent) {
    resetPageActionInfoState();
    return;
  }
  const videoId = getCurrentVideoId();
  const index = inlinePlaylistState.indexById.get(videoId);
  const total = inlinePlaylistState.orderedVideoIds.length;
  if (!Number.isInteger(index) || total <= 0) {
    resetPageActionInfoState();
    return;
  }
  if (
    lastPositionHint.videoId !== videoId ||
    lastPositionHint.index !== index ||
    lastPositionHint.total !== total
  ) {
    const text = `Видео ${index + 1} из ${total}`;
    lastPositionHint = { videoId, index, total };
    setToggleLabelSuffix(text);
  }
  pageActions.info.dataset.visible = "0";
  pageActions.info.textContent = "";
  delete pageActions.info.dataset.dimmed;
}

function showPageActionStatus(text, kind = "info", timeout = 2500) {
  ensurePageActions();
  positionPageActions(determinePageContext());
  if (!pageActions.status) return;
  if (pageActions.container) {
    delete pageActions.container.dataset.hidden;
    expandPageActions({ pinned: true });
  }
  if (pageActions.panel) {
    pageActions.panel.dataset.statusVisible = "1";
  }
  if (pageActions.info) {
    pageActions.info.dataset.dimmed = "1";
  }
  pageActions.status.textContent = text;
  pageActions.status.dataset.kind = kind;
  pageActions.status.dataset.visible = "1";
  if (pageActions.timeout) {
    clearTimeout(pageActions.timeout);
    pageActions.timeout = null;
  }
  if (timeout && timeout > 0) {
    pageActions.timeout = window.setTimeout(() => {
      if (pageActions.status) {
        pageActions.status.dataset.visible = "0";
        pageActions.status.textContent = "";
      }
      if (pageActions.panel) {
        pageActions.panel.dataset.statusVisible = "0";
      }
      if (pageActions.info) {
        delete pageActions.info.dataset.dimmed;
      }
      if (pageActions.container) {
        delete pageActions.container.dataset.pinned;
      }
      pageActions.timeout = null;
      updatePageActionInfo(determinePageContext(), lastCapabilities);
      scheduleCollapsePageActions(320);
    }, timeout);
  }
}

function clearPageActionStatus({ collapse = false } = {}) {
  ensurePageActions();
  if (pageActions.timeout) {
    clearTimeout(pageActions.timeout);
    pageActions.timeout = null;
  }
  if (pageActions.status) {
    pageActions.status.dataset.visible = "0";
    pageActions.status.textContent = "";
    delete pageActions.status.dataset.kind;
  }
  if (pageActions.panel) {
    pageActions.panel.dataset.statusVisible = "0";
  }
  if (pageActions.info) {
    delete pageActions.info.dataset.dimmed;
  }
  if (collapse) {
    if (pageActions.container) {
      delete pageActions.container.dataset.pinned;
    }
    if (determinePageContext() === "watch") {
      collapsePageActions({ force: true });
    } else {
      scheduleCollapsePageActions(DEFAULT_COLLAPSE_DELAY);
    }
  }
}

async function syncPlaybackAfterManualAdd(videoId) {
  if (!videoId) {
    return false;
  }
  state.currentVideoId = videoId;
  try {
    const response = await sendMessage("player:videoStarted", { videoId });
    if (response && typeof response.controlled === "boolean") {
      const controlled = Boolean(response.controlled);
      setControlsActive(controlled);
      if (controlled) {
        return true;
      }
    }
  } catch (err) {
    console.warn("Failed to synchronize playback state", err);
  }
  if (inlinePlaylistState.videoIds.has(videoId)) {
    setControlsActive(true);
    return true;
  }
  return false;
}

async function addVideoIds(videoIds, options = {}) {
  const {
    scopeLabel = "",
    alreadyMessage = "",
    fallbackRequested = Array.isArray(videoIds) ? videoIds.length : null,
  } = options;
  const safeIds = Array.isArray(videoIds) ? videoIds : [];
  const beforeSet = new Set(inlinePlaylistState.videoIds);
  const response = await sendMessage("playlist:addByIds", {
    videoIds: safeIds,
  });
  const { state: presentation, requested, missing } = normalizeAddResponse(
    response
  );
  if (presentation && typeof presentation === "object") {
    updateInlinePlaylistState(presentation);
  } else {
    await refreshInlinePlaylistState();
  }
  const added = computeAddedAfterUpdate(beforeSet);
  const totalRequested =
    requested ?? (Number.isInteger(fallbackRequested) ? fallbackRequested : 0);
  const summary = formatAddResultMessage({
    added,
    requested: totalRequested,
    missing,
    scopeLabel,
    alreadyMessage,
  });
  return { added, missing, summary };
}

async function handleAddCurrentFromPage() {
  const caps = getContextCapabilities();
  if (!caps.canAddCurrent) return;
  ensurePageActions();
  clearPageActionStatus({ collapse: true });
  if (pageActions.addCurrent) pageActions.addCurrent.disabled = true;
  const controlsButton =
    playerControls && typeof playerControls === "object"
      ? playerControls.addCurrent
      : null;
  if (controlsButton) {
    controlsButton.disabled = true;
    controlsButton.dataset.loading = "1";
  }
  try {
    const videoId = getCurrentVideoId();
    if (!videoId) {
      showPageActionStatus("Видео не найдено", "error", 3200);
      return;
    }
    state.currentVideoId = videoId;
    const { added, missing, summary } = await addVideoIds([videoId], {
      alreadyMessage: "Видео уже в плейлисте",
      fallbackRequested: 1,
    });
    if (added > 0 && missing === 0) {
      clearPageActionStatus({ collapse: true });
    } else {
      showPageActionStatus(summary.message, summary.kind, 3400);
    }
    await syncPlaybackAfterManualAdd(videoId);
  } catch (err) {
    console.error("Failed to add current video", err);
    showPageActionStatus("Не удалось добавить видео", "error", 3500);
  } finally {
    if (pageActions.addCurrent) pageActions.addCurrent.disabled = false;
    if (controlsButton) {
      delete controlsButton.dataset.loading;
    }
    updatePageActions();
    if (typeof updatePlayerControlsUI === "function") {
      updatePlayerControlsUI();
    }
  }
}

async function handleAddVisibleFromPage() {
  const caps = getContextCapabilities();
  if (!caps.canAddVisible) return;
  ensurePageActions();
  if (pageActions.addVisible) pageActions.addVisible.disabled = true;
  try {
    const collected = collectVisibleVideoIds({ includeCurrent: false });
    const uniqueIds = Array.from(new Set(collected));
    if (!uniqueIds.length) {
      showPageActionStatus("Видео не найдены", "error", 3200);
      return;
    }
    showPageActionStatus(`Добавляю ${uniqueIds.length} видео...`, "info", 0);
    const { summary } = await addVideoIds(uniqueIds, {
      scopeLabel: "видимые видео",
      fallbackRequested: uniqueIds.length,
    });
    showPageActionStatus(summary.message, summary.kind, 3400);
  } catch (err) {
    console.error("Failed to add visible videos", err);
    showPageActionStatus("Не удалось добавить видео", "error", 3500);
  } finally {
    if (pageActions.addVisible) pageActions.addVisible.disabled = false;
    updatePageActions();
  }
}

async function handleAddAllFromPage() {
  const caps = getContextCapabilities();
  if (!caps.canAddAll) return;
  ensurePageActions();
  if (pageActions.addAll) pageActions.addAll.disabled = true;
  pageActions.cancelRequested = false;
  const controller = new AbortController();
  pageActions.collectAbort = controller;
  setCollectingAllState(true);
  try {
    let reportedTotal = -1;
    showPageActionStatus("Собираю видео...", "info", 0);
    const collected = await collectPageVideosWithContinuation({
      signal: controller.signal,
      shouldStop: () => pageActions.cancelRequested,
      onProgress: ({ total }) => {
        if (pageActions.cancelRequested) return;
        if (total !== reportedTotal) {
          reportedTotal = total;
          showPageActionStatus(`Собрано ${total} видео...`, "info", 0);
        }
      },
    });
    const videoIds = Array.isArray(collected?.videoIds)
      ? collected.videoIds
      : Array.isArray(collected)
      ? collected
      : [];
    const uniqueIds = Array.from(new Set(videoIds));
    const aborted = Boolean(collected?.aborted || pageActions.cancelRequested);
    if (!uniqueIds.length) {
      const message = aborted
        ? "Сбор остановлен. Видео не найдены"
        : "Видео не найдены";
      showPageActionStatus(message, aborted ? "info" : "error", 3200);
      return;
    }
    showPageActionStatus(
      aborted
        ? `Сбор остановлен, добавляю найденные ${uniqueIds.length} видео...`
        : `Добавляю ${uniqueIds.length} видео...`,
      "info",
      0
    );
    if (pageActions.stop) {
      pageActions.stop.disabled = true;
    }
    pageActions.collectAbort = null;
    const { summary } = await addVideoIds(uniqueIds, {
      scopeLabel: aborted ? "найденные видео" : "видео на странице",
      fallbackRequested: uniqueIds.length,
    });
    const finalMessage = aborted
      ? `Сбор остановлен. ${summary.message}`
      : summary.message;
    showPageActionStatus(finalMessage, summary.kind, 3600);
  } catch (err) {
    console.error("Failed to add page videos", err);
    showPageActionStatus("Не удалось добавить видео", "error", 3500);
  } finally {
    pageActions.collectAbort = null;
    const wasCollecting = pageActions.collectingAll;
    setCollectingAllState(false);
    pageActions.cancelRequested = false;
    if (pageActions.addAll) pageActions.addAll.disabled = false;
    if (wasCollecting) {
      scheduleCollapsePageActions(340);
    }
    updatePageActions();
  }
}

function updatePageActions() {
  const context = determinePageContext();
  const caps = getContextCapabilities(context);
  const controlling = Boolean(state.controlsActive);
  const statusVisible = pageActions.status?.dataset.visible === "1";
  const showAddCurrentAction = context !== "watch" && caps.canAddCurrent;
  if (pageActions.container) {
    positionPageActions(context);
    if (context === "watch") {
      if (showAddCurrentAction || statusVisible) {
        pageActions.container.dataset.expanded = "1";
      } else {
        pageActions.container.dataset.expanded = "0";
      }
    }
  }
  updatePageActionInfo(context, caps);
  if (
    context === lastPageContext &&
    pageActions.container &&
    caps.canAddCurrent === lastCapabilities.canAddCurrent &&
    caps.canAddVisible === lastCapabilities.canAddVisible &&
    caps.canAddAll === lastCapabilities.canAddAll &&
    controlling === lastCapabilities.controlling
  ) {
    return;
  }
  lastPageContext = context;
  lastCapabilities = {
    canAddCurrent: caps.canAddCurrent,
    canAddVisible: caps.canAddVisible,
    canAddAll: caps.canAddAll,
    controlling,
  };
  const infoVisible = pageActions.info?.dataset.visible === "1";
  const hasActions =
    showAddCurrentAction || caps.canAddVisible || caps.canAddAll;
  if (!hasActions && !statusVisible && !infoVisible) {
    hidePageActions();
    return;
  }
  ensurePageActions();
  if (!pageActions.container) return;
  positionPageActions(context);
  delete pageActions.container.dataset.hidden;
  if (pageActions.toggle) {
    pageActions.toggle.hidden = context === "watch";
  }
  if (pageActions.addCurrent) {
    pageActions.addCurrent.hidden = !showAddCurrentAction;
  }
  if (pageActions.addVisible) {
    pageActions.addVisible.hidden = !caps.canAddVisible;
  }
  if (pageActions.addAll) {
    pageActions.addAll.hidden = !caps.canAddAll;
  }
  const visibleButtons = [
    pageActions.addCurrent,
    pageActions.addVisible,
    pageActions.addAll,
  ].filter((btn) => btn && !btn.hidden);
  if (!visibleButtons.length && !statusVisible && !infoVisible) {
    pageActions.container.dataset.hidden = "1";
  } else {
    delete pageActions.container.dataset.hidden;
  }
  if (!statusVisible && !visibleButtons.length) {
    collapsePageActions({ force: true });
  }
}
