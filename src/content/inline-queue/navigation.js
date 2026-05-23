// Inline queue navigation helper. Sends route changes and watch-page navigation commands safely from content code.
import { isRecoverableRuntimeError } from "../core/base.js";

function getChromeRuntime() {
  if (typeof chrome === "undefined") {
    return null;
  }
  return chrome?.runtime || null;
}

function openExtensionUrl(url) {
  if (!url) {
    return;
  }
  const opened = window.open(url, "_blank", "noopener,noreferrer");
  if (!opened) {
    window.location.href = url;
  }
}

function buildRuntimeUrl(path, configure) {
  const runtime = getChromeRuntime();
  if (!runtime?.getURL) {
    return null;
  }
  try {
    const url = new URL(runtime.getURL(path));
    if (typeof configure === "function") {
      configure(url);
    }
    return url.toString();
  } catch {
    return null;
  }
}

function logRuntimeMessageError(label, err, action) {
  if (isRecoverableRuntimeError(err)) {
    return;
  }
  console.warn(`${label} message ${action}`, err);
}

function sendRuntimeMessage(message, fallback, errorLabel) {
  const runtime = getChromeRuntime();
  if (!runtime?.sendMessage) {
    fallback();
    return;
  }
  try {
    runtime.sendMessage(message, (response) => {
      const lastError = getChromeRuntime()?.lastError;
      if (lastError) {
        logRuntimeMessageError(errorLabel, lastError, "failed");
        fallback();
        return;
      }
      if (response && response.error) {
        console.warn(`${errorLabel} rejected`, response.error);
        fallback();
      }
    });
  } catch (err) {
    logRuntimeMessageError(errorLabel, err, "threw");
    fallback();
  }
}

export function openQuickFilterForVideo(videoId) {
  const normalized = typeof videoId === "string" ? videoId.trim() : "";
  if (!normalized) {
    return;
  }
  const fallback = () => {
    openExtensionUrl(
      buildRuntimeUrl("src/settings/settings.html", (url) => {
        url.searchParams.set("quickFilterVideo", normalized);
      })
    );
  };
  sendRuntimeMessage(
    { type: "options:openQuickFilter", videoId: normalized },
    fallback,
    "Quick filter"
  );
}

export function openListManager(listId, listName = "") {
  const normalizedId = typeof listId === "string" ? listId.trim() : "";
  if (!normalizedId) {
    return;
  }
  const normalizedName = typeof listName === "string" ? listName.trim() : "";
  const fallback = () => {
    openExtensionUrl(
      buildRuntimeUrl("src/popup/lists.html", (url) => {
        url.searchParams.set("listId", normalizedId);
        if (normalizedName) {
          url.searchParams.set("listName", normalizedName);
        }
      })
    );
  };
  sendRuntimeMessage(
    {
      type: "options:openListSettings",
      listId: normalizedId,
      listName: normalizedName || undefined,
    },
    fallback,
    "List settings"
  );
}
