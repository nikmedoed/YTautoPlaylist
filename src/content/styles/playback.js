// Injected playback styles. Exports CSS text used by the content script for YouTube-page UI.
export function getPlaybackStyles() {
  return `
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
  `;
}
