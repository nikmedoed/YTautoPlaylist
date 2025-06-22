import { parseVideoId, parseDuration } from "../utils.js";
import { getFilters, saveFilters } from "../filter.js";
import { getChannelMap, listChannelPlaylists } from "../youTubeApiConnectors.js";

function toTimeStr(sec) {
  if (sec === undefined || sec === null || sec === Infinity) return "";
  const h = Math.floor(sec / 3600)
    .toString()
    .padStart(2, "0");
  const m = Math.floor((sec % 3600) / 60)
    .toString()
    .padStart(2, "0");
  const s = Math.floor(sec % 60)
    .toString()
    .padStart(2, "0");
  return `${h}:${m}:${s}`;
}

function parseTime(str) {
  if (!str) return 0;
  const parts = str.split(":").map((p) => parseInt(p, 10));
  if (parts.some((n) => Number.isNaN(n))) return 0;
  let sec = 0;
  if (parts.length === 3) sec = parts[0] * 3600 + parts[1] * 60 + parts[2];
  else if (parts.length === 2) sec = parts[0] * 60 + parts[1];
  else if (parts.length === 1) sec = parts[0];
  return sec;
}

function toLocalInputValue(date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

const durTemplate = document.getElementById("durationRowTemplate");
function createDurationRow(min = 0, max = Infinity) {
  const row = durTemplate.content.firstElementChild.cloneNode(true);
  if (min) row.querySelector(".from").value = toTimeStr(min);
  if (max !== Infinity) row.querySelector(".to").value = toTimeStr(max);
  return row;
}

const textTemplate = document.getElementById("textRowTemplate");
function createTextRow(type, value = "") {
  const row = textTemplate.content.firstElementChild.cloneNode(true);
  row.dataset.type = type;
  row.querySelector("input").value = value;
  return row;
}

const playlistTemplate = document.getElementById("playlistRowTemplate");
const playlistCache = {};
async function createPlaylistRow(channelId, value = "") {
  const row = playlistTemplate.content.firstElementChild.cloneNode(true);
  const select = row.querySelector("select");
  if (!playlistCache[channelId]) {
    playlistCache[channelId] = await listChannelPlaylists(channelId);
  }
  playlistCache[channelId].forEach((pl) => {
    const opt = document.createElement("option");
    opt.value = pl.id;
    opt.textContent = pl.title;
    select.appendChild(opt);
  });
  select.value = value;
  return row;
}

const groupTemplate = document.getElementById("filterGroupTemplate");
const cardTemplate = document.getElementById("filterCardTemplate");
function createGroup(labelText, type, rows, createRowFn) {
  const group = groupTemplate.content.firstElementChild.cloneNode(true);
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

  async function addRow(r) {
    const node = await createRowFn(r);
    list.appendChild(node);
    checkHeader();
  }

  addBtn.addEventListener("click", () => {
    addRow();
  });

  rows.forEach((r) => {
    addRow(r);
  });
  list.addEventListener("click", (e) => {
    if (e.target.closest(".remove-row")) {
      e.target.closest(".filter-row").remove();
      checkHeader();
    }
  });

  checkHeader();
  return { group, list, add: () => { addBtn.click(); } };
}


document.addEventListener("DOMContentLoaded", async () => {
  const startInput = document.getElementById("startDate");
  const saveBtn = document.getElementById("saveStartDate");
  const videoInput = document.getElementById("videoId");
  const useBtn = document.getElementById("useVideoId");
  const checkVideoInput = document.getElementById("checkVideoInput");
  const checkVideoBtn = document.getElementById("checkVideoBtn");
  const checkVideoResult = document.getElementById("checkVideoResult");
  const filtersContainer = document.getElementById("filtersContainer");
  const globalContainer = document.getElementById("globalFilters");
  const saveFiltersBtn = document.getElementById("saveFilters");
  const exportBtn = document.getElementById("exportFilters");
  const importInput = document.getElementById("importFilters");
  const addChannelSelect = document.getElementById("addChannelSelect");
  const addChannelBtn = document.getElementById("addChannel");
  const addCard = document.getElementById("addChannelCard");

  let globalShortsChk;
  let globalBroadcastChk;

  chrome.storage.sync.get(["lastVideoDate"], (res) => {
    if (res.lastVideoDate) {
      const d = new Date(res.lastVideoDate);
      startInput.value = toLocalInputValue(d);
    }
  });

  saveBtn?.addEventListener("click", () => {
    const val = startInput.value;
    const dt = new Date(val);
    if (String(dt) !== "Invalid Date") {
      chrome.runtime.sendMessage(
        { type: "setStartDate", date: dt.toISOString() },
        (res) => {
          if (res && res.ok) {
            startInput.value = toLocalInputValue(dt);
          }
        }
      );
    }
  });

  useBtn?.addEventListener("click", () => {
    const id = parseVideoId(videoInput.value);
    if (!id) return;
    chrome.runtime.sendMessage(
      { type: "videoDate", videoId: id },
      (response) => {
        if (response && response.date) {
          const d = new Date(response.date);
          startInput.value = toLocalInputValue(d);
        }
      }
    );
  });

  checkVideoBtn?.addEventListener("click", () => {
    const id = parseVideoId(checkVideoInput.value);
    if (!id) return;
    checkVideoResult.textContent = "Loading...";
    chrome.runtime.sendMessage({ type: "videoInfo", videoId: id }, (resp) => {
      checkVideoResult.innerHTML = "";
      if (resp && resp.info) {
        const info = resp.info;
        const addLine = (label, value) => {
          if (value === undefined || value === null) return;
          const row = document.createElement("div");
          row.className = "mb-1";
          const b = document.createElement("b");
          b.textContent = label + ": ";
          row.appendChild(b);
          if (Array.isArray(value)) {
            value.forEach((v, i) => {
              const code = document.createElement("code");
              code.textContent = v;
              row.appendChild(code);
              if (i < value.length - 1) row.appendChild(document.createTextNode(" "));
            });
          } else {
            const span = document.createElement("span");
            span.textContent = value;
            if (label === "Описание") span.style.whiteSpace = "pre-wrap";
            row.appendChild(span);
          }
          checkVideoResult.appendChild(row);
        };

        addLine("ID", info.id);
        if (info.channelTitle)
          addLine("Канал", `${info.channelTitle} (${info.channelId})`);
        addLine("Название", info.title);
        addLine("Описание", info.description);
        if (info.tags && info.tags.length) addLine("Теги", info.tags);
        if (info.duration)
          addLine(
            "Длительность",
            toTimeStr(parseDuration(info.duration))
          );
        if (info.publishedAt)
          addLine(
            "Опубликовано",
            new Date(info.publishedAt).toLocaleString("ru")
          );
        addLine("Shorts", info.short ? "Да" : "Нет");
        addLine("Трансляция", info.broadcast ? "Да" : "Нет");
        if (info.scheduled) addLine("Запланировано", info.scheduled);
        if (info.actual) addLine("Начало трансляции", info.actual);
      } else {
        checkVideoResult.textContent =
          "Error: " + (resp?.error || "unknown");
      }
    });
  });

  const filters = await getFilters();
  const channels = await getChannelMap(Object.keys(filters.channels));

  Object.keys(channels).forEach((id) => {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = channels[id].title || id;
    addChannelSelect.appendChild(opt);
  });

  function createSection(title, data = {}, channelId) {
    const box = cardTemplate.content.firstElementChild.cloneNode(true);
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
      (r = {}) => createDurationRow(r.min, r.max)
    );
    const titleGroup = createGroup(
      "Заголовок",
      "title",
      data.title || [],
      (t = "") => createTextRow("title", t)
    );
    const tagGroup = createGroup(
      "Тег",
      "tag",
      data.tags || [],
      (t = "") => createTextRow("tag", t)
    );
    const playlistGroup = createGroup(
      "Плейлист",
      "playlist",
      data.playlists || [],
      (id = "") => createPlaylistRow(channelId, id)
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

  const globalSec = createSection("Глобальные", filters.global, null);
  globalContainer.appendChild(globalSec);
  globalShortsChk = globalSec.querySelector(".nos");
  globalBroadcastChk = globalSec.querySelector(".nob");

  function updateCheckboxVisibility() {
    const hideShorts = globalShortsChk?.checked;
    const hideBroadcasts = globalBroadcastChk?.checked;
    document
      .querySelectorAll('#filtersContainer .filter-card[data-channel]')
      .forEach((sec) => {
        const s = sec.querySelector('.nos')?.closest('label');
        if (s) s.style.display = hideShorts ? 'none' : '';
        const b = sec.querySelector('.nob')?.closest('label');
        if (b) b.style.display = hideBroadcasts ? 'none' : '';
      });
  }

  globalShortsChk?.addEventListener('change', updateCheckboxVisibility);
  globalBroadcastChk?.addEventListener('change', updateCheckboxVisibility);

  for (const id of Object.keys(filters.channels)) {
    const chName = channels[id]?.title || id;
    const sec = createSection(chName, filters.channels[id], id);
    filtersContainer.insertBefore(sec, addCard);
  }

  updateCheckboxVisibility();

  Object.keys(filters.channels).forEach((id) => {
    const opt = addChannelSelect.querySelector(`option[value="${id}"]`);
    if (opt) opt.remove();
  });

  saveFiltersBtn?.addEventListener("click", () => {
    const sections = document.querySelectorAll(".filter-card:not(.add-card)");
    const result = { global: {}, channels: {} };
    sections.forEach((sec) => {
      const ch = sec.dataset.channel || null;
      const obj = {};
      if (sec.querySelector(".nos").checked) obj.noShorts = true;
      if (sec.querySelector(".nob").checked) obj.noBroadcasts = true;
      const durs = [];
      const titles = [];
      const tags = [];
      const playlists = [];
      sec.querySelectorAll(".filter-row").forEach((row) => {
        const type = row.dataset.type;
        if (type === "duration") {
          const min = parseTime(row.querySelector(".from").value);
          const toVal = row.querySelector(".to").value;
          const max = toVal ? parseTime(toVal) : Infinity;
          if (min || max !== Infinity) durs.push({ min, max });
        } else if (type === "title") {
          const val = row.querySelector("input").value.trim();
          if (val) titles.push(val);
        } else if (type === "tag") {
          const val = row.querySelector("input").value.trim();
          if (val) tags.push(val);
        } else if (type === "playlist") {
          const val = row.querySelector("select").value;
          if (val) playlists.push(val);
        }
      });
      if (durs.length) obj.duration = durs;
      if (titles.length) obj.title = titles;
      if (tags.length) obj.tags = tags;
      if (playlists.length) obj.playlists = playlists;
      if (ch) result.channels[ch] = obj;
      else result.global = obj;
    });
    saveFilters(result);
  });

  addChannelBtn?.addEventListener("click", () => {
    const id = addChannelSelect.value;
    if (!id) return;
    const sec = createSection(channels[id]?.title || id, {}, id);
    filtersContainer.insertBefore(sec, addCard);
    const opt = addChannelSelect.querySelector(`option[value="${id}"]`);
    opt?.remove();
    updateCheckboxVisibility();
  });

  exportBtn?.addEventListener("click", async () => {
    const data = await getFilters();
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "filters.json";
    a.click();
    URL.revokeObjectURL(url);
  });

  importInput?.addEventListener("change", () => {
    const file = importInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const obj = JSON.parse(reader.result);
        saveFilters(obj).then(() => window.location.reload());
      } catch (e) {
        alert("Invalid JSON");
      }
    };
    reader.readAsText(file);
  });
});
