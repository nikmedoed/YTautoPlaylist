// Settings runtime helper. Wraps extension messaging and tab interactions used by the settings page.
function sendRuntimeMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, resolve);
  });
}

export function getSubscriptionsMeta() {
  return sendRuntimeMessage({ type: "subscriptions:getMeta" }).then(
    (res) => res?.meta || {}
  );
}

export function setStartDate(date) {
  return sendRuntimeMessage({
    type: "setStartDate",
    date: date.toISOString(),
  }).then((res) => Boolean(res?.ok));
}

export function getVideoDate(videoId) {
  return sendRuntimeMessage({ type: "videoDate", videoId }).then(
    (response) => response?.date || null
  );
}

export function getVideoInfo(videoId) {
  return sendRuntimeMessage({ type: "videoInfo", videoId });
}

export function getSyncStatus({ refreshRemote = false } = {}) {
  return sendRuntimeMessage({ type: "sync:getStatus", refreshRemote });
}

export function pullRemoteSync() {
  return sendRuntimeMessage({ type: "sync:pullRemote" });
}

export function pushLocalSync() {
  return sendRuntimeMessage({ type: "sync:pushLocal" });
}

export function replaceLocalFromRemoteSync() {
  return sendRuntimeMessage({ type: "sync:replaceLocalFromRemote" });
}
