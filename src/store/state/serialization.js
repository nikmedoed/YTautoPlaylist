// State serialization helpers. Converts between persisted Chrome storage shape and in-memory store shape.
import {
  DEFAULT_LIST_ID,
} from "./constants.js";
import { deepClone } from "../../utils.js";
import { sanitizeVideoProgressMap } from "./videoProgress.js";

// Reconstructs the in-memory state from split chrome.storage keys while preserving legacy stored shapes.
export function composeRawState(
  rawMeta,
  rawRuntime,
  rawLists,
  rawAutoCollect,
  rawDeletedHistory,
  rawVideoProgress
) {
  const meta = rawMeta && typeof rawMeta === "object" ? rawMeta : {};
  const metaLists =
    meta.lists && typeof meta.lists === "object" ? meta.lists : {};
  const runtime =
    rawRuntime && typeof rawRuntime === "object" ? rawRuntime : {};
  const runtimeIndices =
    runtime.listIndices && typeof runtime.listIndices === "object"
      ? runtime.listIndices
      : {};
  const listEntries =
    rawLists && typeof rawLists === "object" ? rawLists : {};
  const listIds = new Set([
    ...Object.keys(metaLists),
    ...Object.keys(listEntries),
    ...Object.keys(runtimeIndices),
  ]);
  const lists = {};

  listIds.forEach((id) => {
    const metaEntry =
      metaLists[id] && typeof metaLists[id] === "object" ? metaLists[id] : {};
    const listEntry =
      listEntries[id] && typeof listEntries[id] === "object"
        ? listEntries[id]
        : {};
    const queueSource = Array.isArray(listEntry.queue)
      ? listEntry.queue
      : Array.isArray(listEntry)
      ? listEntry
      : [];
    let currentIndex = null;
    if (Number.isInteger(metaEntry.currentIndex)) {
      currentIndex = metaEntry.currentIndex;
    } else if (Number.isInteger(runtimeIndices[id])) {
      currentIndex = runtimeIndices[id];
    } else if (Number.isInteger(listEntry.currentIndex)) {
      currentIndex = listEntry.currentIndex;
    }

    lists[id] = {
      id,
      name:
        typeof metaEntry.name === "string" && metaEntry.name
          ? metaEntry.name
          : typeof listEntry.name === "string" && listEntry.name
          ? listEntry.name
          : undefined,
      freeze:
        typeof metaEntry.freeze === "boolean"
          ? metaEntry.freeze
          : typeof listEntry.freeze === "boolean"
          ? listEntry.freeze
          : undefined,
      queue: queueSource,
      currentIndex,
      revision: Number.isInteger(metaEntry.revision)
        ? metaEntry.revision
        : Number.isInteger(listEntry.revision)
        ? listEntry.revision
        : 0,
    };
  });

  const metaClone = deepClone(meta);
  delete metaClone.lists;

  const runtimeClone = deepClone(runtime);
  delete runtimeClone.listIndices;
  delete runtimeClone.autoCollect;
  delete runtimeClone.activeListId;
  delete runtimeClone.videoProgress;

  let autoCollect = {};
  if (rawAutoCollect && typeof rawAutoCollect === "object") {
    autoCollect = deepClone(rawAutoCollect);
  } else if (runtime.autoCollect && typeof runtime.autoCollect === "object") {
    autoCollect = deepClone(runtime.autoCollect);
  }

  const deletedHistory = Array.isArray(rawDeletedHistory)
    ? deepClone(rawDeletedHistory)
    : Array.isArray(runtime?.deletedHistory)
    ? deepClone(runtime.deletedHistory)
    : [];

  const progressSource =
    rawVideoProgress && typeof rawVideoProgress === "object"
      ? rawVideoProgress
      : rawRuntime &&
          typeof rawRuntime === "object" &&
          typeof rawRuntime.videoProgress === "object"
        ? rawRuntime.videoProgress
        : null;

  return {
    ...metaClone,
    ...runtimeClone,
    autoCollect,
    lists: deepClone(lists),
    deletedHistory,
    videoProgress: sanitizeVideoProgressMap(progressSource),
  };
}

export function splitStateForStorage(state) {
  const listsMeta = {};
  const listContents = {};

  Object.entries(state.lists).forEach(([id, list]) => {
    listsMeta[id] = {
      id: list.id,
      name: list.name,
      freeze: Boolean(list.freeze && id !== DEFAULT_LIST_ID),
      currentIndex: Number.isInteger(list.currentIndex)
        ? list.currentIndex
        : null,
      revision: Number.isInteger(list.revision) ? list.revision : 0,
    };
    listContents[id] = {
      queue: deepClone(list.queue),
    };
  });

  const meta = deepClone({
    lists: listsMeta,
    listOrder: state.listOrder,
  });

  const runtime = deepClone({
    currentListId: state.currentListId,
    currentVideoId: state.currentVideoId,
    history: state.history,
    currentTabId: state.currentTabId,
  });

  const autoCollect = deepClone(state.autoCollect);

  const deletedHistory = Array.isArray(state.deletedHistory)
    ? deepClone(state.deletedHistory)
    : [];

  const videoProgress = sanitizeVideoProgressMap(state.videoProgress);

  return {
    listContents,
    meta,
    runtime,
    autoCollect,
    deletedHistory,
    videoProgress,
  };
}
