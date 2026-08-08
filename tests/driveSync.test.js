// Drive sync tests. Covers appData payload backup rotation and rollback.
import assert from 'assert';
import {
  addVideos,
  buildSyncSnapshot,
  DRIVE_SYNC_LOCAL_META_STORAGE_KEY,
  getState,
  importDriveSync,
  pushLocalDriveSyncNow,
  replaceState,
  restoreDrivePlaylistBackup,
} from '../src/store/index.js';

function installChromeStorageMock() {
  const stores = { local: {}, sync: {} };
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
    alarms: { create: () => {} },
    runtime: { lastError: null },
    identity: {
      getAuthToken: (_details, callback) => callback('token'),
      removeCachedAuthToken: () => {},
    },
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
  return { stores, restore: () => delete globalThis.chrome };
}

function jsonResponse(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
    text: async () => JSON.stringify(data),
  };
}

function parseMultipartDrivePayload(body) {
  const parts = String(body).split('Content-Type: application/json; charset=UTF-8');
  if (parts.length < 3) throw new Error('Drive multipart body is missing payload');
  return JSON.parse(parts[2].replace(/^\s+/, '').split('\r\n--')[0]);
}

function installDriveFetchMock() {
  const originalFetch = globalThis.fetch;
  let payload = null;
  globalThis.fetch = async (url, init = {}) => {
    const href = String(url);
    if (href.includes('/upload/drive/v3/files')) {
      payload = parseMultipartDrivePayload(init.body);
      return jsonResponse({ id: 'drive-file', modifiedTime: '2026-06-18T00:00:01Z' });
    }
    if (href.includes('/drive/v3/files?')) {
      return jsonResponse({
        files: payload
          ? [{ id: 'drive-file', name: 'ytautoplaylist-sync.json', modifiedTime: '2026-06-18T00:00:00Z' }]
          : [],
      });
    }
    if (href.includes('/drive/v3/files/drive-file?alt=media')) {
      return jsonResponse(payload);
    }
    throw new Error(`Unexpected Drive URL: ${href}`);
  };
  return {
    get payload() {
      return payload;
    },
    setPayload(nextPayload) {
      payload = nextPayload;
    },
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

{
  const chromeMock = installChromeStorageMock();
  const driveMock = installDriveFetchMock();
  try {
    await replaceState({
      lists: {
        default: {
          id: 'default',
          name: 'Основной',
          freeze: false,
          queue: [{ id: 'driveBack01', addedAt: 1 }],
          currentIndex: 0,
          revision: 1,
        },
      },
      listOrder: ['default'],
    });
    assert.strictEqual((await pushLocalDriveSyncNow({ interactive: false })).pushed, true);
    assert.strictEqual(driveMock.payload.playlistBackups.length, 0);

    await replaceState({
      lists: {
        default: {
          id: 'default',
          name: 'Основной',
          freeze: false,
          queue: [{ id: 'driveBack02', addedAt: 2 }],
          currentIndex: 0,
          revision: 2,
        },
      },
      listOrder: ['default'],
    });
    assert.strictEqual((await pushLocalDriveSyncNow({ interactive: false })).pushed, true);
    assert.deepStrictEqual(
      driveMock.payload.playlistBackups[0].state.lists.default.queue.map((entry) => entry.id),
      ['driveBack01']
    );

    await replaceState({
      lists: {
        default: {
          id: 'default',
          name: 'Основной',
          freeze: false,
          queue: [{ id: 'driveBack03', addedAt: 3 }],
          currentIndex: 0,
          revision: 3,
        },
      },
      listOrder: ['default'],
    });
    assert.strictEqual((await pushLocalDriveSyncNow({ interactive: false })).pushed, true);
    assert.deepStrictEqual(
      driveMock.payload.playlistBackups.map((snapshot) => snapshot.state.lists.default.queue[0].id),
      ['driveBack02', 'driveBack01']
    );

    const restored = await restoreDrivePlaylistBackup({ offset: 1, interactive: false });
    const state = await getState();
    assert.strictEqual(restored.restored, true);
    assert.deepStrictEqual(state.lists.default.queue.map((entry) => entry.id), ['driveBack02']);
    assert.deepStrictEqual(
      driveMock.payload.playlistBackups.map((snapshot) => snapshot.state.lists.default.queue[0].id),
      ['driveBack03', 'driveBack01']
    );
    assert.ok(chromeMock.stores.local[DRIVE_SYNC_LOCAL_META_STORAGE_KEY].playlistBackupCount);
    console.log('Drive playlist sync keeps backup versions and restores version -1');
  } finally {
    driveMock.restore();
    chromeMock.restore();
  }
}

{
  const chromeMock = installChromeStorageMock();
  const driveMock = installDriveFetchMock();
  try {
    await replaceState({
      lists: {
        default: {
          id: 'default',
          name: 'Основной',
          freeze: false,
          queue: [{ id: 'sharedBase1', addedAt: 1 }],
          currentIndex: 0,
          revision: 1,
        },
      },
      listOrder: ['default'],
    });
    assert.strictEqual((await pushLocalDriveSyncNow({ interactive: false })).pushed, true);

    await addVideos([{ id: 'localOnly1', addedAt: 2 }], 'default');

    const remoteSnapshot = buildSyncSnapshot(
      {
        lists: {
          default: {
            id: 'default',
            name: 'Основной',
            freeze: false,
            queue: [
              { id: 'sharedBase1', addedAt: 1 },
              { id: 'remoteOnly1', addedAt: 3 },
            ],
            currentIndex: 0,
            revision: 2,
          },
        },
        listOrder: ['default'],
      },
      {
        deviceId: 'other-device',
        updatedAt: Date.now() + 1000,
      }
    );
    driveMock.setPayload({
      version: 1,
      updatedAt: remoteSnapshot.manifest.updatedAt,
      deviceId: 'other-device',
      playlist: {
        manifest: remoteSnapshot.manifest,
        state: remoteSnapshot.state,
      },
      playlistBackups: [],
    });

    const imported = await importDriveSync({ interactive: false });
    const state = await getState();
    assert.strictEqual(imported.playlistImported, true);
    assert.deepStrictEqual(
      state.lists.default.queue.map((entry) => entry.id),
      ['sharedBase1', 'remoteOnly1', 'localOnly1']
    );

    console.log('Drive pull merges newer remote changes when local pending exists');
  } finally {
    driveMock.restore();
    chromeMock.restore();
  }
}
