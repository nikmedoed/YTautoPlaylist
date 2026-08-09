// Background account sync flushing. Converts pending local playlist/settings
// markers into Drive/storage writes after their debounce window expires.
import {
  flushPendingPlaylistSync,
  flushPendingSettingsSync,
  importDriveSync,
  pushLocalDriveSyncNow,
} from "../store/index.js";

const REMOTE_REFRESH_THROTTLE_MS = 30 * 1000;

let flushPromise = null;
let remoteRefreshPromise = null;
let lastRemoteRefreshAt = 0;

export async function flushPendingAccountSync() {
  if (flushPromise) {
    return flushPromise;
  }
  flushPromise = (async () => {
    const [playlist] = await Promise.all([
      flushPendingPlaylistSync(),
      flushPendingSettingsSync(),
    ]);
    let drive = null;
    if (playlist?.ready) {
      drive = await pushLocalDriveSyncNow({
        interactive: false,
        expectedMutationVersion: playlist.mutationVersion,
      });
    }
    return { playlist, drive };
  })();
  try {
    return await flushPromise;
  } finally {
    flushPromise = null;
  }
}

export function requestAccountSyncFlush() {
  flushPendingAccountSync().catch((err) => {
    console.error("Account sync flush failed", err);
  });
}

export async function refreshRemoteAccountSync(options = {}) {
  const force = Boolean(options.force);
  const now = Date.now();
  if (!force && now - lastRemoteRefreshAt < REMOTE_REFRESH_THROTTLE_MS) {
    return { imported: false, skipped: true, reason: "throttled" };
  }
  if (remoteRefreshPromise) {
    return remoteRefreshPromise;
  }
  lastRemoteRefreshAt = now;
  remoteRefreshPromise = importDriveSync({ interactive: false });
  try {
    return await remoteRefreshPromise;
  } finally {
    remoteRefreshPromise = null;
  }
}
