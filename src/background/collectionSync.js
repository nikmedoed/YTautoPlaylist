// Runs subscription auto-collection and default-list refill logic. Contains fetch-window calculation, dedupe state, append flow, and progress dispatch.
import {
  addVideos,
  clearPendingDefaultRefresh,
  consumePendingNotifications,
  DEFAULT_LIST,
  getPresentationState,
  getState,
  getAutoCollectMeta,
  normalizeAutoCollectTimestamp,
  queueListEmptyNotification,
  recordDefaultAutoCollect,
  shouldAutoRefreshDefault,
} from "../store/index.js";
import { COLLECTION_WINDOW_MS } from "./constants.js";
import { sendCollectionProgress, notifyState } from "./channel.js";
import { collectVideos } from "../playlist.js";
import { resolveThumbnailUrl } from "../utils.js";

let defaultAutoCollectRunning = false;
let defaultAutoCollectPromise = null;

function addEntryIds(target, entries) {
  if (!(target instanceof Set) || !Array.isArray(entries)) {
    return target;
  }
  for (const entry of entries) {
    const id = typeof entry === "string"
      ? entry.trim()
      : entry && typeof entry === "object" && typeof entry.id === "string"
        ? entry.id.trim()
        : "";
    if (id) {
      target.add(id);
    }
  }
  return target;
}

export function collectAutoCollectSeenIds(
  state,
  { listId = DEFAULT_LIST } = {}
) {
  const seenIds = new Set();
  // The cursor intentionally stays at the previous successful run start. That
  // avoids misses, but it means the next run re-queries a multi-day window and
  // needs a durable per-default-list dedupe memory.
  addEntryIds(seenIds, state?.autoCollect?.seenIds || []);
  addEntryIds(seenIds, state?.lists?.[listId]?.queue || []);
  const history = Array.isArray(state?.history) ? state.history : [];
  for (const entry of history) {
    if (entry?.listId === listId || (!entry?.listId && listId === DEFAULT_LIST)) {
      addEntryIds(seenIds, [entry]);
    }
  }
  const deletedHistory = Array.isArray(state?.deletedHistory)
    ? state.deletedHistory
    : [];
  for (const entry of deletedHistory) {
    if (entry?.listId === listId || (!entry?.listId && listId === DEFAULT_LIST)) {
      addEntryIds(seenIds, [entry]);
    }
  }
  return seenIds;
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
  const cursorTs = normalizeAutoCollectTimestamp(meta?.lastRunAt);

  if (cursorTs > 0) {
    const dt = new Date(cursorTs);
    if (!Number.isNaN(dt.getTime())) {
      return dt;
    }
  }
  return new Date(Date.now() - COLLECTION_WINDOW_MS);
}

// Runs the full subscription collection transaction. The last-run cursor only
// advances after fetch, filter, append, notification, and presentation refresh
// all complete successfully.
export async function collectAndAppendSubscriptions({ origin = "auto" } = {}) {
  const context = { origin };
  const runStartedAt = Date.now();
  const startDate = await resolveCollectionStartDate();
  const before = await getState();
  const queueBefore = before.lists?.[DEFAULT_LIST]?.queue?.length || 0;
  const existingIds = collectAutoCollectSeenIds(before);
  sendCollectionProgress({
    ...context,
    phase: "start",
    startDate: startDate.toISOString(),
  });
  try {
    const entries = await collectVideos(
      startDate,
      (event) => sendCollectionProgress({ ...context, ...event }),
      { excludeIds: existingIds }
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
      const thumbnail = resolveThumbnailUrl(entry);
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
    const newLength = afterAdd.lists?.[DEFAULT_LIST]?.queue?.length || 0;
    const added = Math.max(0, newLength - queueBefore);
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
