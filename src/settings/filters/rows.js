// Settings filter row renderer. Builds editable filter rows and wires row-level controls.
import {
  isVideoInPlaylist,
  listChannelPlaylists,
} from "../../youtube-api/playlists.js";
import { toTimeStr } from "../shared/format.js";

const playlistCache = {};
const playlistMembershipCache = new Map();

export function createDurationRow(min = 0, max = Infinity) {
  const template = document.getElementById("durationRowTemplate");
  const row = template.content.firstElementChild.cloneNode(true);
  if (min) row.querySelector(".from").value = toTimeStr(min);
  if (max !== Infinity) row.querySelector(".to").value = toTimeStr(max);
  return row;
}

export function createTextRow(type, value = "") {
  const template = document.getElementById("textRowTemplate");
  const row = template.content.firstElementChild.cloneNode(true);
  row.dataset.type = type;
  row.querySelector("input").value = value;
  return row;
}

export async function createPlaylistRow(channelId, value = "") {
  const template = document.getElementById("playlistRowTemplate");
  const row = template.content.firstElementChild.cloneNode(true);
  const select = row.querySelector("select");
  const playlists = await getChannelPlaylists(channelId);
  playlists.forEach((pl) => {
    const opt = document.createElement("option");
    opt.value = pl.id;
    opt.textContent = pl.title;
    select.appendChild(opt);
  });
  select.value = value;
  return row;
}

export async function getChannelPlaylists(channelId) {
  if (!channelId) return [];
  if (!playlistCache[channelId]) {
    playlistCache[channelId] = await listChannelPlaylists(channelId);
  }
  return Array.isArray(playlistCache[channelId]) ? playlistCache[channelId] : [];
}

export async function findVideoPlaylists(channelId, videoId) {
  if (!channelId || !videoId) return [];
  const key = `${channelId}:${videoId}`;
  if (playlistMembershipCache.has(key)) {
    return playlistMembershipCache.get(key);
  }
  const playlists = await getChannelPlaylists(channelId);
  const result = [];
  for (const playlist of playlists) {
    try {
      if (await isVideoInPlaylist(videoId, playlist.id)) {
        result.push(playlist);
      }
    } catch (err) {
      console.error(
        "Failed to check playlist membership",
        playlist.id,
        videoId,
        err
      );
    }
  }
  playlistMembershipCache.set(key, result);
  return result;
}

export function createGroup(labelText, type, rows, createRowFn, onChanged) {
  const template = document.getElementById("filterGroupTemplate");
  const group = template.content.firstElementChild.cloneNode(true);
  group.dataset.type = type;

  const header = group.querySelector(".group-header");
  const lab = header.querySelector("span");
  const addBtn = header.querySelector(".add-row");
  const list = group.querySelector(".rows-wrap");
  lab.textContent = labelText;

  function checkHeader() {
    const hasRows = list.children.length > 0;
    header.style.display = hasRows ? "" : "none";
    group.style.display = hasRows ? "" : "none";
  }

  async function addRow(r, silent = false) {
    const node = await createRowFn(r);
    list.appendChild(node);
    checkHeader();
    if (!silent) onChanged?.();
  }

  addBtn.addEventListener("click", () => {
    addRow();
  });

  rows.forEach((r) => {
    addRow(r, true);
  });
  list.addEventListener("click", (e) => {
    if (e.target.closest(".remove-row")) {
      e.target.closest(".filter-row").remove();
      checkHeader();
      onChanged?.();
    }
  });

  checkHeader();
  group.__addRowWithData = addRow;
  return {
    group,
    list,
    add: () => {
      addBtn.click();
    },
  };
}
