// Injected video cards styles. Exports CSS text used by the content script for YouTube-page UI.
import {
  ADD_BUTTON_CLASS,
  ADD_BUTTON_DONE_CLASS,
  CARD_OVERLAY_HOST_CLASS,
  INLINE_BUTTON_OVERLAY_CLASS,
  THUMB_HOST_CLASS,
} from "../core/base.js";

// Returns the card overlay CSS injected by the content script.
export function getVideoCardStyles() {
  return `
  .${THUMB_HOST_CLASS} {
    position: relative !important;
  }
  .${CARD_OVERLAY_HOST_CLASS} {
    position: relative !important;
    z-index: auto;
  }
  .${INLINE_BUTTON_OVERLAY_CLASS} {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 2147483000;
  }
  .${INLINE_BUTTON_OVERLAY_CLASS} .${ADD_BUTTON_CLASS} {
    pointer-events: auto;
  }
  .video-thumb__progress {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 4px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.18);
    overflow: hidden;
    pointer-events: none;
    z-index: 4;
  }
  .video-thumb__progress-bar {
    position: absolute;
    top: 0;
    left: 0;
    bottom: 0;
    width: 0%;
    background: linear-gradient(
      90deg,
      rgba(255, 87, 34, 0.95) 0%,
      rgba(244, 67, 54, 0.95) 50%,
      rgba(198, 40, 40, 0.95) 100%
    );
    box-shadow: 0 0 6px rgba(229, 57, 53, 0.45);
    transition: width 0.2s ease;
  }
  .${ADD_BUTTON_CLASS} {
    position: absolute;
    top: 8px;
    left: 8px;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    border: none;
    background: rgba(17, 17, 17, 0.8);
    color: #fff;
    font-size: 18px;
    line-height: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    z-index: 5;
    transition: transform 0.15s ease, background 0.2s ease, opacity 0.2s ease;
  }
  .${ADD_BUTTON_CLASS}:hover {
    transform: scale(1.08);
    background: rgba(229, 45, 39, 0.9);
  }
  .${ADD_BUTTON_CLASS}[disabled] {
    pointer-events: none;
  }
  .${ADD_BUTTON_CLASS}[data-yta-status="pending"] {
    cursor: progress;
    opacity: 0.6;
  }
  .${ADD_BUTTON_CLASS}.${ADD_BUTTON_DONE_CLASS},
  .${ADD_BUTTON_CLASS}[data-yta-status="present"] {
    background: rgba(34, 197, 94, 0.85);
  }
  .${ADD_BUTTON_CLASS}[data-yta-status="present"] {
    cursor: default;
    opacity: 1;
  }
  .${ADD_BUTTON_CLASS}[data-yta-status="present"]:hover {
    background: rgba(34, 197, 94, 0.85);
    transform: none;
  }
  .${ADD_BUTTON_CLASS}::after {
    content: "+";
    font-weight: 600;
  }
  .${ADD_BUTTON_CLASS}.${ADD_BUTTON_DONE_CLASS}::after {
    content: "✓";
    font-weight: 600;
  }`;
}
