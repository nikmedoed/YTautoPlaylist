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

export async function main(startDate = new Date(Date.now() - 604800000)) {
  const channels = await getChannelMap();
  const uploads = Object.values(channels)
    .map((c) => c.uploads)
    .filter(Boolean);
  console.log("Subscriptions count:", Object.keys(channels).length);
  console.log("Loading videos from", uploads.length, "playlists");
  const results = await Promise.all(
    uploads.map((pl) =>
      getNewVideos(pl, startDate).then((r) => ({
        playlist: pl,
        videos: r.videos,
        pages: r.pages,
      }))
    )
  );

  const allVideos = [];
  const playlistMap = {};
  const stats = {};
  for (const r of results) {
    if (r.videos.length === 0) continue;
    stats[r.playlist] = {
      new: r.videos.length,
      filtered: 0,
      add: 0,
    };
    for (const v of r.videos) {
      playlistMap[v.id] = r.playlist;
      allVideos.push(v);
    }
  }
  console.log("Fetched", allVideos.length, "videos");

  const deduped = [];
  const seenAll = new Set();
  for (const v of allVideos) {
    if (!seenAll.has(v.id)) {
      seenAll.add(v.id);
      deduped.push(v);
    }
  }

  const videos = await filterVideos(deduped);

  const survived = new Set(videos.map((v) => v.id));
  for (const v of deduped) {
    const pl = playlistMap[v.id];
    if (!stats[pl]) continue;
    if (survived.has(v.id)) {
      stats[pl].add++;
    } else {
      stats[pl].filtered++;
    }
  }
  for (const v of videos) {
    v.playlist = playlistMap[v.id];
  }
  for (const [pl, st] of Object.entries(stats)) {
    if (st.new || st.filtered || st.add) {
      console.log(
        `Playlist ${pl} new ${st.new}, filtered ${st.filtered}, to playlist ${st.add}`
      );
    }
  }
  console.log("After filtering:", videos.length, "videos");

  const sorted = videos.sort((a, b) => a.publishedAt - b.publishedAt);

  console.log("New Videos:", sorted);
  console.log(
    sorted
      .map((e) =>
        [
          parseDuration(e.duration),
          formatDate(e.publishedAt),
          e.channelTitle,
          e.title,
          e.id,
        ].join("\t")
      )
      .join("\n")
  );

  return createListAndAddVideos(sorted);
}

export function createListAndAddVideos(list) {
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
      const reason = err.error?.errors?.[0]?.reason || "";
      switch (reason) {
        case "rateLimitExceeded":
          logMessage(
            "warn",
            "create",
            list.length,
            "Rate limit exceeded, retry in 8 min"
          );
          return new Promise((r) => setTimeout(r, 8 * 60 * 1000 + 500)).then(
            () => createListAndAddVideos(list)
          );
        case "quotaExceeded":
          logMessage("error", "create", list.length, "Quota exceeded");
          return 0;
        default:
          logMessage(
            "error",
            "create",
            list.length,
            err.error?.message || err.message
          );
          return 0;
      }
    });
}
