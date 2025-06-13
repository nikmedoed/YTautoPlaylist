export function logMessage(level, vId, count, message) {
  const text = `Video id: ${vId} :: Count: ${count}\n${message}`;
  if (level === 'warn') {
    console.warn(text);
  } else {
    console.error(text);
  }
}

export function storeDate(date) {
  if (typeof chrome === 'undefined') return Promise.resolve();
  return chrome.storage.sync.set({ lastVideoDate: date.toString() }, () => {
    console.log('lastVideoDate is set to ' + date);
  });
}

export function formatDate(date) {
  const options = {
    year: '2-digit',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric'
  };
  return date.toLocaleString('ru', options);
}

export function parseDuration(duration) {
  const reptms = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/;
  let hours = 0, minutes = 0, seconds = 0;
  let totalseconds;

  if (reptms.test(duration)) {
    const matches = reptms.exec(duration);
    if (matches[1]) hours = Number(matches[1]);
    if (matches[2]) minutes = Number(matches[2]);
    if (matches[3]) seconds = Number(matches[3]);
    totalseconds = hours * 3600 + minutes * 60 + seconds;
  }
  return totalseconds;
}
