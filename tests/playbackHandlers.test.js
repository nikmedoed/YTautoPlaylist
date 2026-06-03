// Background playback handler tests. Covers tab ownership adoption for videos already present in extension lists.
import assert from 'assert';
import { playbackHandlers } from '../src/background/handlers/playback.js';
import {
  getState,
  replaceState,
} from '../src/store/index.js';

globalThis.chrome = {
  runtime: {
    sendMessage: async () => {},
  },
  tabs: {
    sendMessage: async () => ({ hasVideo: false, playing: false }),
  },
};

await replaceState({
  lists: {
    default: {
      id: 'default',
      name: 'Main',
      freeze: false,
      queue: [{ id: 'oldVideo001', title: 'Old' }],
      currentIndex: 0,
      revision: 0,
    },
    later: {
      id: 'later',
      name: 'Later',
      freeze: false,
      queue: [{ id: 'GvPJS96I4BU', title: 'Listed video' }],
      currentIndex: 0,
      revision: 0,
    },
  },
  listOrder: ['default', 'later'],
  currentListId: 'default',
  currentVideoId: 'oldVideo001',
  currentTabId: null,
});

const response = await playbackHandlers['player:videoStarted'](
  { videoId: 'GvPJS96I4BU' },
  { tab: { id: 321 } }
);
const state = await getState();

assert.strictEqual(response.controlled, true);
assert.strictEqual(state.currentListId, 'later');
assert.strictEqual(state.currentVideoId, 'GvPJS96I4BU');
assert.strictEqual(state.currentTabId, 321);
console.log('playback adopts a listed video when no live tab owns playback');

await replaceState({
  lists: {
    default: {
      id: 'default',
      name: 'Main',
      freeze: false,
      queue: [{ id: 'oldVideo001', title: 'Old' }],
      currentIndex: 0,
      revision: 0,
    },
    later: {
      id: 'later',
      name: 'Later',
      freeze: false,
      queue: [{ id: 'GvPJS96I4BU', title: 'Listed video' }],
      currentIndex: 0,
      revision: 0,
    },
  },
  listOrder: ['default', 'later'],
  currentListId: 'default',
  currentVideoId: 'oldVideo001',
  currentTabId: 111,
});

globalThis.chrome.tabs.sendMessage = async (tabId, message) => {
  assert.strictEqual(tabId, 111);
  assert.strictEqual(message.type, 'player:getPlaybackStatus');
  return { hasVideo: true, playing: true };
};

const rejected = await playbackHandlers['player:videoStarted'](
  { videoId: 'GvPJS96I4BU' },
  { tab: { id: 222 } }
);
const stateAfterReject = await getState();

assert.strictEqual(rejected.controlled, false);
assert.strictEqual(rejected.reason, 'OTHER_TAB_OWNS_PLAYBACK');
assert.strictEqual(stateAfterReject.currentListId, 'default');
assert.strictEqual(stateAfterReject.currentVideoId, 'oldVideo001');
assert.strictEqual(stateAfterReject.currentTabId, 111);
console.log('playback rejects manual-add adoption while another tab is playing');

await replaceState({
  lists: {
    default: {
      id: 'default',
      name: 'Main',
      freeze: false,
      queue: [
        { id: 'oldVideo001', title: 'Old' },
        { id: 'nextVideo01', title: 'Next' },
      ],
      currentIndex: 0,
      revision: 0,
    },
  },
  listOrder: ['default'],
  currentListId: 'default',
  currentVideoId: 'oldVideo001',
  currentTabId: 111,
});

const nextWithoutVideo = await playbackHandlers['playlist:playNext'](
  { tabId: 111 },
  {}
);
const stateAfterNoId = await getState();

assert.strictEqual(nextWithoutVideo.handled, false);
assert.strictEqual(nextWithoutVideo.reason, 'INVALID_VIDEO');
assert.strictEqual(stateAfterNoId.currentVideoId, 'oldVideo001');
assert.deepStrictEqual(
  stateAfterNoId.lists.default.queue.map((entry) => entry.id),
  ['oldVideo001', 'nextVideo01']
);
console.log('play next commands without a video id are rejected');

const endedWithoutVideo = await playbackHandlers['player:videoEnded'](
  {},
  { tab: { id: 111 } }
);
const stateAfterBadEnded = await getState();

assert.strictEqual(endedWithoutVideo.handled, false);
assert.strictEqual(endedWithoutVideo.reason, 'INVALID_VIDEO');
assert.strictEqual(stateAfterBadEnded.currentVideoId, 'oldVideo001');
console.log('video-ended events without a video id are rejected');
