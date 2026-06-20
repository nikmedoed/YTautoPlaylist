// Playlist sync import conflict decisions. Separates timestamp/pending policy
// from the storage adapter so stale-device handling stays explicit.
const STARTUP_PENDING_GRACE_MS = 2 * 60 * 1000;

export function resolvePlaylistImportDecision({
  force = false,
  localHasUserData = false,
  mergePending = false,
  remoteHash = "",
  remoteUpdatedAt = 0,
  status = {},
  now = Date.now(),
} = {}) {
  const localUpdatedAt = Number(status.localUpdatedAt) || 0;
  const syncedUpdatedAt = Number(status.syncedUpdatedAt) || 0;
  const pendingSince = Number(status.pendingSince) || 0;
  const remoteChanged =
    remoteHash &&
    remoteHash !== status.remoteHash &&
    remoteHash !== status.localHash;
  const freshPendingOnStaleBase = Boolean(
    status.pending &&
      pendingSince &&
      now - pendingSince < STARTUP_PENDING_GRACE_MS &&
      remoteUpdatedAt > syncedUpdatedAt
  );
  const shouldMerge =
    mergePending &&
    status.pending &&
    !freshPendingOnStaleBase &&
    localHasUserData &&
    remoteChanged;
  const remoteIsNewerBaseline =
    (!status.pending && remoteUpdatedAt > localUpdatedAt) ||
    freshPendingOnStaleBase;
  return {
    shouldImport: force || !localHasUserData || shouldMerge || remoteIsNewerBaseline,
    shouldMerge,
    shouldReplace: force || !localHasUserData || (!shouldMerge && remoteIsNewerBaseline),
  };
}

