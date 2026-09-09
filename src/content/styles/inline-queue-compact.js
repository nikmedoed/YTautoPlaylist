// Adapt to the actual YouTube column width, including portrait displays.
export function getInlineQueueCompactStyles() {
  return `
  @container yta-queue (max-width: 380px) {
    .yta-inline-queue[data-placement] .video-item {
      --video-item-thumbnail-width: 96px;
      --video-item-grid-template: 18px 96px minmax(0, 1fr);
      --video-item-min-height: 92px;
      --video-body-padding-top: 6px;
      --video-body-padding-right: 6px;
      --video-body-padding-bottom: 6px;
      --video-body-padding-left: 8px;
      --video-body-gap: 5px;
    }
    .yta-inline-queue .video-thumb-wrapper {
      align-self: start;
      margin-top: 6px;
    }
    .yta-inline-queue .video-body {
      height: auto;
      justify-content: flex-start;
    }
    .yta-inline-queue .video-item > .icon-button {
      top: auto;
      bottom: 4px;
      right: auto;
      width: 24px;
      height: 24px;
      padding: 0;
    }
    .yta-inline-queue .video-quick-filter { left: 18px; }
    .yta-inline-queue .video-postpone { left: 42px; }
    .yta-inline-queue .video-move { left: 66px; }
    .yta-inline-queue .video-remove { left: 90px; }
    .yta-inline-queue .video-details {
      gap: 3px 0;
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
      line-height: 1.25;
    }
    .yta-inline-queue .video-details__separator { display: none; }
    .yta-inline-queue .video-details > span:first-child { flex-basis: 100%; }
    .yta-inline-queue__header-line { flex-wrap: wrap; gap: 4px 8px; }
    .yta-inline-queue__brand { flex-basis: 100%; font-size: 10px; }
    .yta-inline-queue__title {
      display: block;
      min-width: 0;
      flex: 1 1 0;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .yta-inline-queue__now-playing { display: none; }
  }
  `;
}
