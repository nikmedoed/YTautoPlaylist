// Settings filter persistence. Loads and saves user filters and related options through storage helpers.
import { getFilters, saveFilters } from "../../filter.js";
import { parseTime } from "../shared/format.js";

function collectFiltersFromSections(documentRef = document) {
  const sections = documentRef.querySelectorAll(".filter-card:not(.add-card)");
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
        const maxStr = row.querySelector(".to").value;
        const max = maxStr ? parseTime(maxStr) : Infinity;
        durs.push({ min, max });
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
  return result;
}

export function bindFilterPersistence({
  exportBtn,
  floatingSaveBtn,
  importInput,
  lastSaveInfo,
  saveFiltersBtn,
  saveUi,
  setUnsavedChanges,
  showToast,
  updateLastSaveDisplay,
}) {
  async function handleSaveClick() {
    if (saveUi.isSaving()) return;
    const result = collectFiltersFromSections();
    try {
      saveUi.setSaving(true);
      await saveFilters(result);
      updateLastSaveDisplay(lastSaveInfo);
      if (saveUi.consumePendingChangesDuringSave()) {
        setUnsavedChanges(true);
      } else {
        setUnsavedChanges(false);
      }
      showToast("Фильтры сохранены");
    } catch (err) {
      console.error("Failed to save filters", err);
      showToast("Не удалось сохранить фильтры", true);
    } finally {
      saveUi.setSaving(false);
    }
  }

  saveFiltersBtn?.addEventListener("click", handleSaveClick);
  floatingSaveBtn?.addEventListener("click", handleSaveClick);

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
      } catch {
        alert("Invalid JSON");
      }
    };
    reader.readAsText(file);
  });
}
