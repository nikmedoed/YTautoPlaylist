const assert = require('assert');
const api = require('../youTubeApiConnectors.js');

const calls = [];
api.__setCallApi(async (path) => {
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
  const res = await api.getNewVideos('UUstub');
  assert.deepStrictEqual(res, []);
  assert.deepStrictEqual(calls, ['playlistItems', 'search']);
  console.log('getNewVideos falls back to search');
})();
