import { getToken, signInUser, clearToken } from "./auth.js";
import { logMessage, parseDuration } from "./utils.js";

let channelCache;

async function loadChannelCache() {
  if (channelCache) return channelCache;
  const data = await new Promise((r) => chrome.storage.local.get(["channelCache"], r));
  channelCache = data.channelCache || {};
  return channelCache;
}

// Utility for calling YouTube Data API via fetch
async function callApi(path, params = {}, method = "GET", body = null, retry) {
  const token = await getToken();
  const url = new URL("https://www.googleapis.com/youtube/v3/" + path);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null) url.searchParams.set(k, v);
  });
  const init = {
    method,
    headers: { Authorization: "Bearer " + token, Accept: "application/json" },
  };
  if (body) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const resp = await fetch(url.toString(), init);
  if (!resp.ok) {
    if ((resp.status === 401 || resp.status === 403) && !retry) {
      clearToken();
      try {
        await signInUser();
      } catch (e) {
        const text = await resp.text();
        const err = new Error("API " + path + " failed: " + resp.status);
        err.status = resp.status;
        err.body = text;
        err.error = e;
        throw err;
      }
      return callApi(path, params, method, body, true);
    }
    const text = await resp.text();
    const err = new Error("API " + path + " failed: " + resp.status);
    err.status = resp.status;
    err.body = text;
    try {
      err.error = JSON.parse(text);
    } catch (_) {
      err.error = text;
    }
    throw err;
  }
  return resp.json();
}

// return promise with auth user subscriptions list of dicts {title, id, videos}
async function getSubscriptionsId(pageToken) {
  const data = await callApi("subscriptions", {
    part: "snippet,contentDetails",
    maxResults: 50,
    mine: true,
    pageToken,
  });
  const subs = data.items.map((el) => ({
    title: el.snippet.title,
    id: el.snippet.resourceId.channelId,
    videos: el.contentDetails.totalItemCount,
  }));
  if (data.nextPageToken) {
    const next = await getSubscriptionsId(data.nextPageToken);
    return subs.concat(next);
  }
  return subs;
}

// return promise with uploads list id by userid
async function getUploadsLists(userids) {
  const data = await callApi("channels", {
    part: "contentDetails",
    id: userids.join(","),
    maxResults: 50,
  });
  return data.items.map((el) => el.contentDetails.relatedPlaylists.uploads);
}

async function getChannelMap() {
  const cache = await loadChannelCache();
  const subs = await getSubscriptionsId();
  const missing = [];
  for (const { id, title } of subs) {
    if (!cache[id]) cache[id] = {};
    cache[id].title = title;
    if (!cache[id].uploads) missing.push(id);
  }
  let ids = missing.slice();
  while (ids.length) {
    const chunk = ids.splice(0, 50);
    const uploads = await getUploadsLists(chunk);
    for (let i = 0; i < chunk.length; i++) {
      const ch = chunk[i];
      cache[ch] = cache[ch] || {};
      cache[ch].uploads = uploads[i];
    }
  }
  chrome.storage.local.set({ channelCache: cache });
  return cache;
}

async function getRecentVideosBySearch(
  channelId,
  startDate,
  nextPage,
  origin = channelId,
  pages = 1
) {
  const data = await callApi("search", {
    part: "snippet",
    channelId,
    type: "video",
    order: "date",
    maxResults: 50,
    pageToken: nextPage,
    publishedAfter: startDate.toISOString(),
  });
  const vids = data.items.map((el) => ({
    id: el.id.videoId,
    publishedAt: new Date(el.snippet.publishedAt),
    title: el.snippet.title,
    channelId: el.snippet.channelId,
    channelTitle: el.snippet.channelTitle,
    tags: el.snippet.tags,
    playlist: origin,
  }));
  if (data.nextPageToken) {
    const rest = await getRecentVideosBySearch(
      channelId,
      startDate,
      data.nextPageToken,
      origin,
      pages + 1
    );
    return { videos: vids.concat(rest.videos), pages: rest.pages };
  }
  return { videos: vids, pages };
}

async function getNewVideos(
  playlist,
  startDate = new Date(Date.now() - 604800000)
) {
  const videos = [];
  let nextPage;
  let pages = 0;
  while (true) {
    let data;
    try {
      data = await callApi("playlistItems", {
        part: "contentDetails",
        maxResults: 50,
        playlistId: playlist,
        pageToken: nextPage,
      });
    } catch (err) {
      const reason = err.error?.error?.errors?.[0]?.reason;
      if (err.status === 404 && reason === "playlistNotFound") {
        console.warn(
          "Uploads playlist not found",
          playlist,
          "falling back to search"
        );
        const channelId = playlist.startsWith("UU")
          ? "UC" + playlist.slice(2)
          : playlist;
        return getRecentVideosBySearch(
          channelId,
          startDate,
          undefined,
          playlist
        );
      }
      throw err;
    }
    pages++;
    const items = data.items.map((el) => ({
      id: el.contentDetails.videoId,
      publishedAt: new Date(el.contentDetails.videoPublishedAt),
      playlist,
    }));
    for (const it of items) {
      if (it.publishedAt > startDate) videos.push(it);
    }
    const last = data.items[data.items.length - 1];
    const lastDate = last
      ? new Date(last.contentDetails.videoPublishedAt)
      : null;
    if (!data.nextPageToken || (lastDate && lastDate <= startDate)) break;
    nextPage = data.nextPageToken;
  }
  if (videos.length > 0 || pages > 1) {
    const msg = [`Playlist ${playlist}`];
    if (pages > 1) msg.push(`${pages} pages`);
    msg.push("new videos", videos.length);
    console.log(msg.join(" "));
  }
  return { videos, pages };
}

