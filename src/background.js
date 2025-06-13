import { signInUser, initAuthListeners } from "./auth.js";
import { getVideoInfo } from "./youTubeApiConnectors.js";
import {
  storeDate,
  logMessages,
  setupLogCapture,
  parseVideoId,
} from "./utils.js";
import { process } from "./playlist.js";
setupLogCapture();

chrome.storage.sync.get(["lastVideoDate"], function (result) {
  if (!result.lastVideoDate) {
    storeDate(new Date(Date.now() - 604800000));
  }
});

initAuthListeners(process);

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.type) {
    case "signIn":
      signInUser().catch((err) => console.error("Sign-in failed", err));
      break;
    case "process":
      process();
      break;
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
          const date = new Date(info[0].pubDate);
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
    case "getLogs":
      sendResponse({ logs: logMessages });
      return true;
  }
  return true;
});
