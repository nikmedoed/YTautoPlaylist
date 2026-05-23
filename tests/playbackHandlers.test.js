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
