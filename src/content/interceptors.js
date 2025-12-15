function setupControlInterceptors() {
  document.addEventListener(
    "click",
    (event) => {
      if (!canHandlePlaybackActions()) return;
      const path = event.composedPath();
      const hasNext = path.some(
        (node) => node?.classList && node.classList.contains("ytp-next-button")
      );
      const hasPrev = path.some(
        (node) => node?.classList && node.classList.contains("ytp-prev-button")
      );
      if (hasNext) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        requestNext();
      } else if (hasPrev) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        requestPrevious();
      }
    },
    true
  );

  document.addEventListener(
    "keydown",
    (event) => {
      const code = event.code;
      const key = event.key;
      const isMediaNext =
        code === "MediaTrackNext" || key === "MediaTrackNext";
      const isMediaPrevious =
        code === "MediaTrackPrevious" || key === "MediaTrackPrevious";
      if (isMediaNext || isMediaPrevious) {
        if (!canHandlePlaybackActions()) return;
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        if (isMediaNext) {
          requestNext();
        } else {
          requestPrevious();
        }
        return;
      }
      if (!canHandlePlaybackActions()) return;
      if (event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
        const lower = (event.key || "").toLowerCase();
        if (lower === "n") {
          event.preventDefault();
          requestNext();
        } else if (lower === "p") {
          event.preventDefault();
          requestPrevious();
        }
      }
    },
    true
  );
}
