// Content collection progress notification. Shows subscription collection stage updates inside YouTube pages.
import { showPlaybackNotification } from "../playback/notification.js";

const autoCollectDisplay = {
  active: false,
};

function formatAutoCollectProgress(event = {}) {
  switch (event.phase) {
    case "start":
      return "Ищу новые видео...";
    case "channelsLoaded":
      return `Подписок: ${event.channelCount || 0}, плейлистов: ${event.playlistCount || 0}`;
    case "playlistFetch":
      return `Загружаем плейлист ${event.index || 0}/${event.total || 0}`;
    case "playlistFetched":
      return `Плейлист ${event.index || 0}/${event.total || 0}: +${event.videoCount || 0}`;
    case "aggregate":
      return `Собрано ${event.videoCount || 0} видео`;
    case "filtering":
      return `Фильтрую ${event.videoCount || 0} видео`;
    case "filterProgress": {
      const processed = Number(event.processed) || 0;
      const total = Number(event.total) || processed;
      return `Фильтрую ${processed}/${total}`;
    }
    case "filterStats": {
      const totals = event.totals || {};
      const total = Number(event.total) || Number(event.initialCount) || 0;
      const passed = totals.passed || event.videoCount || 0;
      return total
        ? `После фильтра ${passed}/${total}`
        : `После фильтра ${passed}`;
    }
    case "filtered":
      return `После фильтра осталось ${event.videoCount || 0}`;
    case "readyToAdd":
      return event.skippedExisting
        ? `Готово к добавлению ${event.videoCount || 0} видео (уже в очереди ${
            event.skippedExisting
          })`
        : `Готово к добавлению ${event.videoCount || 0} видео`;
    case "adding":
      return `Добавляю ${event.addCount || 0} видео в очередь`;
    default:
      return "";
  }
}

export function handleCollectionProgressEvent(event = {}) {
  if (!event || event.origin !== "auto") {
    return;
  }
  const phase = event.phase || "";
  if (phase === "start") {
    autoCollectDisplay.active = true;
    showPlaybackNotification({
      title: "Сбор подписок",
      body: formatAutoCollectProgress(event) || "Запускаю сбор подписок...",
      persist: true,
    });
    return;
  }
  if (!autoCollectDisplay.active) {
    return;
  }
  if (phase === "complete") {
    autoCollectDisplay.active = false;
    const added = Number(event.added) || 0;
    const fetched = Number(event.fetched) || added;
    const queueLength = Number(event.queueLength) || 0;
    const summary = added
      ? `Добавлено ${added} из ${fetched}`
      : "Новых видео не найдено";
    const queueLabel = queueLength ? ` · В очереди ${queueLength}` : "";
    showPlaybackNotification({
      title: "Сбор подписок завершён",
      body: `${summary}${queueLabel}`,
      duration: 6000,
    });
    return;
  }
  if (phase === "error") {
    autoCollectDisplay.active = false;
    const message = event.message || "Не удалось собрать подписки";
    showPlaybackNotification({
      title: "Сбор подписок",
      body: message,
      duration: 6000,
    });
    return;
  }
  const progress = formatAutoCollectProgress(event);
  if (progress) {
    showPlaybackNotification({
      title: "Сбор подписок",
      body: progress,
      persist: true,
    });
  }
}
