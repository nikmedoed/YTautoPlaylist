import { getVideoInfo, isShort, isVideoInPlaylist } from "./youTubeApiConnectors.js";
import { parseDuration } from "./time.js";

const STORAGE_KEYS = {
  filters: "filters",
  autoCollect: "subscriptionsCollect",
};

const DEFAULT_FILTERS = Object.freeze({
  global: { noShorts: true },
  channels: {},
});

let filtersCache = null;
let autoCollectLastRun = null;

function toDate(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) {
      return null;
    }
    const dt = new Date(value);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }
  if (typeof value === "string") {
    const dt = new Date(value);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }
  return null;
}

function cloneDate(value) {
  return value instanceof Date ? new Date(value.getTime()) : null;
}

function updateAutoCollectLastRun(meta) {
  if (meta && typeof meta === "object") {
    const parsed = toDate(meta.lastRunAt);
    autoCollectLastRun = parsed ? cloneDate(parsed) : null;
    return;
  }
  autoCollectLastRun = null;
}

function cloneDefaultFilters() {
  return {
    global: { ...DEFAULT_FILTERS.global },
    channels: {},
  };
}

function normalizeFilters(raw) {
  if (!raw || typeof raw !== "object") {
    return cloneDefaultFilters();
  }
  const normalized = cloneDefaultFilters();
  if (raw.global && typeof raw.global === "object") {
    normalized.global = { ...normalized.global, ...raw.global };
  }
  if (raw.channels && typeof raw.channels === "object") {
    normalized.channels = { ...raw.channels };
  }
  return normalized;
}

const hasChromeStorage =
  typeof chrome !== "undefined" && chrome?.storage?.local;

if (hasChromeStorage && chrome.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes[STORAGE_KEYS.filters]) {
      try {
        const parsed = JSON.parse(changes[STORAGE_KEYS.filters].newValue);
        filtersCache = normalizeFilters(parsed);
      } catch {
        filtersCache = cloneDefaultFilters();
      }
    }
    if (changes[STORAGE_KEYS.autoCollect]) {
      updateAutoCollectLastRun(changes[STORAGE_KEYS.autoCollect].newValue);
    }
  });
}

export function getFiltersLastSaved() {
  return cloneDate(autoCollectLastRun);
}

export function getFilters() {
  if (filtersCache) {
    return Promise.resolve(filtersCache);
  }
  if (!hasChromeStorage) {
    filtersCache = cloneDefaultFilters();
    return Promise.resolve(filtersCache);
  }
  return new Promise((resolve) => {
    chrome.storage.local.get(
      [STORAGE_KEYS.filters, STORAGE_KEYS.autoCollect],
      (data) => {
        if (data && data[STORAGE_KEYS.filters]) {
          try {
            const parsed = JSON.parse(data[STORAGE_KEYS.filters]);
            filtersCache = normalizeFilters(parsed);
          } catch {
            filtersCache = cloneDefaultFilters();
          }
        } else {
          filtersCache = cloneDefaultFilters();
          chrome.storage.local.set({
            [STORAGE_KEYS.filters]: JSON.stringify(filtersCache),
          });
        }
        updateAutoCollectLastRun(data?.[STORAGE_KEYS.autoCollect]);
        resolve(filtersCache);
      }
    );
  });
}

export function saveFilters(filters) {
  const normalized = normalizeFilters(filters);
  filtersCache = normalized;
  if (!hasChromeStorage) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    chrome.storage.local.set(
      {
        [STORAGE_KEYS.filters]: JSON.stringify(normalized),
      },
      resolve
    );
  });
}

async function fetchInfo(list) {
  const needInfo = list.filter(
    (video) =>
      !video.duration || !video.title || !video.channelId || !video.tags
  );
  const ids = Array.from(
    new Set(needInfo.map((video) => video.id).filter(Boolean))
  );
  if (!ids.length) {
    return list;
  }
  const infoMap = new Map();
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    try {
      const response = await getVideoInfo(chunk);
      response.forEach((video) => infoMap.set(video.id, video));
    } catch (err) {
      console.error("Failed to fetch video info chunk", chunk, err);
    }
  }
  return list.map((video) => {
    const extra = infoMap.get(video.id) || {};
    return { ...video, ...extra };
  });
}

