// Settings filter section renderer. Groups filter rows by category and renders section controls.
import {
  createDurationRow,
  createGroup,
  createPlaylistRow,
  createTextRow,
} from "./rows.js";

// Builds one settings filter section with its rows, add button, collapse control, and updater methods.
export function createFilterSection({
  addChannelSelect,
  channels = {},
  title,
  data = {},
  channelId,
  markUnsaved,
  updateCheckboxVisibility,
}) {
  const template = document.getElementById("filterCardTemplate");
  const box = template.content.firstElementChild.cloneNode(true);
  box.dataset.channel = channelId || "";
  const heading = box.querySelector(".channel-heading");
  const link = box.querySelector(".channel-link");
  const removeBtn = box.querySelector(".remove-btn");
  const groupsWrap = box.querySelector(".groups-container");
  const chkShorts = box.querySelector(".nos");
  const chkBroadcast = box.querySelector(".nob");
  const btnDur = box.querySelector(".add-duration");
  const btnTitle = box.querySelector(".add-title");
  const btnTag = box.querySelector(".add-tag");
  const btnPlaylist = box.querySelector(".add-playlist");

  if (channelId) {
    link.href = `https://www.youtube.com/channel/${channelId}`;
    link.textContent = title;
    removeBtn.addEventListener("click", () => {
      box.remove();
      const opt = document.createElement("option");
      opt.value = channelId;
      opt.textContent = channels[channelId]?.title || channelId;
      addChannelSelect.appendChild(opt);
      updateCheckboxVisibility();
      markUnsaved();
    });
  } else {
    heading.style.display = "none";
    removeBtn.style.display = "none";
    box.classList.remove("box");
    box.classList.add("wide");
  }

  if (data.noShorts) chkShorts.checked = true;
  if (data.noBroadcasts) chkBroadcast.checked = true;

  const durGroup = createGroup(
    "Длительность",
    "duration",
    data.duration || [],
    (r = {}) => createDurationRow(r.min, r.max),
    markUnsaved
  );
  const titleGroup = createGroup(
    "Заголовок",
    "title",
    data.title || [],
    (t = "") => createTextRow("title", t),
    markUnsaved
  );
  const tagGroup = createGroup(
    "Тег",
    "tag",
    data.tags || [],
    (t = "") => createTextRow("tag", t),
    markUnsaved
  );
  const playlistGroup = createGroup(
    "Плейлист",
    "playlist",
    data.playlists || [],
    (id = "") => createPlaylistRow(channelId, id),
    markUnsaved
  );

  groupsWrap.appendChild(durGroup.group);
  groupsWrap.appendChild(titleGroup.group);
  groupsWrap.appendChild(tagGroup.group);
  groupsWrap.appendChild(playlistGroup.group);

  btnDur.addEventListener("click", durGroup.add);
  btnTitle.addEventListener("click", titleGroup.add);
  btnTag.addEventListener("click", tagGroup.add);
  btnPlaylist.addEventListener("click", playlistGroup.add);

  return box;
}
