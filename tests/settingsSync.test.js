// Settings sync tests. Covers chrome.storage.sync initialization and local filters.
import assert from 'assert';
import {
  pushLocalSettingsSyncNow,
  resolveRemoteSettingsSyncFilters,
  SETTINGS_SYNC_LOCAL_META_STORAGE_KEY,
  SETTINGS_SYNC_MANIFEST_STORAGE_KEY,
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
