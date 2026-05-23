// Quick-filter builder controller. Owns quick rule state, validation, and submit flow.
import { parseTime, toTimeStr } from "../shared/format.js";
import { createQuickFilterDom } from "./dom.js";
import { applyQuickFilters } from "./apply.js";
import {
  renderSelectedPlaylists,
  renderSelectedTags,
} from "./renderers.js";

export function createQuickFilterBuilder({
  addDurationFilterToSection,
  addPlaylistFilterToSection,
  addTextFilterToSection,
  ensureFilterSection,
  filtersContainer,
  getGlobalSection,
  info,
  markUnsaved,
  showToast,
}) {
  const {
    container, titleInput, customTagInput, customTagBtn,
    selectedTagsContainer, minInput, maxInput, playlistField,
    playlistSelectedContainer, playlistStatus, playlistSelect,
    playlistAddBtn, channelBtn, globalBtn, message,
  } = createQuickFilterDom(info);

  const selectedTags = new Set();
  const titleSubscribers = new Set();
  const tagSubscribers = new Map();
  const durationSubscribers = new Set();
  const playlistSubscribers = new Map();
  const selectedPlaylists = new Set();
  const playlistOptions = new Map();
  let playlistEmptyMessage = "Плейлисты недоступны";
  const playlistPickerHint =
    "Выберите плейлист из списка и нажмите «+».";

  playlistSelect.disabled = true;
  playlistSelect.title = "Нет доступных плейлистов";
  playlistStatus.textContent = "";

  function refreshPlaylistSelectOptions() {
    const previous = playlistSelect.value;
    playlistSelect.innerHTML = "";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = playlistOptions.size
      ? "Выбрать плейлист"
      : playlistEmptyMessage;
    playlistSelect.appendChild(placeholder);
    playlistOptions.forEach((opt) => {
      if (!opt?.id) return;
      const optionEl = document.createElement("option");
      optionEl.value = opt.id;
      optionEl.textContent = opt.title || opt.id;
      optionEl.disabled = selectedPlaylists.has(opt.id);
      playlistSelect.appendChild(optionEl);
    });
    if (
      previous &&
      playlistOptions.has(previous) &&
      !selectedPlaylists.has(previous)
    ) {
      playlistSelect.value = previous;
    } else {
      playlistSelect.value = "";
    }
    playlistAddBtn.disabled =
      playlistSelect.disabled || !playlistSelect.value;
  }

  const clearMessage = () => {
    message.textContent = "";
    message.classList.remove("has-text-danger", "has-text-success");
  };

  const setMessage = (text, isError = false) => {
    message.textContent = text;
    message.classList.remove("has-text-danger", "has-text-success");
    if (text) {
      message.classList.add(
        isError ? "has-text-danger" : "has-text-success"
      );
    }
  };

  function setPlaylistSelected(
    id,
    shouldSelect,
    { silentMessage = false } = {}
  ) {
    if (!id) return { changed: false };
    const has = selectedPlaylists.has(id);
    if (shouldSelect) {
      if (has) {
        return { changed: false, reason: "exists" };
      }
      selectedPlaylists.add(id);
    } else {
      if (!has) {
        return { changed: false, reason: "missing" };
      }
      selectedPlaylists.delete(id);
    }
    if (!silentMessage) {
      clearMessage();
    }
    updateSelectedPlaylistsView();
    updateActionButtons();
    notifyPlaylistSubscribers();
    return { changed: true };
  }

  function togglePlaylist(id) {
    if (!id) return false;
    const shouldSelect = !selectedPlaylists.has(id);
    const result = setPlaylistSelected(id, shouldSelect);
    if (!result.changed && shouldSelect && result.reason === "exists") {
      setMessage("Этот плейлист уже выбран.", true);
    }
    return selectedPlaylists.has(id);
  }

  playlistSelect.addEventListener("change", () => {
    clearMessage();
    playlistAddBtn.disabled =
      playlistSelect.disabled || !playlistSelect.value;
  });

  playlistAddBtn.addEventListener("click", () => {
    if (playlistAddBtn.disabled) return;
    const id = playlistSelect.value;
    if (!id) return;
    const result = setPlaylistSelected(id, true);
    if (!result.changed && result.reason === "exists") {
      setMessage("Этот плейлист уже выбран.", true);
      return;
    }
    playlistSelect.value = "";
    playlistAddBtn.disabled = true;
  });

  const updateActionButtons = () => {
    const hasValues =
      Boolean(titleInput.value.trim()) ||
      selectedTags.size > 0 ||
      Boolean(minInput.value) ||
      Boolean(maxInput.value) ||
      selectedPlaylists.size > 0;
    globalBtn.disabled = !hasValues;
    if (info.channelId) {
      channelBtn.disabled = !hasValues;
    }
  };

  const updateSelectedTagsView = () => {
    renderSelectedTags({
      container: selectedTagsContainer,
      selectedTags,
      onRemove: (tag) => {
        selectedTags.delete(tag);
        updateSelectedTagsView();
        updateActionButtons();
        clearMessage();
        notifyTagSubscribers();
      },
    });
  };

  const updateSelectedPlaylistsView = () => {
    renderSelectedPlaylists({
      container: playlistSelectedContainer,
      playlistOptions,
      refreshPlaylistSelectOptions,
      selectedPlaylists,
      onRemove: (id) => {
        setPlaylistSelected(id, false);
      },
    });
  };

  const notifyTitleSubscribers = () => {
    const value = titleInput.value.trim();
    titleSubscribers.forEach((fn) => fn(value));
  };

  const notifyTagSubscribers = () => {
    tagSubscribers.forEach((fn, tag) => {
      fn(selectedTags.has(tag));
    });
  };

  const toSeconds = (value) => {
    if (!value) return null;
    const seconds = parseTime(value);
    return Number.isFinite(seconds) ? seconds : null;
  };

  const readDuration = () => ({
    min: toSeconds(minInput.value),
    max: toSeconds(maxInput.value),
  });

  const notifyDurationSubscribers = () => {
    const current = readDuration();
    durationSubscribers.forEach((fn) => fn(current));
  };

  const notifyPlaylistSubscribers = () => {
    playlistSubscribers.forEach((fn, id) => {
      fn(selectedPlaylists.has(id));
    });
  };

  const addCustomTag = () => {
    const value = customTagInput.value.trim();
    if (!value) return;
    selectedTags.add(value);
    customTagInput.value = "";
    updateSelectedTagsView();
    updateActionButtons();
    clearMessage();
    notifyTagSubscribers();
  };

  customTagBtn.addEventListener("click", addCustomTag);
  customTagInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addCustomTag();
    }
  });

  titleInput.addEventListener("input", () => {
    clearMessage();
    updateActionButtons();
    notifyTitleSubscribers();
  });

  minInput.addEventListener("input", () => {
    clearMessage();
    updateActionButtons();
    notifyDurationSubscribers();
  });
  maxInput.addEventListener("input", () => {
    clearMessage();
    updateActionButtons();
    notifyDurationSubscribers();
  });

  const applyFilters = (scope) =>
    applyQuickFilters({
      addDurationFilterToSection,
      addPlaylistFilterToSection,
      addTextFilterToSection,
      ensureFilterSection,
      filtersContainer,
      getGlobalSection,
      info,
      markUnsaved,
      maxInput,
      minInput,
      selectedPlaylists,
      selectedTags,
      setMessage,
      showToast,
      scope,
      titleInput,
    });

  channelBtn.addEventListener("click", () => {
    applyFilters("channel").catch((error) => {
      console.error("Failed to apply channel filters", error);
      setMessage("Не удалось добавить фильтры.", true);
    });
  });
  globalBtn.addEventListener("click", () => {
    applyFilters("global").catch((error) => {
      console.error("Failed to apply global filters", error);
      setMessage("Не удалось добавить фильтры.", true);
    });
  });

  updateSelectedTagsView();
  updateSelectedPlaylistsView();
  updateActionButtons();

  return {
    element: container,
    setTitle(value) {
      titleInput.value = value || "";
      titleInput.focus();
      clearMessage();
      updateActionButtons();
      notifyTitleSubscribers();
    },
    subscribeTitle(fn) {
      if (typeof fn !== "function") return () => {};
      titleSubscribers.add(fn);
      fn(titleInput.value.trim());
      return () => titleSubscribers.delete(fn);
    },
    toggleTag(tag) {
      if (!tag) return selectedTags.has(tag);
      if (selectedTags.has(tag)) {
        selectedTags.delete(tag);
      } else {
        selectedTags.add(tag);
      }
      updateSelectedTagsView();
      updateActionButtons();
      clearMessage();
      notifyTagSubscribers();
      return selectedTags.has(tag);
    },
    subscribeTag(tag, fn) {
      if (!tag || typeof fn !== "function") return () => {};
      tagSubscribers.set(tag, fn);
      fn(selectedTags.has(tag));
      return () => tagSubscribers.delete(tag);
    },
    setDurationFromSeconds(seconds) {
      if (!Number.isFinite(seconds)) return;
      const timeStr = toTimeStr(seconds);
      minInput.value = timeStr;
      maxInput.value = timeStr;
      clearMessage();
      updateActionButtons();
      notifyDurationSubscribers();
    },
    clearDuration() {
      minInput.value = "";
      maxInput.value = "";
      clearMessage();
      updateActionButtons();
      notifyDurationSubscribers();
    },
    subscribeDuration(fn) {
      if (typeof fn !== "function") return () => {};
      durationSubscribers.add(fn);
      fn(readDuration());
      return () => durationSubscribers.delete(fn);
    },
    setPlaylistOptions(options, emptyMessage = "Плейлисты недоступны") {
      playlistOptions.clear();
      if (Array.isArray(options) && options.length) {
        options.forEach((opt) => {
          if (!opt?.id) return;
          playlistOptions.set(opt.id, opt);
        });
      }
      if (emptyMessage) {
        playlistEmptyMessage = emptyMessage;
      }
      playlistField.style.display = "";
      const hasOptions = playlistOptions.size > 0;
      playlistStatus.textContent = hasOptions
        ? playlistPickerHint
        : playlistEmptyMessage;
      playlistSelect.disabled = !hasOptions;
      playlistSelect.title = hasOptions ? "" : playlistEmptyMessage;
      playlistSelect.value = "";
      playlistAddBtn.disabled = true;
      playlistAddBtn.title = hasOptions
        ? "Добавить выбранный плейлист"
        : playlistEmptyMessage;
      Array.from(selectedPlaylists).forEach((id) => {
        if (!playlistOptions.has(id)) {
          setPlaylistSelected(id, false, { silentMessage: true });
        }
      });
      updateSelectedPlaylistsView();
      updateActionButtons();
      notifyPlaylistSubscribers();
    },
    usePlaylist(id) {
      if (!id) return;
      if (!playlistOptions.has(id)) {
        playlistOptions.set(id, { id });
      }
      if (playlistOptions.size > 0) {
        playlistStatus.textContent = playlistPickerHint;
        playlistSelect.disabled = false;
        playlistSelect.title = "";
        playlistAddBtn.title = "Добавить выбранный плейлист";
      }
      togglePlaylist(id);
    },
    subscribePlaylist(id, fn) {
      if (!id || typeof fn !== "function") return () => {};
      playlistSubscribers.set(id, fn);
      fn(selectedPlaylists.has(id));
      return () => playlistSubscribers.delete(id);
    },
  };

}
