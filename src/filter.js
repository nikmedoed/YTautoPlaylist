import { getVideoInfo, isShort } from './youTubeApiConnectors.js';
import { parseDuration } from './utils.js';
import { TITLEFILTER, BROADCASTFILTER } from './constants.js';

export async function filterID(list) {
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
  const chunks = [];
  while (list.length) {
    chunks.push(await getVideoInfo(list.splice(-50)));
  }
  const info = [].concat(...chunks);
  console.log('Got details for', info.length, 'videos');
  const toCheck = [];
  const filtered = [];
  for (const video of info) {
    if (filters.every((fltr) => fltr(video))) {
      toCheck.push(video);
    } else {
      filtered.push(video.vId);
    }
  }
  console.log('After basic filters:', toCheck.length, 'videos');
  const videos = [];
  const shorts = [];
  const quickShort = (v) =>
    parseDuration(v.duration) < 60 ||
    (v.tags && v.tags.some((t) => /shorts/i.test(t))) ||
    v.title.toLowerCase().includes('#short');
  let checked = 0;
  const concurrency = 5;
  let index = 0;
  async function worker() {
    while (index < toCheck.length) {
      const video = toCheck[index++];
      if (quickShort(video)) {
        shorts.push(video.vId);
        checked++;
        continue;
      }
      try {
        const short = await isShort(video);
        if (short) shorts.push(video.vId);
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
