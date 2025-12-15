const settingsPath = "src/settings/settings.html";
const settingsUrl = chrome.runtime.getURL(settingsPath);

function buildQuickFilterUrl(videoId) {
  if (!videoId || typeof videoId !== "string") {
    return settingsUrl;
  }
  const normalized = videoId.trim();
  const url = new URL(settingsUrl);
  if (normalized) {
    url.searchParams.set("quickFilterVideo", normalized);
  }
  return url.toString();
}

export async function openQuickFilter(videoId) {
  if (!videoId || typeof videoId !== "string") {
    return;
  }
  const normalized = videoId.trim();
  if (!normalized) {
    return;
  }
  try {
    await chrome.runtime.sendMessage({
      type: "options:openQuickFilter",
      videoId: normalized,
    });
    return;
  } catch (err) {
    console.warn("Failed to open quick filter via background", err);
  }

  const url = buildQuickFilterUrl(normalized);
  try {
    if (chrome?.tabs?.create) {
      await chrome.tabs.create({ url });
      return;
    }
  } catch (err) {
    console.warn("Failed to open quick filter tab", err);
  }
  try {
    window.open(url, "_blank", "noopener,noreferrer");
  } catch (err) {
    console.error("Failed to open quick filter window", err);
  }
}
