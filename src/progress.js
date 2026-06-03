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

// Reads a progress entry from the persisted plain-object progress map.
export function getProgressPercent(progressById, videoId) {
  if (!videoId || !progressById) {
    return null;
  }
  if (typeof progressById !== "object") {
    return null;
  }
  const percent = clampProgressPercent(progressById[videoId]?.percent);
  return percent && percent > 0 ? percent : null;
}
