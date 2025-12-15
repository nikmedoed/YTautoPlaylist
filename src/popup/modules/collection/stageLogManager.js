import { MAX_STAGE_LOG_ITEMS } from "./constants.js";
import { formatStageMeta, formatStageLog, getStageDefinition } from "./formatters.js";
import { formatClockTime } from "../../../time.js";

export function createStageLogManager({ logEl, collapsed = true } = {}) {
  if (!logEl) {
    return {
      clear() {},
      setCollapsed() {},
      applyUpdate() {
        return null;
      },
      markCompleted() {},
      openStage() {},
    };
  }

  let isCollapsed = Boolean(collapsed);
  const stages = new Map();

  function clear() {
    stages.forEach((entry) => entry.container?.remove());
    stages.clear();
    logEl.textContent = "";
  }

  function ensure(stageId) {
    let entry = stages.get(stageId);
    if (entry) {
      logEl.prepend(entry.container);
      return entry;
    }
    const doc = logEl.ownerDocument;
    const container = doc.createElement("li");
    container.className = "collection-stage";
    const details = doc.createElement("details");
    details.open = !isCollapsed;
    const summaryNode = doc.createElement("summary");
    summaryNode.className = "collection-stage__summary";
    const summaryRow = doc.createElement("div");
    summaryRow.className = "collection-stage__summary-row";
    const title = doc.createElement("span");
    title.className = "collection-stage__title";
    title.textContent = getStageDefinition(stageId).title;
    const meta = doc.createElement("span");
    meta.className = "collection-stage__meta";
    meta.hidden = true;
    summaryRow.append(title, meta);
    const statusLine = doc.createElement("div");
    statusLine.className = "collection-stage__status";
    statusLine.hidden = true;
    summaryNode.append(summaryRow, statusLine);
    const body = doc.createElement("div");
    body.className = "collection-stage__body";
    details.append(summaryNode, body);
    container.append(details);
    logEl.prepend(container);
    entry = {
      id: stageId,
      container,
      details,
      summaryTitle: title,
      summaryMeta: meta,
      summaryStatus: statusLine,
      body,
      logs: [],
      lastLogText: "",
    };
    stages.set(stageId, entry);
    return entry;
  }

  function updateSummaryStatus(entry) {
    if (!entry?.summaryStatus) return;
    if (entry.lastLogText) {
      entry.summaryStatus.textContent = entry.lastLogText;
      entry.summaryStatus.hidden = false;
    } else {
      entry.summaryStatus.textContent = "";
      entry.summaryStatus.hidden = true;
    }
  }

  function addStageLog(entry, text) {
    if (!entry?.body || !text) return;
    if (entry.lastLogText === text) {
      return;
    }
    const item = entry.body.ownerDocument.createElement("div");
    item.className = "collection-stage__log";
    const timestamped = `[${formatClockTime()}] ${text}`;
    item.textContent = timestamped;
    entry.body.prepend(item);
    entry.logs.unshift(item);
    entry.lastLogText = text;
    updateSummaryStatus(entry);
    while (entry.logs.length > MAX_STAGE_LOG_ITEMS) {
      const tail = entry.logs.pop();
      tail?.remove();
    }
  }

  function addFilterTable(entry, channels) {
    if (!entry?.body || !channels?.length) return;
    const doc = entry.body.ownerDocument;
    const item = doc.createElement("div");
    item.className = "collection-stage__log collection-stage__log--table";
    const timestamp = doc.createElement("div");
    timestamp.className = "collection-stage__log-time";
    timestamp.textContent = `[${formatClockTime()}]`;
    const scroll = doc.createElement("div");
    scroll.className = "collection-stage__table-wrap";
    const table = doc.createElement("table");
    table.className = "collection-stage__table";

    const head = doc.createElement("thead");
    const headRow = doc.createElement("tr");
    const headers = [
      "Канал",
      "Новые",
      "Фильтр",
      "Трансляции",
      "Шорты",
      "В очередь",
      "Стоп-лист",
    ];
    headers.forEach((label) => {
      const cell = doc.createElement("th");
      cell.textContent = label;
      headRow.append(cell);
    });
    head.append(headRow);

    const body = doc.createElement("tbody");
    channels.forEach((channel) => {
      const row = doc.createElement("tr");
      const cells = [
        channel?.title || channel?.name || "",
        channel?.new ?? "",
        channel?.filtered ?? "",
        channel?.broadcasts ?? "",
        channel?.shorts ?? "",
        channel?.add ?? "",
        channel?.stoplists ?? "",
      ];
      cells.forEach((value, index) => {
        const cell = doc.createElement("td");
        cell.textContent = `${value ?? ""}`;
        if (index === 0) {
          cell.classList.add("is-name");
        }
        row.append(cell);
      });
      body.append(row);
    });

    table.append(head, body);
    scroll.append(table);
    item.append(timestamp, scroll);
    entry.body.prepend(item);
    entry.logs.unshift(item);
    while (entry.logs.length > MAX_STAGE_LOG_ITEMS) {
      const tail = entry.logs.pop();
      tail?.remove();
    }
  }

  function applyUpdate(stageId, event, summary) {
    const entry = ensure(stageId);
    if (!entry) return null;
    if (entry.summaryTitle && event?.titleOverride) {
      entry.summaryTitle.textContent = event.titleOverride;
    }
    if (entry.summaryMeta) {
      const metaText = formatStageMeta(stageId, summary, event);
      entry.summaryMeta.textContent = metaText || "";
      entry.summaryMeta.hidden = !metaText;
    }
    const logText = formatStageLog(event, summary);
    if (logText) {
      addStageLog(entry, logText);
    }
    if (event?.phase === "filterStats" && Array.isArray(event.channels)) {
      addFilterTable(entry, event.channels);
    } else if (Array.isArray(event?.logEntries) && event.logEntries.length) {
      for (let i = event.logEntries.length - 1; i >= 0; i -= 1) {
        const text = event.logEntries[i];
        if (typeof text === "string" && text.trim()) {
          addStageLog(entry, text);
        }
      }
    }
    updateSummaryStatus(entry);
    return entry;
  }

  function markCompleted(stageId, isError = false) {
    const entry = stages.get(stageId);
    if (!entry || !entry.container) return;
    entry.container.classList.add(isError ? "error" : "completed");
    if (entry.details) {
      entry.details.open = false;
    }
  }

  function openStage(stageId) {
    stages.forEach((entry, id) => {
      if (!entry.details) return;
      if (id === stageId) {
        entry.details.open = true;
      } else if (isCollapsed || entry.container.classList.contains("completed")) {
        entry.details.open = false;
      }
    });
  }

  function setCollapsed(collapsedValue) {
    isCollapsed = Boolean(collapsedValue);
    stages.forEach((entry) => {
      if (!entry.details) return;
      if (isCollapsed || entry.container.classList.contains("completed")) {
        entry.details.open = false;
      }
    });
  }

  return {
    clear,
    setCollapsed,
    applyUpdate,
    markCompleted,
    openStage,
  };
}
