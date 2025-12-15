import { getChannelMap, getNewVideos } from "./youTubeApiConnectors.js";
import { parseDuration, formatStorageTimestamp } from "./time.js";
import { filterVideos } from "./filter.js";

export async function collectVideos(
  startDate = new Date(Date.now() - 604800000),
  progress = () => {}
) {
  const channels = await getChannelMap();
  const sources = Object.entries(channels)
    .map(([channelId, info]) => ({
      channelId,
      channelTitle: info?.title || "",
      playlistId: info?.uploads,
    }))
    .filter((entry) => Boolean(entry.playlistId));
  console.log("Subscriptions count:", Object.keys(channels).length);
  console.log("Loading videos from", sources.length, "playlists");
  progress({
    phase: "channelsLoaded",
    channelCount: Object.keys(channels).length,
    playlistCount: sources.length,
  });

  const results = new Array(sources.length);
  const concurrency = Math.min(sources.length, 6) || 1;
  let cursor = 0;
  const workers = Array.from({ length: concurrency }, () =>
    (async () => {
      while (cursor < sources.length) {
        const current = cursor++;
        const { playlistId: pl, channelId, channelTitle } = sources[current];
        progress({
          phase: "playlistFetch",
          index: current + 1,
          total: sources.length,
          playlistId: pl,
          channelId,
          channelTitle,
        });
        const r = await getNewVideos(pl, startDate);
        results[current] = {
          playlist: pl,
          videos: r.videos,
          pages: r.pages,
          channelId,
          channelTitle,
        };
        progress({
          phase: "playlistFetched",
          index: current + 1,
          total: sources.length,
          playlistId: pl,
          channelId,
          channelTitle,
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
  videos = await filterVideos(videos, progress);
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
          formatStorageTimestamp(v.publishedAt),
          (v.channelTitle || "").padEnd(15).slice(0, 15),
          (v.title || "").padEnd(50).slice(0, 50),
          `https://youtu.be/${v.id}`,
          parseDuration(v.duration),
        ].join(" ")
      )
      .join("\n")
  );
  return videos;
}
