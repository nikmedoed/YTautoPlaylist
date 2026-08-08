// Auto-collection tests. Covers subscription fetch windows, dedupe memory, and lastRunAt update behavior.
import assert from 'assert';
import {
  getAutoCollectMeta,
  getState,
  replaceState,
} from '../src/store/index.js';
import { collectAndAppendSubscriptions } from '../src/background/collectionSync.js';
import { __resetChannelCaches } from '../src/youtube-api/channels.js';
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
        set(payload, callback) {
          Object.assign(localStore, payload);
          if (typeof callback === 'function') callback();
          return Promise.resolve();
        },
        remove(keys, callback) {
          (Array.isArray(keys) ? keys : [keys]).forEach((key) => delete localStore[key]);
          if (typeof callback === 'function') callback();
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

{
  __resetChannelCaches();
  const previousLastRunAt = Date.now() - 86_400_000;
  const localStore = {
    channelCache: {
      channelA: { title: 'Channel A', uploads: 'UUchannelA' },
    },
    channelSubscriptionCache: {
      updatedAt: Date.now(),
      channels: {
        channelA: { title: 'Channel A' },
      },
    },
  };
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
        set(payload, callback) {
          Object.assign(localStore, payload);
          if (typeof callback === 'function') callback();
          return Promise.resolve();
        },
        remove(keys, callback) {
          (Array.isArray(keys) ? keys : [keys]).forEach((key) => delete localStore[key]);
          if (typeof callback === 'function') callback();
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
  __setCallApi(async (path) => {
    if (path === 'subscriptions') {
      return {
        items: [
          {
            snippet: {
              title: 'Channel A',
              resourceId: { channelId: 'channelA' },
            },
            contentDetails: { totalItemCount: 1 },
          },
        ],
      };
    }
    if (path === 'playlistItems') {
      return {
        items: [
          {
            contentDetails: {
              videoId: 'metaFail001',
              videoPublishedAt: new Date(previousLastRunAt + 1000).toISOString(),
            },
          },
        ],
      };
    }
    if (path === 'videos') {
      throw new Error('metadata fetch failed');
    }
    throw new Error(`unexpected API call: ${path}`);
  });
  try {
    await assert.rejects(
      () => collectAndAppendSubscriptions({ origin: 'test' }),
      /metadata fetch failed/
    );
    const meta = await getAutoCollectMeta();
    assert.strictEqual(meta.lastRunAt, previousLastRunAt);
    assert.strictEqual(meta.lastAdded, 4);
    assert.strictEqual(meta.lastFetched, 8);
    const state = await getState();
    assert.deepStrictEqual(state.lists.default.queue, []);
  } finally {
    delete globalThis.chrome;
    __resetChannelCaches();
  }
  console.log('auto-collect does not advance cursor after metadata fetch failure');
}
