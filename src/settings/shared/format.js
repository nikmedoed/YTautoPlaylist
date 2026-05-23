// Settings formatting helpers. Contains small display formatters shared by settings panels.
import { parseDuration } from "../../time.js";

export function toTimeStr(sec) {
  if (sec === undefined || sec === null || sec === Infinity) return "";
  const h = Math.floor(sec / 3600)
    .toString()
    .padStart(2, "0");
  const m = Math.floor((sec % 3600) / 60)
    .toString()
    .padStart(2, "0");
  const s = Math.floor(sec % 60)
    .toString()
    .padStart(2, "0");
  return `${h}:${m}:${s}`;
}

export function parseTime(str) {
  if (!str) return 0;
  const parts = str.split(":").map((p) => parseInt(p, 10));
  if (parts.some((n) => Number.isNaN(n))) return 0;
  let sec = 0;
  if (parts.length === 3) sec = parts[0] * 3600 + parts[1] * 60 + parts[2];
  else if (parts.length === 2) sec = parts[0] * 60 + parts[1];
  else if (parts.length === 1) sec = parts[0];
  return sec;
}

export function toLocalInputValue(date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

export function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "";
  return date.toLocaleString("ru");
}

export function isShortVideo(info) {
  if (!info) return false;
  if (typeof info.duration === "string") {
    const sec = parseDuration(info.duration);
    if (typeof sec === "number" && sec > 0 && sec < 60) {
      return true;
    }
  }
  if (Array.isArray(info.tags) && info.tags.some((tag) => /shorts?/i.test(tag))) {
    return true;
  }
  if (typeof info.title === "string") {
    return info.title.toLowerCase().includes("#short");
  }
  return false;
}
