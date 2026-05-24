// Inline queue feature entrypoint. Coordinates layout, rendering, state refresh, item actions, and navigation behavior.
import {
  determinePageContext,
  getCurrentVideoId,
} from "../core/base.js";
import {
  ensurePlaybackWatchdog,
  updatePlayerControlsUI,
} from "../playback/controls.js";
import { updatePageActions } from "../page-actions/index.js";
import {
  configureInlineQueueLayout,
} from "./layout.js";
import {
  refreshInlinePlaylistState as refreshInlinePlaylistStateBase,
  updateInlinePlaylistState as updateInlinePlaylistStateBase,
} from "./state.js";
import {
  handleInlineQueueListClick as handleInlineQueueListClickBase,
  handleInlineQueueListKeyDown as handleInlineQueueListKeyDownBase,
} from "./itemActions.js";
import {
  configureInlineMoveMenu,
  hideInlineMoveMenu,
  showInlineMoveMenu,
} from "./moveMenu.js";
import {
  configureInlineQueueDragDrop,
  handleInlineQueueDragEnd,
  handleInlineQueueDragOver,
  handleInlineQueueDragStart,
  handleInlineQueueDrop,
  handleInlineQueueHandlePointerDown,
  resetInlineQueueDragState,
} from "./dragDrop.js";
import {
  clearInlineQueuePendingFocus,
  configureInlineQueueScrollFocus,
  setInlineQueuePendingFocus,
} from "./scrollFocus.js";
import {
  configureInlineQueueUI,
  inlineQueueUI,
  teardownInlineQueueShell,
} from "./ui.js";
import { createInlineQueueRenderer } from "./renderer.js";

const inlineQueueRenderer = createInlineQueueRenderer({
  determinePageContext,
  getCurrentVideoId,
  handleInlineQueueHandlePointerDown,
  hideInlineMoveMenu,
  resetInlineQueueDragState,
});

configureInlineQueueLayout(() => updateInlineQueueUI());
configureInlineQueueScrollFocus({
  getInlineQueueUI: () => inlineQueueUI,
});
configureInlineQueueUI({
  handleInlineQueueDragEnd,
  handleInlineQueueDragOver,
  handleInlineQueueDragStart,
  handleInlineQueueDrop,
  handleInlineQueueListClick,
  handleInlineQueueListKeyDown,
});
configureInlineQueueDragDrop({
  hideInlineMoveMenu,
  updateInlinePlaylistState,
});
configureInlineMoveMenu({
  updateInlinePlaylistState,
});

export function teardownInlineQueue() {
  teardownInlineQueueShell();
  inlineQueueRenderer.resetAutoScrollState();
}

const inlineQueueItemActionContext = {
  clearInlineQueuePendingFocus,
  hideInlineMoveMenu,
  setInlineQueuePendingFocus,
  showInlineMoveMenu,
  updateInlinePlaylistState,
};

function handleInlineQueueListClick(event) {
  handleInlineQueueListClickBase(event, inlineQueueItemActionContext);
}

function handleInlineQueueListKeyDown(event) {
  handleInlineQueueListKeyDownBase(event, inlineQueueItemActionContext);
}

export const updateInlineQueueUI = inlineQueueRenderer.updateInlineQueueUI;

const inlinePlaylistStateSyncContext = {
  ensurePlaybackWatchdog,
  updateInlineQueueUI,
  updatePageActions,
  updatePlayerControlsUI,
};

export function updateInlinePlaylistState(rawPresentation) {
  updateInlinePlaylistStateBase(rawPresentation, inlinePlaylistStateSyncContext);
}

export async function refreshInlinePlaylistState() {
  await refreshInlinePlaylistStateBase(inlinePlaylistStateSyncContext);
}