async function isInPlaylists(videoId, playlistIds = []) {
  for (const playlistId of playlistIds) {
    try {
      if (await isVideoInPlaylist(videoId, playlistId)) {
        return true;
      }
    } catch (err) {
      console.error("Playlist check failed", playlistId, videoId, err);
    }
  }
  return false;
}

function buildStats(videos) {
  const stats = new Map();
  for (const video of videos) {
    const channelId = video.channelId || "unknown";
    if (!stats.has(channelId)) {
      stats.set(channelId, {
        name: (video.channelTitle || channelId).slice(0, 60),
        title: (video.channelTitle || channelId).padEnd(30).slice(0, 30),
        new: 0,
        filtered: 0,
        shorts: 0,
        broadcasts: 0,
        add: 0,
        stoplists: 0,
      });
    }
    stats.get(channelId).new += 1;
  }
  return stats;
}

function getRules(global, local = {}) {
  return {
    noShorts: local.noShorts ?? global.noShorts,
    noBroadcasts: local.noBroadcasts ?? global.noBroadcasts,
    title: [...(global.title || []), ...(local.title || [])].map((text) =>
      String(text).toLowerCase()
    ),
    tags: [...(global.tags || []), ...(local.tags || [])].map((tag) =>
      String(tag).toLowerCase().replace(/\s+/g, "")
    ),
    duration: [...(global.duration || []), ...(local.duration || [])].map(
      ({ min = 0, max = Infinity }) => ({
        min: Number.isFinite(min) ? min : 0,
        max: Number.isFinite(max) ? max : Infinity,
      })
    ),
    playlists: [...(global.playlists || []), ...(local.playlists || [])].filter(
      Boolean
    ),
  };
}

