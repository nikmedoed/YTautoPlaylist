// YouTube channel API helpers. Contains subscription reads, upload playlist lookup, channel metadata cache, and fallback search support.
import { callApi } from "./transport.js";

const CHANNEL_CACHE_KEY = "channelCache";
const SUBSCRIPTION_CACHE_KEY = "channelSubscriptionCache";

let channelCache;
let subscriptionSnapshot;
let subscriptionRefreshPromise;

function chromeGet(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, (data) => resolve(data || {}));
  });
}

function chromeSet(payload) {
  return new Promise((resolve) => chrome.storage.local.set(payload, resolve));
}

function toSubscriptionSnapshot(subs) {
  const channels = {};
  for (const { id, title } of subs) {
    if (id) channels[id] = { title: title || "" };
  }
  return { updatedAt: Date.now(), channels };
}

function getExtraIds(extraIds) {
  return Array.isArray(extraIds)
    ? extraIds.filter((id) => typeof id === "string" && id)
    : [];
}

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

async function loadSubscriptionSnapshot() {
  if (subscriptionSnapshot) return subscriptionSnapshot;
  const data = await chromeGet([SUBSCRIPTION_CACHE_KEY]);
  subscriptionSnapshot = data[SUBSCRIPTION_CACHE_KEY] || {
    updatedAt: 0,
    channels: {},
  };
  return subscriptionSnapshot;
}

function refreshSubscriptionSnapshot() {
  if (!subscriptionRefreshPromise) {
    subscriptionRefreshPromise = getSubscriptionsId()
      .then(toSubscriptionSnapshot)
      .then(async (snapshot) => {
        subscriptionSnapshot = snapshot;
        await chromeSet({ [SUBSCRIPTION_CACHE_KEY]: snapshot });
        return snapshot;
      })
      .finally(() => {
        subscriptionRefreshPromise = null;
      });
  }
  return subscriptionRefreshPromise;
}

async function getSubscriptionSnapshot({ refresh = false } = {}) {
  const snapshot = await loadSubscriptionSnapshot();
  if (!snapshot.updatedAt) {
    return refreshSubscriptionSnapshot();
  }
  if (refresh) {
    refreshSubscriptionSnapshot().catch((err) => {
      console.warn("Failed to refresh subscription cache", err);
    });
  }
  return snapshot;
}

export async function getActiveSubscriptionChannelIds({ waitForRefresh = false } = {}) {
  if (waitForRefresh && subscriptionRefreshPromise) {
    await subscriptionRefreshPromise.catch((err) => {
      console.warn("Failed to wait for subscription refresh", err);
    });
  }
  const snapshot = await loadSubscriptionSnapshot();
  return snapshot.updatedAt ? new Set(Object.keys(snapshot.channels || {})) : null;
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

export async function getChannelMap(extraIds = [], options = {}) {
  if (!channelCache) {
    const data = await chromeGet([CHANNEL_CACHE_KEY]);
    channelCache = data[CHANNEL_CACHE_KEY] || {};
  }

  const snapshot = await getSubscriptionSnapshot({
    refresh: options?.refreshSubscriptionsInBackground === true,
  });
  const ids = new Set([
    ...Object.keys(snapshot.channels || {}),
    ...getExtraIds(extraIds),
  ]);
  const missing = [];

  for (const id of ids) {
    channelCache[id] = channelCache[id] || {};
    channelCache[id].title =
      snapshot.channels?.[id]?.title || channelCache[id].title || "";
    if (!channelCache[id].uploads) missing.push(id);
  }

  for (let i = 0; i < missing.length; i += 50) {
    const infos = await getChannelInfos(missing.slice(i, i + 50));
    for (const info of infos) {
      channelCache[info.id] = {
        ...(channelCache[info.id] || {}),
        title: channelCache[info.id]?.title || info.title,
        uploads: info.uploads,
      };
    }
  }

  await chromeSet({ [CHANNEL_CACHE_KEY]: channelCache });
  return Object.fromEntries(
    Array.from(ids)
      .filter((id) => channelCache[id])
      .map((id) => [id, channelCache[id]])
  );
}

export function __resetChannelCaches() {
  channelCache = undefined;
  subscriptionSnapshot = undefined;
  subscriptionRefreshPromise = undefined;
}
