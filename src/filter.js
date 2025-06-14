import { getVideoInfo, isShort } from './youTubeApiConnectors.js';
import { parseDuration } from './utils.js';
import { TITLEFILTER, BROADCASTFILTER } from './constants.js';

export async function filterVideos(list) {
  console.log('Fetching info for', list.length, 'videos');
  const filters = [
    (video) => parseDuration(video.duration) > 61,
    (video) => {
      const titfilt = TITLEFILTER[video.channelId];
      if (titfilt && titfilt.length > 0) {
        const title = video.title.toLowerCase();
        return !titfilt.some((tit) => title.includes(tit));
      }
      return true;
    },
    (video) =>
      !(
        video.liveStreamingDetails &&
        video.liveStreamingDetails.actualStartTime !=
          video.liveStreamingDetails.scheduledStartTime &&
        BROADCASTFILTER.includes(video.channelId)
      ),
  ];

  const needInfo = list.filter((v) => !v.duration || !v.title);
  const ids = [...new Set(needInfo.map((v) => v.id))];
  const chunks = [];
  while (ids.length) {
    chunks.push(await getVideoInfo(ids.splice(-50)));
  }
  const infoMap = {};
  for (const v of [].concat(...chunks)) {
    infoMap[v.id] = v;
  }
  const info = list.map((v) => ({ ...v, ...(infoMap[v.id] || {}) }));
  console.log('Got details for', info.length, 'videos');
  const toCheck = [];
  const filtered = [];
  for (const video of info) {
    if (filters.every((fltr) => fltr(video))) {
      toCheck.push(video);
    } else {
      filtered.push(video.id);
    }
  }
  console.log('After basic filters:', toCheck.length, 'videos');
  const videos = [];
  const shorts = [];
  let checked = 0;
  const concurrency = 5;
  let index = 0;
  async function worker() {
    while (index < toCheck.length) {
      const video = toCheck[index++];
      try {
        const short = await isShort(video);
        if (short) shorts.push(video.id);
        else videos.push(video);
      } catch (err) {
        console.error('Failed short check', err);
        videos.push(video);
      }
      checked++;
      if (checked % 5 === 0 || checked === toCheck.length) {
        console.log('Short checks', checked, '/', toCheck.length);
      }
    }
  }
  await Promise.all(Array(concurrency).fill(0).map(worker));
  console.log('After short filter:', videos.length, 'videos');
  return { videos, shorts, filtered };
}
