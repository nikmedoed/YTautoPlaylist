// Settings filter mutation helpers. Adds, removes, updates, and normalizes filter rows before persistence.
import { parseTime, toTimeStr } from "../shared/format.js";

export async function addTextFilterToSection(section, type, value) {
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

export async function addDurationFilterToSection(section, minSeconds, maxSeconds) {
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

export async function addPlaylistFilterToSection(section, playlistId) {
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

