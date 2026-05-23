// Store actions for auto-collection metadata. Contains last-run, cooldown, counters, and seen-id updates.
import {
  getState,
  replaceState,
  ensureListExists,
  DEFAULT_LIST_ID,
} from "../state/index.js";
import {
  AUTO_COLLECT_COOLDOWN_MS,
  cloneAutoCollectMeta,
  ensureAutoCollectMeta,
  markListEmpty,
  toTimestamp,
  withState,
} from "./core.js";

export async function markAutoCollectRunStarted(startTime = Date.now()) {
  const ts = toTimestamp(startTime);
  const effective = ts === null ? Date.now() : ts;
  const state = await withState((state) => {
    const meta = ensureAutoCollectMeta(state);
    meta.lastRunAt = effective;
    return state;
  });
  const meta = ensureAutoCollectMeta(state);
  return cloneAutoCollectMeta(meta);
}

export async function setAutoCollectStartDate(value) {
  const ts = toTimestamp(value);
  if (ts === null) {
    return getAutoCollectMeta();
  }
  return markAutoCollectRunStarted(ts);
}

export async function shouldAutoRefreshDefault() {
  const state = await getState();
  const defaultList = state.lists[DEFAULT_LIST_ID];
  const meta = ensureAutoCollectMeta(state);
  const queueLength = defaultList ? defaultList.queue.length : 0;
  const needRefresh =
    Boolean(state.pendingDefaultRefresh) || (defaultList && queueLength <= 2);
  const now = Date.now();
  const onCooldown =
    meta.nextAutoCollectAt && meta.nextAutoCollectAt > now && needRefresh;
  return {
    shouldCollect: needRefresh && !onCooldown,
    onCooldown,
    queueLength,
  };
}

export async function clearPendingDefaultRefresh() {
  return withState((state) => {
    delete state.pendingDefaultRefresh;
    return state;
  });
}

export async function consumePendingNotifications() {
  const state = await getState();
  const notifications = Array.isArray(state.pendingNotifications)
    ? state.pendingNotifications.slice()
    : [];
  if (notifications.length) {
    state.pendingNotifications = [];
    await replaceState(state);
  }
  return notifications;
}

export async function getAutoCollectMeta() {
  const state = await getState();
  const meta = ensureAutoCollectMeta(state);
  return cloneAutoCollectMeta(meta);
}

export async function recordDefaultAutoCollect({
  added = 0,
  fetched = 0,
  startedAt = null,
} = {}) {
  return withState((state) => {
    const meta = ensureAutoCollectMeta(state);
    const now = Date.now();
    const runStartedAt = toTimestamp(startedAt);
    // The cursor advances only after a fully successful collect/filter/add pass.
    // It stores the successful run start so videos published during this run
    // remain in the next logical window if YouTube indexes them late.
    meta.lastRunAt = runStartedAt !== null ? runStartedAt : now;
    meta.lastAdded = Math.max(0, Number(added) || 0);
    meta.lastFetched = Math.max(0, Number(fetched) || 0);
    meta.nextAutoCollectAt = now + AUTO_COLLECT_COOLDOWN_MS;
    return state;
  });
}

export async function queueListEmptyNotification(listId = DEFAULT_LIST_ID) {
  if (!listId) return getState();
  return withState((state) => {
    ensureListExists(state, listId);
    const list = state.lists[listId];
    markListEmpty(state, list);
    return state;
  });
}
