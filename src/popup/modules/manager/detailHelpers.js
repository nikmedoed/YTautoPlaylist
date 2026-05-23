// Manager detail helpers. Contains progress lookup, watched selection, list metadata comparisons, and detail reload decisions.
import { resolveProgressPercentFromObject } from "../../../progress.js";

export function getWatchedVideoIds(details, videoProgress) {
  const queue = Array.isArray(details?.queue) ? details.queue : [];
  const watchedIds = [];
  for (const video of queue) {
    const id = typeof video?.id === "string" ? video.id : "";
    if (!id) continue;
    const progress = resolveProgressPercentFromObject(videoProgress, id);
    if (typeof progress === "number" && progress > 95) {
      watchedIds.push(id);
    }
  }
  return watchedIds;
}

export function updateRemoveWatchedButton(button, details, videoProgress) {
  if (!button) {
    return;
  }
  const count = getWatchedVideoIds(details, videoProgress).length;
  button.disabled = count === 0;
  if (count === 0) {
    button.title = "В текущем списке нет видео с прогрессом более 95%";
    button.setAttribute(
      "aria-label",
      "Удалить просмотренные видео недоступно"
    );
    return;
  }
  const label = `Удалить ${count} просмотренных видео`;
  button.title = `${label} (прогресс более 95%)`;
  button.setAttribute("aria-label", button.title);
}

export function haveListMetaChanged(previous, next) {
  const prev = Array.isArray(previous) ? previous : [];
  const curr = Array.isArray(next) ? next : [];
  if (prev.length !== curr.length) {
    return true;
  }
  for (let index = 0; index < curr.length; index += 1) {
    const a = prev[index];
    const b = curr[index];
    if (!a || !b || a.id !== b.id) {
      return true;
    }
    if ((a.name || "") !== (b.name || "")) {
      return true;
    }
    if (Boolean(a.freeze) !== Boolean(b.freeze)) {
      return true;
    }
    const aRevision = Number.isFinite(a.revision) ? Number(a.revision) : 0;
    const bRevision = Number.isFinite(b.revision) ? Number(b.revision) : 0;
    if (aRevision !== bRevision) {
      return true;
    }
    const aLength = Number.isFinite(a.length) ? Number(a.length) : 0;
    const bLength = Number.isFinite(b.length) ? Number(b.length) : 0;
    if (aLength !== bLength) {
      return true;
    }
  }
  return false;
}

export function shouldReloadSelectedDetails(state, selectedListId, selectedDetails) {
  if (!selectedListId) {
    return false;
  }
  const meta = Array.isArray(state?.lists)
    ? state.lists.find((item) => item?.id === selectedListId) || null
    : null;
  if (!meta) {
    return true;
  }
  if (!selectedDetails || selectedDetails.id !== selectedListId) {
    return true;
  }
  if ((selectedDetails.name || "") !== (meta.name || "")) {
    return true;
  }
  if (Boolean(selectedDetails.freeze) !== Boolean(meta.freeze)) {
    return true;
  }
  const currentRevision = Number.isFinite(selectedDetails.revision)
    ? Number(selectedDetails.revision)
    : 0;
  const metaRevision = Number.isFinite(meta.revision) ? Number(meta.revision) : 0;
  if (currentRevision !== metaRevision) {
    return true;
  }
  const currentLength = Array.isArray(selectedDetails.queue)
    ? selectedDetails.queue.length
    : 0;
  const metaLength = Number.isFinite(meta.length) ? Number(meta.length) : 0;
  return currentLength !== metaLength;
}
