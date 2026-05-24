// YouTube playlist API helpers. Contains playlist item reads, playlist creation, membership checks, and batched item insertion.
import { logMessage } from "../utils.js";
import { callApi } from "./transport.js";

export async function getPlaylistVideoIds(playlistId, { limit } = {}) {
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

// Adds a local list to a YouTube playlist in batches, reporting progress and retrying transient insert failures.
export async function addListToWL(playlistId, list, options = {}) {
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

  // Inserts one batch and retries the same batch after transient API failures.
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

export async function createPlayList(title) {
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

export async function listChannelPlaylists(channelId, nextPage) {
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

export async function isVideoInPlaylist(videoId, playlistId) {
  const data = await callApi("playlistItems", {
    part: "id",
    maxResults: 25,
    playlistId,
    videoId,
  });
  return Array.isArray(data.items) && data.items.length > 0;
}
