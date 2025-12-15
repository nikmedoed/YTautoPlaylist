import { getStageTitle, resolveStageId } from "./collection/constants.js";
import { createCollectionSummary } from "./collection/summary.js";
import { createStageLogManager } from "./collection/stageLogManager.js";
import { getStatusInfo } from "./collection/formatters.js";

export function createCollectionController({
  progressEl,
  stageTextEl,
  countersEl,
  logEl,
  titleEl,
  setStatus = () => {},
} = {}) {
  const summary = createCollectionSummary();
  const stageLog = createStageLogManager({ logEl, collapsed: true });

  const headerTitleEl =
    titleEl || progressEl?.querySelector?.(".collection-info h4") || null;
  const baseTitle =
    (headerTitleEl?.textContent || "").trim() || "Сбор подписок";

  const state = {
    active: false,
    currentStage: null,
    hasHistory: false,
  };

  function renderCounters() {
    if (!countersEl) {
      return;
    }
    const metrics = summary.getMetrics();
    const doc = countersEl.ownerDocument || document;
    countersEl.textContent = "";
    countersEl.classList.add("collection-metrics");
    if (!metrics.length) {
      return;
    }
    for (const metric of metrics) {
      const item = doc.createElement("div");
      item.className = "collection-metric";
      if (metric?.id) {
        item.dataset.metricId = metric.id;
      }
      if (metric?.status === "complete") {
        item.classList.add("is-complete");
      }
      const header = doc.createElement("div");
      header.className = "collection-metric__header";
      const label = doc.createElement("span");
      label.className = "collection-metric__label";
      label.textContent = metric?.label || "";
      const value = doc.createElement("span");
      value.className = "collection-metric__value";
      value.textContent = metric?.text || "";
      header.append(label, value);
      item.append(header);

      const bar = doc.createElement("div");
      bar.className = "collection-metric__bar";
      const fill = doc.createElement("div");
      fill.className = "collection-metric__fill";
      const total = Number(metric?.total);
      const current = Number(metric?.value);
      let ratio = 0;
      if (Number.isFinite(total) && total > 0) {
        const safeValue = Number.isFinite(current) ? current : 0;
        ratio = Math.max(0, Math.min(1, safeValue / total));
      } else if (Number.isFinite(current) && current > 0) {
        ratio = 1;
      }
      const width = `${(ratio * 100).toFixed(1)}%`;
      fill.style.width = width;
      if (ratio > 0 && ratio < 0.04) {
        fill.style.minWidth = "3%";
      }
      bar.append(fill);
      item.append(bar);

      if (metric?.caption) {
        const caption = doc.createElement("div");
        caption.className = "collection-metric__caption";
        caption.textContent = metric.caption;
        item.append(caption);
      }

      if (Array.isArray(metric?.details) && metric.details.length) {
        const details = doc.createElement("div");
        details.className = "collection-metric__details";
        for (const detail of metric.details) {
          if (!detail?.label) continue;
          const detailItem = doc.createElement("span");
          detailItem.className = "collection-metric__detail";
          const detailLabel = doc.createElement("span");
          detailLabel.className = "collection-metric__detail-label";
          detailLabel.textContent = detail.label;
          const detailValue = doc.createElement("span");
          detailValue.className = "collection-metric__detail-value";
          detailValue.textContent = detail?.text || String(detail?.value ?? "");
          detailItem.append(detailLabel, detailValue);
          details.append(detailItem);
        }
        if (details.childNodes.length) {
          item.append(details);
        }
      }

      countersEl.append(item);
    }
  }

  function resetView(startDate) {
    state.currentStage = null;
    summary.reset(startDate);
    stageLog.clear();
    if (progressEl) {
      progressEl.classList.remove("finished", "error");
    }
    if (stageTextEl) {
      stageTextEl.textContent = "";
      stageTextEl.hidden = true;
    }
    if (headerTitleEl) {
      headerTitleEl.textContent = baseTitle;
    }
    renderCounters();
  }

  function hidePanel({ clear = false } = {}) {
    if (!progressEl) return;
    if (clear) {
      resetView();
      state.hasHistory = false;
    }
    progressEl.hidden = true;
    progressEl.classList.add("is-hidden");
  }

  function showPanel() {
    if (!progressEl) return;
    progressEl.hidden = false;
    progressEl.classList.remove("is-hidden");
  }

  function updateHeader(stageId) {
    const stageTitle = getStageTitle(stageId);
    if (headerTitleEl) {
      headerTitleEl.textContent = stageTitle
        ? `${baseTitle} – ${stageTitle}`
        : baseTitle;
    }
    if (stageTextEl) {
      stageTextEl.textContent = "";
      stageTextEl.hidden = true;
    }
    renderCounters();
  }

  function beginProgress(event) {
    state.active = true;
    state.hasHistory = true;
    resetView(event?.startDate);
    showPanel();
  }

  function ensureVisible() {
    if (!progressEl) return;
    if (!progressEl.hidden) return;
    if (!state.hasHistory && !state.active) return;
    showPanel();
  }

  function handleEvent(event) {
    if (!event?.phase) return null;
    const stageId = resolveStageId(event);
    if (!stageId) return null;

    if (event.phase === "start") {
      beginProgress(event);
    } else {
      state.hasHistory = true;
      ensureVisible();
      if (progressEl) {
        progressEl.classList.remove("finished", "error");
      }
    }

    summary.update(event);

    if (state.currentStage && state.currentStage !== stageId) {
      stageLog.markCompleted(state.currentStage);
    }

    const entry = stageLog.applyUpdate(stageId, event, summary.data);
    state.currentStage = stageId;

    if (event.phase === "complete") {
      stageLog.markCompleted(stageId);
      if (progressEl) {
        progressEl.classList.add("finished");
      }
      state.active = false;
    } else if (event.phase === "error") {
      stageLog.markCompleted(stageId, true);
      if (progressEl) {
        progressEl.classList.add("error");
      }
      state.active = false;
    } else if (entry) {
      stageLog.openStage(stageId);
    }

    updateHeader(stageId);

    const statusInfo = getStatusInfo(event, summary.data);
    if (statusInfo) {
      setStatus(statusInfo.text, statusInfo.kind, statusInfo.timeout);
    }

    return event.phase;
  }

  hidePanel({ clear: true });

  return {
    handleEvent,
    hidePanel,
    showPanel,
    showIfHasHistory: () => {
      if (state.hasHistory || state.active) {
        showPanel();
      }
    },
    clear: () => hidePanel({ clear: true }),
    isActive: () => state.active,
    hasHistory: () => state.hasHistory,
  };
}
