import {
  getChannelMap,
  getNewVideos,
  addListToWL,
  createPlayList,
} from "./youTubeApiConnectors.js";
import { logMessage, storeDate, parseDuration, formatDate } from "./utils.js";
import { filterVideos } from "./filter.js";
import { DEV_MODE } from "../config.js";

export function process() {
  if (DEV_MODE) {
    return main(new Date(Date.now() - 24 * 60 * 60 * 1000));
  }
  return new Promise((resolve) => {
    chrome.storage.sync.get(["lastVideoDate"], (result) => {
      const mainDate = new Date(result.lastVideoDate);
      console.log("startDate", mainDate);
      resolve(main(mainDate));
    });
  });
}

export async function collectVideos(
  startDate = new Date(Date.now() - 604800000),
  progress = () => {}
) {
  const channels = await getChannelMap();
  const uploads = Object.values(channels)
    .map((c) => c.uploads)
    .filter(Boolean);
  console.log("Subscriptions count:", Object.keys(channels).length);
  console.log("Loading videos from", uploads.length, "playlists");
  progress({
    phase: "channelsLoaded",
    channelCount: Object.keys(channels).length,
    playlistCount: uploads.length,
  });

  const results = new Array(uploads.length);
  const concurrency = Math.min(uploads.length, 6) || 1;
  let cursor = 0;
  const workers = Array.from({ length: concurrency }, () =>
    (async () => {
      while (cursor < uploads.length) {
        const current = cursor++;
        const pl = uploads[current];
        progress({
          phase: "playlistFetch",
          index: current + 1,
          total: uploads.length,
          playlistId: pl,
        });
        const r = await getNewVideos(pl, startDate);
        results[current] = {
          playlist: pl,
          videos: r.videos,
          pages: r.pages,
        };
        progress({
          phase: "playlistFetched",
          index: current + 1,
          total: uploads.length,
          playlistId: pl,
          videoCount: r.videos.length,
        });
      }
    })()
  );
  await Promise.all(workers);

  const videoMap = new Map();
  for (const r of results) {
    for (const v of r.videos) {
      if (!videoMap.has(v.id)) {
        videoMap.set(v.id, v);
      }
    }
  }
  let videos = Array.from(videoMap.values());
  console.log("Fetched", videos.length, "videos");
  progress({ phase: "aggregate", videoCount: videos.length });
  progress({ phase: "filtering", videoCount: videos.length });
  videos = await filterVideos(videos);
  progress({ phase: "filtered", videoCount: videos.length });
  videos.sort((a, b) => a.publishedAt - b.publishedAt);
  return videos;
}

export async function main(startDate = new Date(Date.now() - 604800000)) {
  const videos = await collectVideos(startDate);
  console.log(
    videos
      .map((v) =>
        [
          formatDate(v.publishedAt),
          (v.channelTitle || "").padEnd(15).slice(0, 15),
          (v.title || "").padEnd(50).slice(0, 50),
          `https://youtu.be/${v.id}`,
          parseDuration(v.duration),
        ].join(" ")
      )
      .join("\n")
  );
  return createListAndAddVideos(videos);
}

export function createListAndAddVideos(list) {
  console.log("To playlist", list);
  if (!list || list.length === 0) {
    console.warn("No videos to add");
    return Promise.resolve(0);
  }
  const title = `WL ${formatDate(list[0].publishedAt)} - ${formatDate(
    list[list.length - 1].publishedAt
  )}`;
  return createPlayList(title)
    .then((plst) => {
      const playlistId = plst.id;
      console.log(
        `Created playlist https://www.youtube.com/playlist?list=${playlistId}`
      );
      return addListToWL(storeDate, playlistId, list).then((count) => {
        storeDate((list[count - 1] || list[list.length - 1]).publishedAt);
        console.log(`https://www.youtube.com/playlist?list=${playlistId}`);
        return count;
      });
    })
    .catch((err) => {
      const reason =
        err.error?.error?.errors?.[0]?.reason ||
        err.error?.errors?.[0]?.reason ||
        (err.status === 429 ? "rateLimitExceeded" : "");
      switch (reason) {
        case "rateLimitExceeded":
          logMessage(
            "warn",
            "createPlaylist",
            list.length,
            "Rate limit exceeded, retry in 8 min"
          );
          return new Promise((r) => setTimeout(r, 8 * 60 * 1000 + 500)).then(
            () => createListAndAddVideos(list)
          );
        case "quotaExceeded":
          logMessage("error", "createPlaylist", list.length, "Quota exceeded");
          return 0;
        default:
          logMessage(
            "error",
            "createPlaylist",
            list.length,
            err.error?.error?.message || err.error?.message || err.message
          );
          return 0;
      }
    });
}
