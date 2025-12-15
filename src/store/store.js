import {
  mutateState,
  getState,
  replaceState,
  ensureDefaultList,
  ensureListExists,
  sanitizeEntry,
  sanitizeHistoryEntry,
  sanitizeDeletedHistoryEntry,
  sanitizeState,
  HISTORY_LIMIT,
  DEFAULT_LIST_ID,
  DEFAULT_LIST_NAME,
  applyVideoProgress,
  cloneVideoProgress,
} from "./state.js";

const AUTO_COLLECT_COOLDOWN_MS = 60 * 60 * 1000;

function clampProgressValue(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  const rounded = Math.round(value);
  if (!Number.isFinite(rounded)) {
    return null;
  }
  if (rounded <= 0) {
    return 0;
  }
  if (rounded >= 100) {
    return 100;
  }
  return rounded;
}

function withState(mutator) {
  return mutateState((state) => {
    ensureDefaultList(state);
    return mutator(state);
  });
}

function resolveList(state, listId, { fallback = true } = {}) {
  if (listId && state.lists[listId]) {
    return state.lists[listId];
  }
  if (!fallback) {
    return null;
  }
  const targetId =
    state.currentListId && state.lists[state.currentListId]
      ? state.currentListId
      : DEFAULT_LIST_ID;
  ensureListExists(state, targetId);
  return state.lists[targetId];
}

function ensureNotificationQueue(state) {
  if (!Array.isArray(state.pendingNotifications)) {
    state.pendingNotifications = [];
  }
  return state.pendingNotifications;
}

function ensureAutoCollectMeta(state) {
  if (!state.autoCollect || typeof state.autoCollect !== "object") {
    state.autoCollect = {
      lastRunAt: 0,
      lastAdded: 0,
      lastFetched: 0,
      nextAutoCollectAt: 0,
    };
  } else {
    state.autoCollect.lastRunAt = Number(state.autoCollect.lastRunAt) || 0;
    state.autoCollect.lastAdded = Math.max(
      0,
      Number(state.autoCollect.lastAdded) || 0
    );
    state.autoCollect.lastFetched = Math.max(
      0,
      Number(state.autoCollect.lastFetched) || 0
    );
    state.autoCollect.nextAutoCollectAt =
      Number(state.autoCollect.nextAutoCollectAt) > 0
        ? Number(state.autoCollect.nextAutoCollectAt)
        : 0;
  }
  return state.autoCollect;
}

/**
 * The auto collect metadata is stored inside the global state object and is
 * therefore mutable. Whenever we return it to the outside world we provide a
 * defensive clone to ensure callers cannot accidentally mutate the shared
 * state. While cloning we also normalise the numeric fields so the store keeps
 * working even if someone tampered with the values before calling us.
 */
function cloneAutoCollectMeta(meta) {
  return {
    lastRunAt: Number(meta.lastRunAt) || 0,
    lastAdded: Math.max(0, Number(meta.lastAdded) || 0),
    lastFetched: Math.max(0, Number(meta.lastFetched) || 0),
    nextAutoCollectAt:
      Number(meta.nextAutoCollectAt) > 0
        ? Number(meta.nextAutoCollectAt)
        : 0,
  };
}

function bumpListRevision(list) {
  if (!list || typeof list !== "object") {
    return;
  }
  const current = Number.isInteger(list.revision) ? list.revision : 0;
  list.revision = current + 1;
}

function toTimestamp(value) {
  if (value instanceof Date) {
    const ts = value.getTime();
    return Number.isNaN(ts) ? null : Math.max(0, Math.trunc(ts));
  }
  if (typeof value === "string") {
    const dt = new Date(value);
    const ts = dt.getTime();
    return Number.isNaN(ts) ? null : Math.max(0, Math.trunc(ts));
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.trunc(value));
  }
  return null;
}

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

function markListEmpty(state, list) {
  const notifications = ensureNotificationQueue(state);
  notifications.push({
    type: "listEmpty",
    listId: list.id,
    name: list.name,
  });
}

function adjustIndexAfterRemoval(list, removedIndex) {
  if (list.currentIndex === null) {
    return;
  }
  if (removedIndex < list.currentIndex) {
    list.currentIndex -= 1;
  } else if (removedIndex === list.currentIndex) {
    if (list.queue.length) {
      list.currentIndex = Math.min(removedIndex, list.queue.length - 1);
      if (removedIndex >= list.queue.length && list.queue.length > 0) {
        list.currentIndex = 0;
      }
    } else {
      list.currentIndex = null;
    }
  }
  if (!list.queue.length) {
    list.currentIndex = null;
  } else if (
    list.currentIndex === null ||
    list.currentIndex < 0 ||
    list.currentIndex >= list.queue.length
  ) {
    list.currentIndex = 0;
  }
}

