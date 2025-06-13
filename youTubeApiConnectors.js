// Utility for calling YouTube Data API via fetch
async function callApi(path, params = {}, method = 'GET', body = null) {
  const token = await getToken();
  const url = new URL('https://www.googleapis.com/youtube/v3/' + path);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null) url.searchParams.set(k, v);
  });
  const init = {
    method,
    headers: { 'Authorization': 'Bearer ' + token, 'Accept': 'application/json' }
  };
  if (body) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const resp = await fetch(url.toString(), init);
  if (!resp.ok) {
    const text = await resp.text();
    const err = new Error('API ' + path + ' failed: ' + resp.status);
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
  const data = await callApi('subscriptions', {
    part: 'snippet,contentDetails',
    maxResults: 50,
    mine: true,
    pageToken
  });
  const subs = data.items.map(el => ({
    title: el.snippet.title,
    id: el.snippet.resourceId.channelId,
    videos: el.contentDetails.totalItemCount
  }));
  if (data.nextPageToken) {
    const next = await getSubscriptionsId(data.nextPageToken);
    return subs.concat(next);
  }
  return subs;
}

// return promise with uploads list id by userid
async function getUploadsLists(userids) {
  const data = await callApi('channels', {
    part: 'contentDetails',
    id: userids.join(','),
    maxResults: 50
  });
  return data.items.map(el => el.contentDetails.relatedPlaylists.uploads);
}

async function getRecentVideosBySearch(channelId, startDate, nextPage) {
  const data = await callApi('search', {
    part: 'snippet',
    channelId,
    type: 'video',
    order: 'date',
    maxResults: 50,
    pageToken: nextPage,
    publishedAfter: startDate.toISOString()
  });
  const vids = data.items.map(el => ({
    vId: el.id.videoId,
    pubDate: new Date(el.snippet.publishedAt),
    videoInfo: el
  }));
  if (data.nextPageToken) {
    const rest = await getRecentVideosBySearch(channelId, startDate, data.nextPageToken);
    return vids.concat(rest);
  }
  return vids;
}

async function getNewVideos(playlist, startDate = new Date(Date.now() - 604800000), nextPage) {
  let data;
  try {
    data = await callApi('playlistItems', {
      part: 'contentDetails',
      maxResults: 50,
      playlistId: playlist,
      pageToken: nextPage
    });
  } catch (err) {
    const reason = err.error?.error?.errors?.[0]?.reason;
    if (err.status === 404 && reason === 'playlistNotFound') {
      console.warn('Uploads playlist not found', playlist, 'falling back to search');
      const channelId = playlist.startsWith('UU') ? 'UC' + playlist.slice(2) : playlist;
      return getRecentVideosBySearch(channelId, startDate);
    }
    throw err;
  }
  const newVid = data.items
    .map(el => ({ vId: el.contentDetails.videoId, pubDate: new Date(el.contentDetails.videoPublishedAt), videoInfo: el }))
    .filter(item => item.pubDate > startDate);
  if (data.nextPageToken) {
    const rest = await getNewVideos(playlist, startDate, data.nextPageToken);
    return newVid.concat(rest);
  }
  return newVid;
}

function errorMessage(vId, count, message) {
  console.log(`Video id: ${vId} :: Count: ${count}\n${message}`);
}

async function addListToWL(storeDateFunction, playlistId, list, count = 0) {
  if (count == list.length) {
    console.log('OK, added: ' + count);
    return count;
  }
  const targetVideo = list[count];
  try {
    await addVideoToWL(targetVideo.vId, playlistId);
    console.log(`OK: ${targetVideo.vId}, count ${count}/${list.length}`);
    return addListToWL(storeDateFunction, playlistId, list, count + 1);
  } catch (err) {
    const reason = err.error?.errors?.[0]?.reason || '';
    switch (reason) {
      case 'videoAlreadyInPlaylist':
        errorMessage(targetVideo.vId, count, err.error.message);
        return addListToWL(storeDateFunction, playlistId, list, count + 1);
      case 'backendError':
        errorMessage(targetVideo.vId, count, 'Backend Error');
        return addListToWL(storeDateFunction, playlistId, list, count);
      case 'rateLimitExceeded':
        errorMessage(targetVideo.vId, count, 'Rate Limit Exceeded, 8 min pause');
        await new Promise(r => setTimeout(r, 8 * 60 * 1000 + 500));
        return addListToWL(storeDateFunction, playlistId, list, count);
      case 'quotaExceeded':
        errorMessage(targetVideo.vId, count, 'Quota exceeded');
        return count;
      default:
        errorMessage(targetVideo.vId, count, err.error?.message || err.message);
        return count;
    }
  }
}

async function createPlayList(title) {
  return callApi('playlists', { part: 'snippet,status' }, 'POST', {
    snippet: { title },
    status: { privacyStatus: 'unlisted' }
  });
}

async function addVideoToWL(vId, playlistId) {
  return callApi('playlistItems', { part: 'snippet' }, 'POST', {
    snippet: {
      playlistId,
      resourceId: { kind: 'youtube#video', videoId: vId }
    }
  });
}

async function isShort(video) {
  const videoId = video.id || video.vId;
  try {
    const res = await fetch(`https://www.youtube.com/shorts/${videoId}`, { method: 'HEAD', redirect: 'manual' });
    return res.status === 200;
  } catch (err) {
    console.error('Failed to detect Short for', videoId, err);
    return false;
  }
}

async function getVideoInfo(idList, nextPage) {
  const data = await callApi('videos', {
    part: 'snippet,contentDetails,liveStreamingDetails',
    maxResults: 50,
    id: idList.join(','),
    pageToken: nextPage
  });
  const info = data.items.map(el => ({
    vId: el.id,
    pubDate: el.snippet.publishedAt,
    id: el.id,
    ...el.snippet,
    ...el.contentDetails,
    liveStreamingDetails: el.liveStreamingDetails
  }));
  if (data.nextPageToken) {
    const rest = await getVideoInfo(idList, data.nextPageToken);
    return info.concat(rest);
  }
  return info;
}

if (typeof module !== 'undefined') {
  module.exports = {
    getNewVideos,
    __setCallApi: fn => callApi = fn
  };
}

