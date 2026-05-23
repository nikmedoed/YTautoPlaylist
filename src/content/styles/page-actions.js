// Injected page actions styles. Exports CSS text used by the content script for YouTube-page UI.
export function getPageActionStyles() {
  return `
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
}