async function addListToWL(storeDateFunction, playlistId, list, count = 0) {
  if (count == list.length) {
    console.log("OK, added: " + count);
    return count;
  }
  const targetVideo = list[count];
  try {
    await addVideoToWL(targetVideo.id, playlistId);
    console.log(`OK: ${targetVideo.id}, count ${count}/${list.length}`);
    return addListToWL(storeDateFunction, playlistId, list, count + 1);
  } catch (err) {
    const reason = err.error?.errors?.[0]?.reason || "";
    const status = err.status;
    switch (reason) {
      case "videoAlreadyInPlaylist":
        logMessage("warn", targetVideo.id, count, err.error.message);
        return addListToWL(storeDateFunction, playlistId, list, count + 1);
      case "backendError":
      case "internalError":
        logMessage(
          "warn",
          targetVideo.id,
          count,
          "Backend error, retry in 1 min"
        );
        await new Promise((r) => setTimeout(r, 60 * 1000));
        return addListToWL(storeDateFunction, playlistId, list, count);
      case "rateLimitExceeded":
        logMessage(
          "warn",
          targetVideo.id,
          count,
          "Rate limit exceeded, 8 min pause"
        );
        await new Promise((r) => setTimeout(r, 8 * 60 * 1000 + 500));
        return addListToWL(storeDateFunction, playlistId, list, count);
      case "quotaExceeded":
        logMessage("error", targetVideo.id, count, "Quota exceeded");
        return count;
      case "SERVICE_UNAVAILABLE":
        logMessage(
          "warn",
          targetVideo.id,
          count,
          "Service unavailable, retry in 1 min"
        );
        await new Promise((r) => setTimeout(r, 60 * 1000));
        return addListToWL(storeDateFunction, playlistId, list, count);
      default:
        if (status >= 500) {
          logMessage(
            "warn",
            targetVideo.id,
            count,
            "Server error, retry in 1 min"
          );
          await new Promise((r) => setTimeout(r, 60 * 1000));
          return addListToWL(storeDateFunction, playlistId, list, count);
        }
        logMessage(
          "error",
          targetVideo.id,
          count,
          err.error?.message || err.message
        );
        return count;
    }
  }
}

async function createPlayList(title) {
  return callApi("playlists", { part: "snippet,status" }, "POST", {
    snippet: { title },
    status: { privacyStatus: "unlisted" },
  });
}

async function addVideoToWL(videoId, playlistId) {
  return callApi("playlistItems", { part: "snippet" }, "POST", {
    snippet: {
      playlistId,
      resourceId: { kind: "youtube#video", videoId },
    },
  });
}

async function isShort(video) {
  const videoId = video.id;
  if (video.duration && parseDuration(video.duration) < 60) return true;
  if (video.tags && video.tags.some((t) => /shorts?/i.test(t))) return true;
  if (video.title && video.title.toLowerCase().includes("#short")) return true;
  try {
    const res = await fetch(`https://www.youtube.com/shorts/${videoId}`, {
      method: "HEAD",
      redirect: "manual",
    });
    return res.status === 200;
  } catch (err) {
    console.error("Failed to detect Short for", videoId, err);
    return false;
  }
}

async function getVideoInfo(idList, nextPage) {
  const data = await callApi("videos", {
    part: "snippet,contentDetails,liveStreamingDetails",
    maxResults: 50,
    id: idList.join(","),
    pageToken: nextPage,
  });
  const info = data.items.map((el) => {
    return {
      id: el.id,
      publishedAt: new Date(el.snippet.publishedAt),
      ...el.snippet,
      ...el.contentDetails,
      liveStreamingDetails: el.liveStreamingDetails,
    };
  });
  if (data.nextPageToken) {
    const rest = await getVideoInfo(idList, data.nextPageToken);
    return info.concat(rest);
  }
  return info;
}

export function __setCallApi(fn) {
  callApi = fn;
}

export {
  getSubscriptionsId,
  getUploadsLists,
  getRecentVideosBySearch,
  getNewVideos,
  addListToWL,
  createPlayList,
  addVideoToWL,
  isShort,
  getVideoInfo,
  getChannelMap,
};
