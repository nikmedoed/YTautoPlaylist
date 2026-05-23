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
  await replaceState({
    autoCollect: {
      lastRunAt: previousLastRunAt,
      lastAdded: 4,
      lastFetched: 8,
      nextAutoCollectAt: 0,
      seenIds: [],
    },
  });
  globalThis.chrome = {
    runtime: {
      sendMessage: async () => {},
    },
    storage: {
      local: {
        get(_keys, callback) {
          callback({ channelCache: {} });
        },
        set() {},
      },
    },
  };
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
