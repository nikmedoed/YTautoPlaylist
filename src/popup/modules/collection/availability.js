// Collection availability controller for popup and manager screens. Contains button visibility, cooldown text, collection start, and progress-state wiring.

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

function formatTimeOfDay(timestamp) {
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

// Owns collection button state, cooldown copy, and start/progress transitions for a caller-owned UI.
export function createCollectionAvailabilityController({
  applyState,
  collectBtn,
  collectionArea,
  collectionNote,
  collectionController,
  defaultListId,
  getPlaylistState,
  getSelectedListId,
  refreshState,
  setLoading,
  setStatus,
  sendMessage,
}) {
  let isCollecting = false;
  let collectionCooldownTimer = null;
  let collectionCooldownTarget = 0;

  function stopCollectionCooldownTimer() {
    if (collectionCooldownTimer) {
      clearInterval(collectionCooldownTimer);
      collectionCooldownTimer = null;
    }
  }

  function updateCollectionCooldownMessage() {
    if (!collectionNote) {
      stopCollectionCooldownTimer();
      collectionCooldownTarget = 0;
      return;
    }
    if (!collectionCooldownTarget) {
      stopCollectionCooldownTimer();
      collectionNote.hidden = true;
      collectionNote.textContent = "";
      return;
    }
    const remaining = Math.max(0, collectionCooldownTarget - Date.now());
    if (remaining <= 0) {
      collectionCooldownTarget = 0;
      stopCollectionCooldownTimer();
      collectionNote.hidden = true;
      collectionNote.textContent = "";
      updateAvailability();
      return;
    }
    collectionNote.hidden = false;
    collectionNote.textContent = formatCooldownMessage(
      remaining,
      collectionCooldownTarget
    );
  }

  function startCollectionCooldownTimer(targetTime) {
    collectionCooldownTarget = Number(targetTime) || 0;
    if (!collectionCooldownTarget) {
      updateCollectionCooldownMessage();
      return;
    }
    updateCollectionCooldownMessage();
    if (!collectionCooldownTimer) {
      collectionCooldownTimer = window.setInterval(
        updateCollectionCooldownMessage,
        1000
      );
    }
  }

  function updateAvailability() {
    if (!collectBtn && !collectionArea) return;
    const playlistState = getPlaylistState() || {};
    const selectedListId = getSelectedListId();
    const isDefaultList = selectedListId === defaultListId;
    const autoMeta = readAutoCollectMeta(playlistState);
    const now = Date.now();
    const nextRunAt = autoMeta.nextRunAt || autoMeta.nextAutoCollectAt || 0;
    const onCooldown = isDefaultList && nextRunAt > now;
    const controllerActive = Boolean(collectionController?.isActive?.());
    const showArea = isDefaultList || controllerActive;
    const busy = isCollecting || controllerActive;

    if (collectionArea) {
      const hidden = !showArea;
      collectionArea.hidden = hidden;
      collectionArea.classList.toggle("hidden", hidden);
      if (hidden) {
        stopCollectionCooldownTimer();
        if (collectionNote) {
          collectionNote.hidden = true;
          collectionNote.textContent = "";
        }
      } else {
        collectionController?.showIfHasHistory?.();
      }
    }

    if (collectBtn) {
      const showButton = isDefaultList && !onCooldown && !busy;
      collectBtn.classList.toggle("hidden", !showButton);
      if (showButton) {
        const loading = collectBtn.dataset.loading === "1";
        collectBtn.disabled = loading || busy;
      } else {
        collectBtn.disabled = true;
      }
    }

    if (collectionNote) {
      if (isDefaultList && onCooldown) {
        startCollectionCooldownTimer(nextRunAt);
      } else {
        collectionNote.hidden = true;
        collectionNote.textContent = "";
        stopCollectionCooldownTimer();
      }
    }
  }

  async function collectSubscriptions() {
    if (collectBtn?.classList.contains("hidden")) return;
    if (isCollecting) return;
    isCollecting = true;
    setLoading(collectBtn, true);
    setStatus("Собираю новые видео...", "info", 0);
    updateAvailability();
    try {
      const result = await sendMessage("playlist:collectSubscriptions");
      if (result?.error === "ON_COOLDOWN") {
        if (result?.state) {
          await applyState?.(result.state);
        }
        const nextRunAt = Number(result.nextRunAt) || 0;
        const remaining = Number(result.remainingMs) ||
          (nextRunAt ? Math.max(0, nextRunAt - Date.now()) : 0);
        const message = remaining
          ? formatCooldownMessage(remaining, nextRunAt)
          : "Сбор можно запускать не чаще раза в час";
        setStatus(message, "info", 4000);
        return;
      }
      if (result?.state) {
        await applyState?.(result.state);
      } else {
        await refreshState?.();
      }
    } catch (err) {
      console.error(err);
      setStatus("Не удалось собрать подписки", "error", 4000);
    } finally {
      setLoading(collectBtn, false);
      isCollecting = false;
      updateAvailability();
    }
  }

  function handleProgressMessage(message) {
    const phase = collectionController?.handleEvent?.(message.event || message);
    if (phase === "complete" || phase === "error") {
      isCollecting = false;
      setLoading?.(collectBtn, false);
    }
    updateAvailability();
    return phase;
  }

  return {
    collectSubscriptions,
    handleProgressMessage,
    teardown: stopCollectionCooldownTimer,
    updateAvailability,
  };
}
