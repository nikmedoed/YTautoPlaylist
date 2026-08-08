// Channel cache tests. Covers stale subscription exclusion and parallel subscription refresh.
import assert from 'assert';
import {
  __resetChannelCaches,
  getActiveSubscriptionChannelIds,
  getChannelMap,
} from '../src/youtube-api/channels.js';
import { __setCallApi } from '../src/youtube-api/transport.js';

function installChromeStorageMock(initial = {}) {
  const localStore = { ...initial };
  function readStore(keys) {
    if (keys == null) return { ...localStore };
    if (typeof keys === 'string') return { [keys]: localStore[keys] };
    if (Array.isArray(keys)) {
      return Object.fromEntries(keys.map((key) => [key, localStore[key]]));
    }
    return Object.fromEntries(
      Object.keys(keys).map((key) => [key, localStore[key] ?? keys[key]])
    );
  }
  globalThis.chrome = {
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
      },
    },
  };
  return { localStore, restore: () => delete globalThis.chrome };
}

{
  __resetChannelCaches();
  const chromeMock = installChromeStorageMock({
    channelCache: {
      activeChannel: { title: 'Old title', uploads: 'UUactive' },
      staleChannel: { title: 'Unsubscribed', uploads: 'UUstale' },
    },
  });
  const calls = [];
  __setCallApi(async (path, params) => {
    calls.push(path);
    if (path === 'subscriptions') {
      return {
        items: [
          {
            snippet: {
              title: 'Active title',
              resourceId: { channelId: 'activeChannel' },
            },
            contentDetails: { totalItemCount: 1 },
          },
        ],
      };
    }
    throw new Error(`unexpected API call: ${path} ${JSON.stringify(params)}`);
  });
  try {
    const channels = await getChannelMap([], {
      refreshSubscriptionsInBackground: true,
    });
    assert.deepStrictEqual(Object.keys(channels), ['activeChannel']);
    assert.strictEqual(channels.activeChannel.title, 'Active title');
    assert.ok(chromeMock.localStore.channelCache.staleChannel);
    assert.strictEqual(
      chromeMock.localStore.channelSubscriptionCache.channels.activeChannel.title,
      'Active title'
    );
    assert.deepStrictEqual(calls, ['subscriptions']);
  } finally {
    chromeMock.restore();
    __resetChannelCaches();
  }
  console.log('channel map excludes stale unsubscribed cache entries');
}

{
  __resetChannelCaches();
  const chromeMock = installChromeStorageMock({
    channelCache: {
      activeChannel: { title: 'Active title', uploads: 'UUactive' },
      staleChannel: { title: 'Unsubscribed', uploads: 'UUstale' },
    },
    channelSubscriptionCache: {
      updatedAt: Date.now(),
      channels: {
        activeChannel: { title: 'Active title' },
      },
    },
  });
  const calls = [];
  __setCallApi(async (path) => {
    calls.push(path);
    throw new Error(`unexpected API call: ${path}`);
  });
  try {
    const channels = await getChannelMap();
    assert.deepStrictEqual(Object.keys(channels), ['activeChannel']);
    assert.deepStrictEqual(calls, []);
  } finally {
    chromeMock.restore();
    __resetChannelCaches();
  }
  console.log('channel map reuses fresh subscription snapshots');
}

{
  __resetChannelCaches();
  const chromeMock = installChromeStorageMock({
    channelCache: {
      activeChannel: { title: 'Active title', uploads: 'UUactive' },
      staleChannel: { title: 'Unsubscribed', uploads: 'UUstale' },
    },
    channelSubscriptionCache: {
      updatedAt: Date.now() - 25 * 60 * 60 * 1000,
      channels: {
        activeChannel: { title: 'Active title' },
        staleChannel: { title: 'Unsubscribed' },
      },
    },
  });
  const calls = [];
  let resolveSubscriptions;
  const subscriptionResponse = new Promise((resolve) => {
    resolveSubscriptions = resolve;
  });
  __setCallApi(async (path) => {
    calls.push(path);
    if (path === 'subscriptions') {
      return subscriptionResponse;
    }
    throw new Error(`unexpected API call: ${path}`);
  });
  try {
    const channels = await getChannelMap([], {
      refreshSubscriptionsInBackground: true,
    });
    assert.deepStrictEqual(
      Object.keys(channels).sort(),
      ['activeChannel', 'staleChannel']
    );
    assert.deepStrictEqual(calls, ['subscriptions']);
    resolveSubscriptions({
      items: [
        {
          snippet: {
            title: 'Active title',
            resourceId: { channelId: 'activeChannel' },
          },
          contentDetails: { totalItemCount: 1 },
        },
      ],
    });
    const activeIds = await getActiveSubscriptionChannelIds({
      waitForRefresh: true,
    });
    assert.deepStrictEqual(Array.from(activeIds), ['activeChannel']);
    assert.deepStrictEqual(
      Object.keys(chromeMock.localStore.channelSubscriptionCache.channels),
      ['activeChannel']
    );
  } finally {
    chromeMock.restore();
    __resetChannelCaches();
  }
  console.log('stale subscription snapshots refresh in parallel for later checks');
}

{
  __resetChannelCaches();
  const chromeMock = installChromeStorageMock({
    channelCache: {
      activeChannel: { title: 'Active title', uploads: 'UUactive' },
      staleChannel: { title: 'Unsubscribed', uploads: 'UUstale' },
    },
    channelSubscriptionCache: {
      updatedAt: Date.now(),
      channels: {
        activeChannel: { title: 'Active title' },
        staleChannel: { title: 'Unsubscribed' },
      },
    },
  });
  const calls = [];
  let resolveSubscriptions;
  const subscriptionResponse = new Promise((resolve) => {
    resolveSubscriptions = resolve;
  });
  __setCallApi(async (path) => {
    calls.push(path);
    if (path === 'subscriptions') {
      return subscriptionResponse;
    }
    throw new Error(`unexpected API call: ${path}`);
  });
  try {
    const channels = await getChannelMap([], {
      refreshSubscriptionsInBackground: true,
    });
    assert.deepStrictEqual(
      Object.keys(channels).sort(),
      ['activeChannel', 'staleChannel']
    );
    assert.deepStrictEqual(calls, ['subscriptions']);
    resolveSubscriptions({
      items: [
        {
          snippet: {
            title: 'Active title',
            resourceId: { channelId: 'activeChannel' },
          },
          contentDetails: { totalItemCount: 1 },
        },
      ],
    });
    const activeIds = await getActiveSubscriptionChannelIds({
      waitForRefresh: true,
    });
    assert.deepStrictEqual(Array.from(activeIds), ['activeChannel']);
    assert.deepStrictEqual(
      Object.keys(chromeMock.localStore.channelSubscriptionCache.channels),
      ['activeChannel']
    );
  } finally {
    chromeMock.restore();
    __resetChannelCaches();
  }
  console.log('collection channel map refreshes subscriptions immediately in parallel');
}
