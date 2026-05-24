// YouTube video API helpers. Contains upload/search traversal, metadata reads, Shorts checks, and collection window logic.
import { COLLECTION_FETCH_OVERLAP_MS } from "../background/constants.js";
import { parseDuration } from "../time.js";
import { callApi } from "./transport.js";

function asValidDate(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function getCollectionFetchStartDate(startDate) {
  const baseDate = asValidDate(startDate) || new Date(Date.now() - 604800000);
  return new Date(
    Math.max(0, baseDate.getTime() - COLLECTION_FETCH_OVERLAP_MS)
  );
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

export async function getNewVideos(
  playlist,
  startDate = new Date(Date.now() - 604800000)
) {
  const logicalStartDate =
    asValidDate(startDate) || new Date(Date.now() - 604800000);
  const fetchStartDate = getCollectionFetchStartDate(startDate);
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
        const fallback = await getRecentVideosBySearch(
          channelId,
          fetchStartDate,
          undefined,
          playlist
        );
        return {
          videos: fallback.videos.filter(
            (video) => video.publishedAt > logicalStartDate
          ),
          pages: fallback.pages,
        };
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
      if (it.publishedAt > logicalStartDate) videos.push(it);
    }
    const last = data.items[data.items.length - 1];
    const lastDate = last ? new Date(last.contentDetails.videoPublishedAt) : null;
    if (!data.nextPageToken || (lastDate && lastDate <= fetchStartDate)) break;
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

export async function isShort(video) {
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

export async function getVideoInfo(idList, nextPage) {
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
      publishedAt: new Date(el.snippet.publishedAt),
    };
  });
  if (data.nextPageToken) {
    const rest = await getVideoInfo(idList, data.nextPageToken);
    return info.concat(rest);
  }
  return info;
}
