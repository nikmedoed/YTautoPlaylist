// Page-actions view builder. Creates and updates the floating add buttons and loading states.
import {
  createPageActionElements,
  setDefaultToggleLabel,
  setToggleLabelSuffix as setToggleSuffix,
} from "./dom.js";
import {
  createPageActionHostController,
} from "./host.js";

const DEFAULT_COLLAPSE_DELAY = 220;

// Owns the floating YouTube page-action bar: buttons, status text, collapsed state, and page capability updates.
export function createPageActionViewController({
  determinePageContext,
  getContextCapabilities,
  getCurrentVideoId,
  inlinePlaylistState,
  pageActions,
  state,
  actionDefinitions,
  cancelAddAllFromPage,
}) {
  let lastPositionHint = { videoId: null, index: null, total: null };
  let lastPageContext = null;
  let lastCapabilities = {
    canAddCurrent: null,
    canAddVisible: null,
    canAddAll: null,
    controlling: null,
  };
  const hostController = createPageActionHostController({ pageActions });

  function resetToggleLabel() {
    setDefaultToggleLabel(pageActions.toggle);
  }

  function setToggleLabelSuffix(text) {
    setToggleSuffix(pageActions.toggle, text);
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

  function ensurePageActions() {
    if (pageActions.container) return;
    const elements = createPageActionElements({
      actionDefinitions,
      onCancel: cancelAddAllFromPage,
      onFocusOut: handleContainerFocusOut,
      onMouseEnter: () => {
        expandPageActions();
      },
      onMouseLeave: handleContainerMouseLeave,
      onToggle: togglePageActions,
    });
    Object.assign(pageActions, elements.actionButtons);
    pageActions.container = elements.container;
    pageActions.toggle = elements.toggle;
    pageActions.panel = elements.panel;
    pageActions.status = elements.status;
    pageActions.info = elements.info;
    pageActions.stop = elements.stop;
    document.body.appendChild(elements.container);

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
      clearStatusTimeout();
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
    hostController.positionPageActions(context);
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

  function clearStatusTimeout() {
    if (pageActions.timeout) {
      clearTimeout(pageActions.timeout);
      pageActions.timeout = null;
    }
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
    clearStatusTimeout();
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
    clearStatusTimeout();
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

  // Recomputes the floating action UI from page context, collection state, and
  // playback ownership without changing the underlying queue data.
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

  return {
    clearPageActionStatus,
    ensurePageActions,
    scheduleCollapsePageActions,
    setCollectingAllState,
    showPageActionStatus,
    updatePageActions,
  };
}
