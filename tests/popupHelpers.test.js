// Popup and manager helper tests. Covers status messages, cooldown metadata, playback metadata, watched removal, and detail reload decisions.
import assert from 'assert';
import {
  formatAddResultMessage,
  normalizeAddResponse,
} from '../src/addResultMessages.js';
import {
  formatCooldownMessage,
  readAutoCollectMeta,
} from '../src/popup/modules/collection/availability.js';
import {
  getWatchedVideoIds,
  haveListMetaChanged,
  shouldReloadSelectedDetails,
} from '../src/popup/modules/manager/detailHelpers.js';
import { computePlaybackMeta } from '../src/popup/modules/playback/meta.js';

{
  const state = { id: 'state' };
  assert.deepStrictEqual(normalizeAddResponse({ state, requested: 4, missing: 1, added: 2 }), {
    state,
    requested: 4,
    missing: 1,
    added: 2,
  });
  assert.deepStrictEqual(normalizeAddResponse(null), {
    state: null,
    requested: null,
    missing: 0,
    added: 0,
  });
  assert.deepStrictEqual(
    formatAddResultMessage({ added: 2, requested: 4, missing: 1 }),
    {
      message: 'Добавлено 2 видео (ещё 1 видео уже были). Не удалось получить данные для 1 видео',
      kind: 'success',
    }
  );
  assert.deepStrictEqual(
    formatAddResultMessage({
      added: 0,
      requested: 3,
      missing: 0,
      scopeLabel: 'видимые видео',
    }),
    {
      message: 'Все видимые видео уже в списке',
      kind: 'info',
    }
  );
  console.log('popup add-result messages are normalized consistently');
}

{
  assert.deepStrictEqual(
    readAutoCollectMeta({
      autoCollect: {
        lastRunAt: 1_000,
        lastAdded: 2,
        lastFetched: 3,
        cooldownMs: 5_000,
      },
    }),
    {
      lastRunAt: 1_000,
      lastAdded: 2,
      lastFetched: 3,
      nextAutoCollectAt: 0,
      nextRunAt: 6_000,
      cooldownMs: 5_000,
    }
  );
  assert.match(formatCooldownMessage(90_000, 0), /^Сбор будет доступен через 1 мин$/);
  console.log('popup collection cooldown metadata is formatted consistently');
}

{
  const state = {
    currentListId: 'main',
    currentVideoId: 'b',
    currentQueue: {
      id: 'main',
      freeze: true,
      currentIndex: 0,
      queue: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
    },
    history: [],
  };
  assert.deepStrictEqual(computePlaybackMeta(state), {
    queue: state.currentQueue.queue,
    queueIds: ['a', 'b', 'c'],
    pointerIndex: 0,
    currentIndex: 1,
    inQueue: true,
    queueMatchesActive: true,
    controlling: true,
    frozen: true,
    hasPrev: true,
    hasNext: true,
  });
  assert.strictEqual(
    computePlaybackMeta({ ...state, currentListId: 'other' }).controlling,
    false
  );
  console.log('popup playback metadata tracks active queue controls');
}

{
  const details = {
    queue: [
      { id: 'too-low' },
      { id: 'boundary' },
      { id: 'watched' },
      { id: 'rounded-watched' },
      { id: '' },
      {},
    ],
  };
  const progress = {
    'too-low': { percent: 94.9 },
    boundary: { percent: 95 },
    watched: { percent: 96 },
    'rounded-watched': { percent: 95.6 },
    ignored: { percent: 100 },
  };
  assert.deepStrictEqual(getWatchedVideoIds(details, progress), [
    'watched',
    'rounded-watched',
  ]);
  assert.deepStrictEqual(getWatchedVideoIds(null, progress), []);
  console.log('manager remove-watched selects only videos with progress above 95 percent');
}

{
  const lists = [
    { id: 'default', name: 'Main', freeze: false, revision: 1, length: 2 },
    { id: 'later', name: 'Later', freeze: true, revision: 3, length: 0 },
  ];
  assert.strictEqual(haveListMetaChanged(lists, lists.map((item) => ({ ...item }))), false);
  assert.strictEqual(
    haveListMetaChanged(lists, [{ ...lists[0], length: 3 }, lists[1]]),
    true
  );
  assert.strictEqual(
    haveListMetaChanged(lists, [lists[1], lists[0]]),
    true
  );
  assert.strictEqual(
    haveListMetaChanged(lists, [{ ...lists[0], freeze: true }, lists[1]]),
    true
  );
  console.log('manager list metadata changes are detected by id, order, flags, revision and length');
}

{
  const state = {
    lists: [
      { id: 'main', name: 'Main', freeze: false, revision: 2, length: 2 },
    ],
  };
  const details = {
    id: 'main',
    name: 'Main',
    freeze: false,
    revision: 2,
    queue: [{ id: 'a' }, { id: 'b' }],
  };
  assert.strictEqual(shouldReloadSelectedDetails(state, '', details), false);
  assert.strictEqual(shouldReloadSelectedDetails(state, 'main', details), false);
  assert.strictEqual(
    shouldReloadSelectedDetails(state, 'main', { ...details, revision: 1 }),
    true
  );
  assert.strictEqual(
    shouldReloadSelectedDetails(state, 'main', { ...details, queue: [{ id: 'a' }] }),
    true
  );
  assert.strictEqual(
    shouldReloadSelectedDetails({ lists: [] }, 'main', details),
    true
  );
  console.log('manager selected-list detail reload decisions are covered');
}
