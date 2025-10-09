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
  const [activeTab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });
  return activeTab || null;
}
