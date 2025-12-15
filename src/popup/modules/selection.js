function normalizeVideos(videos) {
  if (!Array.isArray(videos)) return [];
  return videos.filter((video) => video && typeof video.id === "string");
}

export function createSelectionController({
  detailList,
  bulkMoveBtn,
  bulkDeleteBtn,
  floatingActions = null,
  queueSection = null,
}) {
  const state = {
    selected: new Set(),
    lastIndex: null,
    videos: [],
  };

  const getVideoByIndex = (index) => {
    if (!Number.isFinite(index) || index < 0 || index >= state.videos.length) {
      return null;
    }
    return state.videos[index] || null;
  };

  const getVideoIndex = (videoId) => {
    if (!videoId) return -1;
    return state.videos.findIndex((video) => video.id === videoId);
  };

  const updateBulkButton = (button, count, texts = null) => {
    if (!button) return;
    button.disabled = count === 0;
    if (!Array.isArray(texts) || texts.length === 0) return;
    const [singleText, pluralText] = texts;
    button.textContent = count > 1 ? pluralText.replace("${count}", String(count)) : singleText;
  };

  const updateSelectionUI = () => {
    const count = state.selected.size;
    if (detailList) {
      detailList.querySelectorAll(".manage-list-row").forEach((row) => {
        const videoId = row.dataset.id;
        const selected = videoId ? state.selected.has(videoId) : false;
        row.classList.toggle("selected", selected);
        const checkbox = row.querySelector('input[type="checkbox"]');
        if (checkbox) {
          checkbox.checked = selected;
        }
      });
    }
    updateBulkButton(bulkMoveBtn, count);
    updateBulkButton(bulkDeleteBtn, count);
    if (floatingActions) {
      floatingActions.hidden = count === 0;
      if (!floatingActions.hidden) {
        floatingActions.dataset.count = `Выбрано: ${count}`;
      } else {
        delete floatingActions.dataset.count;
      }
    }
    if (queueSection) {
      queueSection.classList.toggle("queue--floating-actions", count > 0);
    }
  };

  const setVideos = (videos) => {
    state.videos = normalizeVideos(videos);
    const availableIds = new Set(state.videos.map((video) => video.id));
    state.selected = new Set(
      Array.from(state.selected).filter((id) => availableIds.has(id)),
    );
    if (state.lastIndex != null) {
      if (state.lastIndex < 0 || state.lastIndex >= state.videos.length) {
        state.lastIndex = null;
      }
    }
    updateSelectionUI();
  };

  const clear = () => {
    state.selected.clear();
    state.lastIndex = null;
    updateSelectionUI();
  };

  const selectAll = () => {
    state.selected = new Set(state.videos.map((video) => video.id));
    state.lastIndex = state.videos.length > 0 ? state.videos.length - 1 : null;
    updateSelectionUI();
  };

  const toggle = (videoId, rawIndex, shouldSelect, useShift) => {
    if (!videoId) return;
    const normalizedIndex = Number.isFinite(rawIndex) && rawIndex >= 0
      ? rawIndex
      : getVideoIndex(videoId);
    if (useShift && state.lastIndex != null && normalizedIndex >= 0) {
      const start = Math.min(normalizedIndex, state.lastIndex);
      const end = Math.max(normalizedIndex, state.lastIndex);
      for (let index = start; index <= end; index += 1) {
        const video = getVideoByIndex(index);
        if (!video) continue;
        if (shouldSelect) {
          state.selected.add(video.id);
        } else {
          state.selected.delete(video.id);
        }
      }
    } else if (shouldSelect) {
      state.selected.add(videoId);
    } else {
      state.selected.delete(videoId);
    }
    state.lastIndex = normalizedIndex >= 0 ? normalizedIndex : state.lastIndex;
    updateSelectionUI();
  };

  const getSelectedIds = () => Array.from(state.selected);

  const getSelectedCount = () => state.selected.size;

  const getLastIndex = () => state.lastIndex;

  return {
    setVideos,
    updateUI: updateSelectionUI,
    clear,
    selectAll,
    toggle,
    getSelectedIds,
    getSelectedCount,
    getVideoByIndex,
    getLastIndex,
  };
}
