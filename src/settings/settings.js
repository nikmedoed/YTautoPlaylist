import { parseVideoId } from "../utils.js";
import { parseDuration } from "../time.js";
import { getFilters, saveFilters, getFiltersLastSaved } from "../filter.js";


import {
  getChannelMap,
  listChannelPlaylists,
  isVideoInPlaylist,
} from "../youTubeApiConnectors.js";

function toTimeStr(sec) {
  if (sec === undefined || sec === null || sec === Infinity) return "";
  const h = Math.floor(sec / 3600)
    .toString()
    .padStart(2, "0");
  const m = Math.floor((sec % 3600) / 60)
    .toString()
    .padStart(2, "0");
  const s = Math.floor(sec % 60)
    .toString()
    .padStart(2, "0");
  return `${h}:${m}:${s}`;
}

function parseTime(str) {
  if (!str) return 0;
  const parts = str.split(":").map((p) => parseInt(p, 10));
  if (parts.some((n) => Number.isNaN(n))) return 0;
  let sec = 0;
  if (parts.length === 3) sec = parts[0] * 3600 + parts[1] * 60 + parts[2];
  else if (parts.length === 2) sec = parts[0] * 60 + parts[1];
  else if (parts.length === 1) sec = parts[0];
  return sec;
}

function toLocalInputValue(date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "";
  return date.toLocaleString("ru");
}

function isShortVideo(info) {
  if (!info) return false;
  if (typeof info.duration === "string") {
    const sec = parseDuration(info.duration);
    if (typeof sec === "number" && sec > 0 && sec < 60) {
      return true;
    }
  }
  if (Array.isArray(info.tags) && info.tags.some((tag) => /shorts?/i.test(tag))) {
    return true;
  }
  if (typeof info.title === "string") {
    return info.title.toLowerCase().includes("#short");
  }
  return false;
}

const durTemplate = document.getElementById("durationRowTemplate");
function createDurationRow(min = 0, max = Infinity) {
  const row = durTemplate.content.firstElementChild.cloneNode(true);
  if (min) row.querySelector(".from").value = toTimeStr(min);
  if (max !== Infinity) row.querySelector(".to").value = toTimeStr(max);
  return row;
}

const textTemplate = document.getElementById("textRowTemplate");
function createTextRow(type, value = "") {
  const row = textTemplate.content.firstElementChild.cloneNode(true);
  row.dataset.type = type;
  row.querySelector("input").value = value;
  return row;
}

const playlistTemplate = document.getElementById("playlistRowTemplate");
const playlistCache = {};
const playlistMembershipCache = new Map();
async function createPlaylistRow(channelId, value = "") {
  const row = playlistTemplate.content.firstElementChild.cloneNode(true);
  const select = row.querySelector("select");
  if (!playlistCache[channelId]) {
    playlistCache[channelId] = await listChannelPlaylists(channelId);
  }
  playlistCache[channelId].forEach((pl) => {
    const opt = document.createElement("option");
    opt.value = pl.id;
    opt.textContent = pl.title;
    select.appendChild(opt);
  });
  select.value = value;
  return row;
}

async function getChannelPlaylists(channelId) {
  if (!channelId) return [];
  if (!playlistCache[channelId]) {
    playlistCache[channelId] = await listChannelPlaylists(channelId);
  }
  return Array.isArray(playlistCache[channelId]) ? playlistCache[channelId] : [];
}

async function findVideoPlaylists(channelId, videoId) {
  if (!channelId || !videoId) return [];
  const key = `${channelId}:${videoId}`;
  if (playlistMembershipCache.has(key)) {
    return playlistMembershipCache.get(key);
  }
  const playlists = await getChannelPlaylists(channelId);
  const result = [];
  for (const playlist of playlists) {
    try {
      if (await isVideoInPlaylist(videoId, playlist.id)) {
        result.push(playlist);
      }
    } catch (err) {
      console.error(
        "Failed to check playlist membership",
        playlist.id,
        videoId,
        err
      );
    }
  }
  playlistMembershipCache.set(key, result);
  return result;
}

const groupTemplate = document.getElementById("filterGroupTemplate");
const cardTemplate = document.getElementById("filterCardTemplate");
let onFiltersChanged = null;
function createGroup(labelText, type, rows, createRowFn) {
  const group = groupTemplate.content.firstElementChild.cloneNode(true);
  group.dataset.type = type;

  const header = group.querySelector(".group-header");
  const lab = header.querySelector("span");
  const addBtn = header.querySelector(".add-row");
  const list = group.querySelector(".rows-wrap");
  lab.textContent = labelText;

  function checkHeader() {
    const hasRows = list.children.length > 0;
    header.style.display = hasRows ? "" : "none";
    group.style.display = hasRows ? "" : "none";
  }

  async function addRow(r, silent = false) {
    const node = await createRowFn(r);
    list.appendChild(node);
    checkHeader();
    if (!silent) onFiltersChanged?.();
  }

  addBtn.addEventListener("click", () => {
    addRow();
  });

  rows.forEach((r) => {
    addRow(r, true);
  });
  list.addEventListener("click", (e) => {
    if (e.target.closest(".remove-row")) {
      e.target.closest(".filter-row").remove();
      checkHeader();
      onFiltersChanged?.();
    }
  });

  checkHeader();
  group.__addRowWithData = addRow;
  return {
    group,
    list,
    add: () => {
      addBtn.click();
    },
  };
}

let toastTimer = null;
function showToast(text, isError = false) {
  const toast = document.getElementById("saveToast");
  if (!toast) return;
  toast.textContent = text;
  toast.className = `notification ${isError ? "is-danger" : "is-success"} is-light`;
  toast.style.display = "";
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.style.display = "none";
    toastTimer = null;
  }, 3000);
}


