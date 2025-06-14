import { getVideoInfo, isShort } from './youTubeApiConnectors.js';
import { TITLEFILTER, BROADCASTFILTER } from './constants.js';

export async function filterVideos(list) {
  console.log('Fetching info for', list.length, 'videos');
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

  const needInfo = list.filter(
    (v) => !v.duration || !v.title || !v.channelId
  );
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

  const stats = {};
  for (const v of info) {
    const ch = v.channelId || 'unknown';
    if (!stats[ch]) {
      stats[ch] = {
        title: (v.channelTitle || ch).padEnd(30).slice(0, 30),
        new: 0,
        filtered: 0,
        shorts: 0,
        broadcasts: 0,
        add: 0,
      };
    }
    stats[ch].new++;
  }
  const toCheck = [];
  let filtered = 0;
  let liveFiltered = 0;
  for (const video of info) {
    const st = stats[video.channelId || 'unknown'];
    if (!filters[1](video)) {
      liveFiltered++;
      st.broadcasts++;
      continue;
    }
    if (!filters[0](video)) {
      filtered++;
      st.filtered++;
      continue;
    }
    toCheck.push(video);
  }
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
        const st = stats[video.channelId || 'unknown'];
        if (short) {
          shorts++;
          st.shorts++;
        } else {
          videos.push(video);
          st.add++;
        }
      } catch (err) {
        console.error('Failed short check', err);
        videos.push(video);
        const st = stats[video.channelId || 'unknown'];
        st.add++;
      }
      checked++;
      if (checked % 5 === 0 || checked === toCheck.length) {
        console.log('Short checks', checked, '/', toCheck.length);
      }
    }
  }
  await Promise.all(Array(concurrency).fill(0).map(worker));
  for (const st of Object.values(stats)) {
    console.log(
      `${st.title} new ${st.new}, filtered ${st.filtered}, broadcasts ${st.broadcasts}, shorts ${st.shorts}, to playlist ${st.add}`
    );
  }
  console.log(
    `${list.length} videos filter stats: filtered ${filtered}, broadcasts ${liveFiltered}, shorts ${shorts}, passed ${videos.length}`
  );
  return videos;
}
