// Settings sync status renderer. Keeps account sync messages readable while
// preserving enough state to decide whether to pull or push.
function formatDate(value) {
  const ts = Number(value) || 0;
  if (ts <= 0) return "нет";
  const date = new Date(ts);
  return Number.isNaN(date.getTime()) ? "нет" : date.toLocaleString();
}

function maxTimestamp(...values) {
  return Math.max(...values.map((value) => Number(value) || 0), 0);
}

function describeSyncState(localUpdatedAt, remoteUpdatedAt, pending) {
  if (!remoteUpdatedAt) return "Облачной версии пока нет.";
  if (pending || localUpdatedAt > remoteUpdatedAt + 1000) {
    return "Есть локальные изменения, стоит отправить их в облако.";
  }
  if (remoteUpdatedAt > localUpdatedAt + 1000) {
    return "Облачная версия свежее локальных данных.";
  }
  return "Локальное состояние совпадает с облачной версией.";
}

function createRow(doc, label, value, className = "") {
  const row = doc.createElement("div");
  row.className = `sync-status__row${className ? ` ${className}` : ""}`;
  const labelEl = doc.createElement("span");
  labelEl.className = "sync-status__label";
  labelEl.textContent = label;
  const valueEl = doc.createElement("span");
  valueEl.className = "sync-status__value";
  valueEl.textContent = value;
  row.append(labelEl, valueEl);
  return row;
}

function friendlyErrors(status) {
  const raw = [
    status?.playlist?.lastError,
    status?.settings?.lastError,
    status?.drive?.lastError,
  ].filter(Boolean);
  return raw.map((error) => {
    const text = String(error);
    if (text.includes("403")) {
      return "Google Drive отклонил доступ. Проверьте OAuth/Drive API.";
    }
    if (text.includes("not initialized")) {
      return "Облачная версия ещё не создана.";
    }
    return text;
  });
}

export function renderSyncStatus(target, status, message = "") {
  if (!target) return;
  const doc = target.ownerDocument;
  const playlist = status?.playlist || {};
  const settings = status?.settings || {};
  const drive = status?.drive || {};
  const localUpdatedAt = maxTimestamp(
    playlist.localUpdatedAt,
    settings.localUpdatedAt
  );
  const remoteUpdatedAt = Number(drive.remoteUpdatedAt) || 0;
  const pending = Boolean(playlist.pending || settings.pending);
  const errors = friendlyErrors(status);
  target.textContent = "";
  target.className = `sync-status${errors.length ? " sync-status--error" : ""}`;
  if (message) {
    const messageEl = doc.createElement("div");
    messageEl.className = "sync-status__message";
    messageEl.textContent = message;
    target.appendChild(messageEl);
  }
  const summary = doc.createElement("div");
  summary.className = "sync-status__summary";
  const summaryText = doc.createElement("span");
  summaryText.textContent = describeSyncState(localUpdatedAt, remoteUpdatedAt, pending);
  const refresh = doc.createElement("button");
  refresh.id = "refreshSyncStatus";
  refresh.type = "button";
  refresh.className = "sync-status__refresh";
  refresh.title = "Обновить статус облака";
  refresh.setAttribute("aria-label", refresh.title);
  refresh.textContent = "↻";
  summary.append(summaryText, refresh);
  target.appendChild(summary);
  target.append(
    createRow(doc, "Локально", formatDate(localUpdatedAt)),
    createRow(doc, "Отправлено", formatDate(drive.lastWriteAt)),
    createRow(doc, "В облаке", formatDate(remoteUpdatedAt)),
    createRow(doc, "Проверено", formatDate(drive.lastReadAt))
  );
  errors.forEach((error) => {
    target.appendChild(createRow(doc, "Проблема", error, "sync-status__row--error"));
  });
}
