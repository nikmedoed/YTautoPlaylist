import { createCollectionController } from "./collection.js";

function formatTimeOfDay(timestamp) {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

function formatCooldownMessage(remainingMs, targetTime) {
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

export function createManagerSection({
  defaultListId,
  elements = {},
  setStatus,
  sendMessage,
  readAppState,
  writeAppState,
  ensureSelectedList,
  renderLists,
  loadListDetails,
  loadState,
  getSelectedListId,
  setButtonLoading,
}) {
  const {
    areaEl,
    collectBtn,
    noteEl,
    progressEl,
    titleEl,
    stageEl,
    countersEl,
    logEl,
  } = elements;

  const collectionController = createCollectionController({
    progressEl,
    titleEl,
    stageTextEl: stageEl,
    countersEl,
    logEl,
    setStatus,
  });

  let collecting = false;
  let cooldownTimer = null;
  let cooldownTarget = 0;

  const stopCooldownTimer = () => {
    if (cooldownTimer) {
      window.clearInterval(cooldownTimer);
      cooldownTimer = null;
    }
  };

  const readAutoCollectMeta = () => {
    const state = readAppState?.() || {};
    const meta = state.autoCollect || {};
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
  };

  const updateCooldownMessage = () => {
    if (!noteEl) {
      stopCooldownTimer();
      cooldownTarget = 0;
      return;
    }
    if (!cooldownTarget) {
      stopCooldownTimer();
      noteEl.hidden = true;
      noteEl.textContent = "";
      return;
    }
    const remaining = Math.max(0, cooldownTarget - Date.now());
    if (remaining <= 0) {
      cooldownTarget = 0;
      stopCooldownTimer();
      noteEl.hidden = true;
      noteEl.textContent = "";
      updateAvailability();
      return;
    }
    noteEl.hidden = false;
    noteEl.textContent = formatCooldownMessage(remaining, cooldownTarget);
  };

  const startCooldownTimer = (targetTime) => {
    cooldownTarget = Number(targetTime) || 0;
    if (!cooldownTarget) {
      updateCooldownMessage();
      return;
    }
    updateCooldownMessage();
    if (!cooldownTimer) {
      cooldownTimer = window.setInterval(updateCooldownMessage, 1000);
    }
  };

  const hasActiveCollection = () => Boolean(collectionController?.isActive?.());

  const updateAvailability = () => {
    if (!areaEl && !collectBtn) return;
    const selectedListId = getSelectedListId?.() || null;
    const isDefaultList = selectedListId === defaultListId;
    const autoMeta = readAutoCollectMeta();
    const now = Date.now();
    const nextRunAt = autoMeta.nextRunAt || autoMeta.nextAutoCollectAt || 0;
    const onCooldown = isDefaultList && nextRunAt > now;
    const controllerActive = hasActiveCollection();
    const showArea =
      (isDefaultList || hasActiveCollection()) && Boolean(areaEl);

    if (areaEl) {
      const hidden = !showArea;
      areaEl.hidden = hidden;
      areaEl.classList.toggle("hidden", hidden);
      if (hidden) {
        stopCooldownTimer();
        if (noteEl) {
          noteEl.hidden = true;
          noteEl.textContent = "";
        }
      } else {
        collectionController?.showIfHasHistory?.();
      }
    }

    if (collectBtn) {
      const busy = collecting || controllerActive;
      const showButton = isDefaultList && !onCooldown && !busy;
      collectBtn.classList.toggle("hidden", !showButton);
      if (showButton) {
        const loading = collectBtn.dataset.loading === "1";
        collectBtn.disabled = loading || busy;
      } else {
        collectBtn.disabled = true;
      }
    }

    if (noteEl) {
      if (isDefaultList && onCooldown) {
        startCooldownTimer(nextRunAt);
      } else {
        noteEl.hidden = true;
        noteEl.textContent = "";
        stopCooldownTimer();
      }
    }
  };

  const syncStateFromResult = async (state) => {
    if (!state || !Array.isArray(state.lists)) return;
    writeAppState?.(state);
    ensureSelectedList?.(state);
    renderLists?.();
    const currentListId = getSelectedListId?.();
    if (currentListId) {
      await loadListDetails?.(currentListId, { syncCurrent: false });
    } else {
      updateAvailability();
    }
  };

  const handleCollectClick = async () => {
    if (collectBtn?.classList.contains("hidden")) return;
    if (collecting) return;
    collecting = true;
    setButtonLoading?.(collectBtn, true);
    updateAvailability();
    setStatus?.("Собираю новые видео...", "info", 0);
    try {
      const result = await sendMessage?.("playlist:collectSubscriptions");
      if (result?.error === "ON_COOLDOWN") {
        if (result?.state) {
          await syncStateFromResult(result.state);
        }
        const nextRunAt = Number(result?.nextRunAt) || 0;
        const remaining =
          Number(result?.remainingMs) ||
          (nextRunAt ? Math.max(0, nextRunAt - Date.now()) : 0);
        const message = remaining
          ? formatCooldownMessage(remaining, nextRunAt)
          : "Сбор можно запускать не чаще раза в час";
        setStatus?.(message, "info", 4000);
        return;
      }
      if (result?.state && Array.isArray(result.state.lists)) {
        await syncStateFromResult(result.state);
      } else {
        await loadState?.();
      }
    } catch (err) {
      console.error("Failed to collect subscriptions", err);
      setStatus?.("Не удалось собрать подписки", "error", 4000);
    } finally {
      setButtonLoading?.(collectBtn, false);
      collecting = false;
      updateAvailability();
    }
  };

  const handleProgressEvent = (event) => {
    const phase = collectionController?.handleEvent?.(event?.event || event);
    if (phase === "complete" || phase === "error") {
      collecting = false;
      if (collectBtn) {
        setButtonLoading?.(collectBtn, false);
      }
    }
    updateAvailability();
    return phase;
  };

  const teardown = () => {
    stopCooldownTimer();
  };

  return {
    updateAvailability,
    handleCollectClick,
    handleProgressEvent,
    teardown,
    get collecting() {
      return collecting;
    },
    get controller() {
      return collectionController;
    },
  };
}
