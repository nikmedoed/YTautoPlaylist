import { getVideoInfo, isShort } from './youTubeApiConnectors.js';
import { FILTERS } from './constants.js';
import { parseDuration } from './utils.js';

async function fetchInfo(list) {
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
  return list.map((v) => ({ ...v, ...(infoMap[v.id] || {}) }));
}

function buildStats(videos) {
  const stats = {};
  for (const v of videos) {
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
  return stats;
}

function getRules(global, local = {}) {
  return {
    noShorts: local.noShorts ?? global.noShorts,
    noBroadcasts: local.noBroadcasts ?? global.noBroadcasts,
    title: [...(global.title || []), ...(local.title || [])],
    tags: [...(global.tags || []), ...(local.tags || [])],
    duration: [...(global.duration || []), ...(local.duration || [])],
  };
}

export async function applyFilters(video, global, channels, stats) {
  const st = stats[video.channelId || 'unknown'];
  const rules = getRules(global, channels[video.channelId]);

  if (
    rules.noBroadcasts &&
    video.liveStreamingDetails &&
    video.liveStreamingDetails.actualStartTime !==
      video.liveStreamingDetails.scheduledStartTime
  ) {
    st.broadcasts++;
    return false;
  }

  if (rules.title.length) {
    const t = (video.title || '').toLowerCase();
    if (rules.title.some((s) => t.includes(s))) {
      st.filtered++;
      return false;
    }
  }

  if (rules.tags.length) {
    const tags = (video.tags || []).map((t) => t.toLowerCase());
    if (rules.tags.some((s) => tags.includes(s))) {
      st.filtered++;
      return false;
    }
  }

  if (rules.duration.length) {
    const len = parseDuration(video.duration);
    if (
      typeof len === 'number' &&
      !rules.duration.some(({ min = 0, max = Infinity }) => len >= min && len <= max)
    ) {
      st.filtered++;
      return false;
    }
  }

  if (rules.noShorts) {
    try {
      if (await isShort(video)) {
        st.shorts++;
        return false;
      }
    } catch (err) {
      console.error('Failed short check', err);
    }
  }

  st.add++;
  return true;
}

export async function filterVideos(list) {
  console.log('Fetching info for', list.length, 'videos');

  list = await fetchInfo(list);
  const stats = buildStats(list);

  const result = [];
  const videos = list;

  let processed = 0;
  const concurrency = 5;

  let index = 0;
  async function worker() {
    while (index < videos.length) {
      const video = videos[index++];
      if (await applyFilters(video, FILTERS.global, FILTERS.channels, stats)) {
        result.push(video);
      }
      processed++;
      if (processed % 5 === 0 || processed === videos.length) {
        console.log('Filter progress', processed, '/', videos.length);
      }
    }
  }

  await Promise.all(Array(concurrency).fill(0).map(worker));

  const totals = Object.values(stats).reduce(
    (acc, st) => {
      acc.filtered += st.filtered;
      acc.shorts += st.shorts;
      acc.broadcasts += st.broadcasts;
      acc.passed += st.add;
      return acc;
    },
    { filtered: 0, shorts: 0, broadcasts: 0, passed: 0 }
  );

  for (const st of Object.values(stats)) {
    console.log(
      `${st.title} new ${st.new}, filtered ${st.filtered}, broadcasts ${st.broadcasts}, shorts ${st.shorts}, to playlist ${st.add}`
    );
  }
  console.log(
    `${list.length} videos filter stats: filtered ${totals.filtered}, broadcasts ${totals.broadcasts}, shorts ${totals.shorts}, passed ${totals.passed}`
  );
  return result;
}