function findVideo(state, videoId, { preferListId = null } = {}) {
  const searchLists = [];
  if (preferListId && state.lists[preferListId]) {
    searchLists.push(state.lists[preferListId]);
  }
  for (const list of Object.values(state.lists)) {
    if (list && list.id === preferListId) {
      continue;
    }
    searchLists.push(list);
  }
  for (const list of searchLists) {
    const index = list.queue.findIndex((item) => item.id === videoId);
    if (index !== -1) {
      return { list, index };
    }
  }
  return null;
}

function appendHistory(state, entry, listId) {
  state.history.unshift(
    sanitizeHistoryEntry({ ...entry, listId, watchedAt: Date.now() })
  );
  state.history = state.history.slice(0, HISTORY_LIMIT);
}

function ensureDeletedHistory(state) {
  if (!Array.isArray(state.deletedHistory)) {
    state.deletedHistory = [];
  }
  return state.deletedHistory;
}

function appendDeletedHistory(state, entry, listId) {
  try {
    const history = ensureDeletedHistory(state);
    const sanitized = sanitizeDeletedHistoryEntry({
      ...entry,
      listId,
      deletedAt: Date.now(),
    });
    state.deletedHistory = history.filter((item) => item.id !== sanitized.id);
    state.deletedHistory.unshift(sanitized);
    state.deletedHistory = state.deletedHistory.slice(0, HISTORY_LIMIT);
  } catch {
    /* ignore invalid entry */
  }
}

function ensureDefaultRefreshFlag(state) {
  const defaultList = state.lists[DEFAULT_LIST_ID];
  if (!defaultList) return;
  if (defaultList.queue.length <= 2) {
    state.pendingDefaultRefresh = true;
  } else {
    state.pendingDefaultRefresh = false;
  }
}

function generateListId() {
  return `list_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 6)}`;
}

export async function addList({ name, freeze = false } = {}) {
  return withState((state) => {
    const id = generateListId();
    state.lists[id] = {
      id,
      name: name?.trim() || "Новый список",
      freeze: Boolean(freeze),
      queue: [],
      currentIndex: null,
      revision: 0,
    };
    state.listOrder.push(id);
    if (!state.currentListId) {
      state.currentListId = id;
    }
    return state;
  });
}

export async function renameList(listId, newName) {
  if (!listId || !newName) return getState();
  return withState((state) => {
    ensureListExists(state, listId);
    state.lists[listId].name = newName.trim();
    if (listId === DEFAULT_LIST_ID) {
      state.lists[listId].name = DEFAULT_LIST_NAME;
    }
    return state;
  });
}

export async function setListFreeze(listId, freeze) {
  if (!listId) return getState();
  return withState((state) => {
    ensureListExists(state, listId);
    if (listId === DEFAULT_LIST_ID) {
      state.lists[listId].freeze = false;
      return state;
    }
    state.lists[listId].freeze = Boolean(freeze);
    return state;
  });
}

function detachList(state, listId) {
  const list = state.lists[listId];
  delete state.lists[listId];
  state.listOrder = state.listOrder.filter((id) => id !== listId);
  if (state.currentListId === listId) {
    state.currentListId = DEFAULT_LIST_ID;
  }
  if (state.currentListId === DEFAULT_LIST_ID) {
    state.currentVideoId = null;
  }
  return list;
}

export async function removeList(
  listId,
  { mode = "move", targetListId = DEFAULT_LIST_ID } = {}
) {
  if (!listId || listId === DEFAULT_LIST_ID) {
    return getState();
  }
  return withState((state) => {
    ensureListExists(state, listId);
    const list = detachList(state, listId);
    if (mode === "delete") {
      if (list.queue.length) {
        ensureNotificationQueue(state);
        markListEmpty(state, list);
      }
      return state;
    }
    const target = resolveList(state, targetListId || DEFAULT_LIST_ID);
    const existingIds = new Set(target.queue.map((item) => item.id));
    for (const entry of list.queue) {
      if (!existingIds.has(entry.id)) {
        target.queue.push(entry);
        existingIds.add(entry.id);
      }
    }
    if (target.currentIndex === null && target.queue.length) {
      target.currentIndex = 0;
    }
    return state;
  });
}

