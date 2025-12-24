function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
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
  }
  .yta-playback-notification {
    position: fixed;
    top: 152px;
    left: 50%;
    transform: translateX(-50%) translateY(-10px);
    display: grid;
    place-items: center;
    padding: 20px 56px;
    border-radius: 20px;
    background: linear-gradient(150deg, #ff0033 0%, #d40000 50%, #a80000 100%);
    color: #ffffff;
    box-shadow: 0 30px 70px rgba(0, 0, 0, 0.38);
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.24s ease, transform 0.24s ease;
    z-index: 2147483647;
    box-sizing: border-box;
    max-width: min(720px, calc(100% - 48px));
    min-width: min(560px, calc(100% - 48px));
    font-size: 17px;
    text-align: center;
  }
  .yta-playback-notification[data-visible="1"] {
    opacity: 1;
    pointer-events: auto;
    transform: translateX(-50%) translateY(0);
  }
  .yta-playback-notification__content {
    display: grid;
    justify-items: center;
    align-content: center;
    gap: 10px;
    width: 100%;
  }
  .yta-playback-notification__title {
    font-size: 24px;
    font-weight: 800;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    color: #ffffff;
    text-shadow: 0 3px 18px rgba(0, 0, 0, 0.45);
  }
  .yta-playback-notification__body {
    font-size: 18px;
    line-height: 1.55;
    color: rgba(255, 255, 255, 0.94);
    font-weight: 600;
    max-width: 560px;
  }
  .yta-player-controls {
    position: absolute;
    right: 24px;
    bottom: 64px;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 8px;
    z-index: 2147483647;
    transition: opacity 0.2s ease;
  }
  .yta-player-controls__row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .yta-player-controls__row--top,
  .yta-player-controls__row--bottom {
    justify-content: flex-end;
  }
  .yta-player-controls .ytp-button[hidden] {
    display: none !important;
  }
  .yta-player-controls .ytp-button {
    border: none;
    width: 32px;
    height: 32px;
    border-radius: 16px;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: rgba(17, 17, 17, 0.6);
    color: #fff;
    font-size: 16px;
    font-weight: 500;
    line-height: 1;
    cursor: pointer;
    transition: background 0.2s ease, transform 0.15s ease;
  }
  .yta-player-controls .ytp-button:hover {
    background: rgba(229, 45, 39, 0.9);
    transform: translateY(-1px);
  }
  .yta-player-controls .ytp-button[disabled] {
    opacity: 0.45;
    cursor: not-allowed;
    transform: none;
  }
  .yta-player-controls__add {
    border: none;
    border-radius: 999px;
    padding: 0 18px;
    min-width: 132px;
    height: 32px;
    background: rgba(229, 45, 39, 0.95);
    color: #ffffff;
    font-weight: 600;
    font-size: 14px;
    letter-spacing: 0.01em;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: background 0.2s ease, transform 0.15s ease, opacity 0.2s ease;
  }
  .yta-player-controls__add:hover:not([disabled]) {
    background: rgba(255, 61, 52, 0.98);
    transform: translateY(-1px);
  }
  .yta-player-controls__add[disabled] {
    opacity: 0.65;
    cursor: not-allowed;
    transform: none;
  }
  .yta-player-controls__add[hidden] {
    display: none !important;
  }
  .yta-player-controls__start {
    width: auto !important;
    min-width: 132px;
    height: 32px;
    padding: 0 16px;
    font-size: 14px;
    font-weight: 600;
    text-align: center;
  }
  .yta-player-controls__postpone {
    width: auto !important;
    min-width: 108px;
    height: 32px;
    padding: 0 12px;
    gap: 6px;
    font-size: 14px;
    font-weight: 500;
  }
  .yta-player-controls__postpone span {
    display: inline-flex;
    align-items: center;
    pointer-events: none;
  }
  .yta-player-controls__postpone-icon {
    font-size: 16px;
    line-height: 1;
  }
  .yta-player-controls[data-hidden="1"] {
    opacity: 0;
    pointer-events: none;
  }
  .yta-inline-queue {
    --inline-queue-gap: 6px;
    position: relative;
    display: none;
    padding: 12px 14px;
    margin: 10px 0 14px;
    color: var(--yt-spec-text-primary, #fff);
    box-sizing: border-box;
    isolation: isolate;
  }
  .yta-inline-queue > * {
    position: relative;
    z-index: 1;
  }
  .yta-inline-queue::before {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: 12px;
    background: var(--yt-spec-raised-background, rgba(18, 18, 18, 0.95));
    border: 1px solid rgba(255, 255, 255, 0.08);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.28);
    pointer-events: none;
  }
  .yta-inline-queue[data-placement="sidebar"] {
    margin: 0 0 16px;
  }
  .yta-inline-queue[data-visible="1"] {
    display: block;
  }
  .yta-inline-queue__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 10px;
    flex-wrap: wrap;
  }
  .yta-inline-queue__header-line {
    display: flex;
    align-items: center;
    flex-wrap: nowrap;
    gap: 8px;
    flex: 1 1 auto;
    min-width: 0;
  }
  .yta-inline-queue__brand {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--yt-spec-text-secondary, rgba(255, 255, 255, 0.6));
    flex: 0 0 auto;
  }
  .yta-inline-queue__title {
    align-self: center;
    display: inline-flex;
    align-items: center;
    font-size: 15px;
    font-weight: 700;
    letter-spacing: 0.01em;
    color: var(--yt-spec-text-primary, #fff);
    line-height: 1.3;
    word-break: normal;
    white-space: nowrap;
    min-width: auto;
    flex: 0 0 auto;
    cursor: pointer;
  }
  .yta-inline-queue__title:hover,
  .yta-inline-queue__title:focus-visible {
    text-decoration: underline;
    outline: none;
  }
  .yta-inline-queue__now-playing {
    display: block;
    align-self: center;
    font-size: 13px;
    color: var(--yt-spec-text-secondary, rgba(255, 255, 255, 0.72));
    line-height: 1.35;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
    max-width: 100%;
    width: 100%;
    flex: 1 1 auto;
    text-align: center;
  }
  .yta-inline-queue__progress {
    font-size: 12.5px;
    font-weight: 600;
    color: var(--yt-spec-text-primary, rgba(255, 255, 255, 0.92));
    white-space: nowrap;
    flex: 0 0 auto;
    cursor: pointer;
  }
  .yta-inline-queue__freeze {
    margin-left: auto;
    font-weight: 600;
    color: var(--yt-spec-text-primary, #fff);
    white-space: nowrap;
  }
  .yta-inline-queue__empty {
    font-size: 13px;
    color: var(--yt-spec-text-secondary, rgba(255, 255, 255, 0.74));
    border: 1px dashed rgba(255, 255, 255, 0.18);
    border-radius: 10px;
    padding: 12px;
    text-align: center;
    margin: 4px 0 10px;
    background: rgba(255, 255, 255, 0.04);
  }
  .yta-inline-queue[data-empty="0"] .yta-inline-queue__empty {
    display: none;
  }
  .yta-inline-queue[data-empty="1"] .yta-inline-queue__list {
    display: none;
  }
  .yta-inline-queue__list {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .yta-inline-queue .video-list {
    display: flex;
    flex-direction: column;
    gap: var(--inline-queue-gap, 6px);
    max-height: none;
    overflow: visible;
    position: relative;
  }
  .yta-inline-queue[data-placement="sidebar"] .video-list {
    max-height: min(72vh, 620px);
    overflow-y: auto;
  }
  .yta-inline-queue[data-placement="stack"] .video-list {
    max-height: min(52vh, 540px);
    overflow-y: auto;
  }
  .yta-inline-queue__item {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .yta-inline-queue .video-item {
    --video-item-thumbnail-width: 112px;
    --video-item-grid-template:
      24px var(--video-item-thumbnail-width) minmax(0, 1fr);
    --video-item-min-height: 63px;
    --video-item-background: rgba(255, 255, 255, 0.05);
    --video-item-hover-background: rgba(255, 255, 255, 0.08);
    --video-item-active-background: rgba(229, 57, 53, 0.15);
    --video-item-border-color: transparent;
    --video-item-hover-border-color: #e53935;
    --video-item-active-border-color: #e53935;
    --video-item-cursor: pointer;
    --video-body-padding-top: 0;
    --video-body-padding-right: 40px;
    --video-body-padding-bottom: 0;
    --video-body-padding-left: 14px;
    --video-body-gap: 4px;
    position: relative;
    display: grid;
    grid-template-columns: var(--video-item-grid-template);
    align-items: stretch;
    column-gap: 0;
    row-gap: 0;
    min-height: var(--video-item-min-height);
    padding: 0;
    border-radius: 10px;
    overflow: hidden;
    background: var(--video-item-background);
    cursor: var(--video-item-cursor);
    transition: background 0.2s ease, border-color 0.2s ease;
    border: 1px solid var(--video-item-border-color);
  }
  .yta-inline-queue[data-placement="sidebar"] .video-item {
    --video-item-thumbnail-width: 132px;
    --video-item-min-height: 74px;
    --video-body-padding-right: 44px;
    --video-body-padding-left: 16px;
  }
  .yta-inline-queue .video-item:hover {
    background: var(--video-item-hover-background);
    border-color: var(--video-item-hover-border-color);
  }
  .yta-inline-queue .video-item.active,
  .yta-inline-queue__item[data-current="1"] .video-item {
    border-color: var(--video-item-active-border-color);
    background: var(--video-item-active-background);
  }
  .yta-inline-queue .video-item:focus-visible {
    outline: 2px solid var(--yt-spec-themed-blue, #3ea6ff);
    outline-offset: 3px;
  }
  .yta-inline-queue .video-item[disabled] {
    opacity: 0.6;
    cursor: wait;
  }
  .yta-inline-queue .video-item.dragging {
    opacity: 0.55;
  }
  .yta-inline-queue .video-item.drop-before::after,
  .yta-inline-queue .video-item.drop-after::after {
    content: "";
    position: absolute;
    left: 20px;
    right: 20px;
    height: 2px;
    border-radius: 999px;
    background: linear-gradient(
      90deg,
      rgba(244, 67, 54, 0) 0%,
      rgba(244, 67, 54, 0.9) 20%,
      rgba(244, 67, 54, 0.9) 80%,
      rgba(244, 67, 54, 0) 100%
    );
    box-shadow: 0 0 4px rgba(244, 67, 54, 0.4);
    pointer-events: none;
  }
  .yta-inline-queue .video-item.drop-before::after {
    top: 0;
    transform: translateY(
      calc(-50% - (var(--inline-queue-gap, 6px) / 2))
    );
  }
  .yta-inline-queue .video-item.drop-after::after {
    bottom: 0;
    transform: translateY(
      calc(50% + (var(--inline-queue-gap, 6px) / 2))
    );
  }
  .yta-inline-queue .video-item.drop-before,
  .yta-inline-queue .video-item.drop-after {
    overflow: visible;
  }
  .yta-inline-queue .video-handle {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    margin: 0;
    padding: 0;
    border: none;
    border-right: 1px solid rgba(255, 255, 255, 0.08);
    background: rgba(255, 255, 255, 0.02);
    color: rgba(255, 255, 255, 0.45);
    cursor: grab;
    transition: background 0.2s ease, color 0.2s ease;
  }
  .yta-inline-queue .video-handle::before,
  .yta-inline-queue .video-handle::after {
    content: "";
    position: absolute;
    top: 50%;
    width: 2px;
    height: 2px;
    border-radius: 50%;
    background: currentColor;
    transform: translate(-50%, -50%);
    box-shadow:
      0 -6px 0 currentColor,
      0 6px 0 currentColor;
  }
  .yta-inline-queue .video-handle::before {
    left: calc(50% - 3px);
  }
  .yta-inline-queue .video-handle::after {
    left: calc(50% + 3px);
  }
  .yta-inline-queue .video-handle:active {
    cursor: grabbing;
  }
  .yta-inline-queue .video-handle:hover {
    background: rgba(229, 57, 53, 0.16);
    color: rgba(229, 57, 53, 0.9);
  }
  .yta-inline-queue .icon-button {
    position: absolute;
    width: 26px;
    height: 26px;
    border-radius: 50%;
    border: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    line-height: 1;
    background: rgba(0, 0, 0, 0.45);
    color: #f5f5f5;
    cursor: pointer;
    transition: background 0.2s ease, transform 0.15s ease, opacity 0.2s ease;
  }
  .yta-inline-queue .icon-button:disabled {
    opacity: 0.55;
    cursor: not-allowed;
    transform: none;
  }
  .yta-inline-queue .video-remove {
    top: 4px;
    right: 4px;
  }
  .yta-inline-queue .video-remove:hover {
    background: rgba(229, 57, 53, 0.85);
  }
  .yta-inline-queue .video-quick-filter {
    top: 4px;
    right: 32px;
  }
  .yta-inline-queue .video-quick-filter:hover {
    background: rgba(33, 150, 243, 0.85);
  }
  .yta-inline-queue .video-postpone {
    bottom: 4px;
    right: 32px;
  }
  .yta-inline-queue .video-postpone:hover {
    background: rgba(255, 193, 7, 0.85);
  }
  .yta-inline-queue .video-item:not(.video-item--has-postpone) .video-postpone {
    display: none;
  }
  .yta-inline-queue .video-move {
    bottom: 4px;
    right: 4px;
  }
  .yta-inline-queue .video-move:hover {
    background: rgba(33, 150, 243, 0.85);
  }
  .yta-inline-queue .video-thumb-wrapper {
    position: relative;
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    align-self: stretch;
    justify-self: stretch;
  }
  .yta-inline-queue .video-thumb {
    width: 100%;
    aspect-ratio: 16 / 9;
    height: auto;
    object-fit: contain;
    object-position: center;
    background: #000;
    flex-shrink: 0;
    overflow: hidden;
    align-self: center;
    justify-self: stretch;
    display: block;
  }
  .yta-inline-queue .video-thumb__duration {
    position: absolute;
    bottom: 1px;
    right: 1px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 1px 4px;
    color: #fff;
    -webkit-text-fill-color: #fff;
    font-size: 11px;
    font-weight: 600;
    line-height: 1.2;
    letter-spacing: 0.2px;
    text-align: center;
    white-space: nowrap;
    background: rgba(0, 0, 0, 0.7);
    border-radius: 6px;
  }
  .yta-inline-queue .video-body {
    display: flex;
    flex-direction: column;
    gap: var(--video-body-gap);
    min-width: 0;
    padding: var(--video-body-padding-top) var(--video-body-padding-right)
      var(--video-body-padding-bottom) var(--video-body-padding-left);
    justify-content: center;
    height: 100%;
  }
  .yta-inline-queue .video-title {
    font-weight: 600;
    font-size: 12.5px;
    color: var(--yt-spec-text-primary, #fff);
    line-height: 1.3;
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }
  .yta-inline-queue .video-details {
    font-size: 10.5px;
    opacity: 0.75;
    display: flex;
    flex-wrap: wrap;
    column-gap: 0;
    row-gap: 4px;
    align-items: center;
    color: var(--yt-spec-text-secondary, rgba(255, 255, 255, 0.72));
  }
  .yta-inline-queue .video-details > span:not(.video-details__separator) {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    line-height: 1;
  }
  .yta-inline-queue .video-details__separator {
    display: inline-block;
    padding: 0 4px;
    font-size: inherit;
    line-height: 1;
    opacity: 0.5;
    vertical-align: middle;
  }
  .yta-inline-queue .video-detail__icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    line-height: 1;
  }
  .yta-inline-queue .video-detail__text {
    display: inline-flex;
    align-items: center;
    line-height: 1;
  }
  .yta-inline-queue__detail-link {
    color: inherit;
    text-decoration: none;
    font-weight: 600;
  }
  .yta-inline-queue__detail-link:hover {
    color: var(--yt-spec-text-primary, #fff);
    text-decoration: underline;
  }
  .yta-inline-move-menu {
    position: fixed;
    z-index: 2147483647;
    display: none;
    flex-direction: column;
    gap: 8px;
    padding: 12px 14px;
    background: rgba(17, 17, 17, 0.96);
    border: 1px solid rgba(255, 255, 255, 0.18);
    border-radius: 12px;
    box-shadow: 0 18px 42px rgba(0, 0, 0, 0.4);
    color: #f5f5f5;
    max-width: min(280px, calc(100% - 32px));
    box-sizing: border-box;
  }
  .yta-inline-move-menu[data-visible="1"] {
    display: flex;
  }
  .yta-inline-move-menu__message {
    font-size: 12.5px;
    line-height: 1.35;
    opacity: 0.85;
  }
  .yta-inline-move-menu__buttons {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .yta-inline-move-menu__buttons[data-empty="1"] {
    display: none;
  }
  .yta-inline-move-menu__option {
    border: none;
    border-radius: 8px;
    padding: 9px 12px;
    font-size: 13px;
    font-weight: 600;
    background: rgba(229, 57, 53, 0.95);
    color: #fff;
    cursor: pointer;
    transition: background 0.2s ease, transform 0.15s ease;
    text-align: left;
  }
  .yta-inline-move-menu__option:hover {
    background: rgba(244, 81, 58, 0.98);
    transform: translateY(-1px);
  }
  .yta-page-actions {
    position: fixed;
    top: 140px;
    right: 16px;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 10px;
    z-index: 2147483647;
    transition: opacity 0.2s ease, transform 0.2s ease;
  }
  .yta-page-actions[data-hidden="1"] {
    display: none;
  }
  .yta-page-actions[data-controls-hidden="1"] {
    opacity: 0;
    pointer-events: none;
  }
  .yta-page-actions__toggle {
    width: 52px;
    height: 52px;
    border-radius: 50%;
    border: 1px solid rgba(255, 255, 255, 0.12);
    padding: 0;
    background: rgba(22, 22, 26, 0.88);
    color: #fff;
    box-shadow: 0 14px 28px rgba(0, 0, 0, 0.32);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    backdrop-filter: blur(14px);
    transition: transform 0.2s ease, background 0.2s ease, box-shadow 0.2s ease;
  }
  .yta-page-actions__toggle img {
    width: 28px;
    height: 28px;
    pointer-events: none;
  }
  .yta-page-actions__toggle-fallback {
    font-weight: 700;
    font-size: 13px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .yta-page-actions__toggle:hover,
  .yta-page-actions[data-expanded="1"] .yta-page-actions__toggle {
    transform: translateY(-1px) scale(1.04);
    background: rgba(32, 32, 36, 0.92);
    box-shadow: 0 18px 34px rgba(0, 0, 0, 0.36);
  }
  .yta-page-actions__panel {
    min-width: 220px;
    max-width: 280px;
    padding: 14px 16px 16px;
    border-radius: 20px;
    background: rgba(16, 16, 20, 0.82);
    backdrop-filter: blur(18px);
    border: 1px solid rgba(255, 255, 255, 0.08);
    color: #fff;
    display: none;
    flex-direction: column;
    align-items: stretch;
    gap: 12px;
    text-align: center;
    opacity: 0;
    pointer-events: none;
    transform: translateY(-8px) scale(0.96);
    transform-origin: top right;
    transition: opacity 0.22s ease, transform 0.22s ease;
    box-shadow: 0 20px 42px rgba(0, 0, 0, 0.36);
  }
  .yta-page-actions[data-expanded="1"] .yta-page-actions__panel,
  .yta-page-actions__panel[data-status-visible="1"] {
    display: flex;
    opacity: 1;
    pointer-events: auto;
    transform: translateY(0) scale(1);
  }
  .yta-page-actions__actions {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .yta-page-actions__action {
    border: none;
    border-radius: 999px;
    padding: 10px 22px;
    background: rgba(229, 45, 39, 0.94);
    color: #ffffff;
    font-weight: 600;
    font-size: 14px;
    line-height: 1.32;
    cursor: pointer;
    transition: background 0.2s ease, transform 0.15s ease, opacity 0.2s ease;
    display: inline-flex;
    justify-content: center;
    align-items: center;
    text-align: center;
    box-shadow: 0 12px 26px rgba(229, 45, 39, 0.38);
  }
  .yta-page-actions__action:hover {
    background: rgba(255, 61, 52, 0.98);
    transform: translateY(-1px);
  }
  .yta-page-actions__action:disabled {
    opacity: 0.7;
    cursor: progress;
    transform: none;
    box-shadow: none;
  }
  .yta-page-actions__info {
    font-size: 13px;
    line-height: 1.4;
    color: rgba(255, 255, 255, 0.9);
    text-align: center;
    display: none;
    border-radius: 999px;
    padding: 7px 16px;
    background: rgba(255, 255, 255, 0.12);
    align-self: center;
  }
  .yta-page-actions__info[data-visible="1"] {
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .yta-page-actions__info[data-dimmed="1"] {
    opacity: 0.55;
  }
  .yta-page-actions__status {
    padding: 10px 16px;
    border-radius: 16px;
    background: rgba(0, 0, 0, 0.34);
    color: rgba(255, 255, 255, 0.94);
    font-size: 12px;
    line-height: 1.45;
    display: none;
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.05);
  }
  .yta-page-actions__status[data-visible="1"] {
    display: block;
  }
  .yta-page-actions__status[data-kind="success"] {
    background: rgba(26, 140, 77, 0.36);
    color: #d6ffe8;
  }
  .yta-page-actions__status[data-kind="error"] {
    background: rgba(229, 45, 39, 0.32);
    color: #ffe3e3;
  }
  .yta-page-actions__stop {
    border: 1px solid rgba(255, 255, 255, 0.22);
    border-radius: 999px;
    padding: 8px 20px;
    background: rgba(15, 15, 18, 0.42);
    color: #ffffff;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.2s ease, transform 0.15s ease, opacity 0.2s ease;
    display: none;
  }
  .yta-page-actions__stop:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.22);
    transform: translateY(-1px);
  }
  .yta-page-actions__stop:disabled {
    opacity: 0.6;
    cursor: progress;
    transform: none;
  }
  .yta-page-actions[data-collecting="1"] .yta-page-actions__stop {
    display: inline-flex;
    justify-content: center;
  }
  .yta-page-actions[data-collecting="1"] .yta-page-actions__toggle {
    box-shadow: 0 10px 20px rgba(0, 0, 0, 0.24);
  }
  .yta-page-actions--player {
    position: absolute;
    top: auto;
    right: 24px;
    left: auto;
    bottom: 96px;
    align-items: flex-end;
  }
  .yta-page-actions[data-context="watch"] {
    gap: 6px;
  }
  .yta-page-actions[data-context="watch"] .yta-page-actions__panel {
    background: transparent;
    border: none;
    box-shadow: none;
    padding: 0;
    opacity: 1;
    pointer-events: auto;
    transform: none;
    align-items: flex-end;
  }
  .yta-page-actions[data-context="watch"] .yta-page-actions__actions {
    gap: 0;
  }
  .yta-page-actions[data-context="watch"] .yta-page-actions__action {
    border: none;
    border-radius: 999px;
    padding: 10px 24px;
    background: rgba(229, 45, 39, 0.96);
    font-size: 15px;
    box-shadow: none;
  }
  .yta-page-actions[data-context="watch"] .yta-page-actions__action:hover {
    background: rgba(255, 61, 52, 0.98);
  }
  .yta-page-actions[data-context="watch"] .yta-page-actions__status {
    background: rgba(0, 0, 0, 0.55);
  }
  .yta-page-actions[data-context="watch"] .yta-page-actions__info {
    text-align: center;
    background: rgba(0, 0, 0, 0.55);
    font-size: 14px;
    padding: 8px 18px;
  }
  .yta-page-actions[data-context="watch"] .yta-page-actions__stop {
    display: none !important;
  }
  `;
  document.head.appendChild(style);
}
