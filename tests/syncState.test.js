// Playlist sync state tests. Covers portable snapshot shape and remote import merge behavior.
import assert from 'assert';
import {
  buildSyncSnapshot,
  buildSyncState,
  getSyncStateFingerprint,
  mergeSyncStatesConservatively,
  mergeRemoteSyncState,
  pushLocalSettingsSyncNow,
  resolveRemoteSettingsSyncFilters,
  SETTINGS_SYNC_LOCAL_META_STORAGE_KEY,
  SETTINGS_SYNC_MANIFEST_STORAGE_KEY,
} from '../src/store/index.js';

function installChromeStorageMock() {
  const stores = { local: {}, sync: {} };
  const alarms = [];
  function getFromStore(store, keys) {
    if (keys == null) return { ...store };
    if (typeof keys === 'string') return { [keys]: store[keys] };
    if (Array.isArray(keys)) {
      return Object.fromEntries(keys.map((key) => [key, store[key]]));
    }
    return Object.fromEntries(
      Object.keys(keys).map((key) => [key, store[key] ?? keys[key]])
    );
  }
  globalThis.chrome = {
    alarms: { create: (name, info) => alarms.push({ name, info }) },
    storage: {
      local: {
        get: async (keys) => getFromStore(stores.local, keys),
        set: async (payload) => Object.assign(stores.local, payload),
        remove: async (keys) =>
          (Array.isArray(keys) ? keys : [keys]).forEach((key) => delete stores.local[key]),
      },
      sync: {
        get: async (keys) => getFromStore(stores.sync, keys),
        set: async (payload) => Object.assign(stores.sync, payload),
        remove: async (keys) =>
          (Array.isArray(keys) ? keys : [keys]).forEach((key) => delete stores.sync[key]),
      },
    },
  };
  return { stores, alarms, restore: () => delete globalThis.chrome };
}

{
  const syncState = buildSyncState({
    lists: {
      default: {
        id: 'default',
        name: 'Основной',
        freeze: false,
        queue: [{ id: 'syncVideo01', title: 'Sync me' }],
        currentIndex: 0,
        revision: 1,
      },
    },
    listOrder: ['default'],
    currentListId: 'default',
    currentVideoId: 'syncVideo01',
    currentTabId: 42,
  });
  assert.strictEqual(syncState.currentVideoId, null);
  assert.strictEqual(syncState.currentTabId, null);
  assert.strictEqual(syncState.currentListId, 'default');
  assert.deepStrictEqual(
    syncState.lists.default.queue.map((entry) => entry.id),
    ['syncVideo01']
  );
  console.log('playlist sync snapshots exclude machine-local playback fields');
}

{
  const base = {
    lists: {
      default: {
        id: 'default',
        name: 'Основной',
        freeze: false,
        queue: [
          { id: 'indexVideo1', title: 'First', addedAt: 1 },
          { id: 'indexVideo2', title: 'Second', addedAt: 2 },
        ],
        currentIndex: 0,
        revision: 2,
      },
    },
    listOrder: ['default'],
    currentListId: 'default',
    currentVideoId: 'indexVideo1',
    currentTabId: 12,
  };
  const moved = {
    ...base,
    lists: {
      default: {
        ...base.lists.default,
        currentIndex: 1,
      },
    },
    currentVideoId: 'indexVideo2',
    currentTabId: 13,
  };
  assert.strictEqual(
    getSyncStateFingerprint(base),
    getSyncStateFingerprint(moved)
  );
  console.log('playlist sync fingerprints ignore local playback position');
}

{
  const merged = mergeRemoteSyncState(
    {
      lists: {
        default: {
          id: 'default',
          name: 'Основной',
          freeze: false,
          queue: [{ id: 'remoteVid01', title: 'Remote current' }],
          currentIndex: 0,
          revision: 1,
        },
      },
      listOrder: ['default'],
      currentListId: 'default',
      currentVideoId: 'remoteVid01',
      currentTabId: 77,
    },
    {
      lists: {
        default: {
          id: 'default',
          name: 'Основной',
          freeze: false,
          queue: [
            { id: 'otherVideo1', title: 'Other' },
            { id: 'remoteVid01', title: 'Remote current' },
          ],
          currentIndex: 0,
          revision: 2,
        },
      },
      listOrder: ['default'],
    }
  );
  assert.strictEqual(merged.currentTabId, 77);
  assert.strictEqual(merged.currentVideoId, 'remoteVid01');
  assert.strictEqual(merged.lists.default.currentIndex, 1);
  console.log('remote playlist imports preserve local active tab and current video when possible');
}

