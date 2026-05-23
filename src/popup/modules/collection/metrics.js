// Collection metric helpers. Keeps count formatting and filter-total normalization consistent across progress views.
export const EMPTY_FILTER_TOTALS = Object.freeze({
  filtered: 0,
  broadcasts: 0,
  shorts: 0,
  stoplists: 0,
  passed: 0,
});

const numberFormatter =
  typeof Intl !== "undefined" ? new Intl.NumberFormat("ru-RU") : null;

export function formatCount(value) {
  const numeric = Number.isFinite(Number(value)) ? Number(value) : 0;
  const count = Math.max(0, Math.round(numeric));
  return numberFormatter ? numberFormatter.format(count) : String(count);
}

export function formatRatio(value, total) {
  const safeTotal = Number(total) || 0;
  const safeValue = Number(value) || 0;
  if (safeTotal > 0) {
    const clamped = Math.min(Math.max(0, safeValue), safeTotal);
    return `${formatCount(clamped)} / ${formatCount(safeTotal)}`;
  }
  return formatCount(safeValue);
}

export function resolveFilterTotals(raw) {
  return {
    filtered: Number(raw?.filtered) || 0,
    broadcasts: Number(raw?.broadcasts) || 0,
    shorts: Number(raw?.shorts) || 0,
    stoplists: Number(raw?.stoplists) || 0,
    passed: Number(raw?.passed) || 0,
  };
}
