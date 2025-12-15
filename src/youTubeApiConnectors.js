import { getToken, signInUser, clearToken } from "./auth.js";
import { logMessage } from "./utils.js";
import { parseDuration } from "./time.js";

let channelCache;

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

async function getChannelInfos(ids) {
  if (!ids || ids.length === 0) return [];
  const data = await callApi("channels", {
    part: "snippet,contentDetails",
    id: ids.join(","),
    maxResults: 50,
  });
  const items = Array.isArray(data?.items) ? data.items : [];
  return items.map((el) => ({
    id: el.id,
    title: el.snippet.title,
    uploads: el.contentDetails.relatedPlaylists.uploads,
  }));
}

async function getChannelMap(extraIds = []) {
  if (!channelCache) {
    const data = await new Promise((r) =>
      chrome.storage.local.get(["channelCache"], r)
    );
    channelCache = data.channelCache || {};
  }
  const cache = channelCache;
  const subs = await getSubscriptionsId();
  const missing = [];
  for (const { id, title } of subs) {
    if (!cache[id]) cache[id] = {};
    cache[id].title = title;
    if (!cache[id].uploads) missing.push(id);
  }
  extraIds.forEach((id) => {
    if (!cache[id] || !cache[id].uploads) missing.push(id);
  });
  let ids = missing.slice();
  while (ids.length) {
    const chunk = ids.splice(0, 50);
    const infos = await getChannelInfos(chunk);
    for (const info of infos) {
      cache[info.id] = cache[info.id] || {};
      cache[info.id].title = cache[info.id].title || info.title;
      cache[info.id].uploads = info.uploads;
    }
  }
  channelCache = cache;
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

async function getPlaylistVideoIds(playlistId, { limit } = {}) {
  const max =
    typeof limit === "number" && Number.isInteger(limit) && limit > 0
      ? limit
      : Infinity;
  const collected = [];
  const seen = new Set();
  let pageToken;
  let hasMore = false;
  do {
    const data = await callApi("playlistItems", {
      part: "contentDetails,snippet",
      maxResults: 50,
      playlistId,
      pageToken,
    });
    const items = Array.isArray(data?.items) ? data.items : [];
    for (const item of items) {
      const videoId =
        item?.contentDetails?.videoId || item?.snippet?.resourceId?.videoId;
      if (!videoId || seen.has(videoId)) {
        continue;
      }
      seen.add(videoId);
      collected.push(videoId);
      if (collected.length >= max) {
        hasMore = Boolean(data?.nextPageToken);
        break;
      }
    }
    if (collected.length >= max) {
      break;
    }
    pageToken = data?.nextPageToken;
    hasMore = Boolean(pageToken);
  } while (pageToken);
  return { ids: collected, total: collected.length, hasMore };
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

async function addListToWL(playlistId, list, options = {}) {
  const total = Array.isArray(list) ? list.length : 0;
  const notifyProgress = (payload) => {
    if (typeof options.onProgress !== "function") return;
    try {
      options.onProgress({
        total,
        ...payload,
      });
    } catch (err) {
      console.warn("addListToWL progress listener failed", err);
    }
  };
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function step(count) {
    if (count === total) {
      console.log("OK, added: " + count);
      notifyProgress({ added: count, status: "complete" });
      return count;
    }
    const targetVideo = list[count];
    if (!targetVideo) {
      notifyProgress({ added: count, status: "complete" });
      return count;
    }
    try {
      await addVideoToWL(targetVideo.id, playlistId);
      console.log(`OK: ${targetVideo.id}, count ${count}/${list.length}`);
      const next = count + 1;
      notifyProgress({ added: next, status: "added", videoId: targetVideo.id });
      return step(next);
    } catch (err) {
      const reason = err.error?.errors?.[0]?.reason || "";
      const status = err.status;
      switch (reason) {
        case "videoAlreadyInPlaylist": {
          logMessage("warn", targetVideo.id, count, err.error.message);
          const next = count + 1;
          notifyProgress({
            added: next,
            status: "skipped",
            videoId: targetVideo.id,
          });
          return step(next);
        }
        case "backendError":
        case "internalError": {
          logMessage(
            "warn",
            targetVideo.id,
            count,
            "Backend error, retry in 1 min"
          );
          notifyProgress({
            added: count,
            status: "retry",
            videoId: targetVideo.id,
            reason,
            delayMs: 60 * 1000,
          });
          await wait(60 * 1000);
          return step(count);
        }
        case "rateLimitExceeded": {
          logMessage(
            "warn",
            targetVideo.id,
            count,
            "Rate limit exceeded, 8 min pause"
          );
          notifyProgress({
            added: count,
            status: "retry",
            videoId: targetVideo.id,
            reason,
            delayMs: 8 * 60 * 1000 + 500,
          });
          await wait(8 * 60 * 1000 + 500);
          return step(count);
        }
        case "quotaExceeded": {
          logMessage("error", targetVideo.id, count, "Quota exceeded");
          notifyProgress({
            added: count,
            status: "quotaExceeded",
            videoId: targetVideo.id,
            reason,
          });
          return count;
        }
        case "SERVICE_UNAVAILABLE": {
          logMessage(
            "warn",
            targetVideo.id,
            count,
            "Service unavailable, retry in 1 min"
          );
          notifyProgress({
            added: count,
            status: "retry",
            videoId: targetVideo.id,
            reason,
            delayMs: 60 * 1000,
          });
          await wait(60 * 1000);
          return step(count);
        }
        default: {
          if (status >= 500) {
            logMessage(
              "warn",
              targetVideo.id,
              count,
              "Server error, retry in 1 min"
            );
            notifyProgress({
              added: count,
              status: "retry",
              videoId: targetVideo.id,
              reason: "serverError",
              delayMs: 60 * 1000,
            });
            await wait(60 * 1000);
            return step(count);
          }
          logMessage(
            "error",
            targetVideo.id,
            count,
            err.error?.message || err.message
          );
          notifyProgress({
            added: count,
            status: "error",
            videoId: targetVideo.id,
            reason,
          });
          return count;
        }
      }
    }
  }

  return step(0);
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
      ...el.snippet,
      ...el.contentDetails,
      liveStreamingDetails: el.liveStreamingDetails,
      publishedAt: new Date(el.snippet.publishedAt)
    };
  });
  if (data.nextPageToken) {
    const rest = await getVideoInfo(idList, data.nextPageToken);
    return info.concat(rest);
  }
  return info;
}

async function listChannelPlaylists(channelId, nextPage) {
  const data = await callApi("playlists", {
    part: "id,snippet",
    channelId,
    maxResults: 50,
    pageToken: nextPage,
  });
  const items = data.items.map((it) => ({ id: it.id, title: it.snippet.title }));
  if (data.nextPageToken) {
    const rest = await listChannelPlaylists(channelId, data.nextPageToken);
    return items.concat(rest);
  }
  return items;
}

async function isVideoInPlaylist(videoId, playlistId) {
  const data = await callApi("playlistItems", {
    part: "id",
    maxResults: 25,
    playlistId,
    videoId,
  });
  return Array.isArray(data.items) && data.items.length > 0;
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
  listChannelPlaylists,
  isVideoInPlaylist,
  getChannelMap,
  getPlaylistVideoIds,
};
