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

export function resolveProgressPercentFromMap(progressMap, videoId) {
  if (!videoId || !(progressMap instanceof Map)) {
    return null;
  }
  return normalizeProgressPercent(progressMap.get(videoId));
}

export function resolveProgressPercentFromObject(progressById, videoId) {
  if (!videoId || !progressById || typeof progressById !== "object") {
    return null;
  }
  return normalizeProgressPercent(progressById[videoId]);
}
