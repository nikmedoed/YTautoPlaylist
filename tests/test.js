const assert = require('assert');
const api = require('../youTubeApiConnectors.js');

const calls = [];
api.__setCallApi(async (path) => {
  calls.push(path);
  if (path === 'playlistItems') {
    throw new Error('API playlistItems failed: 404 {"error":{"errors":[{"reason":"playlistNotFound","location":"playlistId"}]}}');
  }
  return { items: [] };
});

(async () => {
  const res = await api.getNewVideos('UUstub');
  assert.deepStrictEqual(res, []);
  assert.deepStrictEqual(calls, ['playlistItems', 'search']);
  console.log('getNewVideos falls back to search');
})();
