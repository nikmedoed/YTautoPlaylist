// Content diagnostics helpers. Contains debug logging and health checks for the YouTube page integration.
const YTA_DIAG_FLAG_KEY = "yta_diag_enabled";

const ytaDiag = {
  enabled: false,
  stats: new Map(),
  longTasks: [],
  loopLag: [],
  buffering: {
    samples: 0,
    stalledSamples: 0,
    totalStalledMs: 0,
  },
  timers: {
    loopLag: null,
    videoSample: null,
  },
  observers: {
    longTask: null,
  },
  getVideoElement: null,
};

function ytaDiagRecord(name, durationMs) {
  if (!ytaDiag.enabled) return;
  const safeDuration = Number.isFinite(durationMs) ? durationMs : 0;
  const previous = ytaDiag.stats.get(name) || {
    count: 0,
    total: 0,
    max: 0,
    over16: 0,
    over50: 0,
  };
  previous.count += 1;
  previous.total += safeDuration;
  previous.max = Math.max(previous.max, safeDuration);
  if (safeDuration >= 16) previous.over16 += 1;
  if (safeDuration >= 50) previous.over50 += 1;
  ytaDiag.stats.set(name, previous);
}

export function ytaDiagMeasure(name, fn) {
  const started = performance.now();
  try {
    return fn();
  } finally {
    ytaDiagRecord(name, performance.now() - started);
  }
}

function getTrackedVideoElement() {
  if (typeof ytaDiag.getVideoElement === "function") {
    const video = ytaDiag.getVideoElement();
    if (video) return video;
  }
  return document.querySelector("video");
}

function ytaDiagSampleVideo() {
  if (!ytaDiag.enabled) return;
  const video = getTrackedVideoElement();
  if (!video) return;
  ytaDiag.buffering.samples += 1;
  const likelyBuffering =
    !video.paused &&
    !video.ended &&
    (video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA ||
      video.networkState === HTMLMediaElement.NETWORK_LOADING);
  if (likelyBuffering) {
    ytaDiag.buffering.stalledSamples += 1;
    ytaDiag.buffering.totalStalledMs += 1000;
  }
}

function ytaDiagReport() {
  const rows = Array.from(ytaDiag.stats.entries()).map(([name, stat]) => {
    const avg = stat.count > 0 ? stat.total / stat.count : 0;
    return {
      name,
      calls: stat.count,
      avgMs: Number(avg.toFixed(2)),
      maxMs: Number(stat.max.toFixed(2)),
      over16: stat.over16,
      over50: stat.over50,
    };
  });
  rows.sort((a, b) => b.maxMs - a.maxMs);
  const lagSamples = ytaDiag.loopLag;
  const lagAvg =
    lagSamples.length > 0
      ? lagSamples.reduce((sum, value) => sum + value, 0) / lagSamples.length
      : 0;
  const lagMax = lagSamples.length > 0 ? Math.max(...lagSamples) : 0;
  console.group("YTA Diagnostic Report");
  console.table(rows);
  console.log("Long tasks:", ytaDiag.longTasks.length, ytaDiag.longTasks.slice(-10));
  console.log("Loop lag avg/max (ms):", Number(lagAvg.toFixed(2)), Number(lagMax.toFixed(2)));
  console.log("Buffer samples:", ytaDiag.buffering);
  console.groupEnd();
  return {
    rows,
    longTasks: ytaDiag.longTasks.slice(),
    loopLag: {
      samples: lagSamples.length,
      avgMs: Number(lagAvg.toFixed(2)),
      maxMs: Number(lagMax.toFixed(2)),
    },
    buffering: { ...ytaDiag.buffering },
  };
}

function ytaDiagReset() {
  ytaDiag.stats.clear();
  ytaDiag.longTasks = [];
  ytaDiag.loopLag = [];
  ytaDiag.buffering = {
    samples: 0,
    stalledSamples: 0,
    totalStalledMs: 0,
  };
}

function ytaDiagStopInternal() {
  if (ytaDiag.timers.loopLag) {
    clearInterval(ytaDiag.timers.loopLag);
    ytaDiag.timers.loopLag = null;
  }
  if (ytaDiag.timers.videoSample) {
    clearInterval(ytaDiag.timers.videoSample);
    ytaDiag.timers.videoSample = null;
  }
  if (ytaDiag.observers.longTask) {
    try {
      ytaDiag.observers.longTask.disconnect();
    } catch {
      /* ignore */
    }
    ytaDiag.observers.longTask = null;
  }
}

function ytaDiagStartInternal() {
  if (ytaDiag.enabled) return;
  ytaDiag.enabled = true;
  ytaDiagReset();

  let expectedAt = Date.now() + 1000;
  ytaDiag.timers.loopLag = setInterval(() => {
    const now = Date.now();
    const lag = Math.max(0, now - expectedAt);
    expectedAt = now + 1000;
    if (ytaDiag.loopLag.length >= 120) {
      ytaDiag.loopLag.shift();
    }
    ytaDiag.loopLag.push(lag);
  }, 1000);

  ytaDiag.timers.videoSample = setInterval(ytaDiagSampleVideo, 1000);

  if (typeof PerformanceObserver === "function") {
    try {
      const observer = new PerformanceObserver((entryList) => {
        const entries = entryList.getEntries();
        for (const entry of entries) {
          if (ytaDiag.longTasks.length >= 120) {
            ytaDiag.longTasks.shift();
          }
          ytaDiag.longTasks.push({
            name: entry.name,
            duration: Number(entry.duration.toFixed(2)),
            startTime: Number(entry.startTime.toFixed(2)),
          });
        }
      });
      observer.observe({ entryTypes: ["longtask"] });
      ytaDiag.observers.longTask = observer;
    } catch {
      /* ignore unsupported longtask observer */
    }
  }
  console.info("[YTA] diagnostics enabled");
}

function ytaDiagStart() {
  try {
    localStorage.setItem(YTA_DIAG_FLAG_KEY, "1");
  } catch {
    /* ignore */
  }
  ytaDiagStartInternal();
}

function ytaDiagStop() {
  ytaDiag.enabled = false;
  ytaDiagStopInternal();
  try {
    localStorage.removeItem(YTA_DIAG_FLAG_KEY);
  } catch {
    /* ignore */
  }
  console.info("[YTA] diagnostics disabled");
}

function shouldEnableYtaDiagFromStorage() {
  try {
    return localStorage.getItem(YTA_DIAG_FLAG_KEY) === "1";
  } catch {
    return false;
  }
}

export function initYtaDiagnostics({ getVideoElement } = {}) {
  ytaDiag.getVideoElement =
    typeof getVideoElement === "function" ? getVideoElement : null;
  globalThis.ytaDiagStart = ytaDiagStart;
  globalThis.ytaDiagStop = ytaDiagStop;
  globalThis.ytaDiagReport = ytaDiagReport;
  globalThis.ytaDiagReset = ytaDiagReset;
  if (shouldEnableYtaDiagFromStorage()) {
    ytaDiagStartInternal();
  }
}
