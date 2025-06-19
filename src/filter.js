import {
  getVideoInfo,
  getChannelPlaylists,
  getPlaylistVideos,
  isShort,
} from './youTubeApiConnectors.js';

const DEFAULT_FILTERS = {
  global: { noShorts: true, playlists: [] },
  channels: {},
};
import { parseDuration } from './utils.js';

let filtersCache;

export function getFilters() {
  if (filtersCache) return Promise.resolve(filtersCache);
  if (typeof chrome === 'undefined') {
    filtersCache = DEFAULT_FILTERS;
    return Promise.resolve(filtersCache);
  }
  return new Promise((resolve) => {
    chrome.storage.local.get(['filters'], (data) => {
      if (data && data.filters) {
        try {
          filtersCache = JSON.parse(data.filters);
        } catch (e) {
          filtersCache = DEFAULT_FILTERS;
        }
      } else {
        filtersCache = DEFAULT_FILTERS;
        chrome.storage.local.set({ filters: JSON.stringify(filtersCache) });
      }
      resolve(filtersCache);
    });
  });
}

export function saveFilters(filters) {
  filtersCache = filters;
  if (typeof chrome === 'undefined') return Promise.resolve();
  return new Promise((resolve) => {
    chrome.storage.local.set({ filters: JSON.stringify(filters) }, resolve);
  });
}

async function fetchInfo(list, filters) {
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

  const playlistMap = await fetchPlaylistInfo(list, filters);

  return list.map((v) => ({
    ...v,
    ...(infoMap[v.id] || {}),
    playlists: playlistMap[v.id] || v.playlists || [],
  }));
}

async function fetchPlaylistInfo(list, filters) {
  const result = {};
  const globalPhrases = (filters.global.playlists || []).map((s) =>
    s.toLowerCase()
  );
  const byChannel = {};
  for (const v of list) {
    if (!v.channelId) continue;
    if (!byChannel[v.channelId]) byChannel[v.channelId] = new Set();
    byChannel[v.channelId].add(v.id);
  }

  for (const [channelId, ids] of Object.entries(byChannel)) {
    const channelPhrases = [
      ...globalPhrases,
      ...((filters.channels[channelId]?.playlists || []).map((s) => s.toLowerCase())),
    ];
    if (!channelPhrases.length) continue;
    let playlists;
    try {
      playlists = await getChannelPlaylists(channelId);
    } catch (e) {
      console.error('Failed to get playlists for', channelId, e);
      continue;
    }
    const relevant = playlists.filter((pl) =>
      channelPhrases.some((ph) => pl.title.toLowerCase().includes(ph))
    );
    if (!relevant.length) continue;
    for (const pl of relevant) {
      let vids = [];
      try {
        vids = await getPlaylistVideos(pl.id, 150);
      } catch (e) {
        console.error('Failed to get items for', pl.id, e);
        continue;
      }
      for (const vid of vids) {
        if (ids.has(vid)) {
          result[vid] = result[vid] || [];
          result[vid].push(pl.title);
        }
      }
    }
  }
  return result;
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
    playlists: [...(global.playlists || []), ...(local.playlists || [])],
    duration: [...(global.duration || []), ...(local.duration || [])],
  };
}

export async function applyFilters(video, rules) {

  if (
    rules.noBroadcasts &&
    video.liveStreamingDetails &&
    video.liveStreamingDetails.actualStartTime !==
      video.liveStreamingDetails.scheduledStartTime
  ) {
    return 'broadcast';
  }

  if (rules.title.length) {
    const t = (video.title || '').toLowerCase();
    if (rules.title.some((s) => t.includes(s))) {
      return 'title';
    }
  }

  if (rules.tags.length) {
    const tags = (video.tags || []).map((t) => t.toLowerCase());
    if (rules.tags.some((s) => tags.includes(s))) {
      return 'tag';
    }
  }

  if (rules.playlists.length) {
    const pls = (video.playlists || []).map((p) => p.toLowerCase());
    if (
      rules.playlists.some((s) =>
        pls.some((name) => name.includes(s))
      )
    ) {
      return 'playlist';
    }
  }

  if (rules.duration.length) {
    const len = parseDuration(video.duration);
    if (
      typeof len === 'number' &&
      !rules.duration.some(({ min = 0, max = Infinity }) => len >= min && len <= max)
    ) {
      return 'duration';
    }
  }

  if (rules.noShorts) {
    try {
      if (await isShort(video)) {
        return 'short';
      }
    } catch (err) {
      console.error('Failed short check', err);
    }
  }

  return undefined;
}

export async function filterVideos(list) {
  console.log('Fetching info for', list.length, 'videos');

  const FILTERS = await getFilters();

  list = await fetchInfo(list, FILTERS);
  const stats = buildStats(list);

  const result = [];
  const videos = list;

  let processed = 0;
  const concurrency = 5;

  let index = 0;
  async function worker() {
    while (index < videos.length) {
      const video = videos[index++];
      const rules = getRules(FILTERS.global, FILTERS.channels[video.channelId]);
      const reason = await applyFilters(video, rules);
      const st = stats[video.channelId || 'unknown'];
      if (reason) {
        if (reason === 'short') st.shorts++;
        else if (reason === 'broadcast') st.broadcasts++;
        else st.filtered++;
      } else {
        st.add++;
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
