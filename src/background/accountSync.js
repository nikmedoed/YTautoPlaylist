// Background account sync flushing. Converts pending local playlist/settings
// markers into Drive/storage writes and provides a forced playlist flush for
// watch/removal mutations that must reach the cloud promptly.
import {
  flushPendingPlaylistSync,
  flushPendingSettingsSync,
  pushLocalDriveSyncNow,
} from "../store/index.js";

let flushPromise = null;

export async function flushPendingAccountSync(options = {}) {
  if (flushPromise) {
    return flushPromise;
  }
  const forcePlaylist = Boolean(options.forcePlaylist);
  flushPromise = (async () => {
    const [playlist] = await Promise.all([
      flushPendingPlaylistSync({ force: forcePlaylist }),
      flushPendingSettingsSync(),
    ]);
    if (playlist?.ready) {
      await pushLocalDriveSyncNow({ interactive: false });
    }
    return { playlist };
  })();
  try {
    return await flushPromise;
  } finally {
    flushPromise = null;
  }
}
