// Store constants. Contains default list identity, list names, history limits, and storage keys.
export const LEGACY_STORAGE_KEY = "runtimePlaylistState";
export const LISTS_STORAGE_KEY = "runtimePlaylistLists";
export const META_STORAGE_KEY = "runtimePlaylistMeta";
export const RUNTIME_STORAGE_KEY = "runtimePlaylistRuntime";
export const VIDEO_PROGRESS_STORAGE_KEY = "runtimePlaylistProgress";
export const DELETED_HISTORY_STORAGE_KEY = "runtimePlaylistDeletedHistory";
export const AUTO_COLLECT_STORAGE_KEY = "subscriptionsCollect";
export const LEGACY_AUTO_COLLECT_STORAGE_KEY = "runtimePlaylistAutoCollect";
export const AUTO_COLLECT_SYNC_STORAGE_KEY = "runtimeAutoCollectSync";
export const FILTERS_STORAGE_KEY = "filters";
export const SYNC_LOCAL_META_STORAGE_KEY = "runtimePlaylistSyncLocal";
export const SYNC_MANIFEST_STORAGE_KEY = "runtimePlaylistSyncManifest";
export const SETTINGS_SYNC_LOCAL_META_STORAGE_KEY = "runtimeSettingsSyncLocal";
export const SETTINGS_SYNC_MANIFEST_STORAGE_KEY = "runtimeSettingsSyncManifest";
export const SETTINGS_SYNC_CHUNK_STORAGE_PREFIX = "runtimeSettingsSyncChunk:";
export const DRIVE_SYNC_LOCAL_META_STORAGE_KEY = "runtimeDriveSyncLocal";
export const DRIVE_SYNC_FILE_NAME = "ytautoplaylist-sync.json";
export const SYNC_ALARM_NAME = "runtimePlaylistSyncFlush";
const LIST_CONTENT_PREFIX = "runtimePlaylistList:";
export const HISTORY_LIMIT = 10;
export const DEFAULT_LIST_ID = "default";
export const DEFAULT_LIST_NAME = "Основной";
export const VIDEO_PROGRESS_LIMIT = 500;
export const AUTO_COLLECT_SEEN_IDS_LIMIT = 2000;
export const SYNC_DEBOUNCE_MS = 15 * 1000;
export const SYNC_CHUNK_TARGET_BYTES = 7600;
export const SETTINGS_SYNC_TOTAL_TARGET_BYTES = 32 * 1024;

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
