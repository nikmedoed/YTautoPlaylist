// Popup sync strip controller. Shows compact cloud status and routes account sync actions.
const AUTO_REFRESH_MS = 20 * 1000;

function maxTimestamp(...values) {
  return Math.max(...values.map((value) => Number(value) || 0), 0);
}

function isBenignSyncError(error) {
  const text = String(error || "");
  return (
    !text ||
    /not initialized/i.test(text) ||
    /no-drive-remote/i.test(text) ||
    /no-remote/i.test(text)
  );
}

function formatShortTime(timestamp) {
  const value = Number(timestamp) || 0;
  if (!value) return "нет";
  return new Date(value).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatFullTime(timestamp) {
  const value = Number(timestamp) || 0;
  if (!value) return "нет данных";
  return new Date(value).toLocaleString("ru-RU");
}

function formatAge(timestamp) {
  const value = Number(timestamp) || 0;
  if (!value) return "нет";
  const diff = Math.max(0, Date.now() - value);
  return formatDuration(diff);
}

function formatDuration(diff) {
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "сейчас";
  if (minutes < 60) return `${minutes} мин назад`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ч назад`;
  return `${Math.floor(hours / 24)} д назад`;
}

function formatDelta(fromTimestamp, toTimestamp) {
  const from = Number(fromTimestamp) || 0;
  const to = Number(toTimestamp) || 0;
  if (!from || !to) return "";
  const diff = Math.abs(from - to);
  const label = formatDuration(diff).replace(" назад", "");
  return label === "сейчас" ? "меньше минуты" : label;
}

function createSummary(
  statusText,
  kind,
  localUpdatedAt,
  remoteUpdatedAt,
  { backupCount = 0, metaOverride = "" } = {}
) {
  const localAge = formatAge(localUpdatedAt);
  const remoteAge = formatAge(remoteUpdatedAt);
  const hasRemote = Boolean(remoteUpdatedAt);
  let meta = "Облака нет";
  if (hasRemote && localUpdatedAt > remoteUpdatedAt + 1000) {
    meta = `Облако отстаёт на ${formatDelta(localUpdatedAt, remoteUpdatedAt)}`;
  } else if (hasRemote && remoteUpdatedAt > localUpdatedAt + 1000) {
    meta = `Облако новее на ${formatDelta(remoteUpdatedAt, localUpdatedAt)}`;
  } else if (hasRemote) {
    meta = `Обновлено ${remoteAge}`;
  }
  if (metaOverride) {
    meta = metaOverride;
  }
  const title = [
    `На устройстве: ${formatFullTime(localUpdatedAt)} (${localAge})`,
    `В облаке: ${formatFullTime(remoteUpdatedAt)} (${remoteAge})`,
    metaOverride ? `Ошибка: ${metaOverride}` : "",
    backupCount ? `Резервных версий: ${backupCount}` : "",
  ].join("\n");
  return { text: statusText, meta, title, kind };
}

function describeSyncStatus(status) {
  const playlist = status?.playlist || {};
  const settings = status?.settings || {};
  const drive = status?.drive || {};
  const localUpdatedAt = maxTimestamp(
    playlist.localUpdatedAt,
    settings.localUpdatedAt
  );
  const remoteUpdatedAt = maxTimestamp(
    drive.remoteUpdatedAt,
    settings.remoteUpdatedAt
  );
  const backupCount = Number(drive.playlistBackupCount) || 0;
  const errors = [
    playlist.lastError,
    settings.lastError,
    drive.lastError,
  ].filter((error) => !isBenignSyncError(error));
  if (errors.length) {
    const metaOverride = String(errors[0]).slice(0, 120);
    return createSummary("Ошибка синхронизации", "error", localUpdatedAt, remoteUpdatedAt, {
      backupCount,
      metaOverride,
    });
  }
  if (!remoteUpdatedAt) {
    return createSummary("Облако не создано", "warning", localUpdatedAt, remoteUpdatedAt, {
      backupCount,
    });
  }
  if (playlist.pending || settings.pending || localUpdatedAt > remoteUpdatedAt + 1000) {
    return createSummary("Есть изменения", "warning", localUpdatedAt, remoteUpdatedAt, {
      backupCount,
    });
  }
  if (remoteUpdatedAt > localUpdatedAt + 1000) {
    return createSummary("В облаке свежее", "warning", localUpdatedAt, remoteUpdatedAt, {
      backupCount,
    });
  }
  return createSummary("Актуально", "ok", localUpdatedAt, remoteUpdatedAt, {
    backupCount,
  });
}

export function createPopupSyncController({
  stateEl,
  metaEl,
  pullBtn,
  pushBtn,
  restoreBtn,
  sendMessage,
  setStatus = () => {},
  refreshState = () => {},
}) {
  const buttons = [pullBtn, pushBtn, restoreBtn].filter(Boolean);
  let refreshTimer = null;
  let refreshInFlight = false;
  let busy = false;
  let restoreAvailable = false;

  function updateButtonState() {
    buttons.forEach((button) => {
      button.disabled = busy;
      button.classList.toggle("is-loading", busy);
    });
    if (restoreBtn) {
      restoreBtn.disabled = busy || !restoreAvailable;
    }
  }

  function setBusy(value) {
    busy = Boolean(value);
    updateButtonState();
  }

  function renderStatus(status) {
    if (!stateEl) return;
    const summary = describeSyncStatus(status);
    restoreAvailable = Number(status?.drive?.playlistBackupCount) > 0;
    stateEl.textContent = summary.text;
    stateEl.dataset.kind = summary.kind;
    stateEl.title = summary.title;
    if (metaEl) {
      metaEl.textContent = summary.meta;
      metaEl.title = summary.title;
      metaEl.dataset.kind = summary.kind;
    }
    updateButtonState();
  }

  async function refresh({ refreshRemote = false } = {}) {
    if (refreshInFlight) return;
    refreshInFlight = true;
    try {
      const status = await sendMessage("sync:getStatus", { refreshRemote });
      renderStatus(status);
    } catch (err) {
      console.error("Failed to load popup sync status", err);
      if (stateEl) {
        stateEl.textContent = "Синхронизация недоступна";
        stateEl.dataset.kind = "error";
      }
      if (metaEl) {
        metaEl.textContent = "";
        metaEl.removeAttribute("data-kind");
      }
    } finally {
      refreshInFlight = false;
    }
  }

  function scheduleRefresh(delay = 500) {
    if (refreshTimer) {
      window.clearTimeout(refreshTimer);
    }
    refreshTimer = window.setTimeout(() => {
      refreshTimer = null;
      refresh();
    }, delay);
  }

  window.setInterval(() => {
    refresh({ refreshRemote: true });
  }, AUTO_REFRESH_MS);

  async function runAction(action, message, afterLocalChange = false) {
    try {
      setBusy(true);
      const result = await action();
      await refresh({ refreshRemote: true });
      if (afterLocalChange && (result?.playlistImported || result?.driveImported)) {
        await refreshState();
      }
      const outcome = message(result);
      const text = typeof outcome === "object" ? outcome.text : outcome;
      const kind = typeof outcome === "object" ? outcome.kind || "success" : "success";
      setStatus(text, kind, 2200);
    } catch (err) {
      console.error("Popup sync action failed", err);
      await refresh();
      setStatus("Не удалось выполнить синхронизацию", "error", 3000);
    } finally {
      setBusy(false);
    }
  }

  pullBtn?.addEventListener("click", () => {
    runAction(
      () => sendMessage("sync:pullRemote"),
      (result) =>
        result?.playlistImported || result?.settingsImported
          ? "Данные слиты с облаком"
          : "Облачной версии пока нет",
      true
    );
  });

  pushBtn?.addEventListener("click", () => {
    runAction(
      () => sendMessage("sync:pushLocal"),
      (result) =>
        result?.drivePushed || result?.playlistPushed || result?.settingsPushed
          ? "Данные отправлены в облако"
          : { text: result?.driveReason || "Не удалось отправить данные", kind: "error" }
    );
  });

  restoreBtn?.addEventListener("click", () => {
    if (!restoreAvailable) {
      setStatus("В облаке пока нет резервной версии", "error", 2500);
      return;
    }
    const confirmed = window.confirm(
      "Откатить облачный список на предыдущую версию и заменить локальные списки?"
    );
    if (!confirmed) {
      return;
    }
    runAction(
      () => sendMessage("sync:restoreCloudVersion", { offset: 1 }),
      (result) =>
        result?.restored
          ? "Откат выполнен"
          : { text: result?.reason || "Резервная версия не найдена", kind: "error" },
      true
    );
  });

  return { refresh, scheduleRefresh };
}
