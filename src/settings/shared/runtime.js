// Settings runtime helper. Wraps extension messaging and tab interactions used by the settings page.
export function getSubscriptionsMeta() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "subscriptions:getMeta" }, (res) => {
      resolve(res?.meta || {});
    });
  });
}

export function setStartDate(date) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: "setStartDate", date: date.toISOString() },
      (res) => {
        resolve(Boolean(res?.ok));
      }
    );
  });
}

export function getVideoDate(videoId) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: "videoDate", videoId },
      (response) => {
        resolve(response?.date || null);
      }
    );
  });
}

export function getVideoInfo(videoId) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "videoInfo", videoId }, resolve);
  });
}
