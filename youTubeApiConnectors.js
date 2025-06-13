// Utility for calling YouTube Data API via fetch
async function callApi(path, params = {}, method = "GET", body = null) {
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
    vId: el.id.videoId,
    pubDate: new Date(el.snippet.publishedAt),
    videoInfo: el,
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
function logIssue(vId, count, message, isError = false) {
  const msg = `Video id: ${vId} :: Count: ${count}\n${message}`;
  (isError ? console.error : console.warn)(msg);
    if (storeDateFunction && list.length > 0) {
      storeDateFunction(list[list.length - 1].pubDate);
    }
  if (count === list.length) {
      await storeDateFunction(list[list.length - 1].pubDate);

    console.log(`OK: ${targetVideo.vId}, count ${count + 1}/${list.length}`);
    if (storeDateFunction) {
      // Save progress but do not wait
      storeDateFunction(targetVideo.pubDate);
    }
    if (reason === 'videoAlreadyInPlaylist') {
      logIssue(targetVideo.vId, count, 'Already in playlist');
      if (storeDateFunction) storeDateFunction(targetVideo.pubDate);
      return addListToWL(storeDateFunction, playlistId, list, count + 1);
    }

    if (reason === 'backendError' || reason === 'serviceUnavailable' || err.status === 503) {
      logIssue(targetVideo.vId, count, 'Service unavailable, retrying in 1 min');
      await new Promise(r => setTimeout(r, 60 * 1000));
      return addListToWL(storeDateFunction, playlistId, list, count);
    }

    if (reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded' || err.status === 429) {
      logIssue(targetVideo.vId, count, 'Temporary quota exhausted, waiting 8 min');
      await new Promise(r => setTimeout(r, 8 * 60 * 1000 + 500));
      return addListToWL(storeDateFunction, playlistId, list, count);

    if (reason === 'quotaExceeded') {
      logIssue(targetVideo.vId, count, 'Quota exceeded', true);
      if (storeDateFunction && count > 0) {
        await storeDateFunction(list[count - 1].pubDate);
      }
      return count;
    }

    logIssue(targetVideo.vId, count, err.error?.message || err.message, true);
    if (storeDateFunction && count > 0) {
      await storeDateFunction(list[count - 1].pubDate);
    }
    return count;
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

function errorMessage(vId, count, message) {
  console.log(`Video id: ${vId} :: Count: ${count}\n${message}`);
}

async function addListToWL(storeDateFunction, playlistId, list, count = 0) {
  if (count == list.length) {
    console.log("OK, added: " + count);
    return count;
  }
  const targetVideo = list[count];
  try {
    await addVideoToWL(targetVideo.vId, playlistId);
    if (storeDateFunction) {
      await storeDateFunction(targetVideo.pubDate);
    }
    console.log(`OK: ${targetVideo.vId}, count ${count}/${list.length}`);
    return addListToWL(storeDateFunction, playlistId, list, count + 1);
  } catch (err) {
    const reason = err.error?.errors?.[0]?.reason || "";
    switch (reason) {
      case "videoAlreadyInPlaylist":
        console.warn(`Already in playlist: ${targetVideo.vId}`);
        return addListToWL(storeDateFunction, playlistId, list, count + 1);
      case "backendError":
      case "serviceUnavailable":
        console.warn("Service unavailable, retrying in 1 min");
        await new Promise((r) => setTimeout(r, 60 * 1000));
        return addListToWL(storeDateFunction, playlistId, list, count);
      case "rateLimitExceeded":
      case "userRateLimitExceeded":
        console.warn("Rate limit exceeded, waiting 8 min");
        await new Promise((r) => setTimeout(r, 8 * 60 * 1000 + 500));
        return addListToWL(storeDateFunction, playlistId, list, count);
      case "quotaExceeded":
        console.error("Quota exceeded");
        return count;
      default:
        if (err.status === 503) {
          console.warn("Service unavailable, retrying in 1 min");
          await new Promise((r) => setTimeout(r, 60 * 1000));
          return addListToWL(storeDateFunction, playlistId, list, count);
        }
        if (err.status === 429) {
          console.warn("Temporary quota exhausted, waiting 8 min");
          await new Promise((r) => setTimeout(r, 8 * 60 * 1000 + 500));
          return addListToWL(storeDateFunction, playlistId, list, count);
        }
        errorMessage(targetVideo.vId, count, err.error?.message || err.message);
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

async function addVideoToWL(vId, playlistId) {
  return callApi("playlistItems", { part: "snippet" }, "POST", {
    snippet: {
      playlistId,
      resourceId: { kind: "youtube#video", videoId: vId },
    },
  });
}

async function isShort(video) {
  const videoId = video.id || video.vId;
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
  const info = data.items.map((el) => ({
    vId: el.id,
    pubDate: el.snippet.publishedAt,
    id: el.id,
    ...el.snippet,
    ...el.contentDetails,
    liveStreamingDetails: el.liveStreamingDetails,
  }));
  if (data.nextPageToken) {
    const rest = await getVideoInfo(idList, data.nextPageToken);
    return info.concat(rest);
  }
  return info;
}

if (typeof module !== "undefined") {
  module.exports = {
    getNewVideos,
    __setCallApi: (fn) => (callApi = fn),
  };
}
