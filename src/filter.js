import { getVideoInfo, isShort } from './youTubeApiConnectors.js';
import { TITLEFILTER, BROADCASTFILTER } from './constants.js';

export async function filterVideos(list) {
  console.log('Fetching info for', list.length, 'videos');
  const stats = {};
  for (const v of list) {
    const pl = v.playlist || 'unknown';
    if (!stats[pl]) stats[pl] = { new: 0, filtered: 0, add: 0 };
    stats[pl].new++;
  }
  const filters = [
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
  let filtered = 0;
  let liveFiltered = 0;
  for (const video of info) {
    if (!filters[1](video)) {
      liveFiltered++;
      if (stats[video.playlist]) stats[video.playlist].filtered++;
      continue;
    }
    if (!filters[0](video)) {
      filtered++;
      if (stats[video.playlist]) stats[video.playlist].filtered++;
      continue;
    }
    toCheck.push(video);
  }
  console.log('After basic filters:', toCheck.length, 'videos');
  const videos = [];
  let shorts = 0;
  let checked = 0;
  const concurrency = 5;
  let index = 0;
  async function worker() {
    while (index < toCheck.length) {
      const video = toCheck[index++];
      try {
        const short = await isShort(video);
        if (short) {
          shorts++;
          if (stats[video.playlist]) stats[video.playlist].filtered++;
        } else {
          videos.push(video);
          if (stats[video.playlist]) stats[video.playlist].add++;
        }
      } catch (err) {
        console.error('Failed short check', err);
        videos.push(video);
        if (stats[video.playlist]) stats[video.playlist].add++;
      }
      checked++;
      if (checked % 5 === 0 || checked === toCheck.length) {
        console.log('Short checks', checked, '/', toCheck.length);
      }
    }
  }
  await Promise.all(Array(concurrency).fill(0).map(worker));
  console.log(
    `After short filter: ${videos.length} videos, shorts ${shorts}, filtered ${filtered}, broadcasts ${liveFiltered}`
  );
  for (const [pl, st] of Object.entries(stats)) {
    if (st.new || st.filtered || st.add) {
      console.log(
        `Playlist ${pl} new ${st.new}, filtered ${st.filtered}, to playlist ${st.add}`
      );
    }
  }
  return videos;
}
