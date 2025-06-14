import {
  getSubscriptionsId,
  getUploadsLists,
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
  const subs = await getSubscriptionsId();
  console.log("Subscriptions count:", subs.length);
  console.log("Subscriptions list:", subs);

  const ids = subs.map((s) => s.id);
  const uploads = [];
  while (ids.length) {
    uploads.push(...(await getUploadsLists(ids.splice(-50))));
  }
  console.log("Subscriptions upload lists count:", uploads.length);
  console.log("Subscriptions getUploadsLists:", uploads);

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
      shorts: 0,
      add: 0,
    };
    for (const v of r.videos) {
      playlistMap[v.id] = r.playlist;
      allVideos.push(v);
    }
  }
  console.log("Fetched", allVideos.length, "videos");

  const { videos, shorts, filtered } = await filterVideos(allVideos);
  for (const id of filtered) {
    const pl = playlistMap[id];
    if (stats[pl]) stats[pl].filtered++;
  }
  for (const v of videos) {
    const pl = playlistMap[v.id];
    stats[pl].add++;
    v.playlist = pl;
  }
  for (const id of shorts) {
    const pl = playlistMap[id];
    if (stats[pl]) stats[pl].shorts++;
  }
  for (const [pl, st] of Object.entries(stats)) {
    if (st.new || st.filtered || st.shorts || st.add) {
      console.log(
        `Playlist ${pl} new ${st.new}, filtered ${st.filtered}, shorts ${st.shorts}, to playlist ${st.add}`
      );
    }
  }
  console.log("After filtering:", videos.length, "videos");

  const unique = [];
  const seen = new Set();
  for (const v of videos.sort(
    (a, b) => new Date(a.publishedAt) - new Date(b.publishedAt)
  )) {
    if (!seen.has(v.id)) {
      seen.add(v.id);
      unique.push(v);
    }
  }

  console.log("New Videos:", unique);
  console.log(
    unique
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

  return createListAndAddVideos(unique);
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
