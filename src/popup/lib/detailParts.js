import { formatDateTime, formatDuration } from "../../time.js";

function normalizeKey(key) {
  if (key === false || key === null || key === "") {
    return null;
  }
  return typeof key === "string" ? key : null;
}

export function buildDetailParts(entry, options = {}) {
  const {
    includeChannel = true,
    includeDuration = false,
    publishedKey = "publishedAt",
    listIdKey,
    getListName,
    formatDate = formatDateTime,
    formatDurationValue = formatDuration,
  } = options;

  const channel =
    includeChannel && entry?.channelTitle ? entry.channelTitle : null;

  const resolvedPublishedKey = normalizeKey(publishedKey);
  const published =
    resolvedPublishedKey && entry
      ? formatDate(entry?.[resolvedPublishedKey])
      : null;

  const duration =
    includeDuration && entry
      ? formatDurationValue(entry.duration)
      : null;

  const metaParts = [];
  if (channel)
    metaParts.push({
      text: channel,
    });
  if (published)
    metaParts.push({
      text: published,
    });
  if (duration)
    metaParts.push({
      text: duration,
      className: "video-detail-duration",
      icon: "⏱",
    });

  const parts = [];

  if (metaParts.length) {
    parts.push(...metaParts);
  }

  const resolvedListIdKey = normalizeKey(listIdKey);
  if (resolvedListIdKey && typeof getListName === "function") {
    const listId = entry?.[resolvedListIdKey];
    if (listId) {
      const listName = getListName(listId);
      if (listName) {
        parts.push({
          text: listName,
          className: "list-label",
          noSeparator: true,
        });
      }
    }
  }

  return parts;
}
