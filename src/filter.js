import { getVideoInfo, isShort } from './youTubeApiConnectors.js';
import { FILTERS } from './constants.js';
import { parseDuration } from './utils.js';

export async function filterVideos(list) {
  console.log('Fetching info for', list.length, 'videos');

  const { global, channels } = FILTERS;

  function checkTitle(video) {
    const g = global.title || [];
    const c = channels[video.channelId]?.title || [];
    if (!g.length && !c.length) return true;
    const title = (video.title || '').toLowerCase();
    return ![...g, ...c].some((t) => title.includes(t));
  }

  function checkTags(video) {
    const g = global.tags || [];
    const c = channels[video.channelId]?.tags || [];
    if (!g.length && !c.length) return true;
    const tags = (video.tags || []).map((t) => t.toLowerCase());
    return ![...g, ...c].some((t) => tags.includes(t));
  }

  function checkDuration(video) {
    const g = global.duration || [];
    const c = channels[video.channelId]?.duration || [];
    const ranges = [...g, ...c];
    if (!ranges.length) return true;
    const len = parseDuration(video.duration);
    if (typeof len !== 'number') return true;
    return ranges.some(({ min = 0, max = Infinity }) => len >= min && len <= max);
  }

  function checkBroadcast(video) {
    const gb = global.noBroadcasts;
    const cb = channels[video.channelId]?.noBroadcasts;
    if (!gb && !cb) return true;
    return !(
      video.liveStreamingDetails &&
      video.liveStreamingDetails.actualStartTime !=
        video.liveStreamingDetails.scheduledStartTime
    );
  }

  function needShortCheck(video) {
    return global.noShorts || channels[video.channelId]?.noShorts;
  }

  const needInfo = list.filter(
    (v) => !v.duration || !v.title || !v.channelId || !v.tags
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
  const videos = [];
  const toCheck = [];
  let filtered = 0;
  let liveFiltered = 0;
  for (const video of info) {
    const st = stats[video.channelId || 'unknown'];
    if (!checkBroadcast(video)) {
      liveFiltered++;
      st.broadcasts++;
      continue;
    }
    if (!checkTitle(video) || !checkTags(video) || !checkDuration(video)) {
      filtered++;
      st.filtered++;
      continue;
    }
    if (needShortCheck(video)) {
      toCheck.push(video);
    } else {
      videos.push(video);
      st.add++;
    }
  }
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
