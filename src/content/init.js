function init() {
  injectStyles();
  void refreshInlinePlaylistState();
  ensurePlayerControls();
  enhanceVideoCards(document);
  updatePageActions();
  ensurePlayerControls();
  scanForVideo();
  observer.observe(document.documentElement || document.body, {
    childList: true,
    subtree: true,
  });
  setupControlInterceptors();
  window.addEventListener("yt-navigate-start", resetStateForNavigation, true);
  window.addEventListener("yt-navigate-finish", resetStateForNavigation, true);
  window.addEventListener("popstate", resetStateForNavigation);
  window.addEventListener("yt-page-data-updated", () => {
    setTimeout(() => enhanceVideoCards(document), 0);
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
