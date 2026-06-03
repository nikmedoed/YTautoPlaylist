// Compact playlist sync payload helpers. Keeps chrome.storage.sync under quota
// by storing portable queue identity instead of full video metadata.
import { DEFAULT_LIST_ID } from "./constants.js";
import { sanitizeState } from "./sanitizers.js";

const COMPACT_SYNC_VERSION = 2;

function compactEntry(entry, extraField = null) {
  const id = typeof entry?.id === "string" ? entry.id.trim() : "";
  if (!id) return null;
  const result = [id];
  if (entry?.addedAt) result.push(entry.addedAt);
  if (entry?.publishedAt) result.push(entry.publishedAt);
  if (extraField) result.push(entry?.[extraField] || 0, entry?.listId || null);
  return result;
}

function expandEntry(entry, extraField = null) {
  const source = Array.isArray(entry) ? entry : [entry?.id];
  const id = typeof source[0] === "string" ? source[0] : "";
  if (!id) return null;
  const expanded = {
    id,
    title: "",
    channelId: "",
    channelTitle: "",
    thumbnail: "",
    publishedAt: typeof source[2] === "string" ? source[2] : null,
    duration: null,
    addedAt: source[1] || Date.now(),
  };
  if (extraField) {
    expanded[extraField] = source[3] || Date.now();
    expanded.listId = source[4] || null;
  }
  return expanded;
}

function compactList(list) {
  return {
    n: list.name,
    f: list.freeze && list.id !== DEFAULT_LIST_ID ? 1 : 0,
    r: Number.isInteger(list.revision) ? list.revision : 0,
    q: (list.queue || []).map((entry) => compactEntry(entry)).filter(Boolean),
  };
}

function expandList(id, list) {
  const queue = Array.isArray(list?.q)
    ? list.q.map((entry) => expandEntry(entry)).filter(Boolean)
    : [];
  return {
    id,
    name: list?.n || undefined,
    freeze: Boolean(list?.f),
    queue,
    currentIndex: queue.length ? 0 : null,
    revision: Number.isInteger(list?.r) ? list.r : 0,
  };
}

function compactProgress(progress = {}) {
  const result = {};
  Object.entries(progress || {}).forEach(([id, value]) => {
    result[id] = [Number(value?.percent) || 0, Number(value?.updatedAt) || 0];
  });
  return result;
}

function expandProgress(progress = {}) {
  const result = {};
  Object.entries(progress || {}).forEach(([id, value]) => {
    const source = Array.isArray(value) ? value : [];
    result[id] = { percent: Number(source[0]) || 0, updatedAt: Number(source[1]) || 0 };
  });
  return result;
}

export function buildCompactSyncPayload(stateInput) {
  const state = sanitizeState(stateInput);
  const lists = {};
  Object.entries(state.lists || {}).forEach(([id, list]) => {
    lists[id] = compactList(list);
  });
  return {
    v: COMPACT_SYNC_VERSION,
    l: lists,
    o: state.listOrder,
    h: state.history.map((entry) => compactEntry(entry, "watchedAt")).filter(Boolean),
    d: state.deletedHistory
      .map((entry) => compactEntry(entry, "deletedAt"))
      .filter(Boolean),
    a: state.autoCollect,
    p: compactProgress(state.videoProgress),
  };
}

export function expandCompactSyncPayload(payload) {
  if (!payload || payload.v !== COMPACT_SYNC_VERSION) return null;
  const lists = {};
  Object.entries(payload.l || {}).forEach(([id, list]) => {
    lists[id] = expandList(id, list);
  });
  return sanitizeState({
    lists,
    listOrder: Array.isArray(payload.o) ? payload.o : [DEFAULT_LIST_ID],
    currentListId: DEFAULT_LIST_ID,
    currentVideoId: null,
    currentTabId: null,
    history: Array.isArray(payload.h)
      ? payload.h.map((entry) => expandEntry(entry, "watchedAt")).filter(Boolean)
      : [],
    deletedHistory: Array.isArray(payload.d)
      ? payload.d.map((entry) => expandEntry(entry, "deletedAt")).filter(Boolean)
      : [],
    autoCollect: payload.a || {},
    videoProgress: expandProgress(payload.p),
  });
}
