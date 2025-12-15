const EMPTY_FILTER_TOTALS = Object.freeze({
  filtered: 0,
  broadcasts: 0,
  shorts: 0,
  stoplists: 0,
  passed: 0,
});

const numberFormatter =
  typeof Intl !== "undefined" ? new Intl.NumberFormat("ru-RU") : null;

function formatCount(value) {
  const numeric = Number.isFinite(Number(value)) ? Number(value) : 0;
  if (!numberFormatter) {
    return String(Math.max(0, Math.round(numeric)));
  }
  return numberFormatter.format(Math.max(0, Math.round(numeric)));
}

function formatRatio(value, total) {
  const safeTotal = Number(total) || 0;
  const safeValue = Number(value) || 0;
  if (safeTotal > 0) {
    const clamped = Math.min(Math.max(0, safeValue), safeTotal);
    return `${formatCount(clamped)} / ${formatCount(safeTotal)}`;
  }
  return formatCount(safeValue);
}

function resolveFilterTotals(raw) {
  return {
    filtered: Number(raw?.filtered) || 0,
    broadcasts: Number(raw?.broadcasts) || 0,
    shorts: Number(raw?.shorts) || 0,
    stoplists: Number(raw?.stoplists) || 0,
    passed: Number(raw?.passed) || 0,
  };
}

const INITIAL_STATE = {
  startDate: null,
  channelCount: 0,
  playlistsTotal: 0,
  playlistsDone: 0,
  playlistCurrent: 0,
  playlistId: null,
  lastPlaylistVideoCount: 0,
  fetched: 0,
  filtered: 0,
  filterTotal: 0,
  filterProcessed: 0,
  filterTotals: EMPTY_FILTER_TOTALS,
  filterChannels: [],
  ready: 0,
  readyPotential: 0,
  skippedExisting: 0,
  adding: 0,
  queueBefore: 0,
  added: 0,
  completeTarget: 0,
  errorMessage: "",
};

function createInitialSummary() {
  return {
    ...INITIAL_STATE,
    filterTotals: resolveFilterTotals(EMPTY_FILTER_TOTALS),
    filterChannels: [],
  };
}

