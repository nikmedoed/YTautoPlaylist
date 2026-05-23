// Auto-collection timestamp normalization. Contains parsing rules for stored lastRunAt and next-run values.
const SECOND_TS_MIN = 1_000_000_000;
const SECOND_TS_MAX = 10_000_000_000;

export function normalizeAutoCollectTimestamp(value) {
  let ts = Number(value);
  if (!Number.isFinite(ts) || ts <= 0) {
    return 0;
  }
  ts = Math.trunc(ts);
  if (ts >= SECOND_TS_MIN && ts < SECOND_TS_MAX) {
    ts *= 1000;
  }
  return ts;
}
