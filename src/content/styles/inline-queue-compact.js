// Adapt to the actual YouTube column width, including portrait displays.
export function getInlineQueueCompactStyles() {
  return `
  @container yta-queue (max-width: 460px) {
    .yta-inline-queue[data-placement] .video-item {
      --video-item-thumbnail-width: 112px;
      --video-item-grid-template: 18px 112px minmax(0, 1fr);
      --video-item-min-height: 63px;
      --video-body-padding-top: 4px;
      --video-body-padding-right: 56px;
      --video-body-padding-bottom: 4px;
      --video-body-padding-left: 8px;
      --video-body-gap: 2px;
    }
    .yta-inline-queue .video-thumb-wrapper {
      align-self: stretch;
      margin-top: 0;
    }
    .yta-inline-queue .video-thumb {
      height: auto;
      aspect-ratio: 16 / 9;
      object-fit: contain;
    }
    .yta-inline-queue .video-body {
      height: 100%;
      justify-content: center;
    }
    .yta-inline-queue .video-item > .icon-button {
      width: 23px;
      height: 23px;
      padding: 0;
    }
    .yta-inline-queue .video-quick-filter {
      display: inline-flex;
      top: 4px;
      right: 30px;
    }
    .yta-inline-queue .video-remove {
      top: 4px;
      right: 4px;
    }
    .yta-inline-queue .video-postpone {
      top: auto;
      bottom: 4px;
      right: 30px;
    }
    .yta-inline-queue .video-move {
      display: inline-flex;
      top: auto;
      bottom: 4px;
      right: 4px;
    }
    .yta-inline-queue .video-title {
      font-size: 11.5px;
      line-height: 1.15;
    }
    .yta-inline-queue .video-details {
      font-size: 9.5px;
      row-gap: 2px;
    }
    .yta-inline-queue .video-details > span:not(.video-details__separator) {
      min-width: 0;
      max-width: 100%;
    }
    .yta-inline-queue .video-detail__text {
      display: block;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      line-height: 1.2;
    }
    .yta-inline-queue .video-details__separator {
      display: none;
    }
    .yta-inline-queue .video-details > span:first-child {
      flex-basis: 100%;
    }
    .yta-inline-queue__header {
      gap: 6px;
      flex-wrap: nowrap;
    }
    .yta-inline-queue__header-line {
      flex-wrap: nowrap;
      gap: 5px;
    }
    .yta-inline-queue__brand {
      flex-basis: auto;
      font-size: 9px;
    }
    .yta-inline-queue__title {
      display: block;
      min-width: 0;
      flex: 0 1 auto;
      overflow: hidden;
      text-overflow: ellipsis;
      font-size: 13px;
    }
    .yta-inline-queue__now-playing {
      display: block;
      font-size: 11px;
    }
  }
  @container yta-queue (max-width: 340px) {
    .yta-inline-queue[data-placement] .video-item {
      --video-body-padding-right: 32px;
    }
    .yta-inline-queue .video-quick-filter,
    .yta-inline-queue .video-move {
      display: none;
    }
    .yta-inline-queue .video-postpone {
      right: 4px;
    }
  }
  `;
}
