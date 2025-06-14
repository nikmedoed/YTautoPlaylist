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

function passesFilters(video, global, channels) {
  const titleG = global.title || [];
  const titleC = channels[video.channelId]?.title || [];
  if (titleG.length || titleC.length) {
    const t = (video.title || '').toLowerCase();
    if ([...titleG, ...titleC].some((s) => t.includes(s))) return false;
  }

  const tagG = global.tags || [];
  const tagC = channels[video.channelId]?.tags || [];
  if (tagG.length || tagC.length) {
    const tags = (video.tags || []).map((t) => t.toLowerCase());
    if ([...tagG, ...tagC].some((s) => tags.includes(s))) return false;
  }

  const ranges = [
    ...(global.duration || []),
    ...(channels[video.channelId]?.duration || []),
  ];
  if (ranges.length) {
    const len = parseDuration(video.duration);
    if (typeof len === 'number') {
      if (!ranges.some(({ min = 0, max = Infinity }) => len >= min && len <= max)) {
        return false;
      }
    }
  }

  const gb = global.noBroadcasts;
  const cb = channels[video.channelId]?.noBroadcasts;
  if (gb || cb) {
    if (
      video.liveStreamingDetails &&
      video.liveStreamingDetails.actualStartTime !=
        video.liveStreamingDetails.scheduledStartTime
    ) {
      return false;
    }
  }

  return true;
}

function checkShortNeeded(video, global, channels) {
  return global.noShorts || channels[video.channelId]?.noShorts;
}

async function filterOutShorts(list, stats, global, channels) {
  const result = [];
  let shorts = 0;
  for (const video of list) {
    try {
      const short = await isShort(video);
      const st = stats[video.channelId || 'unknown'];
      if (short) {
        shorts++;
        st.shorts++;
      } else {
        result.push(video);
        st.add++;
      }
    } catch (err) {
      console.error('Failed short check', err);
      result.push(video);
      const st = stats[video.channelId || 'unknown'];
      st.add++;
    }
  }
  return { videos: result, shorts };
}

export async function filterVideos(list) {
  console.log('Fetching info for', list.length, 'videos');

  const { global, channels } = FILTERS;

  const info = await fetchInfo(list);
  const stats = buildStats(info);

  const toCheck = [];
  const videos = [];
  let filtered = 0;
  let liveFiltered = 0;

  for (const video of info) {
    const st = stats[video.channelId || 'unknown'];
    if (!passesFilters(video, global, channels)) {
      if (
        video.liveStreamingDetails &&
        video.liveStreamingDetails.actualStartTime !=
          video.liveStreamingDetails.scheduledStartTime
      ) {
        liveFiltered++;
        st.broadcasts++;
      } else {
        filtered++;
        st.filtered++;
      }
      continue;
    }
    if (checkShortNeeded(video, global, channels)) {
      toCheck.push(video);
    } else {
      videos.push(video);
      st.add++;
    }
  }

  const shortRes = await filterOutShorts(toCheck, stats, global, channels);
  videos.push(...shortRes.videos);

  for (const st of Object.values(stats)) {
    console.log(
      `${st.title} new ${st.new}, filtered ${st.filtered}, broadcasts ${st.broadcasts}, shorts ${st.shorts}, to playlist ${st.add}`
    );
  }
  console.log(
    `${list.length} videos filter stats: filtered ${filtered}, broadcasts ${liveFiltered}, shorts ${shortRes.shorts}, passed ${videos.length}`
  );
  return videos;
}
