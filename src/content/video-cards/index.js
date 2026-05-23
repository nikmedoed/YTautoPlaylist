// Video-card feature entrypoint. Finds YouTube cards, extracts targets, installs overlays, and refreshes progress state.
import {
  CARD_MARK,
} from "../core/base.js";
import {
  syncVideoCardProgress as syncVideoCardProgressImpl,
} from "./progress.js";
import { createVideoCardOverlayController } from "./overlays.js";
import { createPreviewOverlayController } from "./previewOverlay.js";
import { createVideoCardDecorationController } from "./decorations.js";

export { findVideoIdInCard } from "./targets.js";

const playlistSuccessTimers = new WeakMap();
const inlineOverlayObservers = new WeakMap();
const inlineOverlayHosts = new WeakMap();
const inlineButtonsByVideoId = new Map();
const inlineButtonOwners = new WeakMap();
const overlays = createVideoCardOverlayController({
  inlineOverlayObservers,
});
const previewOverlay = createPreviewOverlayController({
  inlineButtonsByVideoId,
  observeInlineOverlay: overlays.observeInlineOverlay,
});
const decorations = createVideoCardDecorationController({
  overlays,
  previewOverlay,
  playlistSuccessTimers,
  inlineOverlayHosts,
  inlineButtonsByVideoId,
  inlineButtonOwners,
});

export const enhanceVideoCards = decorations.enhanceVideoCards;
export const resetVideoCardDecorations = decorations.resetVideoCardDecorations;

export function syncVideoCardProgress(root = document) {
  syncVideoCardProgressImpl(root, CARD_MARK);
}
