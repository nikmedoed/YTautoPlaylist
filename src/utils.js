// Shared parsing utilities. Extracts YouTube ids/thumbnail URLs from raw ids,
// URLs, API records, and YouTube DOM attributes across extension contexts.
const YOUTUBE_ID_PATTERN = /[\w-]{11}/;
const PLAYLIST_ID_PATTERN = /[\w-]{13,64}/;
const THUMBNAIL_PRIORITY = ["maxres", "standard", "high", "medium", "default"];

export function logMessage(level, context, count, message) {
  const text = `[${context}] item ${count}: ${message}`;
  if (level === "warn") {
    console.warn(text);
  } else {
    console.error(text);
  }
}

export function deepClone(value) {
  if (value == null) {
    return value;
  }
  return JSON.parse(JSON.stringify(value));
}

// Accepts raw ids, absolute URLs, and relative YouTube hrefs from the content DOM.
export function parseVideoId(input) {
  if (!input) return "";
  const str = String(input).trim();
  if (/^[\w-]{11}$/.test(str)) return str;
  try {
    const baseUrl =
      typeof globalThis?.location?.href === "string"
        ? globalThis.location.href
        : null;
    const url = baseUrl ? new URL(str, baseUrl) : new URL(str);
    if (url.hostname.includes("youtu.be")) {
      const id = url.pathname.split("/").filter(Boolean)[0];
      if (/^[\w-]{11}$/.test(id)) return id;
    }
    const candidate = url.searchParams.get("v");
    if (candidate && /^[\w-]{11}$/.test(candidate)) return candidate;
    const segments = url.pathname.split("/");
    for (const segment of segments) {
      if (/^[\w-]{11}$/.test(segment)) return segment;
    }
  } catch {
    /* not a URL */
  }
  const match = str.match(YOUTUBE_ID_PATTERN);
  return match ? match[0] : "";
}

export function parsePlaylistId(input) {
  if (!input) return "";
  const str = String(input).trim();
  if (str.length === 11) {
    return "";
  }
  if (/^[\w-]{13,64}$/.test(str)) {
    return str;
  }
  try {
    const url = new URL(str, "https://www.youtube.com");
    const listParam = url.searchParams.get("list");
    if (listParam && listParam.length !== 11 && /^[\w-]{13,64}$/.test(listParam)) {
      return listParam;
    }
    const segments = url.pathname.split("/");
    for (const segment of segments) {
      if (segment.length !== 11 && /^[\w-]{13,64}$/.test(segment)) {
        return segment;
      }
    }
  } catch {
    /* not a URL */
  }
  const match = String(input)
    .replace(/content-id-/gi, "")
    .match(PLAYLIST_ID_PATTERN);
  if (!match) {
    return "";
  }
  const candidate = match[0];
  return candidate.length === 11 ? "" : candidate;
}

function pickThumbnailValue(value) {
  if (typeof value === "string" && value) {
    return value;
  }
  if (!value || typeof value !== "object") {
    return "";
  }
  return value.url || value.fallback || value.defaultSrc || "";
}

function pickThumbnailSet(thumbnails) {
  if (!thumbnails || typeof thumbnails !== "object") {
    return "";
  }
  for (const key of THUMBNAIL_PRIORITY) {
    const url = pickThumbnailValue(thumbnails[key]);
    if (url) {
      return url;
    }
  }
  return "";
}

export function resolveThumbnailUrl(entry, fallback = "") {
  if (!entry || typeof entry !== "object") {
    return fallback || "";
  }
  const id = parseVideoId(entry.id);
  return (
    pickThumbnailValue(entry.thumbnail) ||
    pickThumbnailSet(entry.thumbnails) ||
    (id ? `https://i.ytimg.com/vi/${id}/mqdefault.jpg` : "") ||
    fallback ||
    ""
  );
}

