export const MAX_STAGE_LOG_ITEMS = 60;

export const COLLECTION_STAGE_DEFS = {
  intake: { title: "Получение подписок" },
  playlists: { title: "Поиск новых видео в подписках" },
  videos: { title: "Фильтрация видео" },
  queue: { title: "Добавление в очередь" },
  error: { title: "Ошибка" },
};

export const PHASE_TO_STAGE = {
  start: "intake",
  channelsLoaded: "intake",
  playlistFetch: "playlists",
  playlistFetched: "playlists",
  aggregate: "playlists",
  filtering: "videos",
  filterProgress: "videos",
  filterStats: "videos",
  filtered: "videos",
  readyToAdd: "queue",
  adding: "queue",
  complete: "queue",
  error: "error",
};

export function resolveStageId(event) {
  if (!event?.phase) {
    return null;
  }
  const mapped = PHASE_TO_STAGE[event.phase];
  if (mapped) {
    return mapped;
  }
  if (event.stageId && COLLECTION_STAGE_DEFS[event.stageId]) {
    return event.stageId;
  }
  return event.phase;
}

export function getStageTitle(stageId) {
  return (COLLECTION_STAGE_DEFS[stageId] || { title: stageId }).title;
}
