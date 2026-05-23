// Background service worker entrypoint. Routes runtime messages to background handlers and clears playback tab ownership when tabs close.
import { MESSAGE_SOURCE } from "./background/constants.js";
import { messageHandlers } from "./background/messages.js";
import { notifyState } from "./background/channel.js";
import { clearCurrentTab } from "./store/index.js";
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
