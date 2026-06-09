// Playlist sync storage tests. Covers local sync metadata and pending Drive pushes.
import assert from 'assert';
import {
  addVideos,
  buildSyncSnapshot,
  buildSyncState,
  getState,
  importPlaylistSyncSnapshot,
  pushLocalPlaylistSyncNow,
  recordImportedPlaylistSyncSnapshot,
  SYNC_LOCAL_META_STORAGE_KEY,
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
  const chromeMock = installChromeStorageMock();
  try {
    const snapshot = buildSyncSnapshot({
      lists: {
        default: {
          id: 'default',
          name: 'Основной',
          freeze: false,
          queue: [{ id: 'driveSync01', addedAt: 1 }],
          currentIndex: 0,
          revision: 1,
        },
      },
      listOrder: ['default'],
    });
    await importPlaylistSyncSnapshot(
      {
        state: snapshot.state,
        hash: snapshot.hash,
        updatedAt: snapshot.manifest.updatedAt,
      },
      { force: true }
    );
    const meta = chromeMock.stores.local[SYNC_LOCAL_META_STORAGE_KEY];
    assert.strictEqual(meta.remoteHash, snapshot.hash);
    const pushed = await pushLocalPlaylistSyncNow();
    assert.strictEqual(pushed.pushed, true);
    assert.strictEqual(pushed.reason, 'drive-pending');
    assert.deepStrictEqual(Object.keys(chromeMock.stores.sync), []);
    assert.strictEqual(chromeMock.alarms.length, 1);
    console.log('playlist changes mark Drive sync pending without storage.sync writes');
  } finally {
    chromeMock.restore();
  }
}

{
  const chromeMock = installChromeStorageMock();
  try {
    const remoteState = buildSyncState({
      lists: {
        default: {
          id: 'default',
          name: 'Основной',
          freeze: false,
          queue: [{ id: 'remoteOnly1', addedAt: 1 }],
          currentIndex: 0,
          revision: 1,
        },
      },
      listOrder: ['default'],
    });
    const snapshot = buildSyncSnapshot(remoteState);
    await recordImportedPlaylistSyncSnapshot({
      state: remoteState,
      hash: snapshot.hash,
      updatedAt: snapshot.manifest.updatedAt,
    }, remoteState);
    const meta = chromeMock.stores.local[SYNC_LOCAL_META_STORAGE_KEY];
    assert.strictEqual(meta.pending, false);
    assert.strictEqual(meta.remoteHash, snapshot.hash);
    assert.strictEqual(chromeMock.alarms.length, 0);
    console.log('drive playlist imports without local conflicts become synced baseline');
  } finally {
    chromeMock.restore();
  }
}

{
  const chromeMock = installChromeStorageMock();
  try {
    const remoteSnapshot = buildSyncSnapshot({
      lists: {
        default: {
          id: 'default',
          name: 'Основной',
          freeze: false,
          queue: [],
          currentIndex: null,
          revision: 0,
        },
        imported: {
          id: 'imported',
          name: 'Imported',
          freeze: false,
          queue: [{ id: 'remoteOnly2', addedAt: 1 }],
          currentIndex: 0,
          revision: 1,
        },
      },
      listOrder: ['default', 'imported'],
      currentListId: 'imported',
      currentVideoId: 'remoteOnly2',
    });
    const imported = await importPlaylistSyncSnapshot({
      state: remoteSnapshot.state,
      hash: remoteSnapshot.hash,
      updatedAt: remoteSnapshot.manifest.updatedAt,
    });
    const meta = chromeMock.stores.local[SYNC_LOCAL_META_STORAGE_KEY];
    assert.strictEqual(imported.imported, true);
    assert.notStrictEqual(meta.localHash, remoteSnapshot.hash);
    assert.strictEqual(meta.pending, false);
    assert.strictEqual(meta.remoteHash, remoteSnapshot.hash);
    assert.strictEqual(meta.localUpdatedAt, remoteSnapshot.manifest.updatedAt);
    assert.strictEqual(chromeMock.alarms.length, 0);
    console.log('drive playlist imports do not push idle runtime-only hash drift');
  } finally {
    chromeMock.restore();
  }
}

{
  const chromeMock = installChromeStorageMock();
  try {
    const baseState = buildSyncState({
      lists: {
        default: {
          id: 'default',
          name: 'Основной',
          freeze: false,
          queue: [{ id: 'sharedVid01', addedAt: 1 }],
          currentIndex: 0,
          revision: 1,
        },
      },
      listOrder: ['default'],
    });
    const baseSnapshot = buildSyncSnapshot(baseState);
    await importPlaylistSyncSnapshot({
      state: baseSnapshot.state,
      hash: baseSnapshot.hash,
      updatedAt: baseSnapshot.manifest.updatedAt,
    }, { force: true });
    await addVideos([{ id: 'localOnly01', addedAt: 2 }], 'default');
    const remoteSnapshot = buildSyncSnapshot({
      ...baseState,
      lists: {
        default: {
          ...baseState.lists.default,
          queue: [
            { id: 'sharedVid01', addedAt: 1 },
            { id: 'remoteOnly1', addedAt: 3 },
          ],
          revision: 2,
        },
      },
    });
    const imported = await importPlaylistSyncSnapshot({
      state: remoteSnapshot.state,
      hash: remoteSnapshot.hash,
      updatedAt: remoteSnapshot.manifest.updatedAt,
    }, { mergePending: true });
    const state = await getState();
    assert.strictEqual(imported.imported, true);
    assert.deepStrictEqual(
      state.lists.default.queue.map((entry) => entry.id),
      ['sharedVid01', 'remoteOnly1', 'localOnly01']
    );
    console.log('pending playlist Drive push merges changed remote baseline first');
  } finally {
    chromeMock.restore();
  }
}
