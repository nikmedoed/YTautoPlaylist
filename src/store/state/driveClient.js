// Google Drive appData transport. Authentication and HTTP details stay here so
// playlist synchronization can focus on snapshots and conflict handling.
import { getToken, clearToken, signInUser } from "../../auth.js";
import { DRIVE_SYNC_FILE_NAME } from "./constants.js";
import { parseDrivePayload } from "./driveSyncPayload.js";

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";

function formatDriveError(status, textValue) {
  try {
    const parsed = JSON.parse(textValue);
    const error = parsed?.error;
    const reason = error?.errors?.[0]?.reason || error?.status || "";
    const message = error?.message || textValue;
    return [`Drive API failed: ${status}`, reason, message]
      .filter(Boolean)
      .join(" - ")
      .slice(0, 500);
  } catch {
    return `Drive API failed: ${status}${textValue ? ` - ${textValue.slice(0, 300)}` : ""}`;
  }
}

async function driveFetch(
  url,
  init = {},
  { interactive = false, shouldContinue = null } = {}
) {
  const token = await getToken({ interactive });
  if (typeof shouldContinue === "function" && !shouldContinue()) {
    const error = new Error("Playlist sync superseded by newer local changes");
    error.code = "SYNC_SUPERSEDED";
    throw error;
  }
  const headers = { ...(init.headers || {}), Authorization: `Bearer ${token}` };
  let response = await fetch(url, { ...init, headers });
  if ((response.status === 401 || response.status === 403) && interactive) {
    clearToken();
    const refreshed = await signInUser();
    response = await fetch(url, {
      ...init,
      headers: { ...headers, Authorization: `Bearer ${refreshed}` },
    });
  }
  if (!response.ok) {
    const textValue = await response.text();
    const error = new Error(formatDriveError(response.status, textValue));
    error.status = response.status;
    error.body = textValue;
    throw error;
  }
  return response;
}

export async function findDriveFile({ interactive = false } = {}) {
  const params = new URLSearchParams({
    spaces: "appDataFolder",
    fields: "files(id,name,modifiedTime)",
    q: `name='${DRIVE_SYNC_FILE_NAME}' and trashed=false`,
  });
  const response = await driveFetch(`${DRIVE_API}/files?${params}`, {}, { interactive });
  const data = await response.json();
  return Array.isArray(data.files) && data.files.length ? data.files[0] : null;
}

export async function readDrivePayload({ interactive = false } = {}) {
  const file = await findDriveFile({ interactive });
  if (!file?.id) return { file: null, payload: null };
  const response = await driveFetch(
    `${DRIVE_API}/files/${encodeURIComponent(file.id)}?alt=media`,
    {},
    { interactive }
  );
  return { file, payload: parseDrivePayload(await response.json()) };
}

export async function writeDrivePayload(
  payload,
  { interactive = true, existing = null, shouldContinue = null } = {}
) {
  const existingFile = existing || (await findDriveFile({ interactive }));
  const metadata = existingFile?.id
    ? { name: DRIVE_SYNC_FILE_NAME }
    : { name: DRIVE_SYNC_FILE_NAME, parents: ["appDataFolder"] };
  const boundary = `yta_drive_sync_${Date.now()}`;
  const body = [
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify(metadata),
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify(payload),
    `--${boundary}--`,
    "",
  ].join("\r\n");
  const target = existingFile?.id
    ? `${DRIVE_UPLOAD_API}/files/${encodeURIComponent(existingFile.id)}`
    : `${DRIVE_UPLOAD_API}/files`;
  const params = new URLSearchParams({ uploadType: "multipart", fields: "id,modifiedTime" });
  const response = await driveFetch(
    `${target}?${params}`,
    {
      method: existingFile?.id ? "PATCH" : "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body,
    },
    { interactive, shouldContinue }
  );
  return response.json();
}
