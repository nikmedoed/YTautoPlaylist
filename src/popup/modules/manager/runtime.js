// Manager runtime helpers. Contains text extraction, button loading, URL
// opening, count cleanup, and YouTube playlist error messages.
import { parseVideoId } from "../../../utils.js";

export function normalizeCount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

export function extractVideoIdsFromText(input) {
  if (!input) {
    return [];
  }
  const chunks = String(input)
    .split(/[\s,;]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const ids = chunks
    .map((value) => parseVideoId(value))
    .filter((id) => typeof id === "string" && id.length === 11);
  return Array.from(new Set(ids));
}

export function setButtonLoading(button, loading) {
  if (!button) return;
  if (loading) {
    button.disabled = true;
    button.dataset.loading = "1";
  } else {
    button.disabled = false;
    button.removeAttribute("data-loading");
  }
}

export async function openUrlInNewTab(url) {
  if (!url) return;
  try {
    await chrome.tabs.create({ url });
  } catch (err) {
    console.warn("Failed to open tab via chrome.tabs.create", err);
    try {
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (fallbackErr) {
      console.error("Failed to open playlist URL", fallbackErr);
    }
  }
}

export function mapPlaylistCreationError(reason) {
  switch (reason) {
    case "LIST_EMPTY":
      return "Список пуст — нечего добавить в плейлист";
    case "quotaExceeded":
      return "Превышена квота YouTube API, повторите позже";
    case "rateLimitExceeded":
      return "Слишком много запросов к YouTube API, попробуйте позже";
    case "listId required":
      return "Не удалось определить список";
    default:
      if (typeof reason === "string" && reason.trim()) {
        return `Не удалось создать плейлист: ${reason}`;
      }
      return "Не удалось создать плейлист";
  }
}