export async function setCurrentList(listId) {
  if (!listId) return getState();
  return withState((state) => {
    ensureListExists(state, listId);
    const previousListId = state.currentListId;
    state.currentListId = listId;

    if (previousListId === listId) {
      return state;
    }

    const list = state.lists[listId];
    if (!list) {
      state.currentVideoId = null;
      return state;
    }

    if (!Array.isArray(list.queue) || list.queue.length === 0) {
      list.currentIndex = null;
      state.currentVideoId = null;
      return state;
    }

    const indexIsNumber = typeof list.currentIndex === "number";
    if (!indexIsNumber || list.currentIndex < 0 || list.currentIndex >= list.queue.length) {
      list.currentIndex = 0;
    }
    state.currentVideoId = list.queue[list.currentIndex]?.id || null;
    return state;
  });
}

export async function addVideos(entries = [], listId = null) {
  if (!Array.isArray(entries) || !entries.length) {
    return getState();
  }
  return withState((state) => {
    const list = resolveList(state, listId);
    const existingIds = new Set(list.queue.map((item) => item.id));
    const incoming = [];
    for (const entry of entries) {
      try {
        const sanitized = sanitizeEntry(entry);
        if (!existingIds.has(sanitized.id)) {
          existingIds.add(sanitized.id);
          incoming.push(sanitized);
        }
      } catch {
        // skip invalid entry
      }
    }
    if (!incoming.length) {
      return state;
    }
    list.queue = list.queue.concat(incoming);
    bumpListRevision(list);
    if (list.currentIndex === null && list.queue.length) {
      list.currentIndex = 0;
    }
    if (list.id === DEFAULT_LIST_ID) {
      ensureDefaultRefreshFlag(state);
    }
    return state;
  });
}

export async function removeVideo(videoId, { listId = null } = {}) {
  if (!videoId) return getState();
  return removeVideos([videoId], { listId });
}

export async function removeVideos(videoIds, { listId = null } = {}) {
  const ids = Array.isArray(videoIds) ? videoIds : [videoIds];
  const uniqueIds = Array.from(
    new Set(
      ids
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter((id) => id.length > 0)
    )
  );
  if (!uniqueIds.length) {
    return getState();
  }
  return withState((state) => {
    const targets = listId
      ? [resolveList(state, listId, { fallback: false })].filter(Boolean)
      : Object.values(state.lists);
    if (!targets.length) {
      return state;
    }
    const idSet = new Set(uniqueIds);
    let removedAny = false;
    let touchedDefault = false;
    const emptied = [];
    for (const list of targets) {
      if (!list || !Array.isArray(list.queue) || !list.queue.length) {
        continue;
      }
      let removedFromList = false;
      for (let index = list.queue.length - 1; index >= 0; index -= 1) {
        const entry = list.queue[index];
        if (!entry || !idSet.has(entry.id)) {
          continue;
        }
        appendDeletedHistory(state, entry, list.id);
        list.queue.splice(index, 1);
        adjustIndexAfterRemoval(list, index);
        removedAny = true;
        removedFromList = true;
        if (state.currentListId === list.id && state.currentVideoId === entry.id) {
          state.currentVideoId = null;
        }
      }
      if (!removedFromList) {
        continue;
      }
      bumpListRevision(list);
      if (list.id === DEFAULT_LIST_ID) {
        touchedDefault = true;
      } else if (!list.queue.length) {
        emptied.push(list);
      }
    }
    if (!removedAny) {
      return state;
    }
    if (touchedDefault) {
      ensureDefaultRefreshFlag(state);
    }
    emptied.forEach((list) => {
      markListEmpty(state, list);
    });
    state.history = state.history.filter((item) => !idSet.has(item.id));
    return state;
  });
}

export async function setCurrentVideo(videoId, listId = null) {
  if (!videoId) return getState();
  return withState((state) => {
    let targetList = listId ? state.lists[listId] : null;
    let index = -1;
    if (targetList) {
      index = targetList.queue.findIndex((item) => item.id === videoId);
    } else {
      const located = findVideo(state, videoId);
      if (located) {
        targetList = located.list;
        index = located.index;
      }
    }
    if (!targetList || index === -1) {
      return state;
    }
    targetList.currentIndex = index;
    state.currentListId = targetList.id;
    state.currentVideoId = videoId;
    return state;
  });
}

export async function suspendPlayback() {
  return withState((state) => {
    state.currentVideoId = null;
    return state;
  });
}

