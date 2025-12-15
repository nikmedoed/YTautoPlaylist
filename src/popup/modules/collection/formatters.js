import { formatDateTime } from "../../../time.js";
import { COLLECTION_STAGE_DEFS } from "./constants.js";

const EMPTY_TOTALS = Object.freeze({
  filtered: 0,
  broadcasts: 0,
  shorts: 0,
  stoplists: 0,
  passed: 0,
});

function shortenId(value, length = 8) {
  if (!value) return "";
  const str = String(value);
  if (str.length <= length) return str;
  const half = Math.max(1, Math.floor((length - 1) / 2));
  return `${str.slice(0, half)}…${str.slice(-half)}`;
}

function formatCount(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "0";
  }
  return numeric.toLocaleString("ru-RU");
}

function formatPlaylistLabel(event = {}) {
  const title = (event.channelTitle || event.playlistTitle || "").trim();
  if (title) {
    return title;
  }
  return shortenId(event.playlistId);
}

function resolveFilterTotals(totals) {
  if (!totals) {
    return { ...EMPTY_TOTALS };
  }
  return {
    filtered: Number(totals.filtered) || 0,
    broadcasts: Number(totals.broadcasts) || 0,
    shorts: Number(totals.shorts) || 0,
    stoplists: Number(totals.stoplists) || 0,
    passed: Number(totals.passed) || 0,
  };
}

function formatFilterBreakdown(totals) {
  const safeTotals = resolveFilterTotals(totals);
  return [
    `В очередь ${formatCount(safeTotals.passed)}`,
    `Фильтр ${formatCount(safeTotals.filtered)}`,
    `Трансляции ${formatCount(safeTotals.broadcasts)}`,
    `Шорты ${formatCount(safeTotals.shorts)}`,
    `Стоп-лист ${formatCount(safeTotals.stoplists)}`,
  ].join(" · ");
}

export function formatStageMeta(stageId, summary, event = {}) {
  switch (stageId) {
    case "intake": {
      const channels = summary.channelCount || event.channelCount || 0;
      const playlists = summary.playlistsTotal || event.playlistCount || 0;
      if (channels || playlists) {
        if (channels && playlists) {
          return `Каналы ${formatCount(channels)}, плейлисты ${formatCount(
            playlists
          )}`;
        }
        if (channels) {
          return `Каналы ${formatCount(channels)}`;
        }
        return `Плейлисты ${formatCount(playlists)}`;
      }
      if (event.startDate || summary.startDate) {
        const text = formatDateTime(event.startDate || summary.startDate);
        if (text) return `С ${text}`;
      }
      return "Подготовка";
    }
    case "playlists": {
      const total = summary.playlistsTotal || event.total || 0;
      const current = Math.max(
        summary.playlistCurrent,
        summary.playlistsDone,
        event.index || 0
      );
      if (total) {
        return `Плейлист ${formatCount(Math.min(current, total))}/${formatCount(
          total
        )}`;
      }
      if (current) {
        return `Плейлист ${formatCount(current)}`;
      }
      return "Загрузка плейлистов";
    }
    case "videos": {
      const totals = summary.filterTotals || EMPTY_TOTALS;
      const total =
        summary.filterTotal ||
        event.total ||
        summary.readyPotential ||
        summary.fetched ||
        0;
      const processed = Math.max(
        summary.filterProcessed || event.processed || 0,
        summary.filtered || event.videoCount || 0,
        totals.passed || 0
      );
      if (total) {
        return `Фильтрация ${formatCount(Math.min(processed, total))}/${formatCount(
          total
        )}`;
      }
      if (processed) {
        return `Фильтрация ${formatCount(processed)}`;
      }
      if (summary.fetched || event.videoCount) {
        return `Найдено ${formatCount(summary.fetched || event.videoCount || 0)} видео`;
      }
      return "Фильтрация";
    }
    case "queue": {
      const added = summary.added || event.added || 0;
      const ready = summary.ready || event.videoCount || 0;
      if (added) {
        const total =
          summary.completeTarget ||
          summary.readyPotential ||
          summary.fetched ||
          event.fetched ||
          added;
        return `Добавлено ${formatCount(added)}${
          total ? ` из ${formatCount(total)}` : ""
        }`;
      }
      if (event.phase === "complete" && !added) {
        const total =
          summary.completeTarget ||
          summary.readyPotential ||
          summary.fetched ||
          event.fetched ||
          0;
        if (total) {
          return `Добавлено 0 из ${formatCount(total)}`;
        }
        return "Новых видео не найдено";
      }
      if (ready) {
        const skipped = summary.skippedExisting || event.skippedExisting || 0;
        if (skipped) {
          return `Готово ${formatCount(ready)} (уже в очереди ${formatCount(
            skipped
          )})`;
        }
        return `Готово ${formatCount(ready)}`;
      }
      if (summary.adding || typeof event.addCount === "number") {
        const count = summary.adding || event.addCount || 0;
        const before = summary.queueBefore || event.queueBefore || 0;
        if (before) {
          return `Добавляем ${formatCount(count)} (было ${formatCount(before)})`;
        }
        return `Добавляем ${formatCount(count)}`;
      }
      if (summary.queueBefore) {
        return `Очередь была ${formatCount(summary.queueBefore)}`;
      }
      return "Добавление в очередь";
    }
    case "error":
      return summary.errorMessage || event.message || "Ошибка";
    default:
      return "";
  }
}

