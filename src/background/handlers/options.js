// Background options message handlers. Contains option-page routing and settings-related runtime actions.
import {
  getDriveSyncStatus,
  getPlaylistSyncStorageStatus,
  getSettingsSyncStatus,
  importDriveSync,
  importRemotePlaylistSyncIfNewer,
  importRemoteSettingsSync,
  pushLocalDriveSyncNow,
  pushLocalPlaylistSyncNow,
  pushLocalSettingsSyncNow,
  replaceLocalPlaylistSyncFromRemote,
  SETTINGS_SYNC_MANIFEST_STORAGE_KEY,
  SYNC_MANIFEST_STORAGE_KEY,
} from "../../store/index.js";
import { parseVideoId } from "../../utils.js";

export const optionsHandlers = {
  async "options:openQuickFilter"(message) {
    const videoId = parseVideoId(message?.videoId);
    if (!videoId) {
      return { error: "INVALID_VIDEO_ID" };
    }
    try {
      const base = chrome.runtime.getURL("src/settings/settings.html");
      const url = new URL(base);
      url.searchParams.set("quickFilterVideo", videoId);
      await chrome.tabs.create({ url: url.toString() });
      return { ok: true };
    } catch (err) {
      console.error("Failed to open quick filter page", err);
      return { error: err?.message || "FAILED_TO_OPEN_QUICK_FILTER" };
    }
  },

  async "options:openListSettings"(message) {
    const listId =
      typeof message?.listId === "string" ? message.listId.trim() : "";
    if (!listId) {
      return { error: "INVALID_LIST_ID" };
    }
    try {
      const base = chrome.runtime.getURL("src/popup/lists.html");
      const url = new URL(base);
      url.searchParams.set("listId", listId);
      const listName =
        typeof message?.listName === "string" ? message.listName.trim() : "";
      if (listName) {
        url.searchParams.set("listName", listName);
      }
      await chrome.tabs.create({ url: url.toString() });
      return { ok: true };
    } catch (err) {
      console.error("Failed to open list settings page", err);
      return { error: err?.message || "FAILED_TO_OPEN_LIST_SETTINGS" };
    }
  },

  async "sync:getStatus"() {
    const [playlist, settings, drive] = await Promise.all([
      getPlaylistSyncStorageStatus(),
      getSettingsSyncStatus(),
      getDriveSyncStatus(),
    ]);
    const syncKeys = Object.keys(await chrome.storage.sync.get(null));
    return {
      ok: true,
      extensionId: chrome.runtime.id,
      playlist,
      settings,
      drive,
      syncKeyCount: syncKeys.length,
      hasPlaylistManifest: syncKeys.includes(SYNC_MANIFEST_STORAGE_KEY),
      hasSettingsManifest: syncKeys.includes(SETTINGS_SYNC_MANIFEST_STORAGE_KEY),
    };
  },

  async "sync:pullRemote"() {
    const drive = await importDriveSync();
    const [playlist, settings] = drive.imported
      ? [{ imported: drive.playlistImported }, { imported: drive.settingsImported }]
      : await Promise.all([
        importRemotePlaylistSyncIfNewer(),
        importRemoteSettingsSync(),
      ]);
    return {
      ok: true,
      driveImported: Boolean(drive.imported),
      driveReason: drive.reason || null,
      playlistImported: Boolean(playlist?.imported),
      settingsImported: Boolean(settings?.imported),
      settingsReason: settings?.reason || null,
    };
  },

  async "sync:replaceLocalFromRemote"() {
    const drive = await importDriveSync({ force: true });
    const [playlist, settings] = drive.imported
      ? [{ imported: drive.playlistImported }, { imported: drive.settingsImported }]
      : await Promise.all([
        replaceLocalPlaylistSyncFromRemote(),
        importRemoteSettingsSync({ force: true }),
      ]);
    return {
      ok: true,
      driveImported: Boolean(drive.imported),
      driveReason: drive.reason || null,
      playlistImported: Boolean(playlist?.imported),
      playlistReason: playlist?.reason || null,
      settingsImported: Boolean(settings?.imported),
      settingsReason: settings?.reason || null,
    };
  },

  async "sync:pushLocal"() {
    const [playlist, settings, drive] = await Promise.all([
      pushLocalPlaylistSyncNow(),
      pushLocalSettingsSyncNow(),
      pushLocalDriveSyncNow(),
    ]);
    return {
      ok: true,
      drivePushed: Boolean(drive?.pushed),
      driveReason: drive?.reason || null,
      playlistPushed: Boolean(playlist?.pushed),
      playlistReason: playlist?.reason || null,
      settingsPushed: Boolean(settings?.pushed),
      settingsReason: settings?.reason || null,
    };
  },
};
