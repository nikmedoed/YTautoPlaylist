// Popup runtime messaging helper. Wraps chrome.runtime.sendMessage with recoverable-error handling.
export async function sendMessage(type, payload = {}, options = {}) {
  try {
    return await chrome.runtime.sendMessage({ type, ...payload });
  } catch (err) {
    const recoverable = isRecoverableRuntimeError(err);
    if (!recoverable || options.logRecoverable) {
      console.error(options.label || "Message failed", type, err);
    }
    throw err;
  }
}

export function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function getErrorMessage(err) {
  if (!err) return "";
  if (typeof err === "string") return err;
  if (typeof err.message === "string") return err.message;
  return String(err);
}

export function isRecoverableRuntimeError(err) {
  const message = getErrorMessage(err);
  return (
    /receiving end/i.test(message) ||
    /could not establish connection/i.test(message) ||
    /message port closed/i.test(message) ||
    /context invalidated/i.test(message)
  );
}
