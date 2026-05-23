// Runtime message registry for the background service worker. Combines domain handler tables into one message type lookup.
import { collectionHandlers } from "./handlers/collection.js";
import { listHandlers } from "./handlers/lists.js";
import { optionsHandlers } from "./handlers/options.js";
import { playbackHandlers } from "./handlers/playback.js";
import { queueHandlers } from "./handlers/queue.js";

export const messageHandlers = {
  ...collectionHandlers,
  ...optionsHandlers,
  ...queueHandlers,
  ...listHandlers,
  ...playbackHandlers,
};
