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

const hasChromeStorage = typeof chrome !== "undefined" && chrome?.storage?.local;

let filtersCache = null;
let autoCollectLastRun = null;

function asValidDate(value) {
  const candidate =
    value instanceof Date
      ? new Date(value.getTime())
      : typeof value === "number" || typeof value === "string"
        ? new Date(value)
        : null;
  return candidate && !Number.isNaN(candidate.getTime()) ? candidate : null;
}

function updateAutoCollectLastRun(meta) {
  const candidate =
    meta && typeof meta === "object" ? meta.lastRunAt ?? meta : meta;
  autoCollectLastRun = asValidDate(candidate);
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

function parseStoredFilters(raw) {
  if (!raw) return cloneDefaultFilters();
  try {
    return normalizeFilters(typeof raw === "string" ? JSON.parse(raw) : raw);
  } catch {
    return cloneDefaultFilters();
  }
}

const chromeGet = (keys) =>
  new Promise((resolve) => chrome.storage.local.get(keys, (data) => resolve(data || {})));

const chromeSet = (payload) =>
  new Promise((resolve) => chrome.storage.local.set(payload, resolve));

if (hasChromeStorage && chrome.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes[STORAGE_KEYS.filters]) {
      filtersCache = parseStoredFilters(changes[STORAGE_KEYS.filters].newValue);
    }
    if (changes[STORAGE_KEYS.autoCollect]) {
      updateAutoCollectLastRun(changes[STORAGE_KEYS.autoCollect].newValue);
    }
  });
}

export function getFiltersLastSaved() {
  return asValidDate(autoCollectLastRun);
}

export async function getFilters() {
  if (filtersCache) {
    return filtersCache;
  }
  if (!hasChromeStorage) {
    filtersCache = cloneDefaultFilters();
    return filtersCache;
  }
  const data = await chromeGet([STORAGE_KEYS.filters, STORAGE_KEYS.autoCollect]);
  filtersCache = parseStoredFilters(data?.[STORAGE_KEYS.filters]);
  if (!data?.[STORAGE_KEYS.filters]) {
    await chromeSet({ [STORAGE_KEYS.filters]: JSON.stringify(filtersCache) });
  }
  updateAutoCollectLastRun(data?.[STORAGE_KEYS.autoCollect]);
  return filtersCache;
}

export async function saveFilters(filters) {
  filtersCache = normalizeFilters(filters);
  if (!hasChromeStorage) {
    return;
  }
  await chromeSet({ [STORAGE_KEYS.filters]: JSON.stringify(filtersCache) });
}

async function fetchInfo(list) {
  const ids = Array.from(
    new Set(
      list
        .filter(
          (video) =>
            !video.duration || !video.title || !video.channelId || !video.tags
        )
        .map((video) => video.id)
        .filter(Boolean)
    )
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

function normalizeNeedles(values, normalize, keyFn = (v) => v) {
  if (!Array.isArray(values)) return [];
  const seen = new Set();
  const result = [];
  values.forEach((value) => {
    const normalized = normalize(value);
    if (normalized == null) return;
    const key = keyFn(normalized);
    if (seen.has(key)) return;
    seen.add(key);
    result.push(normalized);
  });
  return result;
}

function normalizeDurationRange(range = {}) {
  const min = Number.isFinite(range.min) ? range.min : 0;
  const max = Number.isFinite(range.max) ? range.max : Infinity;
  return { min, max };
}

function createRulesResolver(filters) {
  const normalized = normalizeFilters(filters);
  const cache = new Map();

  return (channelId) => {
    const key = channelId || "unknown";
    if (cache.has(key)) return cache.get(key);
    const local = normalized.channels[key] || {};
    const rules = {
      noShorts: local.noShorts ?? normalized.global.noShorts,
      noBroadcasts: local.noBroadcasts ?? normalized.global.noBroadcasts,
      title: normalizeNeedles(
        [...(normalized.global.title || []), ...(local.title || [])],
        (text) => {
          const str = String(text || "").trim().toLowerCase();
          return str || null;
        }
      ),
      tags: normalizeNeedles(
        [...(normalized.global.tags || []), ...(local.tags || [])],
        (tag) => {
          const str = String(tag || "").toLowerCase().replace(/\s+/g, "");
          return str || null;
        }
      ),
      duration: normalizeNeedles(
        [...(normalized.global.duration || []), ...(local.duration || [])],
        normalizeDurationRange,
        ({ min, max }) => `${min}-${max}`
      ),
      playlists: normalizeNeedles(
        [...(normalized.global.playlists || []), ...(local.playlists || [])],
        (pl) => pl || null
      ),
    };
    cache.set(key, rules);
    return rules;
  };
}

function normalizeVideoTags(video) {
  const tags = (video.tags || []).map((tag) =>
    String(tag || "").toLowerCase().replace(/\s+/g, "")
  );
  const titleTags =
    (video.title || "")
      .match(/#[^\s#]+/g)
      ?.map((tag) => tag.slice(1).toLowerCase().replace(/\s+/g, "")) || [];
  return Array.from(new Set([...tags, ...titleTags]));
}

function isBroadcast(video) {
  return (
    video.liveStreamingDetails &&
    video.liveStreamingDetails.actualStartTime !==
      video.liveStreamingDetails.scheduledStartTime
  );
}

export async function applyFilters(video, rules, durationSeconds) {
  if (
    rules.noBroadcasts &&
    isBroadcast(video)
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
    const allTags = normalizeVideoTags(video);
    if (rules.tags.some((needle) => allTags.includes(needle))) {
      return "tag";
    }
  }

  if (rules.duration.length) {
    const parsedDuration =
      typeof durationSeconds === "number"
        ? durationSeconds
        : parseDuration(video.duration);
    if (
      typeof parsedDuration === "number" &&
      !rules.duration.some(
        ({ min = 0, max = Infinity }) =>
          parsedDuration >= min && parsedDuration <= max
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

async function determineFilterReason(video, rules) {
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
  let reason = await applyFilters(video, rules, durationSeconds);
  if (!reason && rules.playlists?.length) {
    if (await isInPlaylists(video.id, rules.playlists)) {
      reason = "playlist";
    }
  }
  return reason;
}

export async function getVideoFilterReason(video) {
  const filters = await getFilters();
  const rulesForChannel = createRulesResolver(filters);
  return determineFilterReason(video, rulesForChannel(video.channelId));
}

export async function filterVideos(list, progress) {
  console.log("Fetching info for", list.length, "videos");
  const filters = await getFilters();
  const rulesForChannel = createRulesResolver(filters);
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
        const channelId = video.channelId || "unknown";
        const reason = await determineFilterReason(
          video,
          rulesForChannel(channelId)
        );
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
