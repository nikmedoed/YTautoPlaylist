// Video progress state helpers. Contains progress normalization, lookup, and update behavior for watched thresholds.
import { clampProgressPercent } from "../../progress.js";
import {
  VIDEO_ID_PATTERN,
  VIDEO_PROGRESS_LIMIT,
} from "./constants.js";

function sanitizeVideoProgressEntry(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }
  const percent = clampProgressPercent(entry.percent);
  if (percent === null || percent <= 0) {
    return null;
  }
  const updatedAt = Number.isFinite(entry.updatedAt)
    ? Math.max(0, Math.trunc(entry.updatedAt))
    : Date.now();
  return { percent, updatedAt };
}

export function sanitizeVideoProgressMap(raw) {
  const entries = [];
  if (raw && typeof raw === "object") {
    Object.entries(raw).forEach(([key, value]) => {
      if (!VIDEO_ID_PATTERN.test(key)) {
        return;
      }
      const sanitized = sanitizeVideoProgressEntry(value);
      if (!sanitized) {
        return;
      }
      entries.push([key, sanitized]);
    });
  }
  entries.sort((a, b) => {
    const aTime = a[1]?.updatedAt || 0;
    const bTime = b[1]?.updatedAt || 0;
    return bTime - aTime;
  });
  const limited = entries.slice(0, VIDEO_PROGRESS_LIMIT);
  const map = {};
  limited.forEach(([id, value]) => {
    map[id] = { percent: value.percent, updatedAt: value.updatedAt };
  });
  return map;
}

function ensureVideoProgress(state) {
  if (!state || typeof state !== "object") {
    throw new TypeError("State is required to ensure video progress");
  }
  if (!state.videoProgress || typeof state.videoProgress !== "object") {
    state.videoProgress = {};
  }
  return state.videoProgress;
}

function collectTrackedVideoIds(state) {
  const ids = new Set();
  if (!state || typeof state !== "object") {
    return ids;
  }
  const lists = state.lists && typeof state.lists === "object" ? state.lists : {};
  Object.values(lists).forEach((list) => {
    if (!list || typeof list !== "object") {
      return;
    }
    const queue = Array.isArray(list.queue) ? list.queue : [];
    queue.forEach((entry) => {
      if (!entry || typeof entry !== "object") {
        return;
      }
      const id = typeof entry.id === "string" ? entry.id.trim() : "";
      if (VIDEO_ID_PATTERN.test(id)) {
        ids.add(id);
      }
    });
  });
  return ids;
}

function enforceVideoProgressLimit(state) {
  const map = ensureVideoProgress(state);
  const keys = Object.keys(map);
  if (keys.length <= VIDEO_PROGRESS_LIMIT) {
    return;
  }
  const overflow = keys.length - VIDEO_PROGRESS_LIMIT;
  const trackedIds = collectTrackedVideoIds(state);
  const entries = keys
    .map((id) => ({
      id,
      updatedAt: Number(map[id]?.updatedAt) || 0,
      tracked: trackedIds.has(id),
    }))
    .sort((a, b) => a.updatedAt - b.updatedAt);

  let remaining = overflow;
  for (const entry of entries) {
    if (remaining <= 0) {
      break;
    }
    if (entry.tracked) {
      continue;
    }
    if (map[entry.id]) {
      delete map[entry.id];
      remaining -= 1;
    }
  }

  if (remaining <= 0) {
    return;
  }

  for (const entry of entries) {
    if (remaining <= 0) {
      break;
    }
    if (!map[entry.id]) {
      continue;
    }
    delete map[entry.id];
    remaining -= 1;
  }
}

export function applyVideoProgress(state, videoId, percent, options = {}) {
  if (!state || typeof state !== "object") {
    return false;
  }
  if (typeof videoId !== "string" || !VIDEO_ID_PATTERN.test(videoId)) {
    return false;
  }
  const clamped = clampProgressPercent(percent);
  const progressMap = ensureVideoProgress(state);
  const existing = progressMap[videoId] || null;
  if (clamped === null || clamped <= 0) {
    if (existing) {
      delete progressMap[videoId];
      return true;
    }
    return false;
  }
  const timestampCandidate = Number(options.timestamp);
  const timestamp = Number.isFinite(timestampCandidate)
    ? Math.max(0, Math.trunc(timestampCandidate))
    : Date.now();
  if (existing) {
    const noChange =
      existing.percent === clamped && timestamp <= existing.updatedAt;
    if (noChange) {
      return false;
    }
    if (timestamp < existing.updatedAt && clamped <= existing.percent) {
      return false;
    }
  }
  progressMap[videoId] = { percent: clamped, updatedAt: timestamp };
  enforceVideoProgressLimit(state);
  return !existing || existing.percent !== clamped || timestamp !== existing.updatedAt;
}
