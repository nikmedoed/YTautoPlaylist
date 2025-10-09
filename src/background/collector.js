import { getVideoInfo } from "../youTubeApiConnectors.js";
import { collectVideos } from "../playlist.js";
import { parseVideoId } from "../utils.js";
import { MAX_API_BATCH } from "./constants.js";

function pickThumbnail(thumbnails) {
  if (!thumbnails) return "";
  return (
    thumbnails?.medium?.url ||
    thumbnails?.high?.url ||
    thumbnails?.standard?.url ||
    thumbnails?.maxres?.url ||
    thumbnails?.default?.url ||
    ""
  );
}

function toQueueEntry(video, overrides = {}) {
  const published =
    video.publishedAt instanceof Date
      ? video.publishedAt.toISOString()
      : typeof video.publishedAt === "string"
      ? video.publishedAt
      : null;
  return {
    id: video.id,
    title: video.title || "",
    channelId: video.channelId || "",
    channelTitle: video.channelTitle || "",
    thumbnail: overrides.thumbnail ?? pickThumbnail(video.thumbnails),
    publishedAt: published,
    duration: video.duration || null,
    addedAt: Date.now(),
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
        result.push(
          toQueueEntry(data, { thumbnail: pickThumbnail(data.thumbnails) })
        );
      }
    });
  }
  return result;
}

export async function collectSubscriptionEntries(startDate, progress) {
  const videos = await collectVideos(startDate, (event) => {
    if (typeof progress === "function") {
      progress(event);
    }
  });
  const entries = videos.map((video) => toQueueEntry(video));
  let latestPublishedAt = null;
  if (videos.length) {
    const raw = videos[videos.length - 1].publishedAt;
    const dt = raw instanceof Date ? raw : new Date(raw);
    if (!Number.isNaN(dt.getTime())) {
      latestPublishedAt = dt;
    }
  }
  return {
    entries,
    latestPublishedAt,
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
