// Popup playback controller. Owns play, pause, next, previous, postpone, active-state sync, and button loading behavior.
import { computePlaybackMeta } from "./meta.js";

// Keeps popup playback buttons synchronized with stored state and routes commands through background messages.
export function createPlaybackController({
  startPlaybackBtn,
  playPrevBtn,
  postponeBtn,
  playNextBtn,
  togglePlaybackBtn,
  playbackControls,
  getPlaylistState,
  renderState,
  setLoading,
  setStatus,
  sendMessage,
}) {
  let activePlaybackTabId = null;
  let playbackStatus = {
    playing: false,
    hasVideo: false,
    known: false,
  };
  let lastPlaybackStatusRequest = 0;
  let playbackStatusPromise = null;

  function applyPlaybackStatus(status = {}) {
    playbackStatus = {
      playing: Boolean(status.playing),
      hasVideo: Boolean(status.hasVideo),
      known: status.known === false ? false : true,
    };
  }

  function resetPlaybackStatus() {
    applyPlaybackStatus({ playing: false, hasVideo: false, known: true });
  }

  function getActivePlaybackTabId(state = getPlaylistState() || {}) {
    return Boolean(state?.currentListId) &&
      Boolean(state?.currentVideoId) &&
      Number.isInteger(state?.currentTabId)
      ? state.currentTabId
      : null;
  }

  function updatePlaybackControls() {
    const playlistState = getPlaylistState() || {};
    const meta = computePlaybackMeta(playlistState);
    const queueHasEntries = meta.queueIds.length > 0;
    const hasPlaybackContext = getActivePlaybackTabId(playlistState) !== null;
    const hasActivePlayback = hasPlaybackContext && meta.controlling;
    const shouldShowStart = queueHasEntries && !hasPlaybackContext;
    let showPlaybackCluster = false;
    if (startPlaybackBtn) {
      startPlaybackBtn.classList.toggle("hidden", !shouldShowStart);
      if (!startPlaybackBtn.dataset.loading) {
        startPlaybackBtn.disabled = !queueHasEntries;
      }
    }
    if (togglePlaybackBtn) {
      const allowToggle =
        hasActivePlayback && (playbackStatus.hasVideo || !playbackStatus.known);
      togglePlaybackBtn.classList.toggle("hidden", !allowToggle);
      showPlaybackCluster = showPlaybackCluster || allowToggle;
      if (!togglePlaybackBtn.dataset.loading) {
        togglePlaybackBtn.disabled = false;
      }
      if (allowToggle) {
        const isPlaying = playbackStatus.known ? playbackStatus.playing : true;
        const icon = togglePlaybackBtn.querySelector(".icon");
        if (icon) {
          icon.textContent = isPlaying ? "⏸" : "▶";
        }
        togglePlaybackBtn.dataset.state = isPlaying ? "playing" : "paused";
        togglePlaybackBtn.setAttribute("aria-label", isPlaying ? "Пауза" : "Воспроизвести");
        togglePlaybackBtn.title = isPlaying ? "Пауза" : "Воспроизвести";
      }
    }
    const showQueueControls = hasActivePlayback;
    if (playPrevBtn) {
      const showPrev = showQueueControls && meta.hasPrev;
      playPrevBtn.classList.toggle("hidden", !showPrev);
      showPlaybackCluster = showPlaybackCluster || showPrev;
      if (!playPrevBtn.dataset.loading) {
        playPrevBtn.disabled = false;
      }
    }
    if (playNextBtn) {
      const showNext = showQueueControls && meta.hasNext;
      playNextBtn.classList.toggle("hidden", !showNext);
      showPlaybackCluster = showPlaybackCluster || showNext;
      if (!playNextBtn.dataset.loading) {
        playNextBtn.disabled = false;
      }
    }
    if (postponeBtn) {
      const showPostpone = showQueueControls && meta.hasNext && !meta.frozen;
      postponeBtn.classList.toggle("hidden", !showPostpone);
      if (!postponeBtn.dataset.loading) {
        postponeBtn.disabled = false;
      }
    }
    if (playbackControls) {
      playbackControls.classList.toggle("hidden", !showPlaybackCluster);
      if (showPlaybackCluster) {
        playbackControls.removeAttribute("aria-hidden");
      } else {
        playbackControls.setAttribute("aria-hidden", "true");
      }
    }
  }

  async function startPlayback() {
    if (!startPlaybackBtn) return;
    const playlistState = getPlaylistState() || {};
    const meta = computePlaybackMeta(playlistState);
    if (!meta.queueIds.length) {
      setStatus("Очередь пустая", "info", 3000);
      return;
    }
    const entry = meta.queue[0];
    if (!entry || !entry.id) {
      setStatus("Не удалось определить видео", "error", 3500);
      return;
    }
    setLoading(startPlaybackBtn, true);
    setStatus("Запускаю плейлист...", "info");
    try {
      const state = await sendMessage("playlist:play", {
        videoId: entry.id,
        listId: playlistState?.currentQueue?.id || playlistState?.currentListId || null,
        forceNewTab: true,
        activate: true,
      });
      if (state) {
        renderState(state);
        setStatus("Плейлист запущен", "success", 2500);
      } else {
        setStatus("Не удалось запустить плейлист", "error", 3500);
      }
    } catch (err) {
      console.error(err);
      setStatus("Не удалось запустить плейлист", "error", 4000);
    } finally {
      setLoading(startPlaybackBtn, false);
    }
  }

  async function togglePlayback() {
    if (!togglePlaybackBtn) return;
    if (togglePlaybackBtn.dataset.loading === "1") return;
    const playlistState = getPlaylistState() || {};
    togglePlaybackBtn.dataset.loading = "1";
    togglePlaybackBtn.disabled = true;
    try {
      const response = await sendMessage("player:togglePlayback", {});
      if (response?.state && response.state.currentTabId !== playlistState?.currentTabId) {
        renderState(response.state);
        return;
      }
      if (response?.reason === "NO_ACTIVE_TAB" || response?.reason === "TAB_UNREACHABLE") {
        setStatus("Нет активного воспроизведения", "info", 2500);
        resetPlaybackStatus();
        updatePlaybackControls();
        return;
      }
      if (response?.reason === "NO_VIDEO") {
        setStatus("Видео не найдено на вкладке", "info", 2500);
        resetPlaybackStatus();
        updatePlaybackControls();
        return;
      }
      if (response?.handled === false) {
        setStatus("Не удалось управлять воспроизведением", "error", 3200);
        return;
      }
      if (response) {
        const playing = response.playing === true;
        applyPlaybackStatus({ playing, hasVideo: true, known: true });
        updatePlaybackControls();
        setStatus(
          playing ? "Воспроизведение возобновлено" : "Видео на паузе",
          playing ? "success" : "info",
          1800
        );
      }
    } catch (err) {
      console.error("Toggle playback failed", err);
      setStatus("Не удалось управлять воспроизведением", "error", 3500);
      resetPlaybackStatus();
      updatePlaybackControls();
    } finally {
      togglePlaybackBtn.removeAttribute("data-loading");
      togglePlaybackBtn.disabled = false;
      refreshPlaybackStatus({ force: true }).catch(() => {});
    }
  }

  function hasActivePlaybackTab() {
    return getActivePlaybackTabId() !== null;
  }

  async function refreshPlaybackStatus({ force = false } = {}) {
    if (!hasActivePlaybackTab()) {
      playbackStatusPromise = null;
      lastPlaybackStatusRequest = 0;
      resetPlaybackStatus();
      updatePlaybackControls();
      return;
    }
    const playlistState = getPlaylistState() || {};
    const now = Date.now();
    if (!force && playbackStatusPromise) {
      return playbackStatusPromise;
    }
    if (!force && now - lastPlaybackStatusRequest < 400) {
      return playbackStatusPromise || Promise.resolve();
    }
    lastPlaybackStatusRequest = now;
    playbackStatusPromise = sendMessage("player:getPlaybackStatus", {})
      .then((response) => {
        playbackStatusPromise = null;
        if (response?.state && response.state.currentTabId !== playlistState?.currentTabId) {
          renderState(response.state);
          return;
        }
        if (response?.active) {
          applyPlaybackStatus({
            playing: response.playing === true,
            hasVideo: true,
            known: true,
          });
          updatePlaybackControls();
          return;
        }
        if (response?.reason === "NO_VIDEO" || response?.reason === "TAB_UNREACHABLE") {
          resetPlaybackStatus();
          updatePlaybackControls();
          return;
        }
        if (response?.reason === "NO_ACTIVE_TAB") {
          resetPlaybackStatus();
          updatePlaybackControls();
        }
      })
      .catch((err) => {
        playbackStatusPromise = null;
        if (!err || !/receiving end/i.test(err.message || "")) {
          console.error("Failed to get playback status", err);
        }
        resetPlaybackStatus();
        updatePlaybackControls();
      });
    return playbackStatusPromise;
  }

  async function playPrevious() {
    if (!playPrevBtn) return;
    const playlistState = getPlaylistState() || {};
    setLoading(playPrevBtn, true);
    setStatus("Возвращаюсь к предыдущему...", "info");
    try {
      const state = await sendMessage("playlist:playPrevious", {
        placement: "beforeCurrent",
        tabId: Number.isInteger(playlistState?.currentTabId)
          ? playlistState.currentTabId
          : undefined,
      });
      if (state?.handled === false) {
        setStatus("Предыдущее видео не найдено", "info", 3000);
        return;
      }
      if (state?.state) {
        renderState(state.state);
        setStatus("Предыдущее видео запущено", "success", 2500);
      } else if (state) {
        renderState(state);
      }
    } catch (err) {
      console.error(err);
      setStatus("Не удалось переключиться", "error", 4000);
    } finally {
      setLoading(playPrevBtn, false);
      refreshPlaybackStatus({ force: true }).catch(() => {});
    }
  }

  async function postponeCurrentVideo() {
    if (!postponeBtn) return;
    const playlistState = getPlaylistState() || {};
    if (playlistState?.currentQueue?.freeze) {
      setStatus("Список заморожен, нельзя отложить", "info", 3000);
      return;
    }
    setLoading(postponeBtn, true);
    setStatus("Откладываю видео...", "info");
    try {
      const payload = {
        tabId: Number.isInteger(playlistState?.currentTabId)
          ? playlistState.currentTabId
          : undefined,
      };
      if (playlistState?.currentVideoId) {
        payload.videoId = playlistState.currentVideoId;
      }
      const state = await sendMessage("playlist:postpone", payload);
      if (state?.handled === false) {
        setStatus("Нет следующего видео", "info", 3000);
        return;
      }
      if (state?.state) {
        renderState(state.state);
      } else if (state) {
        renderState(state);
      }
      setStatus("Видео отложено", "success", 2500);
    } catch (err) {
      console.error(err);
      setStatus("Не удалось отложить", "error", 4000);
    } finally {
      setLoading(postponeBtn, false);
      refreshPlaybackStatus({ force: true }).catch(() => {});
    }
  }

  async function playNext() {
    const playlistState = getPlaylistState() || {};
    const videoId =
      typeof playlistState?.currentVideoId === "string"
        ? playlistState.currentVideoId
        : null;
    if (!videoId) {
      setStatus("Текущее видео не найдено", "info", 3000);
      return;
    }
    setLoading(playNextBtn, true);
    setStatus("Переходим к следующему...", "info");
    try {
      const state = await sendMessage("playlist:playNext", {
        videoId,
        tabId: Number.isInteger(playlistState?.currentTabId)
          ? playlistState.currentTabId
          : undefined,
      });
      if (state?.handled === false) {
        setStatus("Следующее видео не найдено", "info");
        return;
      }
      if (state?.state) {
        renderState(state.state);
        setStatus("Следующее видео запущено", "success");
      } else if (state) {
        renderState(state);
      }
    } catch (err) {
      console.error(err);
      setStatus("Не удалось переключиться", "error", 4000);
    } finally {
      setLoading(playNextBtn, false);
      refreshPlaybackStatus({ force: true }).catch(() => {});
    }
  }

  function syncState(state) {
    const nextActiveTabId = getActivePlaybackTabId(state);
    const activeTabChanged = nextActiveTabId !== activePlaybackTabId;
    activePlaybackTabId = nextActiveTabId;
    if (!activePlaybackTabId) {
      playbackStatusPromise = null;
      lastPlaybackStatusRequest = 0;
      resetPlaybackStatus();
    } else if (activeTabChanged) {
      applyPlaybackStatus({ playing: true, hasVideo: true, known: false });
    }
    updatePlaybackControls();
    if (activePlaybackTabId) {
      refreshPlaybackStatus({ force: activeTabChanged }).catch(() => {});
    }
  }

  return {
    playNext,
    playPrevious,
    postponeCurrentVideo,
    refreshPlaybackStatus,
    startPlayback,
    syncState,
    togglePlayback,
    updatePlaybackControls,
  };
}