export async function applyFilters(video, rules) {
  if (
    rules.noBroadcasts &&
    video.liveStreamingDetails &&
    video.liveStreamingDetails.actualStartTime !==
      video.liveStreamingDetails.scheduledStartTime
  ) {
    return "broadcast";
  }

  if (rules.title.length) {
    const lowerTitle = (video.title || "").toLowerCase();
    if (rules.title.some((needle) => lowerTitle.includes(needle))) {
      return "title";
    }
  }

  if (rules.tags.length) {
    const tags = (video.tags || []).map((tag) =>
      String(tag).toLowerCase().replace(/\s+/g, "")
    );
    const titleTags =
      (video.title || "")
        .match(/#[^\s#]+/g)
        ?.map((tag) => tag.slice(1).toLowerCase().replace(/\s+/g, "")) || [];
    const allTags = tags.concat(titleTags);
    if (rules.tags.some((needle) => allTags.includes(needle))) {
      return "tag";
    }
  }

  if (rules.duration.length) {
    const durationSeconds = parseDuration(video.duration);
    if (
      typeof durationSeconds === "number" &&
      !rules.duration.some(
        ({ min = 0, max = Infinity }) =>
          durationSeconds >= min && durationSeconds <= max
      )
    ) {
      return "duration";
    }
  }

  if (rules.noShorts) {
    try {
      if (await isShort(video)) {
        return "short";
      }
    } catch (err) {
      console.error("Failed short check", err);
    }
  }

  return undefined;
}

async function determineFilterReason(video, filters) {
  const rules = getRules(filters.global, filters.channels[video.channelId]);
  const durationSeconds = parseDuration(video.duration);
  if (
    rules.duration.length &&
    (!video.duration ||
      typeof durationSeconds !== "number" ||
      !Number.isFinite(durationSeconds) ||
      durationSeconds <= 0)
  ) {
    return "missingDuration";
  }
  let reason = await applyFilters(video, rules);
  if (!reason && rules.playlists?.length) {
    if (await isInPlaylists(video.id, rules.playlists)) {
      reason = "playlist";
    }
  }
  return reason;
}

export async function getVideoFilterReason(video) {
  const filters = await getFilters();
  return determineFilterReason(video, filters);
}

export async function filterVideos(list, progress) {
  console.log("Fetching info for", list.length, "videos");
  const filters = await getFilters();
  const videos = await fetchInfo(list);
  const stats = buildStats(videos);
  const result = [];
  const concurrency = 5;
  let processed = 0;
  let index = 0;
  const notifyProgress = typeof progress === "function" ? progress : null;

  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const current = index++;
        if (current >= videos.length) break;
        const video = videos[current];
        const reason = await determineFilterReason(video, filters);
        const channelId = video.channelId || "unknown";
        const channelStats = stats.get(channelId);
        if (reason) {
          switch (reason) {
            case "short":
              channelStats.shorts += 1;
              break;
            case "broadcast":
              channelStats.broadcasts += 1;
              break;
            case "playlist":
              channelStats.stoplists += 1;
              break;
            default:
              channelStats.filtered += 1;
          }
        } else {
          channelStats.add += 1;
          result.push(video);
        }
        processed += 1;
        if (processed % 5 === 0 || processed === videos.length) {
          console.log("Filter progress", processed, "/", videos.length);
        }
        if (
          notifyProgress &&
          (processed % 10 === 0 || processed === videos.length)
        ) {
          notifyProgress({
            phase: "filterProgress",
            processed,
            total: videos.length,
          });
        }
      }
    })
  );

  const totals = Array.from(stats.values()).reduce(
    (acc, channelStats) => {
      acc.filtered += channelStats.filtered;
      acc.shorts += channelStats.shorts;
      acc.broadcasts += channelStats.broadcasts;
      acc.stoplists += channelStats.stoplists;
      acc.passed += channelStats.add;
      return acc;
    },
    { filtered: 0, shorts: 0, broadcasts: 0, stoplists: 0, passed: 0 }
  );

  const channelEntries = Array.from(stats.values()).map((channelStats) => ({
    name: (channelStats.name || channelStats.title || "").trim(),
    title: channelStats.title,
    new: channelStats.new,
    filtered: channelStats.filtered,
    broadcasts: channelStats.broadcasts,
    shorts: channelStats.shorts,
    add: channelStats.add,
    stoplists: channelStats.stoplists,
  }));

  const sortedChannels = channelEntries
    .slice()
    .sort((a, b) => {
      if (b.add !== a.add) return b.add - a.add;
      if (b.new !== a.new) return b.new - a.new;
      return a.name.localeCompare(b.name, "ru");
    });

  const logEntries = sortedChannels.map((channel) => {
    const baseTitle = (channel.title || channel.name || "").trimEnd();
    const paddedTitle = baseTitle.padEnd(30).slice(0, 30);
    return `${paddedTitle} new ${channel.new}, filtered ${channel.filtered}, broadcasts ${channel.broadcasts}, shorts ${channel.shorts}, to playlist ${channel.add}, stoplists ${channel.stoplists}`;
  });

  if (notifyProgress) {
    notifyProgress({
      phase: "filterStats",
      videoCount: result.length,
      totals,
      channels: sortedChannels,
      logEntries,
      total: videos.length,
      initialCount: list.length,
      readyPotential: totals.passed,
    });
  }

  for (const channelStats of stats.values()) {
    console.log(
      `${channelStats.title} new ${channelStats.new}, filtered ${channelStats.filtered}, broadcasts ${channelStats.broadcasts}, shorts ${channelStats.shorts}, to playlist ${channelStats.add}, stoplists ${channelStats.stoplists}`
    );
  }
  console.log(
    `${list.length} videos filter stats: filtered ${totals.filtered}, broadcasts ${totals.broadcasts}, shorts ${totals.shorts}, stoplists ${totals.stoplists}, passed ${totals.passed}`
  );
  return result;
}
