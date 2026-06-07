// Background service worker entrypoint. Routes runtime messages to background handlers and clears playback tab ownership when tabs close.
import { MESSAGE_SOURCE } from "./background/constants.js";
import { messageHandlers } from "./background/messages.js";
import { notifyState } from "./background/channel.js";
import {
  clearCurrentTab,
  configurePlaylistSyncAccess,
  flushPendingPlaylistSync,
  flushPendingSettingsSync,
  importDriveSync,
  importRemoteSettingsSync,
  isSettingsSyncStorageChange,
  pushLocalDriveSyncNow,
  SYNC_ALARM_NAME,
} from "./store/index.js";

configurePlaylistSyncAccess();
importDriveSync({ interactive: false })
  .then((result) => {
    if (result?.playlistImported) notifyState();
  })
  .catch((err) => {
    console.debug("Initial Drive sync check skipped", err);
  });

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== "string") {
    return false;
  }
  if (message.source === MESSAGE_SOURCE) {
    return false;
  }
  const handler = messageHandlers[message.type];
  if (!handler) {
    return false;
  }
  Promise.resolve(handler(message, sender))
    .then((result) => sendResponse(result))
    .catch((err) => {
      console.error("Message handler failed", message.type, err);
      sendResponse({
        error: err && err.message ? err.message : String(err),
      });
    });
  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  clearCurrentTab(tabId).then(() => notifyState());
});

async function flushPendingAccountSync() {
  const [playlist, settings] = await Promise.all([
    flushPendingPlaylistSync(),
    flushPendingSettingsSync(),
  ]);
  if (playlist?.ready || settings?.wrote) {
    await pushLocalDriveSyncNow({ interactive: false });
  }
}

if (chrome.alarms?.onAlarm) {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm?.name !== SYNC_ALARM_NAME) {
      return;
    }
    flushPendingAccountSync().catch((err) => {
      console.error("Account sync flush failed", err);
    });
  });
}

chrome.storage?.onChanged?.addListener((changes, area) => {
  if (area !== "sync") {
    return;
  }
  const tasks = [];
  if (isSettingsSyncStorageChange(changes)) {
    tasks.push(importRemoteSettingsSync());
  }
  if (!tasks.length) {
    return;
  }
  Promise.all(tasks).catch((err) => {
    console.error("Account sync import failed", err);
  });
});
