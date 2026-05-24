// Progress helpers. Converts stored watch-progress records into display percentages.
export function clampProgressPercent(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  const percent = Math.round(value);
  if (!Number.isFinite(percent)) {
    return null;
  }
  if (percent <= 0) return 0;
  return percent >= 100 ? 100 : percent;
}

export function normalizeProgressPercent(entry) {
  const percent = clampProgressPercent(entry?.percent);
  return percent && percent > 0 ? percent : null;
}

// Reads a progress entry from either content-side Maps or stored plain objects.
export function getProgressPercent(progressById, videoId) {
  if (!videoId || !progressById) {
    return null;
  }
  if (progressById instanceof Map) {
    return normalizeProgressPercent(progressById.get(videoId));
  }
  if (typeof progressById !== "object") {
    return null;
  }
  return normalizeProgressPercent(progressById[videoId]);
}
