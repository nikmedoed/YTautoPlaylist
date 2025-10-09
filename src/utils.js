import { DEV_MODE } from "../config.js";

const MAX_CAPTURED_LOGS = 100;
const YOUTUBE_ID_PATTERN = /[\w-]{11}/;
const HAS_CHROME_SYNC =
  typeof chrome !== "undefined" && chrome?.storage?.sync;

const RU_DATE_FORMATTER = new Intl.DateTimeFormat("ru", {
  year: "2-digit",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
});

export function logMessage(level, context, count, message) {
  const text = `[${context}] item ${count}: ${message}`;
  if (level === "warn") {
    console.warn(text);
  } else {
    console.error(text);
  }
}

export function storeDate(date) {
  if (DEV_MODE || !HAS_CHROME_SYNC) {
    return Promise.resolve();
  }
  const value = date instanceof Date ? date.toString() : String(date);
  return new Promise((resolve) => {
    chrome.storage.sync.set({ lastVideoDate: value }, () => {
      console.log("lastVideoDate is set to " + value);
      resolve();
    });
  });
}

export function formatDate(date) {
  return RU_DATE_FORMATTER.format(date);
}

export function parseDuration(duration) {
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(duration || "");
  if (!match) return undefined;
  const hours = Number(match[1] || 0);
  const minutes = Number(match[2] || 0);
  const seconds = Number(match[3] || 0);
  return hours * 3600 + minutes * 60 + seconds;
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