{
  const merged = mergeSyncStatesConservatively(
    {
      lists: {
        default: {
          id: 'default',
          name: 'Основной',
          freeze: false,
          queue: [
            { id: 'sharedVid01', title: 'Shared' },
            { id: 'localAdd001', title: 'Local add' },
          ],
          currentIndex: 1,
          revision: 2,
        },
      },
      listOrder: ['default'],
      autoCollect: {
        lastRunAt: 1000,
        lastAdded: 1,
        lastFetched: 1,
        nextAutoCollectAt: 2000,
        seenIds: ['localAdd001'],
      },
      videoProgress: {
        localAdd001: { percent: 40, updatedAt: 2000 },
      },
    },
    {
      lists: {
        default: {
          id: 'default',
          name: 'Основной',
          freeze: false,
          queue: [
            { id: 'sharedVid01', title: 'Shared' },
            { id: 'remoteAdd01', title: 'Remote add' },
          ],
          currentIndex: 1,
          revision: 3,
        },
      },
      listOrder: ['default'],
      autoCollect: {
        lastRunAt: 5000,
        lastAdded: 2,
        lastFetched: 3,
        nextAutoCollectAt: 7000,
        seenIds: ['remoteAdd01'],
      },
      videoProgress: {
        sharedVid01: { percent: 80, updatedAt: 3000 },
      },
    }
  );
  assert.deepStrictEqual(
    merged.lists.default.queue.map((entry) => entry.id),
    ['sharedVid01', 'remoteAdd01', 'localAdd001']
  );
  assert.strictEqual(merged.lists.default.currentIndex, 0);
  assert.strictEqual(merged.autoCollect.lastRunAt, 5000);
  assert.deepStrictEqual(
    new Set(merged.autoCollect.seenIds),
    new Set(['remoteAdd01', 'localAdd001'])
  );
  assert.strictEqual(merged.videoProgress.localAdd001.percent, 40);
  assert.strictEqual(merged.videoProgress.sharedVid01.percent, 80);
  console.log('playlist sync conflict merge keeps local and remote data');
}

{
  const longQueue = Array.from({ length: 80 }, (_, index) => ({
    id: `chunkVid${String(index).padStart(3, '0')}`,
    title: `Chunked playlist video ${index}`,
  }));
  const snapshot = buildSyncSnapshot({
    lists: {
      default: {
        id: 'default',
        name: 'Основной',
        freeze: false,
        queue: longQueue,
        currentIndex: 0,
        revision: 80,
      },
    },
    listOrder: ['default'],
  });
  assert.ok(snapshot.manifest.chunkCount >= 1);
  assert.strictEqual(snapshot.chunks.length, snapshot.manifest.chunkCount);
  console.log('playlist sync snapshots are split into storage.sync chunks');
}

{
  const heavyQueue = Array.from({ length: 250 }, (_, index) => ({
    id: `heavyVid${String(index).padStart(3, '0')}`,
    title: `Heavy metadata playlist video ${index}`,
    thumbnail: `https://i.ytimg.com/vi/heavyVid${index}/maxresdefault.jpg?${'x'.repeat(500)}`,
    channelTitle: `Channel ${index}`,
    addedAt: 1000 + index,
  }));
  const snapshot = buildSyncSnapshot({
    lists: {
      default: {
        id: 'default',
        name: 'Основной',
        freeze: false,
        queue: heavyQueue,
        currentIndex: 0,
        revision: heavyQueue.length,
      },
    },
    listOrder: ['default'],
  });
  assert.ok(snapshot.totalBytes < 98 * 1024);
  console.log('playlist sync snapshots compact heavy video metadata');
}

{
  const chromeMock = installChromeStorageMock();
  try {
    const filters = {
      global: { noShorts: true, title: ['already local'] },
      channels: {},
    };
    const result = await resolveRemoteSettingsSyncFilters(filters);
    assert.strictEqual(result.imported, false);
    assert.strictEqual(
      chromeMock.stores.local[SETTINGS_SYNC_LOCAL_META_STORAGE_KEY],
      undefined
    );
    assert.strictEqual(
      chromeMock.stores.sync[SETTINGS_SYNC_MANIFEST_STORAGE_KEY],
      undefined
    );
    console.log('settings sync does not auto-seed empty remote storage');
  } finally {
    chromeMock.restore();
  }
}

{
  const chromeMock = installChromeStorageMock();
  try {
    chromeMock.stores.local.filters = JSON.stringify({
      global: { noShorts: true, title: ['push local'] },
      channels: {},
    });
    const result = await pushLocalSettingsSyncNow();
    assert.strictEqual(result.pushed, true);
    assert.ok(chromeMock.stores.sync[SETTINGS_SYNC_MANIFEST_STORAGE_KEY]);
    console.log('settings sync explicit push initializes remote storage');
  } finally {
    chromeMock.restore();
  }
}
