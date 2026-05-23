// Store public API entrypoint. Exports state helpers and action modules used by background and UI code.
export * from "./actions/autoCollect.js";
export * from "./actions/history.js";
export * from "./actions/lists.js";
export * from "./actions/playback.js";
export * from "./actions/presentation.js";
export * from "./actions/queue.js";
export * from "./state/index.js";

export {
  DEFAULT_LIST_ID as DEFAULT_LIST,
  getState,
  mutateState,
  replaceState,
} from "./state/index.js";
