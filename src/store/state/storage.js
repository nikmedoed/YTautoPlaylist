// Chrome storage adapter for store state. Contains load, save, and mutation helpers around persisted playlist data.
import {
  AUTO_COLLECT_STORAGE_KEY,
  DELETED_HISTORY_STORAGE_KEY,
  LEGACY_AUTO_COLLECT_STORAGE_KEY,
  LEGACY_STORAGE_KEY,
  LISTS_STORAGE_KEY,
  META_STORAGE_KEY,
  RUNTIME_STORAGE_KEY,
  VIDEO_PROGRESS_STORAGE_KEY,
  defaultState,
  getListStorageKey,
} from "./constants.js";
import { composeRawState, splitStateForStorage } from "./serialization.js";
import { sanitizeState } from "./sanitizers.js";
import { deepClone } from "../../utils.js";

const hasChromeStorage =
  typeof chrome !== "undefined" && chrome?.storage?.local;
let memoryState = null;
let stateWriteQueue = Promise.resolve();

// Serializes read-modify-write operations so parallel add/remove calls cannot
// read the same old state and then overwrite each other.
function enqueueStateWrite(operation) {
  const result = stateWriteQueue.then(operation, operation);
  stateWriteQueue = result.catch(() => {});
  return result;
}

// Loads every split state key from chrome.storage and falls back to legacy monolithic state when needed.
async function loadRawState() {
  if (!hasChromeStorage) {
    const source = memoryState ?? defaultState;
    return deepClone(source);
  }

  const stored = await chrome.storage.local.get([
    META_STORAGE_KEY,
    RUNTIME_STORAGE_KEY,
    VIDEO_PROGRESS_STORAGE_KEY,
    LISTS_STORAGE_KEY,
    LEGACY_STORAGE_KEY,
    AUTO_COLLECT_STORAGE_KEY,
    LEGACY_AUTO_COLLECT_STORAGE_KEY,
    DELETED_HISTORY_STORAGE_KEY,
  ]);

  if (stored?.[LEGACY_STORAGE_KEY]) {
    const migrated = sanitizeState(stored[LEGACY_STORAGE_KEY]);
    const {
      listContents,
      meta,
      runtime,
      autoCollect,
      deletedHistory,
      videoProgress,
    } = splitStateForStorage(migrated);
    const payload = {
      [META_STORAGE_KEY]: meta,
      [RUNTIME_STORAGE_KEY]: runtime,
      [AUTO_COLLECT_STORAGE_KEY]: autoCollect,
      [DELETED_HISTORY_STORAGE_KEY]: deletedHistory,
      [VIDEO_PROGRESS_STORAGE_KEY]: videoProgress,
    };
    Object.entries(listContents).forEach(([id, content]) => {
      payload[getListStorageKey(id)] = content;
    });
    await chrome.storage.local.set(payload);
    await chrome.storage.local.remove([
      LEGACY_STORAGE_KEY,
      LISTS_STORAGE_KEY,
      LEGACY_AUTO_COLLECT_STORAGE_KEY,
    ]);
    return composeRawState(
      meta,
      runtime,
      listContents,
      autoCollect,
      deletedHistory,
      videoProgress
    );
  }

  if (stored?.[LISTS_STORAGE_KEY]) {
    const migrated = composeRawState(
      stored?.[META_STORAGE_KEY],
      stored?.[RUNTIME_STORAGE_KEY],
      stored?.[LISTS_STORAGE_KEY],
      stored?.[AUTO_COLLECT_STORAGE_KEY] ||
        stored?.[LEGACY_AUTO_COLLECT_STORAGE_KEY],
      stored?.[DELETED_HISTORY_STORAGE_KEY]
    );
    const sanitized = sanitizeState(migrated);
    const {
      listContents,
      meta,
      runtime,
      autoCollect,
      deletedHistory,
      videoProgress,
    } = splitStateForStorage(sanitized);
    const payload = {
      [META_STORAGE_KEY]: meta,
      [RUNTIME_STORAGE_KEY]: runtime,
      [AUTO_COLLECT_STORAGE_KEY]: autoCollect,
      [DELETED_HISTORY_STORAGE_KEY]: deletedHistory,
      [VIDEO_PROGRESS_STORAGE_KEY]: videoProgress,
    };
    Object.entries(listContents).forEach(([id, content]) => {
      payload[getListStorageKey(id)] = content;
    });
    await chrome.storage.local.set(payload);
    await chrome.storage.local.remove([
      LISTS_STORAGE_KEY,
      LEGACY_AUTO_COLLECT_STORAGE_KEY,
    ]);
    return composeRawState(
      meta,
      runtime,
      listContents,
      autoCollect,
      deletedHistory,
      videoProgress
    );
  }

  const meta =
    stored?.[META_STORAGE_KEY] &&
    typeof stored[META_STORAGE_KEY] === "object"
      ? stored[META_STORAGE_KEY]
      : {};
  const runtime =
    stored?.[RUNTIME_STORAGE_KEY] &&
    typeof stored[RUNTIME_STORAGE_KEY] === "object"
      ? stored[RUNTIME_STORAGE_KEY]
      : {};
  const autoCollectSource =
    (stored?.[AUTO_COLLECT_STORAGE_KEY] &&
      typeof stored[AUTO_COLLECT_STORAGE_KEY] === "object"
      ? stored[AUTO_COLLECT_STORAGE_KEY]
      : null) ||
    (stored?.[LEGACY_AUTO_COLLECT_STORAGE_KEY] &&
      typeof stored[LEGACY_AUTO_COLLECT_STORAGE_KEY] === "object"
      ? stored[LEGACY_AUTO_COLLECT_STORAGE_KEY]
      : null) ||
    runtime?.autoCollect;
  const autoCollect = autoCollectSource;

  const deletedHistorySource = Array.isArray(
    stored?.[DELETED_HISTORY_STORAGE_KEY]
  )
    ? stored[DELETED_HISTORY_STORAGE_KEY]
    : runtime?.deletedHistory;

  const videoProgressSource =
    stored?.[VIDEO_PROGRESS_STORAGE_KEY] &&
    typeof stored[VIDEO_PROGRESS_STORAGE_KEY] === "object"
      ? stored[VIDEO_PROGRESS_STORAGE_KEY]
      : runtime?.videoProgress;

  const listIds = Object.keys(
    meta.lists && typeof meta.lists === "object" ? meta.lists : {}
  );
  const listKeys = listIds.map(getListStorageKey);
  let listEntries = {};

  if (listKeys.length) {
    const storedLists = await chrome.storage.local.get(listKeys);
    listEntries = listIds.reduce((acc, id) => {
      const key = getListStorageKey(id);
      if (storedLists && storedLists[key]) {
        acc[id] = storedLists[key];
      }
      return acc;
    }, {});
  }

  return composeRawState(
    meta,
    runtime,
    listEntries,
    autoCollect,
    deletedHistorySource,
    videoProgressSource
  );
}

