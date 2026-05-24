// Fetches video entries and playlist ids for background add flows. Contains YouTube metadata conversion and active-tab collection requests.
import { getPlaylistVideoIds } from "../youtube-api/playlists.js";
import { getVideoInfo } from "../youtube-api/videos.js";
import {
  parsePlaylistId,
  parseVideoId,
  resolveThumbnailUrl,
} from "../utils.js";
import { MAX_API_BATCH } from "./constants.js";

function normalizeLiveStreamingDetails(details) {
  if (!details || typeof details !== "object") {
    return null;
  }
  return {
    actualStartTime: details.actualStartTime || null,
    scheduledStartTime: details.scheduledStartTime || null,
    actualEndTime: details.actualEndTime || null,
  };
}

function toQueueEntry(video, overrides = {}) {
  const published =
    video.publishedAt instanceof Date
      ? video.publishedAt.toISOString()
      : typeof video.publishedAt === "string"
      ? video.publishedAt
      : null;
  const description =
    typeof video.description === "string" ? video.description : "";
  const tags = Array.isArray(video.tags) ? video.tags.slice() : [];
  const liveStreamingDetails = normalizeLiveStreamingDetails(
    video.liveStreamingDetails
  );
  const liveBroadcastContent =
    typeof video.liveBroadcastContent === "string"
      ? video.liveBroadcastContent
      : null;
  return {
    id: video.id,
    title: video.title || "",
    channelId: video.channelId || "",
    channelTitle: video.channelTitle || "",
    thumbnail: overrides.thumbnail ?? resolveThumbnailUrl(video),
    publishedAt: published,
    duration: video.duration || null,
    addedAt: Date.now(),
    description,
    tags,
    liveStreamingDetails,
    liveBroadcastContent,
  };
}

export async function fetchVideoEntries(videoIds) {
  const ids = Array.from(
    new Set(
      (Array.isArray(videoIds) ? videoIds : [])
        .map(parseVideoId)
        .filter((id) => typeof id === "string" && id.length === 11)
    )
  );
  if (!ids.length) return [];
  const result = [];
  for (let i = 0; i < ids.length; i += MAX_API_BATCH) {
    const chunk = ids.slice(i, i + MAX_API_BATCH);
    const info = await getVideoInfo(chunk);
    const map = new Map();
    info.forEach((video) => {
      map.set(video.id, video);
    });
    chunk.forEach((id) => {
      const data = map.get(id);
      if (data) {
        result.push(toQueueEntry(data));
      }
    });
  }
  return result;
}

export async function fetchPlaylistVideoIds(playlistId, options = {}) {
  const parsed = parsePlaylistId(playlistId);
  if (!parsed) {
    return { ids: [], total: 0, hasMore: false };
  }
  const result = await getPlaylistVideoIds(parsed, options);
  return {
    ids: Array.isArray(result?.ids) ? result.ids : [],
    total:
      typeof result?.total === "number" && result.total >= 0
        ? result.total
        : Array.isArray(result?.ids)
          ? result.ids.length
          : 0,
    hasMore: Boolean(result?.hasMore),
  };
}

export async function requestVideoIdsFromActiveTab(scope) {
  const [activeTab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });
  if (!activeTab) {
    return { videoIds: [], error: "ACTIVE_TAB_NOT_FOUND" };
  }
  try {
    const response = await chrome.tabs.sendMessage(
      activeTab.id,
      {
        type: "collector:collect",
        scope,
      },
      { frameId: 0 }
    );
    if (!response || !Array.isArray(response.videoIds)) {
      return { videoIds: [], error: "NO_DATA" };
    }
    return { videoIds: response.videoIds, tabId: activeTab.id };
  } catch (err) {
    return {
      videoIds: [],
      error:
        err && typeof err.message === "string"
          ? err.message
          : "COLLECTOR_FAILED",
    };
  }
}
