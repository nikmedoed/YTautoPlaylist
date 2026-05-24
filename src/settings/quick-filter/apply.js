// Quick-filter apply logic. Converts quick-filter builder state into saved filter mutations.
import { parseTime } from "../shared/format.js";

// Merges the checked video's selected quick-filter rules into the saved filter configuration.
export async function applyQuickFilters({
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
}) {
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
      : getGlobalSection?.();
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
}

