// Manager detail helpers. Contains progress lookup, watched selection, list metadata comparisons, and detail reload decisions.
import { getProgressPercent } from "../../../progress.js";

function getLength(list, fallback = 0) {
  return Number.isFinite(list?.length) ? Number(list.length) : fallback;
}

function haveSameListMeta(previous, next, previousLength, nextLength) {
  const previousRevision = Number.isFinite(previous?.revision)
    ? Number(previous.revision)
    : 0;
  const nextRevision = Number.isFinite(next?.revision)
    ? Number(next.revision)
    : 0;
  return (
    Boolean(previous && next) &&
    previous?.id === next?.id &&
    (previous?.name || "") === (next?.name || "") &&
    Boolean(previous?.freeze) === Boolean(next?.freeze) &&
    previousRevision === nextRevision &&
    previousLength === nextLength
  );
}

export function getWatchedVideoIds(details, videoProgress) {
  const queue = Array.isArray(details?.queue) ? details.queue : [];
  const watchedIds = [];
  for (const video of queue) {
    const id = typeof video?.id === "string" ? video.id : "";
    if (!id) continue;
    const progress = getProgressPercent(videoProgress, id);
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
    if (!haveSameListMeta(a, b, getLength(a), getLength(b))) {
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
  const detailLength = Array.isArray(selectedDetails.queue)
    ? selectedDetails.queue.length
    : 0;
  return !haveSameListMeta(
    selectedDetails,
    meta,
    detailLength,
    getLength(meta)
  );
}
