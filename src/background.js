import { initAuthListeners } from "./auth.js";
import { getVideoInfo } from "./youTubeApiConnectors.js";
import {
  storeDate,
  logMessages,
  setupLogCapture,
  parseVideoId,
} from "./utils.js";
import { process } from "./playlist.js";

let isProcessing = false;
function startProcess() {
  if (isProcessing) {
    console.warn("Process already running");
    return;
  }
  isProcessing = true;
  console.log("Processing started");
  Promise.resolve(process())
    .catch((err) => console.error("Processing failed", err))
    .finally(() => {
      isProcessing = false;
      console.log("Processing finished");
    });
}
setupLogCapture();

chrome.storage.sync.get(["lastVideoDate"], (result) => {
  if (!result.lastVideoDate) {
    // open settings page on first run
    if (chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else {
      chrome.tabs.create({ url: chrome.runtime.getURL("src/settings/settings.html") });
    }
    storeDate(new Date(Date.now() - 604800000));
  }
});

initAuthListeners(startProcess);

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.type) {
    case "setStartDate":
      storeDate(new Date(request.date)).then(() => sendResponse({ ok: true }));
      return true;
    case "videoDate": {
      const id = parseVideoId(request.videoId);
      if (!id) {
        sendResponse({ error: "Invalid video ID" });
        return true;
      }
      getVideoInfo([id])
        .then((info) => {
          const date = info[0].publishedAt;
          storeDate(date).then(() => {
            sendResponse({ date: date.toISOString() });
          });
        })
        .catch((err) => {
          console.error("Failed to get video date", err);
          sendResponse({ error: err.message });
        });
      return true;
    }
    case "videoInfo": {
      const id = parseVideoId(request.videoId);
      if (!id) {
        sendResponse({ error: "Invalid video ID" });
        return true;
      }
      getVideoInfo([id])
        .then((info) => {
          sendResponse({ info: info[0] });
        })
        .catch((err) => {
          console.error("Failed to get video info", err);
          sendResponse({ error: err.message });
        });
      return true;
    }
    case "getLogs":
      sendResponse({ logs: logMessages });
      return true;
  }
  return true;
});
