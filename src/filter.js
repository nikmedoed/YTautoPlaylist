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

function getRules(channelId) {
  const { global, channels } = FILTERS;
  const ch = channels[channelId] || {};
  return {
    noShorts: ch.noShorts ?? global.noShorts,
    noBroadcasts: ch.noBroadcasts ?? global.noBroadcasts,
    title: [...(global.title || []), ...(ch.title || [])],
    tags: [...(global.tags || []), ...(ch.tags || [])],
    duration: [...(global.duration || []), ...(ch.duration || [])],
  };
}

export async function filterVideos(list) {
  console.log('Fetching info for', list.length, 'videos');

  const info = await fetchInfo(list);
  const stats = buildStats(info);

  const result = [];
  let filtered = 0;
  let liveFiltered = 0;
  let shorts = 0;

  for (const video of info) {
    const st = stats[video.channelId || 'unknown'];
    const rules = getRules(video.channelId);

    if (
      rules.noBroadcasts &&
      video.liveStreamingDetails &&
      video.liveStreamingDetails.actualStartTime !==
        video.liveStreamingDetails.scheduledStartTime
    ) {
      liveFiltered++;
      st.broadcasts++;
      continue;
    }

    if (rules.title.length) {
      const t = (video.title || '').toLowerCase();
      if (rules.title.some((s) => t.includes(s))) {
        filtered++;
        st.filtered++;
        continue;
      }
    }

    if (rules.tags.length) {
      const tags = (video.tags || []).map((t) => t.toLowerCase());
      if (rules.tags.some((s) => tags.includes(s))) {
        filtered++;
        st.filtered++;
        continue;
      }
    }

    if (rules.duration.length) {
      const len = parseDuration(video.duration);
      if (
        typeof len === 'number' &&
        !rules.duration.some(({ min = 0, max = Infinity }) => len >= min && len <= max)
      ) {
        filtered++;
        st.filtered++;
        continue;
      }
    }

    if (rules.noShorts) {
      try {
        if (await isShort(video)) {
          shorts++;
          st.shorts++;
          continue;
        }
      } catch (err) {
        console.error('Failed short check', err);
      }
    }

    result.push(video);
    st.add++;
  }

  for (const st of Object.values(stats)) {
    console.log(
      `${st.title} new ${st.new}, filtered ${st.filtered}, broadcasts ${st.broadcasts}, shorts ${st.shorts}, to playlist ${st.add}`
    );
  }
  console.log(
    `${list.length} videos filter stats: filtered ${filtered}, broadcasts ${liveFiltered}, shorts ${shorts}, passed ${result.length}`
  );
  return result;
}
