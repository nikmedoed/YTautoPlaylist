// Injected inline queue styles. Exports CSS text used by the content script for YouTube-page UI.
export function getInlineQueueShellStyles() {
  return `
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
  `;
}
