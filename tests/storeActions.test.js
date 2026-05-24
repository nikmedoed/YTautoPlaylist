// Store action tests. Covers queue mutations, content add targeting, and auto-collect dedupe metadata.
import assert from 'assert';
import {
  addVideos,
  getAutoCollectMeta,
  getState,
  markVideoWatched,
  moveVideosToList,
  removeVideos,
  recordDefaultAutoCollect,
  replaceState,
  shouldAutoRefreshDefault,
} from '../src/store/index.js';
import { collectAutoCollectSeenIds } from '../src/background/collectionSync.js';
import { queueHandlers } from '../src/background/handlers/queue.js';
import { __setCallApi } from '../src/youtube-api/transport.js';

{
  await replaceState({});
  await addVideos(
    [
      { id: 'queueVid001', title: 'Queue one' },
      { id: 'queueVid002', title: 'Queue two' },
    ],
    'default'
  );
  const stored = await getState();
  assert.deepStrictEqual(
    stored.autoCollect.seenIds,
    ['queueVid001', 'queueVid002']
  );
  console.log('default-list additions are remembered for future auto-collect dedupe');
}

{
  await replaceState({
    lists: {
      default: {
        id: 'default',
        name: 'Основной',
        freeze: false,
        queue: [],
        currentIndex: null,
        revision: 0,
      },
    },
    listOrder: ['default'],
    currentListId: 'default',
  });
  await Promise.all([
    addVideos([{ id: 'parallel001', title: 'Parallel one' }], 'default'),
    addVideos([{ id: 'parallel002', title: 'Parallel two' }], 'default'),
  ]);
  const stored = await getState();
  assert.deepStrictEqual(
    stored.lists.default.queue.map((entry) => entry.id),
    ['parallel001', 'parallel002']
  );
  console.log('parallel queue additions are serialized without losing videos');
}

{
  await replaceState({
    lists: {
      default: {
        id: 'default',
        name: 'Основной',
        freeze: false,
        queue: [],
        currentIndex: null,
        revision: 0,
      },
      target: {
        id: 'target',
        name: 'Target',
        freeze: false,
        queue: [],
        currentIndex: null,
        revision: 0,
      },
    },
    listOrder: ['default', 'target'],
    currentListId: 'target',
  });
  __setCallApi(async (path) => {
    if (path === 'videos') {
      return {
        items: [
          {
            id: 'videoAdd001',
            snippet: {
              title: 'Added from content',
              channelId: 'channel001',
              channelTitle: 'Channel',
              publishedAt: '2024-01-01T00:00:00Z',
            },
            contentDetails: {
              duration: 'PT2M',
            },
          },
        ],
      };
    }
    return { items: [] };
  });
  await queueHandlers['playlist:addByIds'](
    { videoIds: ['videoAdd001'], listId: 'default' },
    { tab: { id: 77 } }
  );
  const stored = await getState();
  assert.deepStrictEqual(stored.lists.default.queue.map((entry) => entry.id), []);
  assert.deepStrictEqual(
    stored.lists.target.queue.map((entry) => entry.id),
    ['videoAdd001']
  );
  console.log('content add requests use the current active list from background state');
}

{
  await replaceState({
    lists: {
      default: {
        id: 'default',
        name: 'Основной',
        freeze: false,
        queue: [{ id: 'watchVid001', title: 'Watch me' }],
        currentIndex: 0,
        revision: 0,
      },
    },
    listOrder: ['default'],
    currentListId: 'default',
    currentVideoId: 'watchVid001',
    autoCollect: {
      lastRunAt: 0,
      lastAdded: 0,
      lastFetched: 0,
      nextAutoCollectAt: 0,
      seenIds: [],
    },
  });
  await markVideoWatched('watchVid001', { listId: 'default' });
  const stateAfterWatch = await getState();
  assert.ok(stateAfterWatch.autoCollect.seenIds.includes('watchVid001'));
  console.log('watched default videos are persisted in auto-collect dedupe memory');
}

{
  await replaceState({
    lists: {
      default: {
        id: 'default',
        name: 'Основной',
        freeze: false,
        queue: [{ id: 'removeVid00', title: 'Remove me' }],
        currentIndex: 0,
        revision: 0,
      },
    },
    listOrder: ['default'],
    currentListId: 'default',
    currentVideoId: 'removeVid00',
    autoCollect: {
      lastRunAt: 0,
      lastAdded: 0,
      lastFetched: 0,
      nextAutoCollectAt: 0,
      seenIds: [],
    },
  });
  await removeVideos(['removeVid00'], { listId: 'default' });
  const stateAfterRemoval = await getState();
  assert.ok(stateAfterRemoval.autoCollect.seenIds.includes('removeVid00'));
  console.log('removed default videos are persisted in auto-collect dedupe memory');
}

{
  await replaceState({
    lists: {
      default: {
        id: 'default',
        name: 'Основной',
        freeze: false,
        queue: [
          { id: 'moveBatch01', title: 'Move one' },
          { id: 'moveBatch02', title: 'Move two' },
        ],
        currentIndex: 0,
        revision: 0,
      },
      target: {
        id: 'target',
        name: 'Target',
        freeze: false,
        queue: [{ id: 'targetKeep1', title: 'Keep me' }],
        currentIndex: 0,
        revision: 0,
      },
    },
    listOrder: ['default', 'target'],
    currentListId: 'default',
  });
  await moveVideosToList(['moveBatch01', 'moveBatch02'], 'target');
  const stateAfterMove = await getState();
  assert.deepStrictEqual(stateAfterMove.lists.default.queue, []);
  assert.deepStrictEqual(
    stateAfterMove.lists.target.queue.map((entry) => entry.id),
    ['targetKeep1', 'moveBatch01', 'moveBatch02']
  );
  console.log('batch queue moves persist several videos in one action');
}

{
  const seenIds = collectAutoCollectSeenIds({
    autoCollect: {
      seenIds: ['storedSee01', 'storedSee02'],
    },
    lists: {
      default: {
        queue: [
          { id: 'queueVid001' },
          { id: 'queueVid002' },
        ],
      },
    },
    history: [
      { id: 'historyOne1', listId: 'default' },
      { id: 'queueVid002' },
    ],
    deletedHistory: [
      { id: 'deletedOne1', listId: 'default' },
      { id: 'otherList01', listId: 'listother01' },
    ],
  });
  assert.deepStrictEqual(
    Array.from(seenIds).sort(),
    [
      'deletedOne1',
      'historyOne1',
      'queueVid001',
      'queueVid002',
      'storedSee01',
      'storedSee02',
    ]
  );
  console.log('auto-collect dedupe uses default-list seen ids, queue and default history');
}

{
  await replaceState({});
  const startedAt = Date.now() - 20_000;
  const completedAt = Date.now() - 5_000;
  await recordDefaultAutoCollect({
    added: 0,
    fetched: 0,
    startedAt,
    completedAt,
  });
  const meta = await getAutoCollectMeta();
  const status = await shouldAutoRefreshDefault();
  assert.strictEqual(meta.lastRunAt, startedAt);
  assert.strictEqual(status.queueLength, 0);
  assert.strictEqual(status.onCooldown, true);
  assert.strictEqual(status.shouldCollect, false);
  console.log('auto-collect lastRunAt records successful run start time');
}
