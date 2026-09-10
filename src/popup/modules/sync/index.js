// Popup sync strip controller. Shows compact cloud status and routes account sync actions.
import { chooseCloudVersion } from "./versions.js";
const AUTO_REFRESH_MS = 2 * 60 * 1000;

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
    return createSummary(metaOverride, "error", localUpdatedAt, remoteUpdatedAt, {
      backupCount,
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
  const replaceBtn = document.createElement("button");
  replaceBtn.type = "button";
  replaceBtn.className = "popup-sync__text-button";
  replaceBtn.textContent = "Заменить из облака";
  replaceBtn.title = "Полностью заменить локальные списки облачной версией";
  pullBtn?.parentElement?.append(replaceBtn);
  if (restoreBtn) {
    restoreBtn.className = "popup-sync__text-button";
    restoreBtn.textContent = "Версии";
    restoreBtn.title = "Посмотреть и восстановить сохранённые версии";
  }
  if (pushBtn) {
    pushBtn.title = "Заменить облачные списки локальными (с сохранением облачной версии)";
  }
  if (pullBtn) pullBtn.title = "Загрузить облачные списки при отсутствии локальных изменений";
  const buttons = [pullBtn, pushBtn, restoreBtn, replaceBtn].filter(Boolean);
  let refreshTimer = null;
  let refreshInFlight = false;
  let busy = false;

  function updateButtonState() {
    buttons.forEach((button) => {
      button.disabled = busy;
      button.classList.toggle("is-loading", busy);
    });
    if (restoreBtn) {
      restoreBtn.disabled = busy;
    }
  }

  function setBusy(value) {
    busy = Boolean(value);
    updateButtonState();
  }

  function renderStatus(status) {
    if (!stateEl) return;
    const summary = describeSyncStatus(status);
    stateEl.textContent = summary.text;
    stateEl.dataset.kind = summary.kind;
    stateEl.title = summary.title;
    if (metaEl) {
      metaEl.textContent = summary.kind === "error" ? "" : summary.meta;
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
    refresh({ refreshRemote: false });
  }, AUTO_REFRESH_MS);

  async function runAction(action, message, afterLocalChange = false) {
    try {
      setBusy(true);
      const result = await action();
      await refresh({ refreshRemote: true });
      if (afterLocalChange && (result?.playlistImported || result?.driveImported || result?.restored)) {
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
          ? "Данные загружены из облака"
          : { text: result?.driveReason === "local-pending"
              ? "Конфликт: есть локальные изменения. Выберите замену из облака или сохранённую версию."
              : result?.driveReason || "Списки уже актуальны", kind: "warning" },
      true
    );
  });

  pushBtn?.addEventListener("click", () => {
    if (!window.confirm("Заменить облачные списки списками с этого устройства? Текущая облачная версия будет сохранена.")) return;
    runAction(
      () => sendMessage("sync:pushLocal", { force: true }),
      (result) =>
        result?.drivePushed || result?.playlistPushed || result?.settingsPushed
          ? "Данные отправлены в облако"
          : { text: result?.driveReason || "Не удалось отправить данные", kind: "error" }
    );
  });

  replaceBtn.addEventListener("click", () => {
    if (!window.confirm("Полностью заменить локальные списки из облака? Локальная копия будет сохранена перед заменой.")) return;
    runAction(
      () => sendMessage("sync:replaceLocalFromRemote"),
      (result) => result?.playlistImported
        ? "Локальные списки заменены из облака"
        : { text: result?.driveReason || "Не удалось заменить списки", kind: "error" },
      true
    );
  });

  restoreBtn?.addEventListener("click", () => {
    runAction(
      async () => {
        const hash = await chooseCloudVersion(sendMessage);
        return hash ? sendMessage("sync:restoreCloudVersion", { hash }) : { cancelled: true };
      },
      (result) =>
        result?.cancelled ? "Восстановление отменено" : result?.restored
          ? "Откат выполнен"
          : { text: result?.reason || "Резервная версия не найдена", kind: "error" },
      true
    );
  });

  return { refresh, scheduleRefresh };
}
