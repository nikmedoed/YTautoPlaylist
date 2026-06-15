// Auto-collection tests. Covers subscription fetch windows, dedupe memory, and lastRunAt update behavior.
import assert from 'assert';
import {
  getAutoCollectMeta,
  replaceState,
} from '../src/store/index.js';
import { collectAndAppendSubscriptions } from '../src/background/collectionSync.js';
import { __setCallApi } from '../src/youtube-api/transport.js';

{
  const previousLastRunAt = Date.now() - 86_400_000;
  const localStore = { channelCache: {} };
  function readStore(keys) {
    if (keys == null) return { ...localStore };
    if (typeof keys === 'string') return { [keys]: localStore[keys] };
    if (Array.isArray(keys)) {
      return Object.fromEntries(keys.map((key) => [key, localStore[key]]));
    }
    return {};
  }
  globalThis.chrome = {
    runtime: {
      sendMessage: async () => {},
    },
    storage: {
      local: {
        get(keys, callback) {
          const result = readStore(keys);
          if (typeof callback === 'function') {
            callback(result);
            return undefined;
          }
          return Promise.resolve(result);
        },
        set(payload) {
          Object.assign(localStore, payload);
          return Promise.resolve();
        },
        remove(keys) {
          (Array.isArray(keys) ? keys : [keys]).forEach((key) => delete localStore[key]);
          return Promise.resolve();
        },
      },
    },
  };
  await replaceState({
    autoCollect: {
      lastRunAt: previousLastRunAt,
      lastAdded: 4,
      lastFetched: 8,
      nextAutoCollectAt: 0,
      seenIds: [],
    },
  });
  __setCallApi(async () => {
    throw new Error('subscription fetch failed');
  });
  try {
    await assert.rejects(
      () => collectAndAppendSubscriptions({ origin: 'test' }),
      /subscription fetch failed/
    );
    const meta = await getAutoCollectMeta();
    assert.strictEqual(meta.lastRunAt, previousLastRunAt);
    assert.strictEqual(meta.lastAdded, 4);
    assert.strictEqual(meta.lastFetched, 8);
  } finally {
    delete globalThis.chrome;
  }
  console.log('auto-collect does not advance cursor after collect failure');
}
