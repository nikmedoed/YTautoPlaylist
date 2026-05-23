// Test runner for the repository. Imports each focused test file so npm test can execute the full lightweight suite.
import assert from 'assert';
import {
  getCollectionFetchStartDate,
  getNewVideos,
} from '../src/youtube-api/videos.js';
import {
  __setCallApi,
} from '../src/youtube-api/transport.js';
import {
  isVideoInPlaylist,
  listChannelPlaylists,
} from '../src/youtube-api/playlists.js';
import {
  addVideos,
  getAutoCollectMeta,
  getState,
  markVideoWatched,
  removeVideos,
  recordDefaultAutoCollect,
  replaceState,
  shouldAutoRefreshDefault,
} from '../src/store/index.js';
import {
  collectAutoCollectSeenIds,
} from '../src/background/collectionSync.js';
import { parseVideoId } from '../src/utils.js';
import { applyFilters, getVideoFilterReason, saveFilters } from '../src/filter.js';
import './popupHelpers.test.js';
import './inlineQueueHelpers.test.js';
import './videoCards.test.js';
import './playbackHandlers.test.js';

const calls = [];
__setCallApi(async (path) => {
  calls.push(path);
  if (path === 'playlistItems') {
    const err = new Error('API playlistItems failed');
    err.status = 404;
    err.body = '{"error":{"errors":[{"reason":"playlistNotFound","location":"playlistId"}]}}';
    err.error = { error: { errors: [{ reason: 'playlistNotFound' }] } };
    throw err;
  }
  return { items: [] };
});

const res = await getNewVideos('UUstub');
assert.deepStrictEqual(res, { videos: [], pages: 1 });
assert.deepStrictEqual(calls, ['playlistItems', 'search']);
console.log('getNewVideos falls back to search');

{
  const startDate = new Date('2024-01-03T00:00:00Z');
  assert.strictEqual(
    getCollectionFetchStartDate(startDate).toISOString(),
    '2024-01-01T00:00:00.000Z'
  );
  console.log('collection fetch window keeps a 48h safety overlap');
}

{
  const startDate = new Date('2024-01-01T03:00:00+03:00');
  const captured = [];
  __setCallApi(async (path) => {
    captured.push(path);
    if (path === 'playlistItems') {
      return {
        items: [
          {
            contentDetails: {
              videoId: 'equal',
              videoPublishedAt: '2024-01-01T00:00:00Z',
            },
          },
          {
            contentDetails: {
              videoId: 'after',
              videoPublishedAt: '2024-01-01T00:00:01Z',
            },
          },
        ],
      };
    }
    return { items: [] };
  });
  const { videos } = await getNewVideos('PLtz', startDate);
  assert.deepStrictEqual(captured, ['playlistItems']);
  assert.deepStrictEqual(
    videos.map((video) => video.id),
    ['after']
  );
  assert.strictEqual(videos[0].publishedAt.toISOString(), '2024-01-01T00:00:01.000Z');
  console.log('getNewVideos respects timezone boundaries');
}

{
  const startDate = new Date('2024-01-03T00:00:00Z');
  __setCallApi(async (path) => {
    if (path === 'playlistItems') {
      return {
        items: [
          {
            contentDetails: {
              videoId: 'late',
              videoPublishedAt: '2024-01-02T12:00:00Z',
            },
          },
        ],
      };
    }
    return { items: [] };
  });
  const { videos } = await getNewVideos('PLlate', startDate);
  assert.deepStrictEqual(
    videos.map((video) => video.id),
    []
  );
  console.log('getNewVideos keeps overlap for fetch traversal without widening the logical date cursor');
}

