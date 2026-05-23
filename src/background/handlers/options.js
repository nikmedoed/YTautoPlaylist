// Background options message handlers. Contains option-page routing and settings-related runtime actions.
import { parseVideoId } from "../../utils.js";

export const optionsHandlers = {
  async "options:openQuickFilter"(message) {
    const videoId = parseVideoId(message?.videoId);
    if (!videoId) {
      return { error: "INVALID_VIDEO_ID" };
    }
    try {
      const base = chrome.runtime.getURL("src/settings/settings.html");
      const url = new URL(base);
      url.searchParams.set("quickFilterVideo", videoId);
      await chrome.tabs.create({ url: url.toString() });
      return { ok: true };
    } catch (err) {
      console.error("Failed to open quick filter page", err);
      return { error: err?.message || "FAILED_TO_OPEN_QUICK_FILTER" };
    }
  },

  async "options:openListSettings"(message) {
    const listId =
      typeof message?.listId === "string" ? message.listId.trim() : "";
    if (!listId) {
      return { error: "INVALID_LIST_ID" };
    }
    try {
      const base = chrome.runtime.getURL("src/popup/lists.html");
      const url = new URL(base);
      url.searchParams.set("listId", listId);
      const listName =
        typeof message?.listName === "string" ? message.listName.trim() : "";
      if (listName) {
        url.searchParams.set("listName", listName);
      }
      await chrome.tabs.create({ url: url.toString() });
      return { ok: true };
    } catch (err) {
      console.error("Failed to open list settings page", err);
      return { error: err?.message || "FAILED_TO_OPEN_LIST_SETTINGS" };
    }
  },
};
