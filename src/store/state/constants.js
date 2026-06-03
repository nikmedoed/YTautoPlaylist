// Store constants. Contains default list identity, list names, history limits, and storage keys.
export const LEGACY_STORAGE_KEY = "runtimePlaylistState";
export const LISTS_STORAGE_KEY = "runtimePlaylistLists";
export const META_STORAGE_KEY = "runtimePlaylistMeta";
export const RUNTIME_STORAGE_KEY = "runtimePlaylistRuntime";
export const VIDEO_PROGRESS_STORAGE_KEY = "runtimePlaylistProgress";
export const DELETED_HISTORY_STORAGE_KEY = "runtimePlaylistDeletedHistory";
export const AUTO_COLLECT_STORAGE_KEY = "subscriptionsCollect";
export const LEGACY_AUTO_COLLECT_STORAGE_KEY = "runtimePlaylistAutoCollect";
const LIST_CONTENT_PREFIX = "runtimePlaylistList:";
export const HISTORY_LIMIT = 10;
export const DEFAULT_LIST_ID = "default";
export const DEFAULT_LIST_NAME = "Основной";
export const VIDEO_PROGRESS_LIMIT = 500;
export const AUTO_COLLECT_SEEN_IDS_LIMIT = 2000;

export const VIDEO_ID_PATTERN = /^[\w-]{11}$/;

export const defaultState = {
  lists: {
    [DEFAULT_LIST_ID]: {
      id: DEFAULT_LIST_ID,
      name: DEFAULT_LIST_NAME,
      freeze: false,
      queue: [],
      currentIndex: null,
      revision: 0,
    },
  },
  listOrder: [DEFAULT_LIST_ID],
  currentListId: DEFAULT_LIST_ID,
  currentVideoId: null,
  history: [],
  deletedHistory: [],
  currentTabId: null,
  autoCollect: {
    lastRunAt: 0,
    lastAdded: 0,
    lastFetched: 0,
    nextAutoCollectAt: 0,
    seenIds: [],
  },
  videoProgress: {},
};

export function getListStorageKey(id) {
  return `${LIST_CONTENT_PREFIX}${id}`;
}