export function createCollectionSummary() {
  const data = createInitialSummary();

  function reset(startDate = null) {
    Object.assign(data, createInitialSummary());
    if (startDate) {
      data.startDate = startDate;
    }
  }

  function update(event = {}) {
    switch (event.phase) {
      case "start":
        if (event.startDate) data.startDate = event.startDate;
        data.channelCount = event.channelCount || 0;
        data.playlistsTotal = event.playlistCount || 0;
        break;
      case "channelsLoaded":
        data.channelCount = event.channelCount || 0;
        data.playlistsTotal = event.playlistCount || 0;
        break;
      case "playlistFetch":
        data.playlistsTotal = event.total || data.playlistsTotal;
        data.playlistCurrent = event.index || data.playlistCurrent;
        break;
      case "playlistFetched":
        data.playlistsTotal = event.total || data.playlistsTotal;
        data.playlistCurrent = event.index || data.playlistCurrent;
        data.playlistsDone = Math.max(
          data.playlistsDone,
          event.index || data.playlistsDone
        );
        data.playlistId = event.playlistId || data.playlistId;
        data.lastPlaylistVideoCount =
          event.videoCount || data.lastPlaylistVideoCount;
        break;
      case "aggregate":
        data.fetched = event.videoCount || 0;
        break;
      case "filtering":
        data.filtered = 0;
        data.filterTotal = event.videoCount || 0;
        data.filterProcessed = 0;
        data.filterTotals = resolveFilterTotals(EMPTY_FILTER_TOTALS);
        data.filterChannels = [];
        data.readyPotential = 0;
        data.skippedExisting = 0;
        break;
      case "filterProgress":
        if (typeof event.total === "number" && event.total >= 0) {
          data.filterTotal = event.total;
        }
        if (typeof event.processed === "number") {
          const total = data.filterTotal || event.total || event.processed;
          const current = Math.min(
            Math.max(0, event.processed),
            total || event.processed
          );
          data.filterProcessed = Math.max(data.filterProcessed, current);
        }
        break;
      case "filterStats": {
        if (typeof event.total === "number" && event.total >= 0) {
          data.filterTotal = event.total;
        }
        data.filterTotals = resolveFilterTotals(event.totals);
        data.filterChannels = Array.isArray(event.channels)
          ? event.channels.map((channel) => ({
              name: channel?.name || "",
              title: channel?.title || channel?.name || "",
              new: Number(channel?.new) || 0,
              filtered: Number(channel?.filtered) || 0,
              broadcasts: Number(channel?.broadcasts) || 0,
              shorts: Number(channel?.shorts) || 0,
              add: Number(channel?.add) || 0,
              stoplists: Number(channel?.stoplists) || 0,
            }))
          : [];
        if (typeof event.videoCount === "number") {
          data.filtered = event.videoCount;
        }
        if (data.filterTotal) {
          data.filterProcessed = Math.max(
            data.filterProcessed,
            data.filterTotal
          );
        }
        if (typeof event.readyPotential === "number") {
          data.readyPotential = event.readyPotential;
        } else if (!data.readyPotential) {
          data.readyPotential = data.filterTotals.passed || data.filtered || 0;
        }
        break;
      }
      case "filtered":
        data.filtered = event.videoCount || data.filtered;
        if (data.filterTotal) {
          data.filterProcessed = Math.max(data.filterProcessed, data.filterTotal);
        }
        break;
      case "readyToAdd":
        data.ready = event.videoCount || 0;
        data.skippedExisting = Math.max(0, Number(event.skippedExisting) || 0);
        if (typeof event.sourceTotal === "number" && event.sourceTotal >= 0) {
          data.readyPotential = event.sourceTotal;
        } else if (!data.readyPotential) {
          data.readyPotential = data.filterTotals.passed || data.ready;
        }
        data.completeTarget = data.readyPotential || data.ready || data.completeTarget;
        break;
      case "adding":
        if (typeof event.addCount === "number") {
          data.adding = event.addCount;
        }
        if (typeof event.queueBefore === "number") {
          data.queueBefore = event.queueBefore;
        }
        if (!data.completeTarget) {
          data.completeTarget = data.adding || data.ready || data.readyPotential;
        }
        break;
      case "complete":
        if (typeof event.added === "number") {
          data.added = event.added;
          data.adding = 0;
        }
        if (typeof event.fetched === "number") {
          data.fetched = event.fetched;
          data.completeTarget = event.fetched;
        } else if (!data.completeTarget) {
          data.completeTarget = data.readyPotential || data.ready || data.added;
        }
        if (typeof event.skippedExisting === "number") {
          data.skippedExisting = Math.max(0, event.skippedExisting);
        }
        break;
      case "error":
        data.errorMessage = event.message || "";
        break;
      default:
        break;
    }
  }

  function getHeaderParts() {
    const parts = [];
    if (data.channelCount) {
      parts.push(`Каналы ${formatCount(data.channelCount)}`);
    }
    if (data.playlistsTotal) {
      const current = Math.max(data.playlistCurrent, data.playlistsDone);
      parts.push(
        `Плейлисты ${formatCount(Math.min(current, data.playlistsTotal))}/${formatCount(
          data.playlistsTotal
        )}`
      );
    }
    const totalVideos =
      data.completeTarget || data.readyPotential || data.filterTotal || data.fetched;
    if (totalVideos) {
      const processed = Math.max(
        data.added || 0,
        data.ready || 0,
        data.filtered || 0,
        data.filterProcessed || 0,
        data.filterTotals?.passed || 0
      );
      if (processed) {
        parts.push(
          `Видео ${formatCount(Math.min(processed, totalVideos))}/${formatCount(
            totalVideos
          )}`
        );
      } else {
        parts.push(`Видео ${formatCount(totalVideos)}`);
      }
    } else if (data.fetched) {
      parts.push(`Видео ${formatCount(data.fetched)}`);
    }
    if (data.ready) {
      const skipped = data.skippedExisting ? ` (уже ${formatCount(data.skippedExisting)})` : "";
      parts.push(`Готово ${formatCount(data.ready)}${skipped}`);
    }
    if (data.added) {
      parts.push(`Добавлено ${formatCount(data.added)}`);
    } else if (data.adding) {
      parts.push(`Добавляется ${formatCount(data.adding)}`);
    }
    return parts;
  }

  function getMetrics() {
    const metrics = [];

    const playlistTotal = data.playlistsTotal || 0;
    const playlistProgress = Math.max(data.playlistCurrent, data.playlistsDone);
    if (playlistTotal || playlistProgress) {
      const completed = playlistTotal
        ? Math.min(playlistProgress, playlistTotal)
        : playlistProgress;
      const total = playlistTotal || completed;
      metrics.push({
        id: "playlists",
        label: "Плейлисты",
        value: completed,
        total,
        text: formatRatio(completed, total),
      });
    }

    const totals = resolveFilterTotals(data.filterTotals);
    const filterTotal =
      data.filterTotal ||
      data.readyPotential ||
      data.completeTarget ||
      data.fetched ||
      0;
    const processed = Math.max(
      Number(data.filterProcessed) || 0,
      Number(data.filtered) || 0,
      totals.passed || 0
    );

    if (filterTotal || processed) {
      const total = filterTotal || processed;
      const value = Math.min(processed, total || processed);
      const metric = {
        id: "filter",
        label: "Фильтрация",
        value,
        total,
        text: formatRatio(value, total),
      };
      if (total > 0 && value >= total && data.added) {
        metric.status = "complete";
      }
      metrics.push(metric);
    }

    return metrics;
  }

  return {
    data,
    reset,
    update,
    getHeaderParts,
    getMetrics,
  };
}
