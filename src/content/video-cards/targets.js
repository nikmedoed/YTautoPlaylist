// Video-card target parser. Extracts video and playlist ids from YouTube card links, datasets, and DOM structure.
import {
  parseVideoId,
} from "../core/base.js";

const PLAYLIST_CARD_SELECTOR = [
  "ytd-playlist-renderer",
  "ytd-grid-playlist-renderer",
  "ytd-compact-playlist-renderer",
  "ytd-radio-renderer",
  "ytd-compact-radio-renderer",
  ".yt-lockup-view-model--collection",
  ".yt-lockup-view-model--collection-stack-2",
  ".yt-lockup-view-model--collection-stack-3",
].join(",");

const PLAYLIST_ID_PATTERN = /[\w-]{13,64}/;

export function hasNestedCardCandidate(card, videoCardSelector) {
  if (!(card instanceof HTMLElement)) {
    return false;
  }
  return Boolean(card.querySelector(videoCardSelector));
}

function parsePlaylistIdCandidate(value) {
  if (!value) return "";
  const str = String(value).trim();
  if (!str || str.length === 11) return "";
  if (/^[\w-]{13,64}$/.test(str)) return str;
  const match = str.replace(/content-id-/gi, "").match(PLAYLIST_ID_PATTERN);
  if (match && match[0] && match[0].length !== 11) {
    return match[0];
  }
  return "";
}

function isPlaylistCollectionCard(card) {
  if (!(card instanceof HTMLElement)) return false;
  if (card.matches(PLAYLIST_CARD_SELECTOR)) {
    return true;
  }
  if (card.classList) {
    return Array.from(card.classList).some((cls) =>
      /collection/i.test(cls)
    );
  }
  return (
    Boolean(card.querySelector("yt-collection-thumbnail-view-model")) ||
    Boolean(card.querySelector("yt-collections-stack")) ||
    Boolean(card.querySelector("ytd-playlist-thumbnail"))
  );
}

function findPlaylistIdInCard(card) {
  if (!(card instanceof HTMLElement)) return "";
  const directValues = [
    card.dataset?.playlistId,
    card.dataset?.listId,
    card.dataset?.contentId,
    card.getAttribute("data-playlist-id"),
    card.getAttribute("data-list-id"),
    card.getAttribute("data-content-id"),
  ];
  for (const value of directValues) {
    const parsed = parsePlaylistIdCandidate(value);
    if (parsed) return parsed;
  }
  if (typeof card.className === "string" && card.className) {
    const match = card.className.match(/content-id-([\w-]{13,64})/i);
    if (match) {
      const parsed = parsePlaylistIdCandidate(match[1]);
      if (parsed) return parsed;
    }
  }
  const attributeNodes = card.querySelectorAll(
    "[data-playlist-id],[data-list-id],[data-content-id]"
  );
  for (const node of attributeNodes) {
    const parsed =
      parsePlaylistIdCandidate(node.getAttribute("data-playlist-id")) ||
      parsePlaylistIdCandidate(node.getAttribute("data-list-id")) ||
      parsePlaylistIdCandidate(node.getAttribute("data-content-id"));
    if (parsed) return parsed;
  }
  const anchors = card.querySelectorAll("a[href]");
  for (const anchor of anchors) {
    const href = anchor.getAttribute("href");
    if (!href) continue;
    try {
      const url = new URL(href, window.location.href);
      const listParam = parsePlaylistIdCandidate(url.searchParams.get("list"));
      if (listParam) {
        if (!url.pathname.startsWith("/watch")) {
          return listParam;
        }
        if (isPlaylistCollectionCard(card)) {
          return listParam;
        }
      }
      const fromPath = parsePlaylistIdCandidate(url.pathname);
      if (fromPath) {
        return fromPath;
      }
    } catch {
      const parsed = parsePlaylistIdCandidate(href);
      if (parsed) return parsed;
    }
  }
  return "";
}

export function determineCardTarget(card) {
  const playlistId = findPlaylistIdInCard(card);
  const videoId = findVideoIdInCard(card);
  if (playlistId && (!videoId || isPlaylistCollectionCard(card))) {
    return { type: "playlist", id: playlistId };
  }
  if (videoId) {
    return { type: "video", id: videoId };
  }
  if (playlistId) {
    return { type: "playlist", id: playlistId };
  }
  return null;
}

export function findVideoIdInCard(card) {
  if (!(card instanceof HTMLElement)) return "";
  const direct =
    card.dataset?.videoId ||
    card.dataset?.ytVideoId ||
    card.dataset?.contentId ||
    card.getAttribute("data-video-id") ||
    card.getAttribute("data-content-id") ||
    card.getAttribute("data-entity-id") ||
    card.getAttribute("data-id") ||
    card.id;
  if (direct) {
    const parsed = parseVideoId(direct);
    if (parsed) return parsed;
  }
  if (typeof card.className === "string" && card.className) {
    const match = card.className.match(/content-id-([\w-]{11})/i);
    if (match) {
      const parsed = parseVideoId(match[1]);
      if (parsed) return parsed;
    }
  }
  const datasetNode = card.querySelector("[data-video-id]");
  if (datasetNode && datasetNode.dataset) {
    const parsed = parseVideoId(datasetNode.dataset.videoId);
    if (parsed) return parsed;
  }
  const contentIdNode = card.querySelector("[data-content-id], [data-entity-id]");
  if (contentIdNode) {
    const parsed =
      parseVideoId(contentIdNode.getAttribute("data-content-id")) ||
      parseVideoId(contentIdNode.getAttribute("data-entity-id"));
    if (parsed) return parsed;
  }
  const classNode = card.querySelector("[class*='content-id-']");
  if (classNode && typeof classNode.className === "string") {
    const match = classNode.className.match(/content-id-([\w-]{11})/i);
    if (match) {
      const parsed = parseVideoId(match[1]);
      if (parsed) return parsed;
    }
  }
  const anchors = card.querySelectorAll("a[href]");
  for (const anchor of anchors) {
    const href = anchor.href || anchor.getAttribute("href");
    if (!href) continue;
    if (
      !/[?&]v=/.test(href) &&
      !/\/shorts\//.test(href) &&
      !/youtu\.be\//.test(href)
    ) {
      continue;
    }
    const parsed = parseVideoId(href);
    if (parsed) return parsed;
  }
  const buttons = card.querySelectorAll("button[data-video-id]");
  for (const btn of buttons) {
    const parsed = parseVideoId(btn.getAttribute("data-video-id"));
    if (parsed) return parsed;
  }
  return "";
}
