import assert from 'assert';
import {
  getNewVideos,
  __setCallApi,
  isVideoInPlaylist,
  listChannelPlaylists,
} from '../src/youTubeApiConnectors.js';
import { parseVideoId } from '../src/utils.js';
import { applyFilters, getVideoFilterReason, saveFilters } from '../src/filter.js';

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
  const reason = await getVideoFilterReason({ id: '1', title: 'foo bar' });
  assert.strictEqual(reason, 'title');
  console.log('getVideoFilterReason uses saved filters');
}
