import { getPresentationState } from "../playlistStore.js";
import { MESSAGE_SOURCE } from "./constants.js";

async function safeSendMessage(payload) {
  try {
    await chrome.runtime.sendMessage(payload);
  } catch (err) {
    if (
      !err ||
      typeof err.message !== "string" ||
      !/receiving end/i.test(err.message)
    ) {
      console.warn("Runtime message failed", err);
    }
  }
}

export async function notifyState() {
  const presentation = await getPresentationState();
  await safeSendMessage({
    source: MESSAGE_SOURCE,
    type: "playlist:stateUpdated",
    state: presentation,
  });
  return presentation;
}

export function sendCollectionProgress(event) {
  if (!event || typeof event !== "object") return;
  void safeSendMessage({
    source: MESSAGE_SOURCE,
    type: "playlist:collectProgress",
    event,
  });
}
