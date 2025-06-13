export function logMessage(level, vId, count, message) {
  const text = `Video id: ${vId} :: Count: ${count}\n${message}`;
  if (level === 'warn') {
    console.warn(text);
  } else {
    console.error(text);
  }
}
