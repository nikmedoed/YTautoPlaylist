// Collection cooldown helpers. Reads auto-collection metadata and formats next-run countdown messages.
export function readAutoCollectMeta(state) {
  const meta = state?.autoCollect || {};
  const cooldownMs = Number(meta.cooldownMs) || 0;
  const lastRunAt = Number(meta.lastRunAt) || 0;
  const storedNext = Number(meta.nextAutoCollectAt) || 0;
  let nextRun = storedNext;
  if (!nextRun && cooldownMs > 0 && lastRunAt > 0) {
    nextRun = lastRunAt + cooldownMs;
  }
  return {
    lastRunAt,
    lastAdded: Number(meta.lastAdded) || 0,
    lastFetched: Number(meta.lastFetched) || 0,
    nextAutoCollectAt: storedNext,
    nextRunAt: nextRun > 0 ? nextRun : 0,
    cooldownMs,
  };
}

export function formatTimeOfDay(timestamp) {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

export function formatCooldownMessage(remainingMs, targetTime) {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [];
  if (hours > 0) {
    parts.push(`${hours} ч`);
  }
  if (minutes > 0 || hours > 0) {
    parts.push(`${minutes} мин`);
  }
  if (!parts.length) {
    parts.push(`${seconds} сек`);
  }
  const timeLabel = formatTimeOfDay(targetTime);
  return timeLabel
    ? `Сбор будет доступен через ${parts.join(" ")} (≈ ${timeLabel})`
    : `Сбор будет доступен через ${parts.join(" ")}`;
}
