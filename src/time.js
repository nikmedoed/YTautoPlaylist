const ISO_DURATION_PATTERN = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/;

const DISPLAY_DATE_FORMATTER = new Intl.DateTimeFormat("ru-RU", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

const STORAGE_TIMESTAMP_FORMATTER = new Intl.DateTimeFormat("ru", {
  year: "2-digit",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
});

function toDate(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : new Date(value.getTime());
  }
  if (typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === "string" && value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function formatHms(totalSeconds) {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hours) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(
      2,
      "0"
    )}:${String(secs).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

export function parseDuration(duration) {
  if (duration == null) return undefined;
  if (typeof duration === "number" && Number.isFinite(duration)) {
    return Math.max(0, duration);
  }
  const match = ISO_DURATION_PATTERN.exec(String(duration));
  if (!match) return undefined;
  const hours = Number(match[1] || 0);
  const minutes = Number(match[2] || 0);
  const seconds = Number(match[3] || 0);
  return hours * 3600 + minutes * 60 + seconds;
}

export function formatDuration(duration) {
  if (duration == null) return "";
  const seconds = parseDuration(duration);
  if (seconds == null) return "";
  return formatHms(seconds);
}

export function formatDateTime(value) {
  const date = toDate(value);
  return date ? DISPLAY_DATE_FORMATTER.format(date) : "";
}

export function formatClockTime(value = new Date()) {
  const date = toDate(value);
  if (!date) return "";
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

/**
 * Formats a Date-like value for compact display when showing stored timestamps.
 */
export function formatStorageTimestamp(value) {
  const date = toDate(value);
  return date ? STORAGE_TIMESTAMP_FORMATTER.format(date) : "";
}

