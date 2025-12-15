const MAX_CAPTURED_LOGS = 100;
const YOUTUBE_ID_PATTERN = /[\w-]{11}/;
const PLAYLIST_ID_PATTERN = /[\w-]{13,64}/;

export function logMessage(level, context, count, message) {
  const text = `[${context}] item ${count}: ${message}`;
  if (level === "warn") {
    console.warn(text);
  } else {
    console.error(text);
  }
}

export function parseVideoId(input) {
  if (!input) return "";
  const str = String(input).trim();
  if (/^[\w-]{11}$/.test(str)) return str;
  try {
    const url = new URL(str);
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

export const logMessages = [];

function safeStringify(value) {
  try {
    return JSON.stringify(value);
  } catch (err) {
    return `[unserializable: ${err.message}]`;
  }
}

export function setupLogCapture() {
  const originalLog = console.log.bind(console);
  console.log = (...args) => {
    const entry = args
      .map((arg) =>
        typeof arg === "object" && arg !== null ? safeStringify(arg) : String(arg)
      )
      .join(" ");
    logMessages.push(entry);
    if (logMessages.length > MAX_CAPTURED_LOGS) {
      logMessages.shift();
    }
    originalLog(...args);
  };
}

