// Background service worker entrypoint. Routes runtime messages to background handlers and clears playback tab ownership when tabs close.
import { MESSAGE_SOURCE } from "./background/constants.js";
import { messageHandlers } from "./background/messages.js";
import { notifyState } from "./background/channel.js";
import {
  clearCurrentTab,
  configurePlaylistSyncAccess,
  flushPendingPlaylistSync,
  flushPendingSettingsSync,
  importRemotePlaylistSyncIfNewer,
  importRemoteSettingsSync,
  isPlaylistSyncStorageChange,
  isSettingsSyncStorageChange,
  SYNC_ALARM_NAME,
} from "./store/index.js";

configurePlaylistSyncAccess();

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

if (chrome.alarms?.onAlarm) {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm?.name !== SYNC_ALARM_NAME) {
      return;
    }
    Promise.all([flushPendingPlaylistSync(), flushPendingSettingsSync()]).catch(
      (err) => {
        console.error("Account sync flush failed", err);
      }
    );
  });
}

chrome.storage?.onChanged?.addListener((changes, area) => {
  if (area !== "sync") {
    return;
  }
  const tasks = [];
  if (isPlaylistSyncStorageChange(changes)) {
    tasks.push(importRemotePlaylistSyncIfNewer().then(() => notifyState()));
  }
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
