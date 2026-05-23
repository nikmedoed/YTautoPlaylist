// Tab resolution helpers for playback. Contains checks for existing tabs and preferred-tab selection.
export async function ensureTab(tabId) {
  if (typeof tabId !== "number" || !Number.isInteger(tabId)) return null;
  try {
    return await chrome.tabs.get(tabId);
  } catch {
    return null;
  }
}

export async function resolvePreferredTab(preferredIds = []) {
  for (const id of preferredIds) {
    const tab = await ensureTab(id);
    if (tab) return tab;
  }
  return null;
}