document.addEventListener("DOMContentLoaded", async () => {
  const startInput = document.getElementById("startDate");
  const saveBtn = document.getElementById("saveStartDate");
  const videoInput = document.getElementById("videoId");
  const useBtn = document.getElementById("useVideoId");
  const checkVideoInput = document.getElementById("checkVideoInput");
  const checkVideoBtn = document.getElementById("checkVideoBtn");
  const checkVideoResult = document.getElementById("checkVideoResult");
  const filtersContainer = document.getElementById("filtersContainer");
  const globalContainer = document.getElementById("globalFilters");
  const saveFiltersBtn = document.getElementById("saveFilters");
  const lastSaveInfo = document.getElementById("lastSave");
  const exportBtn = document.getElementById("exportFilters");
  const importInput = document.getElementById("importFilters");
  const addChannelSelect = document.getElementById("addChannelSelect");
  const addChannelBtn = document.getElementById("addChannel");
  const addCard = document.getElementById("addChannelCard");
  const floatingSaveBtn = document.getElementById("floatingSave");

  const saveButtons = [saveFiltersBtn, floatingSaveBtn].filter(Boolean);

  let globalSec;
  let globalShortsChk;
  let globalBroadcastChk;
  let channels = {};
  let hasUnsavedChanges = false;
  let isSaving = false;
  let pendingChangesDuringSave = false;

  function updateSaveButtons() {
    const shouldHide = !hasUnsavedChanges;
    saveButtons.forEach((btn) => {
      if (!btn) return;
      btn.classList.toggle("is-hidden", shouldHide);
      btn.disabled = shouldHide || isSaving;
      btn.classList.toggle("is-loading", isSaving);
    });
  }

  function setUnsavedChanges(value) {
    if (!value) {
      pendingChangesDuringSave = false;
    }
    if (hasUnsavedChanges === value) return;
    hasUnsavedChanges = value;
    updateSaveButtons();
  }

  function markUnsaved() {
    if (isSaving) {
      pendingChangesDuringSave = true;
    }
    if (!hasUnsavedChanges) {
      setUnsavedChanges(true);
    }
  }

  function updateLastSaveDisplay() {
    const savedTime = getFiltersLastSaved();
    const text = savedTime
      ? `Последнее сохранение: ${savedTime.toLocaleString()}`
      : "Изменения ещё не сохранялись";
    if (lastSaveInfo) {
      lastSaveInfo.textContent = text;
    }
  }

  onFiltersChanged = markUnsaved;

  [globalContainer, filtersContainer].forEach((target) => {
    target?.addEventListener("input", markUnsaved, true);
    target?.addEventListener("change", markUnsaved, true);
  });
  updateSaveButtons();

  chrome.runtime.sendMessage({ type: "subscriptions:getMeta" }, (res) => {
    const ts = Number(res?.meta?.lastRunAt) || 0;
    if (ts > 0) {
      const d = new Date(ts);
      if (!Number.isNaN(d.getTime())) {
        startInput.value = toLocalInputValue(d);
      }
    }
  });

  saveBtn?.addEventListener("click", () => {
    const val = startInput.value;
    const dt = new Date(val);
    if (String(dt) !== "Invalid Date") {
      chrome.runtime.sendMessage(
        { type: "setStartDate", date: dt.toISOString() },
        (res) => {
          if (res && res.ok) {
            startInput.value = toLocalInputValue(dt);
          }
        }
      );
    }
  });

  useBtn?.addEventListener("click", () => {
    const id = parseVideoId(videoInput.value);
    if (!id) return;
    chrome.runtime.sendMessage(
      { type: "videoDate", videoId: id },
      (response) => {
        if (response && response.date) {
          const d = new Date(response.date);
          startInput.value = toLocalInputValue(d);
        }
      }
    );
  });

  const hideCheckVideoResult = () => {
    if (!checkVideoResult) return;
    checkVideoResult.innerHTML = "";
    checkVideoResult.classList.add("is-hidden");
  };

  const showCheckVideoResult = () => {
    if (!checkVideoResult) return;
    checkVideoResult.classList.remove("is-hidden");
  };

  hideCheckVideoResult();

  checkVideoBtn?.addEventListener("click", async () => {
    const id = parseVideoId(checkVideoInput.value);
    if (!id) {
      hideCheckVideoResult();
      return;
    }
    checkVideoResult.textContent = "Loading...";
    showCheckVideoResult();
    chrome.runtime.sendMessage({ type: "videoInfo", videoId: id }, async (resp) => {
      checkVideoResult.innerHTML = "";
      showCheckVideoResult();
      if (resp && resp.info) {
        const info = resp.info;
        const reason = resp.filterReason;
        const filters = await getFilters();
        const chFilters = {
          ...(filters.global || {}),
          ...(filters.channels[info.channelId] || {}),
        };

        const tags = Array.isArray(info.tags) ? info.tags.filter(Boolean) : [];
        let durationSeconds = null;
        if (typeof info.duration === "string") {
          const parsedDuration = parseDuration(info.duration);
          if (Number.isFinite(parsedDuration) && parsedDuration > 0) {
            durationSeconds = parsedDuration;
          }
        } else if (
          typeof info.duration === "number" &&
          Number.isFinite(info.duration) &&
          info.duration > 0
        ) {
          durationSeconds = info.duration;
        }

        const quickFilter = (() => {
          const container = document.createElement("div");
          container.className = "quick-filter-controls";

          const heading = document.createElement("h4");
          heading.className = "title is-5";
          heading.textContent = "Создать фильтр";
          container.appendChild(heading);

          const lead = document.createElement("p");
          lead.className = "mb-3";
          lead.textContent =
            "Выберите данные выше или заполните поля вручную, затем создайте фильтр и сохраните изменения.";
          container.appendChild(lead);

          const titleField = document.createElement("div");
          titleField.className = "field";
          const titleLabel = document.createElement("label");
          titleLabel.className = "label";
          titleLabel.textContent = "Название";
          titleField.appendChild(titleLabel);
          const titleControl = document.createElement("div");
          titleControl.className = "control";
          const titleInput = document.createElement("input");
          titleInput.type = "text";
          titleInput.className = "input";
          titleInput.placeholder = "Подстрока в названии";
          titleControl.appendChild(titleInput);
          titleField.appendChild(titleControl);
          container.appendChild(titleField);

          const tagsField = document.createElement("div");
          tagsField.className = "field";
          const tagsLabel = document.createElement("label");
          tagsLabel.className = "label";
          tagsLabel.textContent = "Теги";
          tagsField.appendChild(tagsLabel);

          const tagsControl = document.createElement("div");
          tagsControl.className = "field has-addons mt-2";
          const tagInputControl = document.createElement("div");
          tagInputControl.className = "control";
          const customTagInput = document.createElement("input");
          customTagInput.type = "text";
          customTagInput.className = "input quick-filter-tag-input";
          customTagInput.placeholder = "Добавить тег";
          tagInputControl.appendChild(customTagInput);
          tagsControl.appendChild(tagInputControl);
          const tagBtnControl = document.createElement("div");
          tagBtnControl.className = "control";
          const customTagBtn = document.createElement("button");
          customTagBtn.type = "button";
          customTagBtn.className = "button is-light quick-filter-tag-add";
          customTagBtn.textContent = "Добавить";
          tagBtnControl.appendChild(customTagBtn);
          tagsControl.appendChild(tagBtnControl);
          tagsField.appendChild(tagsControl);

          const selectedTagsContainer = document.createElement("div");
          selectedTagsContainer.className = "quick-filter-selected-tags";
          tagsField.appendChild(selectedTagsContainer);
          container.appendChild(tagsField);

          const durationField = document.createElement("div");
          durationField.className = "field";
          const durationLabel = document.createElement("label");
          durationLabel.className = "label";
          durationLabel.textContent = "Длительность";
          durationField.appendChild(durationLabel);

          const durationInputs = document.createElement("div");
          durationInputs.className = "field has-addons";
          const minControl = document.createElement("div");
          minControl.className = "control";
          const minInput = document.createElement("input");
          minInput.type = "time";
          minInput.className = "input from";
          minInput.placeholder = "От";
          minControl.appendChild(minInput);
          durationInputs.appendChild(minControl);
          const dashControl = document.createElement("div");
          dashControl.className = "control";
          const dash = document.createElement("span");
          dash.className = "button is-static";
          dash.textContent = "—";
          dashControl.appendChild(dash);
          durationInputs.appendChild(dashControl);
          const maxControl = document.createElement("div");
          maxControl.className = "control";
          const maxInput = document.createElement("input");
          maxInput.type = "time";
          maxInput.className = "input to";
          maxInput.placeholder = "До";
          maxControl.appendChild(maxInput);
          durationInputs.appendChild(maxControl);
          durationField.appendChild(durationInputs);
          container.appendChild(durationField);

          const playlistField = document.createElement("div");
          playlistField.className = "field";
          const playlistLabel = document.createElement("label");
          playlistLabel.className = "label";
          playlistLabel.textContent = "Плейлисты канала";
          playlistField.appendChild(playlistLabel);

          const playlistSelectedContainer = document.createElement("div");
          playlistSelectedContainer.className =
            "quick-filter-selected-playlists";
          playlistField.appendChild(playlistSelectedContainer);

          const playlistStatus = document.createElement("p");
          playlistStatus.className = "help quick-filter-playlist-status";
          playlistField.appendChild(playlistStatus);

          const playlistPicker = document.createElement("div");
          playlistPicker.className =
            "field has-addons quick-filter-playlist-picker";
          const playlistSelectControl = document.createElement("div");
          playlistSelectControl.className = "control is-expanded";
          const playlistSelectWrapper = document.createElement("div");
          playlistSelectWrapper.className = "select is-fullwidth";
          const playlistSelect = document.createElement("select");
          playlistSelectWrapper.appendChild(playlistSelect);
          playlistSelectControl.appendChild(playlistSelectWrapper);
          playlistPicker.appendChild(playlistSelectControl);

          const playlistAddControl = document.createElement("div");
          playlistAddControl.className = "control";
          const playlistAddBtn = document.createElement("button");
          playlistAddBtn.type = "button";
          playlistAddBtn.className =
            "button is-info is-light quick-filter-playlist-add";
          playlistAddBtn.disabled = true;
          playlistAddBtn.title = "Нет доступных плейлистов";
          playlistAddBtn.setAttribute("aria-label", "Добавить плейлист");
          playlistAddBtn.innerHTML =
            '<span class="icon"><svg width="1.25em" height="1.25em"><use href="icons.svg#icon-plus"></use></svg></span>';
          playlistAddControl.appendChild(playlistAddBtn);
          playlistPicker.appendChild(playlistAddControl);

          playlistField.appendChild(playlistPicker);

          playlistField.style.display = "none";
          container.appendChild(playlistField);

          const actions = document.createElement("div");
          actions.className = "quick-filter-actions";
          const channelBtn = document.createElement("button");
          channelBtn.type = "button";
          channelBtn.className = "button is-link";
          channelBtn.textContent = "Создать для канала";
          if (!info.channelId) {
            channelBtn.disabled = true;
            channelBtn.title = "Нет ID канала";
          }
          const globalBtn = document.createElement("button");
          globalBtn.type = "button";
          globalBtn.className = "button is-link is-light";
          globalBtn.textContent = "Создать глобально";
          actions.appendChild(channelBtn);
          actions.appendChild(globalBtn);
          container.appendChild(actions);

          const message = document.createElement("p");
          message.className = "quick-filter-message";
          container.appendChild(message);

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
            selectedTagsContainer.innerHTML = "";
            if (!selectedTags.size) {
              const empty = document.createElement("p");
              empty.className = "quick-filter-empty";
              empty.textContent = "Теги не выбраны";
              selectedTagsContainer.appendChild(empty);
              return;
            }
            selectedTags.forEach((tag) => {
              const tagEl = document.createElement("span");
              tagEl.className = "tag is-info is-light";
              tagEl.appendChild(document.createTextNode(tag));
              const removeBtn = document.createElement("button");
              removeBtn.type = "button";
              removeBtn.className = "delete is-small";
              removeBtn.setAttribute("aria-label", `Удалить тег ${tag}`);
              removeBtn.addEventListener("click", () => {
                selectedTags.delete(tag);
                updateSelectedTagsView();
                updateActionButtons();
                clearMessage();
                notifyTagSubscribers();
              });
              tagEl.appendChild(removeBtn);
              selectedTagsContainer.appendChild(tagEl);
            });
          };

          const updateSelectedPlaylistsView = () => {
            playlistSelectedContainer.innerHTML = "";
            if (!selectedPlaylists.size) {
              const empty = document.createElement("p");
              empty.className = "quick-filter-empty";
              empty.textContent = "Плейлисты не выбраны";
              playlistSelectedContainer.appendChild(empty);
              refreshPlaylistSelectOptions();
              return;
            }
            selectedPlaylists.forEach((id) => {
              const playlistInfo = playlistOptions.get(id) || { id };
              const card = document.createElement("div");
              card.className = "quick-filter-playlist-card";
              const link = document.createElement("a");
              link.className = "quick-filter-playlist-link";
              link.textContent = playlistInfo.title || playlistInfo.id || id;
              link.href = `https://www.youtube.com/playlist?list=${id}`;
              link.target = "_blank";
              link.rel = "noopener noreferrer";
              card.appendChild(link);
              const removeBtn = document.createElement("button");
              removeBtn.type = "button";
              removeBtn.className =
                "button is-light quick-filter-playlist-remove";
              removeBtn.title = "Удалить плейлист из фильтра";
              removeBtn.setAttribute(
                "aria-label",
                `Удалить плейлист ${playlistInfo.title || id}`
              );
              removeBtn.innerHTML =
                '<span class="icon"><svg width="1.25em" height="1.25em"><use href="icons.svg#icon-x"></use></svg></span>';
              removeBtn.addEventListener("click", () => {
                setPlaylistSelected(id, false);
              });
              card.appendChild(removeBtn);
              playlistSelectedContainer.appendChild(card);
            });
            refreshPlaylistSelectOptions();
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

          const applyFilters = async (scope) => {
            const titleValue = titleInput.value.trim();
            const tagsValues = Array.from(selectedTags);
            const minValue = minInput.value;
            const maxValue = maxInput.value;
            if (
              !titleValue &&
              !tagsValues.length &&
              !minValue &&
              !maxValue &&
              !selectedPlaylists.size
            ) {
              setMessage("Добавьте значение фильтра перед созданием.", true);
              return;
            }
            let targetSection =
              scope === "channel"
                ? filtersContainer?.querySelector(
                    `.filter-card[data-channel="${info.channelId}"]`
                  )
                : globalSec;
            if (!targetSection) {
              targetSection = ensureFilterSection(
                scope === "channel" ? info.channelId : null,
                info.channelTitle || info.channelId
              );
            }
            if (!targetSection) {
              setMessage("Не удалось найти раздел для добавления фильтра.", true);
              return;
            }
            let added = 0;
            if (titleValue) {
              if (await addTextFilterToSection(targetSection, "title", titleValue)) {
                added += 1;
              }
            }
            for (const tag of tagsValues) {
              if (await addTextFilterToSection(targetSection, "tag", tag)) {
                added += 1;
              }
            }
            if (minValue || maxValue) {
              const minSeconds = minValue ? parseTime(minValue) : null;
              const maxSeconds = maxValue ? parseTime(maxValue) : null;
              if (
                await addDurationFilterToSection(
                  targetSection,
                  minSeconds,
                  maxSeconds
                )
              ) {
                added += 1;
              }
            }
            if (selectedPlaylists.size) {
              for (const playlistId of Array.from(selectedPlaylists)) {
                if (await addPlaylistFilterToSection(targetSection, playlistId)) {
                  added += 1;
                }
              }
            }
            if (!added) {
              setMessage(
                "Такие фильтры уже есть или значения совпадают с существующими.",
                true
              );
              return;
            }
            setMessage(
              scope === "channel"
                ? "Фильтр для канала добавлен. Не забудьте сохранить изменения."
                : "Глобальный фильтр добавлен. Не забудьте сохранить изменения.",
              false
            );
            showToast("Фильтры обновлены, не забудьте сохранить изменения");
            markUnsaved();
          };

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
        })();

        const layout = document.createElement("div");
        layout.className = "quick-filter-layout";
        const infoColumn = document.createElement("div");
        infoColumn.className = "quick-filter-info";
        const builderColumn = document.createElement("div");
        builderColumn.className = "quick-filter-builder";
        layout.appendChild(infoColumn);
        layout.appendChild(builderColumn);
        checkVideoResult.appendChild(layout);

        const addLine = (label, value) => {
          if (value === undefined || value === null) return null;
          const row = document.createElement("div");
          row.className = "mb-1";
          const b = document.createElement("b");
          b.textContent = label + ": ";
          row.appendChild(b);
          const span = document.createElement("span");
          if (Array.isArray(value)) {
            span.textContent = value.map((v) => `"${v}"`).join(", ");
          } else if (value instanceof Node) {
            span.appendChild(value);
          } else {
            span.textContent = value;
          }
          row.appendChild(span);
          infoColumn.appendChild(row);
          return span;
        };

        const reasonMap = {
          short: "короткое видео",
          broadcast: "трансляция",
          title: "фильтр по названию",
          tag: "фильтр по тегу",
          duration: "длительность",
          playlist: "стоп-лист",
        };

        const verdict = document.createElement("div");
        verdict.className = `notification mb-2 ${reason ? "is-warning" : "is-info"}`;
        verdict.innerHTML = reason
          ? `<b>Будет отфильтровано:</b> ${reasonMap[reason] || reason}`
          : "<b>Не будет отфильтровано</b>";

        if (reason === "tag" && chFilters.tags?.length) {
          const d = document.createElement("div");
          d.textContent = `Теги фильтров: ${chFilters.tags.map((t) => `"${t}"`).join(", ")}`;
          verdict.appendChild(d);
        } else if (reason === "title" && chFilters.title?.length) {
          const d = document.createElement("div");
          d.textContent = `Фильтры названия: ${chFilters.title.map((t) => `"${t}"`).join(", ")}`;
          verdict.appendChild(d);
        }

        infoColumn.appendChild(verdict);

        if (info.id) {
          const videoLink = document.createElement("a");
          videoLink.href = `https://www.youtube.com/watch?v=${info.id}`;
          videoLink.target = "_blank";
          videoLink.rel = "noopener noreferrer";
          videoLink.textContent = info.id;
          addLine("ID", videoLink);
        }
        if (info.channelTitle || info.channelId) {
          const fragment = document.createDocumentFragment();
          if (info.channelId) {
            const channelLink = document.createElement("a");
            channelLink.href = `https://www.youtube.com/channel/${info.channelId}`;
            channelLink.target = "_blank";
            channelLink.rel = "noopener noreferrer";
            channelLink.textContent = info.channelTitle || info.channelId;
            fragment.appendChild(channelLink);
            if (info.channelTitle && info.channelId) {
              fragment.appendChild(
                document.createTextNode(` (${info.channelId})`)
              );
            }
          } else {
            fragment.appendChild(document.createTextNode(info.channelTitle));
          }
          addLine("Канал", fragment);
        }
        const originalTitle =
          typeof info.title === "string" ? info.title.trim() : "";
        if (originalTitle) {
          const titleButton = document.createElement("button");
          titleButton.type = "button";
          titleButton.className = "video-info-action";
          titleButton.textContent = info.title;
          titleButton.title = "Использовать название в фильтре";
          titleButton.setAttribute("aria-pressed", "false");
          let titleActive = false;
          titleButton.addEventListener("click", () => {
            if (titleActive) {
              quickFilter.setTitle("");
            } else {
              quickFilter.setTitle(info.title);
            }
          });
          quickFilter.subscribeTitle((current) => {
            const normalized = (current || "").trim().toLowerCase();
            const matches =
              normalized && normalized === originalTitle.toLowerCase();
            titleActive = Boolean(matches);
            titleButton.classList.toggle("is-active", Boolean(matches));
            titleButton.setAttribute(
              "aria-pressed",
              matches ? "true" : "false"
            );
          });
          addLine("Название", titleButton);
        } else {
          addLine("Название", info.title);
        }

          if (tags.length) {
            const row = document.createElement("div");
            row.className = "mb-1";
            const label = document.createElement("b");
            label.textContent = "Теги: ";
            row.appendChild(label);
            const tagsWrap = document.createElement("span");
            tagsWrap.className = "video-info-tags";
            tags.forEach((tag) => {
              const tagBtn = document.createElement("button");
              tagBtn.type = "button";
              tagBtn.className = "video-info-action video-info-tag";
              tagBtn.textContent = tag;
              tagBtn.title = "Добавить тег в фильтр";
              tagBtn.setAttribute("aria-pressed", "false");
              const toggle = () => {
                const selected = quickFilter.toggleTag(tag);
                tagBtn.classList.toggle("is-active", selected);
                tagBtn.setAttribute("aria-pressed", selected ? "true" : "false");
              };
              tagBtn.addEventListener("click", toggle);
              quickFilter.subscribeTag(tag, (selected) => {
                tagBtn.classList.toggle("is-active", selected);
                tagBtn.setAttribute("aria-pressed", selected ? "true" : "false");
              });
              tagsWrap.appendChild(tagBtn);
            });
            row.appendChild(tagsWrap);
            infoColumn.appendChild(row);
          }

        if (durationSeconds) {
          const durationRow = document.createElement("div");
          durationRow.className = "mb-1";
          const label = document.createElement("b");
          label.textContent = "Длительность: ";
          durationRow.appendChild(label);
          const durationButton = document.createElement("button");
          durationButton.type = "button";
          durationButton.className = "video-info-action";
          const durationStr = toTimeStr(durationSeconds);
          durationButton.textContent = durationStr;
          durationButton.setAttribute("aria-pressed", "false");
          let durationActive = false;
          durationButton.addEventListener("click", () => {
            if (durationActive) {
              quickFilter.clearDuration();
            } else {
              quickFilter.setDurationFromSeconds(durationSeconds);
            }
          });
          quickFilter.subscribeDuration(({ min, max }) => {
            const active =
              Number.isFinite(min) &&
              Number.isFinite(max) &&
              min === durationSeconds &&
              max === durationSeconds;
            durationActive = Boolean(active);
            durationButton.classList.toggle("is-active", Boolean(active));
            durationButton.setAttribute(
              "aria-pressed",
              active ? "true" : "false"
            );
          });
          durationRow.appendChild(durationButton);
          infoColumn.appendChild(durationRow);
        } else if (info.duration) {
          const parsed = parseDuration(info.duration);
          addLine(
            "Длительность",
            Number.isFinite(parsed) && parsed > 0
              ? toTimeStr(parsed)
              : info.duration
          );
        }
        if (info.publishedAt)
          addLine("Опубликовано", formatDateTime(info.publishedAt));
        addLine("Shorts", isShortVideo(info) ? "Да" : "Нет");
        const isBroadcast =
          (typeof info.liveBroadcastContent === "string" &&
            info.liveBroadcastContent !== "none") ||
          Boolean(info.liveStreamingDetails?.actualStartTime);
        addLine("Трансляция", isBroadcast ? "Да" : "Нет");
        const scheduled = info.liveStreamingDetails?.scheduledStartTime;
        if (scheduled) addLine("Запланировано", formatDateTime(scheduled));
        const actual = info.liveStreamingDetails?.actualStartTime;
        if (actual) addLine("Начало трансляции", formatDateTime(actual));
        if (info.description) {
          const descriptionRow = document.createElement("div");
          descriptionRow.className = "mb-1 video-description-row";

          const label = document.createElement("b");
          label.textContent = "Описание:";
          descriptionRow.appendChild(label);

          descriptionRow.appendChild(document.createTextNode(" "));

          const toggle = document.createElement("span");
          toggle.className = "video-description-toggle";
          toggle.textContent = "[показать]";
          toggle.style.cursor = "pointer";
          toggle.style.userSelect = "none";
          toggle.style.marginLeft = "0";
          toggle.style.fontWeight = "normal";
          toggle.style.color = "#3273dc";
          toggle.style.textDecoration = "underline";
          descriptionRow.appendChild(toggle);

          const descriptionBody = document.createElement("pre");
          descriptionBody.textContent = info.description;
          descriptionBody.className = "video-description-body";
          descriptionBody.style.whiteSpace = "pre-wrap";
          descriptionBody.style.margin = "0";
          descriptionBody.style.display = "none";
          descriptionRow.appendChild(descriptionBody);

          let isOpen = false;
          const updateToggle = () => {
            toggle.textContent = isOpen ? "[скрыть]" : "[показать]";
            descriptionBody.style.display = isOpen ? "block" : "none";
          };
          toggle.addEventListener("click", () => {
            isOpen = !isOpen;
            updateToggle();
          });
          toggle.addEventListener("keydown", (event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              isOpen = !isOpen;
              updateToggle();
            }
          });
          toggle.setAttribute("role", "button");
          toggle.setAttribute("tabindex", "0");
          updateToggle();

          infoColumn.appendChild(descriptionRow);
        }

        // quick filter controls appended below

        if (quickFilter?.element) {
          builderColumn.appendChild(quickFilter.element);
        }

        if (info.channelId) {
          quickFilter.setPlaylistOptions([], "Загрузка плейлистов...");
          getChannelPlaylists(info.channelId)
            .then((allPlaylists) => {
              if (Array.isArray(allPlaylists) && allPlaylists.length) {
                quickFilter.setPlaylistOptions(allPlaylists);
              } else {
                quickFilter.setPlaylistOptions([], "Плейлисты не найдены");
              }
            })
            .catch((err) => {
              console.error("Failed to load channel playlists", err);
              quickFilter.setPlaylistOptions(
                [],
                "Не удалось загрузить плейлисты"
              );
            });
        } else {
          quickFilter.setPlaylistOptions(
            [],
            "Плейлисты доступны только для каналов"
          );
        }

        const playlistsContainer = document.createElement("span");
        playlistsContainer.className = "video-info-playlists";
        const initialPlaylistLabel = document.createElement("span");
        initialPlaylistLabel.textContent = info.channelId
          ? "Загрузка..."
          : "Недоступно";
        playlistsContainer.appendChild(initialPlaylistLabel);
        addLine("Состоит в плейлистах", playlistsContainer);

        if (info.channelId && info.id) {
          findVideoPlaylists(info.channelId, info.id)
            .then((playlists) => {
              playlistsContainer.innerHTML = "";
              if (!playlists.length) {
                const none = document.createElement("span");
                none.textContent = "Не найдено";
                playlistsContainer.appendChild(none);
                return;
              }
              playlists.forEach((playlist) => {
                const item = document.createElement("span");
                item.className = "video-info-playlist";
                const link = document.createElement("a");
                link.href = `https://www.youtube.com/playlist?list=${playlist.id}`;
                link.target = "_blank";
                link.rel = "noopener noreferrer";
                link.textContent = playlist.title || playlist.id;
                item.appendChild(link);

                const useBtn = document.createElement("button");
                useBtn.type = "button";
                useBtn.className = "video-info-action video-info-action--icon";
                useBtn.title = "Использовать плейлист в фильтре";
                useBtn.setAttribute(
                  "aria-label",
                  "Использовать плейлист в фильтре"
                );
                useBtn.innerHTML =
                  '<span class="icon"><svg width="1.25em" height="1.25em"><use href="icons.svg#icon-plus"></use></svg></span>';
                useBtn.setAttribute("aria-pressed", "false");
                useBtn.addEventListener("click", () => {
                  quickFilter.usePlaylist(playlist.id);
                });
                quickFilter.subscribePlaylist(playlist.id, (selected) => {
                  useBtn.classList.toggle("is-active", selected);
                  useBtn.setAttribute("aria-pressed", selected ? "true" : "false");
                });
                item.appendChild(useBtn);

                playlistsContainer.appendChild(item);
              });
            })
            .catch((err) => {
              console.error("Failed to load channel playlists", err);
              playlistsContainer.innerHTML = "";
              const error = document.createElement("span");
              error.textContent = "Не удалось загрузить";
              playlistsContainer.appendChild(error);
            });
        }
      } else {
        checkVideoResult.textContent =
          "Error: " + (resp?.error || "unknown");
      }
    });
  });

  const searchParams = new URLSearchParams(window.location.search);
  const quickFilterVideo = parseVideoId(searchParams.get("quickFilterVideo"));
  if (quickFilterVideo && checkVideoInput) {
    const quickFilterUrl = `https://www.youtube.com/watch?v=${quickFilterVideo}`;
    checkVideoInput.value = quickFilterUrl;
    setTimeout(() => {
      if (typeof checkVideoBtn?.click === "function") {
        checkVideoBtn.click();
      }
    }, 0);
  }

  const filters = await getFilters();
  updateLastSaveDisplay();
  channels = await getChannelMap(Object.keys(filters.channels));

  Object.keys(channels).forEach((id) => {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = channels[id].title || id;
    addChannelSelect.appendChild(opt);
  });

  function createSection(title, data = {}, channelId) {
    const box = cardTemplate.content.firstElementChild.cloneNode(true);
    box.dataset.channel = channelId || "";
    const heading = box.querySelector(".channel-heading");
    const link = box.querySelector(".channel-link");
    const removeBtn = box.querySelector(".remove-btn");
    const groupsWrap = box.querySelector(".groups-container");
    const chkShorts = box.querySelector(".nos");
    const chkBroadcast = box.querySelector(".nob");
    const btnDur = box.querySelector(".add-duration");
    const btnTitle = box.querySelector(".add-title");
    const btnTag = box.querySelector(".add-tag");
    const btnPlaylist = box.querySelector(".add-playlist");

    if (channelId) {
      link.href = `https://www.youtube.com/channel/${channelId}`;
      link.textContent = title;
      removeBtn.addEventListener("click", () => {
        box.remove();
        const opt = document.createElement("option");
        opt.value = channelId;
        opt.textContent = channels[channelId]?.title || channelId;
        addChannelSelect.appendChild(opt);
        updateCheckboxVisibility();
        markUnsaved();
      });
    } else {
      heading.style.display = "none";
      removeBtn.style.display = "none";
      box.classList.remove("box");
      box.classList.add("wide");
    }

    if (data.noShorts) chkShorts.checked = true;
    if (data.noBroadcasts) chkBroadcast.checked = true;

    const durGroup = createGroup(
      "Длительность",
      "duration",
      data.duration || [],
      (r = {}) => createDurationRow(r.min, r.max)
    );
    const titleGroup = createGroup(
      "Заголовок",
      "title",
      data.title || [],
      (t = "") => createTextRow("title", t)
    );
    const tagGroup = createGroup(
      "Тег",
      "tag",
      data.tags || [],
      (t = "") => createTextRow("tag", t)
    );
    const playlistGroup = createGroup(
      "Плейлист",
      "playlist",
      data.playlists || [],
      (id = "") => createPlaylistRow(channelId, id)
    );

    groupsWrap.appendChild(durGroup.group);
    groupsWrap.appendChild(titleGroup.group);
    groupsWrap.appendChild(tagGroup.group);
    groupsWrap.appendChild(playlistGroup.group);

    btnDur.addEventListener("click", durGroup.add);
    btnTitle.addEventListener("click", titleGroup.add);
    btnTag.addEventListener("click", tagGroup.add);
    btnPlaylist.addEventListener("click", playlistGroup.add);

    return box;
  }

  function ensureFilterSection(channelId, channelTitle) {
    if (!channelId) {
      return globalSec || globalContainer?.querySelector(".filter-card");
    }
    if (!filtersContainer) {
      return null;
    }
    let section = filtersContainer.querySelector(
      `.filter-card[data-channel="${channelId}"]`
    );
    if (section) {
      return section;
    }
    const resolvedTitle = channelTitle || channels[channelId]?.title || channelId;
    channels[channelId] = channels[channelId] || { title: resolvedTitle };
    section = createSection(resolvedTitle, {}, channelId);
    filtersContainer.insertBefore(section, addCard);
    const opt = addChannelSelect?.querySelector(
      `option[value="${channelId}"]`
    );
    opt?.remove();
    updateCheckboxVisibility();
    return section;
  }

  async function addTextFilterToSection(section, type, value) {
    if (!section || !value) return false;
    const group = section.querySelector(`.filter-group[data-type="${type}"]`);
    if (!group) return false;
    const list = group.querySelector(".rows-wrap");
    if (!list) return false;
    const normalized = value.trim();
    if (!normalized) return false;
    const normalizedLower = normalized.toLowerCase();
    const existingRows = Array.from(list.querySelectorAll(".filter-row"))
      .filter((row) => row.dataset.type === type);
    if (
      existingRows.some(
        (row) =>
          row
            .querySelector("input")
            ?.value.trim()
            .toLowerCase() === normalizedLower
      )
    ) {
      return false;
    }
    const addRowFn = group.__addRowWithData;
    if (typeof addRowFn === "function") {
      await addRowFn(normalized);
    } else {
      group.querySelector(".add-row")?.click();
    }
    const newRows = Array.from(list.querySelectorAll(".filter-row"))
      .filter((row) => row.dataset.type === type);
    const newRow = newRows[newRows.length - 1];
    if (!newRow) return false;
    const input = newRow.querySelector("input");
    if (!input) return false;
    if (input.value.trim().toLowerCase() !== normalizedLower) {
      input.value = normalized;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    return true;
  }

  async function addDurationFilterToSection(section, minSeconds, maxSeconds) {
    if (!section) return false;
    const group = section.querySelector('.filter-group[data-type="duration"]');
    if (!group) return false;
    const list = group.querySelector('.rows-wrap');
    if (!list) return false;
    let normalizedMin =
      Number.isFinite(minSeconds) && minSeconds > 0 ? Math.max(minSeconds, 0) : 0;
    let normalizedMax =
      Number.isFinite(maxSeconds) && maxSeconds >= 0
        ? Math.max(maxSeconds, 0)
        : Infinity;
    if (normalizedMax !== Infinity && normalizedMax < normalizedMin) {
      const temp = normalizedMax;
      normalizedMax = normalizedMin;
      normalizedMin = temp;
    }
    if (normalizedMin === 0 && normalizedMax === Infinity) {
      return false;
    }
    const rows = Array.from(
      list.querySelectorAll('.filter-row[data-type="duration"]')
    );
    const hasSame = rows.some((row) => {
      const fromInput = row.querySelector('.from');
      const toInput = row.querySelector('.to');
      if (!fromInput || !toInput) return false;
      const existingMin = fromInput.value ? parseTime(fromInput.value) : 0;
      const toValue = toInput.value;
      const existingMax = toValue ? parseTime(toValue) : Infinity;
      return existingMin === normalizedMin && existingMax === normalizedMax;
    });
    if (hasSame) {
      return false;
    }
    const addRowFn = group.__addRowWithData;
    if (typeof addRowFn === "function") {
      await addRowFn({ min: normalizedMin, max: normalizedMax });
    } else {
      group.querySelector('.add-row')?.click();
    }
    const newRows = Array.from(
      list.querySelectorAll('.filter-row[data-type="duration"]')
    );
    const newRow = newRows[newRows.length - 1];
    if (!newRow) return false;
    const fromInput = newRow.querySelector('.from');
    const toInput = newRow.querySelector('.to');
    if (!fromInput || !toInput) return false;
    const expectedMin = normalizedMin ? toTimeStr(normalizedMin) : "";
    const expectedMax = normalizedMax !== Infinity ? toTimeStr(normalizedMax) : "";
    if (fromInput.value !== expectedMin) {
      fromInput.value = expectedMin;
      fromInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (toInput.value !== expectedMax) {
      toInput.value = expectedMax;
      toInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
    return true;
  }

  async function addPlaylistFilterToSection(section, playlistId) {
    if (!section || !playlistId) return false;
    const group = section.querySelector('.filter-group[data-type="playlist"]');
    if (!group) return false;
    const list = group.querySelector('.rows-wrap');
    if (!list) return false;
    const existingRows = Array.from(
      list.querySelectorAll('.filter-row[data-type="playlist"]')
    );
    if (
      existingRows.some((row) => {
        const select = row.querySelector('select');
        return select?.value === playlistId;
      })
    ) {
      return false;
    }
    const addRowFn = group.__addRowWithData;
    if (typeof addRowFn === "function") {
      await addRowFn(playlistId);
    } else {
      group.querySelector('.add-row')?.click();
    }
    const newRows = Array.from(
      list.querySelectorAll('.filter-row[data-type="playlist"]')
    );
    const newRow = newRows[newRows.length - 1];
    if (!newRow) return false;
    const select = newRow.querySelector('select');
    if (!select) return false;
    if (select.value !== playlistId) {
      select.value = playlistId;
    }
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  globalSec = createSection("Глобальные", filters.global, null);
  globalContainer.appendChild(globalSec);
  globalShortsChk = globalSec.querySelector(".nos");
  globalBroadcastChk = globalSec.querySelector(".nob");

  function updateCheckboxVisibility() {
    const hideShorts = globalShortsChk?.checked;
    const hideBroadcasts = globalBroadcastChk?.checked;
    document
      .querySelectorAll('#filtersContainer .filter-card[data-channel]')
      .forEach((sec) => {
        const s = sec.querySelector('.nos')?.closest('label');
        if (s) s.style.display = hideShorts ? 'none' : '';
        const b = sec.querySelector('.nob')?.closest('label');
        if (b) b.style.display = hideBroadcasts ? 'none' : '';
      });
  }

  globalShortsChk?.addEventListener('change', updateCheckboxVisibility);
  globalBroadcastChk?.addEventListener('change', updateCheckboxVisibility);

  for (const id of Object.keys(filters.channels)) {
    const chName = channels[id]?.title || id;
    const sec = createSection(chName, filters.channels[id], id);
    filtersContainer.insertBefore(sec, addCard);
  }

  updateCheckboxVisibility();

  Object.keys(filters.channels).forEach((id) => {
    const opt = addChannelSelect.querySelector(`option[value="${id}"]`);
    if (opt) opt.remove();
  });

  async function handleSaveClick() {
    if (isSaving) return;
    const sections = document.querySelectorAll(".filter-card:not(.add-card)");
    const result = { global: {}, channels: {} };
    sections.forEach((sec) => {
      const ch = sec.dataset.channel || null;
      const obj = {};
      if (sec.querySelector(".nos").checked) obj.noShorts = true;
      if (sec.querySelector(".nob").checked) obj.noBroadcasts = true;
      const durs = [];
      const titles = [];
      const tags = [];
      const playlists = [];
      sec.querySelectorAll(".filter-row").forEach((row) => {
        const type = row.dataset.type;
        if (type === "duration") {
          const min = parseTime(row.querySelector(".from").value);
          const toVal = row.querySelector(".to").value;
          const max = toVal ? parseTime(toVal) : Infinity;
          if (min || max !== Infinity) durs.push({ min, max });
        } else if (type === "title") {
          const val = row.querySelector("input").value.trim();
          if (val) titles.push(val);
        } else if (type === "tag") {
          const val = row.querySelector("input").value.trim();
          if (val) tags.push(val);
        } else if (type === "playlist") {
          const val = row.querySelector("select").value;
          if (val) playlists.push(val);
        }
      });
      if (durs.length) obj.duration = durs;
      if (titles.length) obj.title = titles;
      if (tags.length) obj.tags = tags;
      if (playlists.length) obj.playlists = playlists;
      if (ch) result.channels[ch] = obj;
      else result.global = obj;
    });
    try {
      isSaving = true;
      updateSaveButtons();
      await saveFilters(result);
      updateLastSaveDisplay();
      if (pendingChangesDuringSave) {
        pendingChangesDuringSave = false;
        hasUnsavedChanges = true;
      } else {
        setUnsavedChanges(false);
      }
      showToast("Фильтры сохранены");
    } catch (err) {
      console.error("Failed to save filters", err);
      showToast("Не удалось сохранить фильтры", true);
    } finally {
      isSaving = false;
      updateSaveButtons();
    }
  }

  saveFiltersBtn?.addEventListener("click", handleSaveClick);
  floatingSaveBtn?.addEventListener("click", handleSaveClick);

  addChannelBtn?.addEventListener("click", () => {
    const id = addChannelSelect.value;
    if (!id) return;
    const sec = createSection(channels[id]?.title || id, {}, id);
    filtersContainer.insertBefore(sec, addCard);
    const opt = addChannelSelect.querySelector(`option[value="${id}"]`);
    opt?.remove();
    updateCheckboxVisibility();
    markUnsaved();
  });

  exportBtn?.addEventListener("click", async () => {
    const data = await getFilters();
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "filters.json";
    a.click();
    URL.revokeObjectURL(url);
  });

  importInput?.addEventListener("change", () => {
    const file = importInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const obj = JSON.parse(reader.result);
        saveFilters(obj).then(() => window.location.reload());
      } catch (e) {
        alert("Invalid JSON");
      }
    };
    reader.readAsText(file);
  });
});
