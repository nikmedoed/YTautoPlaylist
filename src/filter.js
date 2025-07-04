import { getVideoInfo, isShort, isVideoInPlaylist } from './youTubeApiConnectors.js';

const DEFAULT_FILTERS = {
  global: { noShorts: true },
  channels: {},
};
import { parseDuration } from './utils.js';

let filtersCache;
let filtersSaveTime;

if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') {
      if (changes.filters) {
        try {
          filtersCache = JSON.parse(changes.filters.newValue);
        } catch (e) {
          filtersCache = DEFAULT_FILTERS;
        }
      }
      if (changes.filtersSaveTime) {
        filtersSaveTime = new Date(changes.filtersSaveTime.newValue);
      }
    }
  });
}

export function getFiltersLastSaved() {
  return filtersSaveTime;
}

export function getFilters() {
  if (filtersCache) return Promise.resolve(filtersCache);
  if (typeof chrome === 'undefined') {
    filtersCache = DEFAULT_FILTERS;
    return Promise.resolve(filtersCache);
  }
  return new Promise((resolve) => {
    chrome.storage.local.get(['filters', 'filtersSaveTime'], (data) => {
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
      if (data && data.filtersSaveTime) {
        filtersSaveTime = new Date(data.filtersSaveTime);
      }
      resolve(filtersCache);
    });
  });
}

export function saveFilters(filters) {
  filtersCache = filters;
  filtersSaveTime = new Date();
  if (typeof chrome === 'undefined') return Promise.resolve();
  return new Promise((resolve) => {
    chrome.storage.local.set(
      { filters: JSON.stringify(filters), filtersSaveTime: filtersSaveTime.toISOString() },
      resolve
    );
  });
}

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

async function isInPlaylists(videoId, playlistIds) {
  for (const pl of playlistIds) {
    try {
      if (await isVideoInPlaylist(videoId, pl)) {
        return true;
      }
    } catch (err) {
      console.error('Playlist check failed', pl, videoId, err);
    }
  }
  return false;
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
        stoplists: 0,
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
    title: [...(global.title || []), ...(local.title || [])].map((t) =>
      t.toLowerCase()
    ),
    tags: [...(global.tags || []), ...(local.tags || [])].map((t) =>
      t.toLowerCase().replace(/\s+/g, '')
    ),
    duration: [...(global.duration || []), ...(local.duration || [])],
    playlists: local.playlists || [],
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
    const tags = (video.tags || [])
      .map((t) => t.toLowerCase().replace(/\s+/g, ''));
    const titleTags = (video.title || '')
      .match(/#[^\s#]+/g)
      ?.map((t) => t.slice(1).toLowerCase().replace(/\s+/g, '')) || [];
    const allTags = tags.concat(titleTags);
    if (rules.tags.some((s) => allTags.includes(s))) {
      return 'tag';
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

export async function getVideoFilterReason(video) {
  const filters = await getFilters();
  const rules = getRules(filters.global, filters.channels[video.channelId]);
  let reason = await applyFilters(video, rules);
  if (!reason && rules.playlists && rules.playlists.length) {
    if (await isInPlaylists(video.id, rules.playlists)) {
      reason = 'playlist';
    }
  }
  return reason;
}

export async function filterVideos(list) {
  console.log('Fetching info for', list.length, 'videos');

  const FILTERS = await getFilters();

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
      const rules = getRules(FILTERS.global, FILTERS.channels[video.channelId]);
      let reason = await applyFilters(video, rules);
      if (!reason && rules.playlists && rules.playlists.length) {
        if (await isInPlaylists(video.id, rules.playlists)) {
          reason = 'playlist';
        }
      }
      const st = stats[video.channelId || 'unknown'];
      if (reason) {
        if (reason === 'short') st.shorts++;
        else if (reason === 'broadcast') st.broadcasts++;
        else if (reason === 'playlist') st.stoplists++;
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
      acc.stoplists += st.stoplists;
      acc.passed += st.add;
      return acc;
    },
    { filtered: 0, shorts: 0, broadcasts: 0, stoplists: 0, passed: 0 }
  );

  for (const st of Object.values(stats)) {
    console.log(
      `${st.title} new ${st.new}, filtered ${st.filtered}, broadcasts ${st.broadcasts}, shorts ${st.shorts}, to playlist ${st.add}, stoplists ${st.stoplists}`
    );
  }
  console.log(
    `${list.length} videos filter stats: filtered ${totals.filtered}, broadcasts ${totals.broadcasts}, shorts ${totals.shorts}, stoplists ${totals.stoplists}, passed ${totals.passed}`
  );
  return result;
}
