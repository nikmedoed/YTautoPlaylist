// Presentation-state builder for UI consumers. Converts raw store state into popup/content friendly list and queue details.
import { getState, cloneVideoProgress } from "../state/index.js";
import {
  AUTO_COLLECT_COOLDOWN_MS,
  ensureAutoCollectMeta,
} from "./core.js";

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