export async function setCurrentTab(tabId) {
  return withState((state) => {
    state.currentTabId =
      typeof tabId === "number" && Number.isInteger(tabId) ? tabId : null;
    return state;
  });
}

export async function clearCurrentTab(tabId) {
  return withState((state) => {
    if (state.currentTabId === tabId) {
      state.currentTabId = null;
    }
    return state;
  });
}

export async function recordVideoProgress(videoId, percent, options = {}) {
  const id = typeof videoId === "string" ? videoId.trim() : "";
  if (!id) {
    return false;
  }
  const clamped = clampProgressValue(percent);
  if (clamped === null) {
    return false;
  }
  const timestampCandidate = Number(options.timestamp);
  const timestamp = Number.isFinite(timestampCandidate)
    ? Math.max(0, Math.trunc(timestampCandidate))
    : Date.now();
  const current = await getState();
  const existing =
    current?.videoProgress && typeof current.videoProgress === "object"
      ? current.videoProgress[id] || null
      : null;
  if (clamped <= 0 && !existing) {
    return false;
  }
  if (
    existing &&
    existing.percent === clamped &&
    timestamp <= (Number(existing.updatedAt) || 0)
  ) {
    return false;
  }
  let changed = false;
  await withState((state) => {
    changed = applyVideoProgress(state, id, clamped, { timestamp });
    return state;
  });
  return changed;
}

export async function markVideoWatched(videoId, { listId = null } = {}) {
  if (!videoId) return getState();
  return withState((state) => {
    const located = findVideo(state, videoId, { preferListId: listId });
    if (!located) {
      return state;
    }
    const { list, index } = located;
    if (index < 0) {
      return state;
    }
    const entry = list.queue[index];
    appendHistory(state, entry, list.id);
    applyVideoProgress(state, videoId, 100, { timestamp: Date.now() });
    const shouldRemove = list.id === DEFAULT_LIST_ID || !list.freeze;
    let listChanged = false;
    if (shouldRemove) {
      list.queue.splice(index, 1);
      adjustIndexAfterRemoval(list, index);
      listChanged = true;
    } else if (list.currentIndex === index && list.queue.length > 1) {
      list.currentIndex = (index + 1) % list.queue.length;
    }
    if (state.currentListId === list.id && state.currentVideoId === videoId) {
      if (list.queue.length && list.currentIndex !== null) {
        state.currentVideoId = list.queue[list.currentIndex]?.id || null;
      } else {
        state.currentVideoId = null;
      }
    }
    if (list.id === DEFAULT_LIST_ID) {
      ensureDefaultRefreshFlag(state);
    } else if (!list.queue.length) {
      markListEmpty(state, list);
    }
    if (listChanged) {
      bumpListRevision(list);
    }
    return state;
  });
}