async function persistState(state) {
  if (!hasChromeStorage) {
    memoryState = deepClone(state);
    return state;
  }
  const {
    listContents,
    meta,
    runtime,
    autoCollect,
    deletedHistory,
    videoProgress,
  } = splitStateForStorage(state);
  const payload = {
    [META_STORAGE_KEY]: meta,
    [RUNTIME_STORAGE_KEY]: runtime,
    [AUTO_COLLECT_STORAGE_KEY]: autoCollect,
    [DELETED_HISTORY_STORAGE_KEY]: deletedHistory,
    [VIDEO_PROGRESS_STORAGE_KEY]: videoProgress,
  };

  Object.entries(listContents).forEach(([id, content]) => {
    payload[getListStorageKey(id)] = content;
  });

  const existingMeta = await chrome.storage.local.get(META_STORAGE_KEY);
  const previousLists =
    existingMeta?.[META_STORAGE_KEY]?.lists &&
    typeof existingMeta[META_STORAGE_KEY].lists === "object"
      ? existingMeta[META_STORAGE_KEY].lists
      : {};
  const nextListIds = Object.keys(listContents);
  const toRemove = Object.keys(previousLists)
    .filter((id) => !nextListIds.includes(id))
    .map(getListStorageKey);

  if (toRemove.length) {
    await chrome.storage.local.remove(toRemove);
  }

  await chrome.storage.local.set(payload);
  if (LEGACY_AUTO_COLLECT_STORAGE_KEY !== AUTO_COLLECT_STORAGE_KEY) {
    await chrome.storage.local.remove(LEGACY_AUTO_COLLECT_STORAGE_KEY);
  }
  return state;
}

export async function getState() {
  const raw = await loadRawState();
  return sanitizeState(raw);
}

export async function replaceState(newState) {
  return enqueueStateWrite(async () => {
    const sanitized = sanitizeState(newState);
    await persistState(sanitized);
    return sanitized;
  });
}

export async function mutateState(mutator) {
  return enqueueStateWrite(async () => {
    const current = await getState();
    const updated = await Promise.resolve(mutator(current));
    if (!updated || typeof updated !== "object") {
      throw new TypeError("State mutator must return updated state");
    }
    const sanitized = sanitizeState(updated);
    await persistState(sanitized);
    return sanitized;
  });
}
