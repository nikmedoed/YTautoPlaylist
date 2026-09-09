// Playlist sync import conflict decisions. Separates timestamp/pending policy
// from the storage adapter so stale-device handling stays explicit.

export function resolvePlaylistImportDecision({
  force = false,
  localHasUserData = false,
  mergePending = false,
  remoteHash = "",
  remoteUpdatedAt = 0,
  status = {},
} = {}) {
  const localUpdatedAt = Number(status.localUpdatedAt) || 0;
  const remoteChanged =
    remoteHash &&
    remoteHash !== status.remoteHash &&
    remoteHash !== status.localHash;
  const shouldMerge =
    mergePending &&
    status.pending &&
    localHasUserData &&
    remoteChanged;
  const remoteIsNewerBaseline =
    !status.pending && remoteUpdatedAt > localUpdatedAt;
  return {
    shouldImport: force || !localHasUserData || shouldMerge || remoteIsNewerBaseline,
    shouldMerge,
    shouldReplace: force || !localHasUserData || (!shouldMerge && remoteIsNewerBaseline),
  };
}
