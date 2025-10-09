import {
  addVideos,
  clearPendingDefaultRefresh,
  consumePendingNotifications,
  DEFAULT_LIST,
  getState,
  shouldAutoRefreshDefault,
} from "../playlistStore.js";
import { storeDate } from "../utils.js";
import { COLLECTION_WINDOW_MS } from "./constants.js";
import { sendCollectionProgress, notifyState } from "./channel.js";
import { collectSubscriptionEntries } from "./collector.js";

let defaultAutoCollectRunning = false;

export async function dispatchNotifications() {
  const notifications = await consumePendingNotifications();
  if (!notifications?.length) return;
  for (const note of notifications) {
    if (note.type !== "listEmpty") continue;
    const title = "Список закончился";
    const message = note.name
      ? `Очередь «${note.name}» пустая`
      : "Дополнительный список пустой";
    try {
      chrome.notifications.create(
        `yta_list_empty_${note.listId || Date.now()}`,
        {
          type: "basic",
          iconUrl: chrome.runtime.getURL("icon/icon.png"),
          title,
          message,
        }
      );
    } catch (err) {
      console.warn("Failed to show notification", err);
    }
  }
}

async function resolveCollectionStartDate() {
  const stored = await new Promise((resolve) => {
    chrome.storage.sync.get(["lastVideoDate"], (result) => resolve(result));
  });
  if (stored && stored.lastVideoDate) {
    const dt = new Date(stored.lastVideoDate);
    if (!Number.isNaN(dt.getTime())) {
      return dt;
    }
  }
  return new Date(Date.now() - COLLECTION_WINDOW_MS);
}

export async function collectAndAppendSubscriptions() {
  const startDate = await resolveCollectionStartDate();
  sendCollectionProgress({
    phase: "start",
    startDate: startDate.toISOString(),
  });
  try {
    const { entries, latestPublishedAt } =
      await collectSubscriptionEntries(startDate, sendCollectionProgress);
    sendCollectionProgress({
      phase: "readyToAdd",
      videoCount: entries.length,
    });
    const before = await getState();
    sendCollectionProgress({
      phase: "adding",
      addCount: entries.length,
      queueBefore: before.lists?.[DEFAULT_LIST]?.queue?.length || 0,
    });
    if (entries.length) {
      await addVideos(entries, DEFAULT_LIST);
    }
    if (latestPublishedAt) {
      await storeDate(latestPublishedAt);
    }
    await notifyState();
    await dispatchNotifications();
    const after = await getState();
    const previousLength = before.lists?.[DEFAULT_LIST]?.queue?.length || 0;
    const newLength = after.lists?.[DEFAULT_LIST]?.queue?.length || 0;
    const added = Math.max(0, newLength - previousLength);
    sendCollectionProgress({
      phase: "complete",
      added,
      fetched: entries.length,
      queueLength: newLength,
    });
    return { added, fetched: entries.length, state: after };
  } catch (err) {
    sendCollectionProgress({
      phase: "error",
      message: err?.message || "Не удалось собрать подписки",
    });
    throw err;
  }
}

export async function ensureDefaultQueueFilled() {
  if (defaultAutoCollectRunning) return;
  const needRefresh = await shouldAutoRefreshDefault();
  if (!needRefresh) return;
  defaultAutoCollectRunning = true;
  try {
    await clearPendingDefaultRefresh();
    await collectAndAppendSubscriptions();
  } catch (err) {
    console.error("Auto-collection failed", err);
  } finally {
    defaultAutoCollectRunning = false;
  }
}
