export function logMessage(level, id, count, message) {
  const text = `Video id: ${id} :: Count: ${count}\n${message}`;
  if (level === "warn") {
    console.warn(text);
  } else {
    console.error(text);
  }
}

export function storeDate(date) {
  if (typeof chrome === "undefined") {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    chrome.storage.sync.set({ lastVideoDate: date.toString() }, () => {
      console.log("lastVideoDate is set to " + date);
      resolve();
    });
  });
}

export function formatDate(date) {
  const options = {
    year: "2-digit",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  };
  return date.toLocaleString("ru", options);
}

export function parseDuration(duration) {
  const reptms = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/;
  let hours = 0,
    minutes = 0,
    seconds = 0;
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

export function parseVideoId(input) {
  if (!input) return "";
  const str = String(input).trim();
  if (/^[\w-]{11}$/.test(str)) return str;
  try {
    const url = new URL(str);
    if (url.hostname.includes("youtu.be")) {
      const parts = url.pathname.split("/").filter(Boolean);
      const id = parts[0];
      if (/^[\w-]{11}$/.test(id)) return id;
    }
    if (url.searchParams.has("v")) {
      const id = url.searchParams.get("v");
      if (id && /^[\w-]{11}$/.test(id)) return id;
    }
    const segments = url.pathname.split("/");
    for (const part of segments) {
      if (/^[\w-]{11}$/.test(part)) return part;
    }
  } catch (e) {
    /* not a URL */
  }
  const match = str.match(/[\w-]{11}/);
  return match ? match[0] : "";
}

export const logMessages = [];
export function setupLogCapture() {
  const originalLog = console.log.bind(console);
  console.log = (...args) => {
    logMessages.push(
      args
        .map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a)))
        .join(" ")
    );
    if (logMessages.length > 100) logMessages.shift();
    originalLog(...args);
  };
}
