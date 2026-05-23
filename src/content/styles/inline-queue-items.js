// Injected inline queue items styles. Exports CSS text used by the content script for YouTube-page UI.
export function getInlineQueueItemStyles() {
  return `
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
  `;
}