{
  const examples = [
    'https://youtu.be/HxdM7D8rnpw?si=YCLpPQ9ncgQuHKqu',
    'https://www.youtube.com/watch?v=HxdM7D8rnpw&list=PLAYLIST&index=91',
    'https://www.youtube.com/watch?v=hE79n2sUboU',
    'https://youtu.be/hE79n2sUboU?si=zRcgYGQVPYCv2iux'
  ];
  assert.strictEqual(parseVideoId(examples[0]), 'HxdM7D8rnpw');
  assert.strictEqual(parseVideoId(examples[1]), 'HxdM7D8rnpw');
  assert.strictEqual(parseVideoId(examples[2]), 'hE79n2sUboU');
  assert.strictEqual(parseVideoId(examples[3]), 'hE79n2sUboU');
  console.log('parseVideoId handles messy URLs');
}

{
  const video = { title: 'Foo BAR', tags: ['MyTag'] };
  const byTitle = {
    noShorts: false,
    noBroadcasts: false,
    title: ['foo bar'],
    tags: [],
    duration: [],
  };
  const byTag = {
    noShorts: false,
    noBroadcasts: false,
    title: [],
    tags: ['mytag'],
    duration: [],
  };
  assert.strictEqual(await applyFilters(video, byTitle), 'title');
  assert.strictEqual(await applyFilters(video, byTag), 'tag');
  const byCase = {
    noShorts: false,
    noBroadcasts: false,
    title: ['FOO BAR'].map((t) => t.toLowerCase()),
    tags: ['MYTAG'].map((t) => t.toLowerCase()),
    duration: [],
  };
  assert.strictEqual(await applyFilters(video, byCase), 'title');
  console.log('applyFilters is case-insensitive');
}

{
  const video = { title: '#HashTag video', tags: [] };
  const rules = {
    noShorts: false,
    noBroadcasts: false,
    title: [],
    tags: ['hashtag'],
    duration: [],
  };
  assert.strictEqual(await applyFilters(video, rules), 'tag');
  console.log('applyFilters detects hashtags in title');
}

{
  const video = { title: 'Video', tags: ['popular politics'] };
  const withSpace = {
    noShorts: false,
    noBroadcasts: false,
    title: [],
    tags: ['popular politics'].map((t) => t.toLowerCase().replace(/\s+/g, '')),
    duration: [],
  };
  const noSpace = {
    noShorts: false,
    noBroadcasts: false,
    title: [],
    tags: ['popularpolitics'].map((t) => t.toLowerCase().replace(/\s+/g, '')),
    duration: [],
  };
  assert.strictEqual(await applyFilters(video, withSpace), 'tag');
  assert.strictEqual(await applyFilters(video, noSpace), 'tag');
  console.log('applyFilters matches tags ignoring spaces');
}

{
  const calls2 = [];
  __setCallApi(async (path, params) => {
    calls2.push(path);
    if (path === 'playlistItems') {
      return { items: params.videoId === 'AAA' ? [{}] : [] };
    }
    if (path === 'playlists') {
      return { items: [{ id: 'PL1', snippet: { title: 'List' } }] };
    }
    return { items: [] };
  });
  const ok = await isVideoInPlaylist('AAA', 'PL1');
  assert.strictEqual(ok, true);
  const no = await isVideoInPlaylist('BBB', 'PL1');
  assert.strictEqual(no, false);
  const pls = await listChannelPlaylists('CID');
  assert.deepStrictEqual(pls, [{ id: 'PL1', title: 'List' }]);
  console.log('playlist helpers work');
}

{
  await saveFilters({
    global: { noShorts: false, title: ['foo'] },
    channels: {},
  });
  const reason = await getVideoFilterReason({
    id: '1',
    title: 'foo bar',
    duration: 'PT1M',
  });
  assert.strictEqual(reason, 'title');
  console.log('getVideoFilterReason uses saved filters');
}

{
  await saveFilters({
    global: { noShorts: false },
    channels: {},
  });
  const reason = await getVideoFilterReason({ id: '1', title: 'foo bar' });
  assert.strictEqual(reason, 'missingDuration');
  console.log('getVideoFilterReason skips videos without duration');
}

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

await import('./autoCollect.test.js');
