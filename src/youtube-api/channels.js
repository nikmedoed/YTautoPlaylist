// YouTube channel API helpers. Contains subscription reads, upload playlist lookup, channel metadata cache, and fallback search support.
import { callApi } from "./transport.js";

let channelCache;

export async function getSubscriptionsId(pageToken) {
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

export async function getUploadsLists(userids) {
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

export async function getChannelMap(extraIds = []) {
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
