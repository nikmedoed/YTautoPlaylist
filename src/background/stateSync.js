import {
  addVideos,
  clearPendingDefaultRefresh,
  consumePendingNotifications,
  DEFAULT_LIST,
  getPresentationState,
  getState,
  getAutoCollectMeta,
  queueListEmptyNotification,
  recordDefaultAutoCollect,
  shouldAutoRefreshDefault,
} from "../playlistStore.js";
import { COLLECTION_WINDOW_MS } from "./constants.js";
import { sendCollectionProgress, notifyState } from "./channel.js";
import { collectVideos } from "../playlist.js";

let defaultAutoCollectRunning = false;
let defaultAutoCollectPromise = null;

function resolveThumbnail(entry) {
  if (!entry || typeof entry !== "object") {
    return "";
  }
  if (typeof entry.thumbnail === "string" && entry.thumbnail) {
    return entry.thumbnail;
  }
  const thumbnails = entry.thumbnails;
  if (!thumbnails || typeof thumbnails !== "object") {
    return "";
  }
  const candidates = [
    thumbnails?.maxres?.url,
    thumbnails?.standard?.url,
    thumbnails?.high?.url,
    thumbnails?.medium?.url,
    thumbnails?.default?.url,
  ];
  for (const url of candidates) {
    if (typeof url === "string" && url) {
      return url;
    }
  }
  return "";
}

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
  const meta = await getAutoCollectMeta();
  if (meta?.lastRunAt) {
    const dt = new Date(meta.lastRunAt);
    if (!Number.isNaN(dt.getTime())) {
      return dt;
    }
  }
  return new Date(Date.now() - COLLECTION_WINDOW_MS);
}

export async function collectAndAppendSubscriptions({ origin = "auto" } = {}) {
  const context = { origin };
  const startDate = await resolveCollectionStartDate();
  const runStartedAt = Date.now();
  sendCollectionProgress({
    ...context,
    phase: "start",
    startDate: startDate.toISOString(),
  });
  try { 
    const entries = await collectVideos(startDate, (event) =>
      sendCollectionProgress({ ...context, ...event })
    );
    const before = await getState();
    const queueBefore = before.lists?.[DEFAULT_LIST]?.queue?.length || 0;
    const existingIds = new Set(
      (before.lists?.[DEFAULT_LIST]?.queue || []).map((item) => item.id)
    );
    const uniqueEntries = [];
    let skippedExisting = 0;
    for (const entry of entries) {
      if (!entry?.id) continue;
      if (existingIds.has(entry.id)) {
        skippedExisting += 1;
        continue;
      }
      existingIds.add(entry.id);
      const thumbnail = resolveThumbnail(entry);
      uniqueEntries.push({ ...entry, thumbnail });
    }
    sendCollectionProgress({
      ...context,
      phase: "readyToAdd",
      videoCount: uniqueEntries.length,
      skippedExisting,
      sourceTotal: entries.length,
    });
    sendCollectionProgress({
      ...context,
      phase: "adding",
      addCount: uniqueEntries.length,
      queueBefore,
    });
    if (uniqueEntries.length) {
      await addVideos(uniqueEntries, DEFAULT_LIST);
    }
    const afterAdd = await getState();
    const previousLength = before.lists?.[DEFAULT_LIST]?.queue?.length || 0;
    const newLength = afterAdd.lists?.[DEFAULT_LIST]?.queue?.length || 0;
    const added = Math.max(0, newLength - previousLength);
    await recordDefaultAutoCollect({
      added,
      fetched: uniqueEntries.length,
      startedAt: runStartedAt,
    });
    await notifyState();
    await dispatchNotifications();
    const presentation = await getPresentationState();
    sendCollectionProgress({
      ...context,
      phase: "complete",
      added,
      fetched: uniqueEntries.length,
      queueLength: newLength,
      skippedExisting,
    });
    return {
      origin,
      added,
      fetched: uniqueEntries.length,
      state: presentation,
    };
  } catch (err) {
    sendCollectionProgress({
      ...context,
      phase: "error",
      message: err?.message || "Не удалось собрать подписки",
    });
    throw err;
  }
}

async function runDefaultAutoCollect(queueLengthHint = 0) {
  try {
    await clearPendingDefaultRefresh();
    const result = await collectAndAppendSubscriptions({ origin: "auto" });
    if (!result?.added) {
      const queueSize = Array.isArray(result?.state?.lists)
        ? result.state.lists.find((list) => list.id === DEFAULT_LIST)?.length ??
          queueLengthHint
        : queueLengthHint;
      if (!queueSize) {
        await queueListEmptyNotification(DEFAULT_LIST);
        await notifyState();
        await dispatchNotifications();
      }
    }
  } finally {
    defaultAutoCollectRunning = false;
    defaultAutoCollectPromise = null;
  }
}

export async function ensureDefaultQueueFilled(options = {}) {
  const awaitCompletion = options?.awaitCompletion === true;
  if (defaultAutoCollectRunning && defaultAutoCollectPromise) {
    if (awaitCompletion) {
      try {
        await defaultAutoCollectPromise;
      } catch (err) {
        console.error("Auto-collection failed", err);
      }
    }
    return;
  }

  const { shouldCollect, onCooldown, queueLength } =
    await shouldAutoRefreshDefault();

  if (!shouldCollect && !onCooldown) {
    return;
  }

  if (onCooldown) {
    if (queueLength === 0) {
      await queueListEmptyNotification(DEFAULT_LIST);
      await notifyState();
      await dispatchNotifications();
    }
    await clearPendingDefaultRefresh();
    return;
  }

  defaultAutoCollectRunning = true;
  defaultAutoCollectPromise = runDefaultAutoCollect(queueLength);
  if (awaitCompletion) {
    try {
      await defaultAutoCollectPromise;
    } catch (err) {
      console.error("Auto-collection failed", err);
    }
  } else {
    defaultAutoCollectPromise.catch((err) => {
      console.error("Auto-collection failed", err);
    });
  }
}