export function formatStageLog(event = {}, summary) {
  switch (event.phase) {
    case "start":
      return event.startDate
        ? `Старт с ${formatDateTime(event.startDate)}`
        : "Запуск процесса";
    case "channelsLoaded":
      return `Получено ${event.channelCount || 0} каналов и ${event.playlistCount || 0} плейлистов`;
    case "playlistFetch":
      return null;
    case "playlistFetched": {
      const index = Number(event.index);
      const total = Number(event.total);
      const parts = [];
      if (Number.isFinite(total) && total > 0) {
        const boundedIndex = Math.max(0, Math.min(Number.isFinite(index) ? index : 0, total));
        parts.push(`${formatCount(boundedIndex)}/${formatCount(total)}`);
      } else if (Number.isFinite(index) && index > 0) {
        parts.push(formatCount(index));
      }
      parts.push(`${formatCount(event.videoCount || 0)} видео`);
      const label = formatPlaylistLabel(event);
      if (label) {
        parts.push(label);
      }
      return parts.join(" – ");
    }
    case "aggregate":
      return `Собрано ${event.videoCount || 0} уникальных видео`;
    case "filtering":
      return `Фильтрация (${formatCount(event.videoCount || 0)})`;
    case "filterProgress":
      if (event.total) {
        return `Фильтрация ${formatCount(event.processed || 0)}/${formatCount(
          event.total
        )}`;
      }
      return `Фильтрация ${formatCount(event.processed || 0)}`;
    case "filterStats":
      return formatFilterBreakdown(event.totals || summary?.filterTotals);
    case "filtered":
      return null;
    case "readyToAdd":
      return event.skippedExisting
        ? `К добавлению ${formatCount(event.videoCount || 0)} видео (уже в очереди ${
            formatCount(event.skippedExisting || 0)
          })`
        : `К добавлению ${formatCount(event.videoCount || 0)} видео`;
    case "adding":
      return `Добавляем ${formatCount(event.addCount || 0)} видео (очередь была ${formatCount(
        event.queueBefore || 0
      )})`;
    case "complete":
      return event.added
        ? `В очередь добавлено ${formatCount(event.added)} из ${formatCount(
            event.fetched || event.added
          )}`
        : "Новых видео не найдено";
    case "error":
      return event.message || "Произошла ошибка";
    default:
      return null;
  }
}

export function getStatusInfo(event = {}, summary) {
  if (!event.phase) return null;
  switch (event.phase) {
    case "start":
      return { text: "Сбор подписок...", kind: "info", timeout: 0 };
    case "channelsLoaded":
      return {
        text: `Каналов: ${event.channelCount || 0}, плейлистов: ${event.playlistCount || 0}`,
        kind: "info",
        timeout: 0,
      };
    case "playlistFetch":
      return {
        text: `Загрузка плейлистов ${event.index || 0}/${event.total || 0}`,
        kind: "info",
        timeout: 0,
      };
    case "playlistFetched":
      return {
        text: `Плейлист ${event.index || 0}/${event.total || 0}: +${event.videoCount || 0}`,
        kind: "info",
        timeout: 0,
      };
    case "aggregate":
      return {
        text: `Найдено ${event.videoCount || 0} видео`,
        kind: "info",
        timeout: 0,
      };
    case "filtering":
      return {
        text: `Фильтрация ${event.videoCount || 0} видео`,
        kind: "info",
        timeout: 0,
      };
    case "filterProgress": {
      const processed = Number(event.processed) || 0;
      const total = Number(event.total) || processed;
      return {
        text: `Фильтрация ${processed}/${total}`,
        kind: "info",
        timeout: 0,
      };
    }
    case "filterStats": {
      const breakdown = formatFilterBreakdown(
        event.totals || summary?.filterTotals
      );
      if (breakdown) {
        return {
          text: breakdown,
          kind: "info",
          timeout: 0,
        };
      }
      const totals = event.totals || {};
      const total = Number(event.total) || Number(event.initialCount) || 0;
      const passed = totals.passed || event.videoCount || 0;
      const base = total
        ? `После фильтра ${passed}/${total}`
        : `После фильтра ${passed}`;
      return {
        text: base,
        kind: "info",
        timeout: 0,
      };
    }
    case "filtered": {
      const breakdown = formatFilterBreakdown(
        summary?.filterTotals || event.totals
      );
      if (breakdown) {
        return {
          text: breakdown,
          kind: "info",
          timeout: 0,
        };
      }
      return {
        text: `После фильтра ${event.videoCount || 0}`,
        kind: "info",
        timeout: 0,
      };
    }
    case "readyToAdd":
      return {
        text:
          event.skippedExisting && event.skippedExisting > 0
            ? `К добавлению ${event.videoCount || 0} видео (уже в очереди ${
                event.skippedExisting
              })`
            : `К добавлению ${event.videoCount || 0} видео`,
        kind: "info",
        timeout: 0,
      };
    case "adding":
      return {
        text: `Добавляем ${event.addCount || 0} видео`,
        kind: "info",
        timeout: 0,
      };
    case "complete":
      return summary?.added
        ? {
            text: `Добавлено ${summary.added} из ${summary.fetched || summary.added}`,
            kind: "success",
            timeout: 5000,
          }
        : {
            text: "Новых видео не найдено",
            kind: "info",
            timeout: 5000,
          };
    case "error":
      return {
        text: event.message || "Ошибка при сборе подписок",
        kind: "error",
        timeout: 6000,
      };
    default:
      return null;
  }
}

export function getStageDefinition(stageId) {
  return COLLECTION_STAGE_DEFS[stageId] || { title: stageId };
}
