const DEFAULT_TIMEOUT = 5000;

function ensureAccessibility(statusBox, statusText) {
  if (!statusBox || !statusText) return;
  statusBox.hidden = true;
  statusBox.dataset.visible = "0";
  statusText.textContent = "";
  if (!statusBox.hasAttribute("role")) {
    statusBox.setAttribute("role", "status");
  }
  statusBox.setAttribute("aria-live", "polite");
  statusBox.setAttribute("aria-atomic", "true");
}

function applyStatusProgress(progressEl, progressBarEl, progress) {
  if (!progressEl || !progressBarEl) return;
  if (!progress) {
    progressEl.hidden = true;
    progressEl.removeAttribute("data-indeterminate");
    progressBarEl.style.width = "0%";
    progressBarEl.style.transform = "translateX(0)";
    return;
  }
  if (progress.indeterminate || !progress.total) {
    progressEl.dataset.indeterminate = "1";
    progressBarEl.style.width = "40%";
    progressBarEl.style.transform = "";
  } else {
    progressEl.removeAttribute("data-indeterminate");
    const total = Number(progress.total);
    const added = Number(progress.added);
    if (
      Number.isFinite(total) &&
      total > 0 &&
      Number.isFinite(added) &&
      added >= 0
    ) {
      const ratio = Math.max(0, Math.min(1, added / total));
      progressBarEl.style.width = `${(ratio * 100).toFixed(2)}%`;
    } else {
      progressBarEl.style.width = "0%";
    }
    progressBarEl.style.transform = "translateX(0)";
  }
  progressEl.hidden = false;
}

export function createStatusController({
  statusBox,
  statusText,
  progressEl = null,
  progressBarEl = null,
}) {
  if (!statusBox || !statusText) {
    return {
      setStatus() {},
      hideStatus() {},
    };
  }

  let timeoutHandle = null;
  let hideTimer = null;

  const clearTimers = () => {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
      timeoutHandle = null;
    }
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
  };

  const finalizeHide = () => {
    hideTimer = null;
    applyStatusProgress(progressEl, progressBarEl, null);
    statusBox.hidden = true;
    statusBox.removeAttribute("data-kind");
    statusText.textContent = "";
  };

  const hideStatus = (immediate = false) => {
    clearTimeout(hideTimer);
    statusBox.dataset.visible = "0";
    if (immediate) {
      finalizeHide();
      return;
    }
    hideTimer = window.setTimeout(() => {
      if (statusBox.dataset.visible !== "1") {
        finalizeHide();
      }
    }, 220);
  };

  const setStatus = (text, kind = "info", timeout = DEFAULT_TIMEOUT, options = {}) => {
    if (!text) {
      hideStatus(true);
      return;
    }
    clearTimeout(hideTimer);
    statusText.textContent = text;
    statusBox.dataset.kind = kind;
    statusBox.hidden = false;
    applyStatusProgress(progressEl, progressBarEl, options?.progress ?? null);
    void statusBox.offsetWidth;
    statusBox.dataset.visible = "1";
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
    if (timeout && timeout > 0) {
      timeoutHandle = window.setTimeout(() => {
        hideStatus();
      }, timeout);
    } else {
      timeoutHandle = null;
    }
  };

  ensureAccessibility(statusBox, statusText);
  if (progressEl) {
    progressEl.hidden = true;
  }

  statusBox.addEventListener("click", () => {
    hideStatus(true);
  });

  return { setStatus, hideStatus };
}
