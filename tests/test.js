import assert from 'assert';
import { getNewVideos, __setCallApi } from '../src/youTubeApiConnectors.js';
import { parseVideoId } from '../src/utils.js';
import { applyFilters } from '../src/filter.js';

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

(async () => {
  const res = await getNewVideos('UUstub');
  assert.deepStrictEqual(res, { videos: [], pages: 1 });
  assert.deepStrictEqual(calls, ['playlistItems', 'search']);
  console.log('getNewVideos falls back to search');
})();

(() => {
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
})();

(async () => {
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
    title: ['FOO BAR'],
    tags: ['MYTAG'],
    duration: [],
  };
  assert.strictEqual(await applyFilters(video, byCase), 'title');
  console.log('applyFilters is case-insensitive');
})();
