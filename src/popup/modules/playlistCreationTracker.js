function normalizeCount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function createInitialState(listId, button) {
  return {
    listId,
    button: button || null,
    token: null,
    total: 0,
    added: 0,
    stage: "start",
    status: "start",
    reason: null,
    delayMs: null,
    startedAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function buildProgress(total, added, stage) {
  const totalValid = normalizeCount(total);
  const addedValid = normalizeCount(added);
  const safeAdded = totalValid ? Math.min(addedValid, totalValid) : addedValid;
  const stageSupportsProgress = ["adding", "finalizing", "done"].includes(stage);
  if (!stageSupportsProgress) {
    return null;
  }
  if (!totalValid) {
    return { indeterminate: true };
  }
  return { total: totalValid, added: safeAdded };
}

function resolveStatusText(state) {
  const totalValid = normalizeCount(state.total);
  const addedValid = normalizeCount(state.added);
  const safeAdded = totalValid ? Math.min(addedValid, totalValid) : addedValid;
  let text = "Создаю плейлист ютуб...";
  switch (state.stage) {
    case "playlistCreated":
    case "adding":
      text = totalValid
        ? `Добавляю видео в плейлист (${safeAdded}/${totalValid})...`
        : "Добавляю видео в плейлист...";
      break;
    case "finalizing":
      text = totalValid
        ? `Завершаю создание плейлиста (${safeAdded}/${totalValid})...`
        : "Завершаю создание плейлиста...";
      break;
    case "done":
      text = totalValid
        ? `Плейлист почти готов (${safeAdded}/${totalValid})...`
        : "Плейлист почти готов...";
      break;
    case "error":
      text = "Ошибка при создании плейлиста";
      break;
    default:
      break;
  }

  if (state.status === "retry") {
    const waitSeconds = state.delayMs ? Math.ceil(state.delayMs / 1000) : null;
    return waitSeconds
      ? `Ожидаю перед продолжением (${waitSeconds} с)...`
      : "Ожидаю перед продолжением...";
  }

  if (state.status === "quotaExceeded") {
    return "Превышена квота YouTube API, создание остановлено";
  }

  if (state.status === "error") {
    return "Не удалось добавить часть видео";
  }

  return text;
}

export function createPlaylistCreationTracker({ setStatus }) {
  const statesByList = new Map();
  const statesByToken = new Map();

  const updatePlaylistCreationStatus = (state) => {
    if (!state) return;
    const progress = buildProgress(state.total, state.added, state.stage);
    setStatus(resolveStatusText(state), "info", 0, { progress });
  };

  const registerState = (listId, button) => {
    if (!listId) return null;
    const existing = statesByList.get(listId);
    if (existing && existing.token) {
      statesByToken.delete(existing.token);
    }
    const state = createInitialState(listId, button);
    statesByList.set(listId, state);
    return state;
  };

  const releaseState = (stateOrListId) => {
    if (!stateOrListId) return;
    const state =
      typeof stateOrListId === "string"
        ? statesByList.get(stateOrListId)
        : stateOrListId;
    if (!state) return;
    statesByList.delete(state.listId);
    if (state.token) {
      statesByToken.delete(state.token);
    }
  };

  const handleProgressMessage = (message) => {
    if (!message || message.type !== "playlist:createYouTubePlaylist:progress") {
      return;
    }
    const token = message.token;
    const listId = message.listId;
    let state = null;
    if (token && statesByToken.has(token)) {
      state = statesByToken.get(token);
    }
    if (!state && listId && statesByList.has(listId)) {
      state = statesByList.get(listId);
    }
    if (!state) {
      return;
    }
    if (!state.token && token) {
      state.token = token;
      statesByToken.set(token, state);
    } else if (state.token && token && state.token !== token) {
      return;
    }

    if (typeof message.total === "number" && message.total >= 0) {
      state.total = message.total;
    }
    if (typeof message.added === "number" && message.added >= 0) {
      state.added = message.added;
    }
    if (typeof message.delayMs === "number") {
      state.delayMs = Number.isFinite(message.delayMs) && message.delayMs > 0
        ? message.delayMs
        : null;
    }
    if (Object.prototype.hasOwnProperty.call(message, "reason")) {
      state.reason = message.reason || null;
    }
    if (message.stage) {
      state.stage = message.stage;
    }
    if (message.status) {
      state.status = message.status;
    }
    state.updatedAt = Date.now();
    updatePlaylistCreationStatus(state);
  };

  return {
    registerState,
    releaseState,
    handleProgressMessage,
  };
}