export async function postponeVideo(videoId, { listId = null } = {}) {
  if (!videoId) return getState();
  return withState((state) => {
    const located = findVideo(state, videoId, { preferListId: listId });
    if (!located) {
      return state;
    }
    const { list, index } = located;
    if (index < 0) {
      return state;
    }
    if (list.queue.length <= 1) {
      return state;
    }
    if (list.freeze) {
      return state;
    }
    const [entry] = list.queue.splice(index, 1);
    if (!entry) {
      return state;
    }
    const wasCurrentVideo =
      list.currentIndex === index &&
      state.currentListId === list.id &&
      state.currentVideoId === videoId;
    adjustIndexAfterRemoval(list, index);
    list.queue.push(entry);
    bumpListRevision(list);
    if (list.currentIndex === null && list.queue.length) {
      list.currentIndex = 0;
    }
    if (wasCurrentVideo) {
      const nextEntry =
        list.currentIndex !== null ? list.queue[list.currentIndex] : null;
      state.currentVideoId = nextEntry ? nextEntry.id : null;
      state.currentListId = nextEntry ? list.id : state.currentListId;
    }
    return state;
  });
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
    if (runStartedAt !== null) {
      meta.lastRunAt = runStartedAt;
    } else if (!meta.lastRunAt) {
      meta.lastRunAt = now;
    }
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

export async function getNextQueueEntry(stateInput = null) {
  const state = stateInput ? sanitizeState(stateInput) : await getState();
  const list = state.currentListId
    ? state.lists[state.currentListId]
    : null;
  if (!list || list.currentIndex === null) return null;
  const nextIndex = list.currentIndex + 1;
  if (nextIndex >= list.queue.length) return null;
  return list.queue[nextIndex];
}

export async function playHistoryEntry(position = 0, options = {}) {
  const placement = options.placement || "front";
  return withState((state) => {
    if (!state.history.length) {
      return state;
    }
    const idx = Math.min(
      Math.max(Number(position) || 0, 0),
      state.history.length - 1
    );
    const [entry] = state.history.splice(idx, 1);
    if (!entry) return state;
    const preferredListId =
      entry.listId && state.lists[entry.listId] ? entry.listId : null;
    const list = resolveList(state, preferredListId);
    const revived = sanitizeEntry({ ...entry, addedAt: Date.now() });
    const existingIndex = list.queue.findIndex(
      (item) => item.id === revived.id
    );
    if (existingIndex !== -1) {
      list.queue.splice(existingIndex, 1);
      adjustIndexAfterRemoval(list, existingIndex);
    }
    let insertIndex = 0;
    if (placement === "beforeCurrent") {
      insertIndex =
        list.currentIndex !== null ? Math.max(list.currentIndex, 0) : 0;
    } else if (placement === "end") {
      insertIndex = list.queue.length;
    }
    list.queue.splice(insertIndex, 0, revived);
    list.currentIndex = insertIndex;
    state.currentListId = list.id;
    state.currentVideoId = revived.id;
    bumpListRevision(list);
    if (list.id === DEFAULT_LIST_ID) {
      ensureDefaultRefreshFlag(state);
    }
    return state;
  });
}

export async function reorderQueue(videoId, targetIndex, listId = null) {
  if (!videoId || typeof targetIndex !== "number") {
    return getState();
  }
  return withState((state) => {
    const list = resolveList(state, listId);
    const fromIndex = list.queue.findIndex((item) => item.id === videoId);
    if (fromIndex === -1) return state;
    const toIndex = Math.max(0, Math.min(list.queue.length - 1, targetIndex));
    if (fromIndex === toIndex) return state;
    const [entry] = list.queue.splice(fromIndex, 1);
    list.queue.splice(toIndex, 0, entry);
    if (list.currentIndex === fromIndex) {
      list.currentIndex = toIndex;
    } else if (
      fromIndex < list.currentIndex &&
      toIndex >= list.currentIndex
    ) {
      list.currentIndex -= 1;
    } else if (
      fromIndex > list.currentIndex &&
      toIndex <= list.currentIndex
    ) {
      list.currentIndex += 1;
    }
    bumpListRevision(list);
    return state;
  });
}

export async function restoreDeletedEntry(position = 0) {
  return withState((state) => {
    const history = ensureDeletedHistory(state);
    if (!history.length) {
      return state;
    }
    const idx = Math.min(Math.max(Number(position) || 0, 0), history.length - 1);
    const [entry] = history.splice(idx, 1);
    if (!entry) {
      return state;
    }
    const preferredListId = entry.listId && state.lists[entry.listId]
      ? entry.listId
      : null;
    const list = resolveList(state, preferredListId);
    const revived = sanitizeEntry({ ...entry, addedAt: Date.now() });
    const existingIndex = list.queue.findIndex((item) => item.id === revived.id);
    if (existingIndex !== -1) {
      list.queue.splice(existingIndex, 1);
      adjustIndexAfterRemoval(list, existingIndex);
    }
    list.queue.push(revived);
    bumpListRevision(list);
    if (list.currentIndex === null) {
      list.currentIndex = 0;
    }
    if (list.id === DEFAULT_LIST_ID) {
      ensureDefaultRefreshFlag(state);
    }
    return state;
  });
}

export async function moveVideoToList(videoId, targetListId) {
  if (!videoId || !targetListId) return getState();
  return withState((state) => {
    ensureListExists(state, targetListId);
    const located = findVideo(state, videoId);
    if (!located) return state;
    const { list, index } = located;
    if (list.id === targetListId) return state;
    const [entry] = list.queue.splice(index, 1);
    adjustIndexAfterRemoval(list, index);
    bumpListRevision(list);
    if (list.id === DEFAULT_LIST_ID) {
      ensureDefaultRefreshFlag(state);
    } else if (!list.queue.length) {
      markListEmpty(state, list);
    }
    const target = state.lists[targetListId];
    const existingIdx = target.queue.findIndex((item) => item.id === videoId);
    if (existingIdx !== -1) {
      target.queue.splice(existingIdx, 1);
      adjustIndexAfterRemoval(target, existingIdx);
      bumpListRevision(target);
    }
    target.queue.push(entry);
    bumpListRevision(target);
    if (target.currentIndex === null) {
      target.currentIndex = 0;
    }
    if (target.id === DEFAULT_LIST_ID) {
      ensureDefaultRefreshFlag(state);
    }
    if (state.currentListId === list.id && state.currentVideoId === videoId) {
      state.currentVideoId = null;
    }
    return state;
  });
}

export async function exportList(listId) {
  const state = await getState();
  const list = resolveList(state, listId);
  return {
    id: list.id,
    name: list.name,
    freeze: list.freeze,
    queue: list.queue,
  };
}

export async function importList(
  data,
  { mode = "new", targetListId = null } = {}
) {
  if (!data || typeof data !== "object") {
    throw new Error("Invalid import data");
  }
  const entries = Array.isArray(data.queue) ? data.queue : [];
  if (mode === "append") {
    const listId = targetListId || DEFAULT_LIST_ID;
    return addVideos(entries, listId);
  }
  return withState((state) => {
    const id = generateListId();
    const queue = entries
      .map((item) => {
        try {
          return sanitizeEntry(item);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    state.lists[id] = {
      id,
      name: data.name?.trim() || "Импортированный список",
      freeze: Boolean(data.freeze),
      queue,
      currentIndex: 0,
      revision: queue.length,
    };
    state.listOrder.push(id);
    return state;
  });
}

export async function getPresentationState() {
  const state = await getState();
  const autoMeta = ensureAutoCollectMeta(state);
  const listsMeta = state.listOrder
    .map((id) => state.lists[id])
    .filter(Boolean)
    .map((list) => ({
      id: list.id,
      name: list.name,
      freeze: list.freeze,
      length: list.queue.length,
      revision: Number.isInteger(list.revision) ? list.revision : 0,
    }));
  const currentList = state.lists[state.currentListId];
  return {
    lists: listsMeta,
    currentListId: state.currentListId,
    activeListId: state.currentListId,
    currentVideoId: state.currentVideoId,
    currentTabId: state.currentTabId,
    videoProgress: cloneVideoProgress(state),
    currentQueue: currentList
      ? {
          id: currentList.id,
          name: currentList.name,
          freeze: currentList.freeze,
          queue: currentList.queue,
          currentIndex: currentList.currentIndex,
        }
      : null,
    history: state.history,
    deletedHistory: state.deletedHistory,
    autoCollect: {
      lastRunAt: autoMeta.lastRunAt || 0,
      lastAdded: autoMeta.lastAdded || 0,
      lastFetched: autoMeta.lastFetched || 0,
      nextAutoCollectAt: autoMeta.nextAutoCollectAt || 0,
      cooldownMs: AUTO_COLLECT_COOLDOWN_MS,
    },
  };
}

export const DEFAULT_LIST = DEFAULT_LIST_ID;

export async function moveAllVideos(sourceListId, targetListId) {
  if (!sourceListId || !targetListId || sourceListId === targetListId) {
    return getState();
  }
  return withState((state) => {
    ensureListExists(state, sourceListId);
    ensureListExists(state, targetListId);
    const source = state.lists[sourceListId];
    const target = state.lists[targetListId];
    if (!source.queue.length) {
      return state;
    }
    const existingIds = new Set(target.queue.map((item) => item.id));
    let appended = false;
    for (const entry of source.queue) {
      if (!existingIds.has(entry.id)) {
        target.queue.push(entry);
        appended = true;
      }
    }
    if (appended) {
      bumpListRevision(target);
    }
    if (target.currentIndex === null && target.queue.length) {
      target.currentIndex = 0;
    }
    if (state.currentListId === source.id && state.currentVideoId) {
      state.currentVideoId = null;
    }
    const sourceWasDefault = sourceListId === DEFAULT_LIST_ID;
    source.queue = [];
    source.currentIndex = null;
    bumpListRevision(source);
    if (sourceWasDefault) {
      state.pendingDefaultRefresh = true;
    }
    if (targetListId === DEFAULT_LIST_ID) {
      ensureDefaultRefreshFlag(state);
    }
    if (!sourceWasDefault) {
      markListEmpty(state, source);
    }
    return state;
  });
}

export async function getListDetails(listId) {
  const state = await getState();
  ensureDefaultList(state);
  ensureListExists(state, listId);
  const list = state.lists[listId];
  return {
    id: list.id,
    name: list.name,
    freeze: list.freeze,
    queue: list.queue,
    length: list.queue.length,
    revision: Number.isInteger(list.revision) ? list.revision : 0,
  };
}

export {
  getState,
  replaceState,
  mutateState, // exported for advanced flows if needed
};
