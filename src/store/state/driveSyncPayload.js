// Google Drive sync payload helpers. Keeps Drive file parsing, playlist
// snapshot encoding, and backup rotation separate from network code.
import {
  DRIVE_PLAYLIST_BACKUP_LIMIT,
} from "./constants.js";
import {
  buildSyncState,
  getSyncStateFingerprint,
} from "./sync.js";
import {
  normalizeSyncTimestamp,
} from "./syncSnapshot.js";

export const DRIVE_SYNC_VERSION = 1;

export function encodePlaylistSnapshot(snapshot) {
  if (!snapshot) return null;
  return {
    manifest: snapshot.manifest,
    state: snapshot.state,
  };
}
export function encodePlaylistSnapshots(snapshots = []) {
  return snapshots
    .slice(0, DRIVE_PLAYLIST_BACKUP_LIMIT)
    .map((snapshot) => encodePlaylistSnapshot(snapshot))
    .filter(Boolean);
}

function parseDrivePlaylistSnapshot(raw) {
  if (!raw || typeof raw !== "object" || !raw.state) return null;
  const state = buildSyncState(raw.state);
  const hash = getSyncStateFingerprint(state);
  const manifest =
    raw.manifest && typeof raw.manifest === "object" ? raw.manifest : {};
  if (typeof manifest.hash === "string" && manifest.hash && manifest.hash !== hash) {
    return null;
  }
  return {
    manifest: { ...manifest, hash },
    state,
    updatedAt: normalizeSyncTimestamp(manifest.updatedAt),
    hash,
  };
}

export function parseDrivePayload(raw) {
  if (!raw || typeof raw !== "object" || raw.version !== DRIVE_SYNC_VERSION) {
    return null;
  }
  const playlist = parseDrivePlaylistSnapshot(raw.playlist);
  if (!playlist) return null;
  const playlistBackups = Array.isArray(raw.playlistBackups)
    ? raw.playlistBackups
        .map((item) => parseDrivePlaylistSnapshot(item))
        .filter(Boolean)
        .slice(0, DRIVE_PLAYLIST_BACKUP_LIMIT)
    : [];
  const updatedAt =
    normalizeSyncTimestamp(raw.updatedAt) ||
    normalizeSyncTimestamp(playlist.updatedAt);
  return {
    updatedAt,
    deviceId: typeof raw.deviceId === "string" ? raw.deviceId : null,
    playlist,
    playlistBackups,
  };
}

export function buildPlaylistBackups(remotePayload, nextPlaylistHash) {
  const candidates = [
    remotePayload?.playlist,
    ...(Array.isArray(remotePayload?.playlistBackups)
      ? remotePayload.playlistBackups
      : []),
  ].filter(Boolean);
  const seenHashes = new Set();
  const backups = [];
  candidates.forEach((snapshot) => {
    const hash = typeof snapshot?.hash === "string" ? snapshot.hash : "";
    if (!hash || hash === nextPlaylistHash || seenHashes.has(hash)) {
      return;
    }
    seenHashes.add(hash);
    backups.push(snapshot);
  });
  return backups.slice(0, DRIVE_PLAYLIST_BACKUP_LIMIT);
}
