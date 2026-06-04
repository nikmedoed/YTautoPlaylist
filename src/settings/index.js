// Settings page entrypoint. Wires saved filters, quick-filter builder, video checks, and save status UI.
import { parseVideoId } from "../utils.js";
import { parseDuration } from "../time.js";
import { getFilters } from "../filter.js";
import {
  toLocalInputValue,
} from "./shared/format.js";
import {
  getSyncStatus,
  getSubscriptionsMeta,
  getVideoDate,
  getVideoInfo,
  pullRemoteSync,
  pushLocalSync,
  replaceLocalFromRemoteSync,
  setStartDate,
} from "./shared/runtime.js";
import {
  createSaveUiState,
  showToast,
  updateLastSaveDisplay,
} from "./shared/saveUi.js";
import { renderCheckVideoResult } from "./video-check/resultView.js";
import {
  addDurationFilterToSection,
  addPlaylistFilterToSection,
  addTextFilterToSection,
} from "./filters/mutations.js";
import { createFilterSection } from "./filters/sections.js";
import { bindFilterPersistence } from "./filters/persistence.js";
import { createQuickFilterBuilder } from "./quick-filter/builder.js";
import { getChannelMap } from "../youtube-api/channels.js";

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
  const pullSyncBtn = document.getElementById("pullSync");
  const pushSyncBtn = document.getElementById("pushSync");
  const replaceFromSyncBtn = document.getElementById("replaceFromSync");
  const syncStatus = document.getElementById("syncStatus");
  const saveButtons = [saveFiltersBtn, floatingSaveBtn].filter(Boolean);
  let globalSec;
  let globalShortsChk;
  let globalBroadcastChk;
  let channels = {};
  const saveUi = createSaveUiState(saveButtons);
  const { markUnsaved, setUnsavedChanges, updateSaveButtons } = saveUi;

  [globalContainer, filtersContainer].forEach((target) => {
    target?.addEventListener("input", markUnsaved, true);
    target?.addEventListener("change", markUnsaved, true);
  });
  updateSaveButtons();
  function formatSyncDate(value) {
    const ts = Number(value) || 0;
    if (ts <= 0) return "нет";
    const date = new Date(ts);
    return Number.isNaN(date.getTime()) ? "нет" : date.toLocaleString();
  }
  function setSyncBusy(busy) {
    [pullSyncBtn, pushSyncBtn, replaceFromSyncBtn].forEach((button) => {
      if (!button) return;
      button.disabled = busy;
      button.classList.toggle("is-loading", busy);
    });
  }
  function renderSyncStatus(status, message = "") {
    if (!syncStatus) return;
    const playlist = status?.playlist || {};
    const settings = status?.settings || {};
    const pending = [playlist.pending, settings.pending].some(Boolean);
    const errors = [playlist.lastError, settings.lastError].filter(Boolean);
    const manifests = `${status?.hasPlaylistManifest ? "playlist" : "-"} / ${status?.hasSettingsManifest ? "filters" : "-"}`;
    const parts = [
      message,
      `ID: ${status?.extensionId || "?"}`,
      `Плейлисты remote: ${playlist.remoteAvailable ? formatSyncDate(playlist.remoteUpdatedAt) : "нет"}`,
      `Фильтры remote: ${settings.remoteAvailable ? formatSyncDate(settings.remoteUpdatedAt) : "нет"}`,
      `Ключи sync: ${status?.syncKeyCount ?? "?"}`,
      `Manifest: ${manifests}`,
      pending ? "Есть локальные изменения в очереди на отправку." : "",
      errors.length ? `Ошибки: ${errors.join("; ")}` : "",
    ].filter(Boolean);
    syncStatus.textContent = parts.join(" ");
    syncStatus.classList.toggle("is-danger", errors.length > 0);
  }
  async function refreshSyncStatus(message = "") {
    try {
      const status = await getSyncStatus();
      renderSyncStatus(status, message);
    } catch (err) {
      console.error("Failed to load sync status", err);
      renderSyncStatus(null, "Не удалось получить статус синхронизации.");
    }
  }

  pullSyncBtn?.addEventListener("click", async () => {
    try {
      setSyncBusy(true);
      const result = await pullRemoteSync();
      const changed = result?.playlistImported || result?.settingsImported;
      await refreshSyncStatus(changed
        ? "Данные из аккаунта подтянуты."
        : "Более свежих данных в аккаунте нет.");
      if (result?.settingsImported) {
        window.setTimeout(() => window.location.reload(), 700);
      }
    } catch (err) {
      console.error("Failed to pull account sync", err);
      showToast("Не удалось подтянуть данные из аккаунта", true);
    } finally {
      setSyncBusy(false);
    }
  });

  pushSyncBtn?.addEventListener("click", async () => {
    if (saveFiltersBtn && !saveFiltersBtn.classList.contains("is-hidden")) {
      showToast("Сначала сохраните изменения фильтров", true);
      return;
    }
    try {
      setSyncBusy(true);
      const result = await pushLocalSync();
      const pushed = result?.playlistPushed || result?.settingsPushed;
      await refreshSyncStatus(pushed
        ? "Локальные данные отправлены в аккаунт."
        : "Не удалось отправить данные в аккаунт.");
    } catch (err) {
      console.error("Failed to push local account sync", err);
      showToast("Не удалось отправить данные в аккаунт", true);
    } finally {
      setSyncBusy(false);
    }
  });

  replaceFromSyncBtn?.addEventListener("click", async () => {
    const ok = window.confirm(
      "Заменить локальные плейлисты и фильтры данными из аккаунта?"
    );
    if (!ok) return;
    try {
      setSyncBusy(true);
      const result = await replaceLocalFromRemoteSync();
      const changed = result?.playlistImported || result?.settingsImported;
      await refreshSyncStatus(changed
        ? "Локальные данные заменены из аккаунта."
        : "В аккаунте нет сохранённых данных.");
      if (changed) {
        window.setTimeout(() => window.location.reload(), 700);
      }
    } catch (err) {
      console.error("Failed to replace local data from account sync", err);
      showToast("Не удалось заменить локальные данные", true);
    } finally {
      setSyncBusy(false);
    }
  });

  refreshSyncStatus();

  getSubscriptionsMeta().then((meta) => {
    const ts = Number(meta?.lastRunAt) || 0;
    if (ts <= 0) return;
    const d = new Date(ts);
    if (!Number.isNaN(d.getTime())) {
      startInput.value = toLocalInputValue(d);
    }
  });

  saveBtn?.addEventListener("click", () => {
    const val = startInput.value;
    const dt = new Date(val);
    if (!Number.isNaN(dt.getTime())) {
      setStartDate(dt).then((ok) => {
        if (ok) {
          startInput.value = toLocalInputValue(dt);
        }
      });
    }
  });

  useBtn?.addEventListener("click", () => {
    const id = parseVideoId(videoInput.value);
    if (!id) return;
    getVideoDate(id).then((date) => {
      if (date) {
        const d = new Date(date);
        startInput.value = toLocalInputValue(d);
      }
    });
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
    getVideoInfo(id).then(async (resp) => {
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

        const quickFilter = createQuickFilterBuilder({
          addDurationFilterToSection,
          addPlaylistFilterToSection,
          addTextFilterToSection,
          ensureFilterSection,
          filtersContainer,
          getGlobalSection: () => globalSec,
          info,
          markUnsaved,
          showToast,
        });

        renderCheckVideoResult({
          chFilters,
          checkVideoResult,
          durationSeconds,
          info,
          quickFilter,
          reason,
          tags,
        });
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
  updateLastSaveDisplay(lastSaveInfo);
  channels = await getChannelMap(Object.keys(filters.channels));

  Object.keys(channels).forEach((id) => {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = channels[id].title || id;
    addChannelSelect.appendChild(opt);
  });

  function createSection(title, data = {}, channelId) {
    return createFilterSection({
      addChannelSelect,
      channels,
      channelId,
      data,
      markUnsaved,
      title,
      updateCheckboxVisibility,
    });
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

  bindFilterPersistence({
    exportBtn,
    floatingSaveBtn,
    importInput,
    lastSaveInfo,
    saveFiltersBtn,
    saveUi,
    setUnsavedChanges,
    showToast,
    updateLastSaveDisplay,
  });
});
