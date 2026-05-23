// Shared background constants. Contains message source markers used to avoid handling self-sent broadcasts.
export const MESSAGE_SOURCE = "background";
export const MAX_API_BATCH = 50;
export const COLLECTION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const COLLECTION_FETCH_OVERLAP_MS = 48 * 60 * 60 * 1000;
