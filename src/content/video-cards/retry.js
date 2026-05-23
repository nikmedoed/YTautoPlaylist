// Video-card retry scheduler. Re-runs enhancement after YouTube lazy rendering or SPA navigation.
import { cardRetryState } from "../core/base.js";

export function clearCardRetryTimeout(card) {
  const retryState = cardRetryState.get(card);
  if (!retryState?.timeout) return;
  clearTimeout(retryState.timeout);
  cardRetryState.set(card, {
    attempts: retryState.attempts,
    timeout: null,
  });
}

export function forgetCardRetry(card) {
  cardRetryState.delete(card);
}

export function scheduleCardRetry(card, retryCallback) {
  if (!(card instanceof HTMLElement)) return;
  const existing = cardRetryState.get(card) || { attempts: 0, timeout: null };
  if (existing.timeout || existing.attempts >= 6) return;
  const attempts = existing.attempts + 1;
  const delay = Math.min(500, 75 * attempts);
  const timeout = window.setTimeout(() => {
    if (!document.contains(card)) {
      cardRetryState.delete(card);
      return;
    }
    cardRetryState.set(card, { attempts, timeout: null });
    retryCallback(card);
  }, delay);
  cardRetryState.set(card, { attempts, timeout });
}
