const assert = require('assert');
const api = require('../youTubeApiConnectors.js');

api.__setCallApi(async () => {
  throw new Error('API playlistItems failed: 404 {"error":{"errors":[{"reason":"playlistNotFound","location":"playlistId"}]}}');
});

(async () => {
  const res = await api.getNewVideos('bad');
  assert.deepStrictEqual(res, []);
  console.log('getNewVideos handles 404');
})();
