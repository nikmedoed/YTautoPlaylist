import { parseVideoId } from "../utils.js";
import { getFilters, saveFilters } from "../filter.js";
import { getChannelMap } from "../youTubeApiConnectors.js";

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

function createDurationRow(min = 0, max = Infinity) {
  const row = document.createElement("div");
  row.className = "filter-row";
  row.dataset.type = "duration";

  const lab = document.createElement("label");
  lab.textContent = "Длительность";
  row.appendChild(lab);

  const from = document.createElement("input");
  from.type = "time";
  from.step = 1;
  from.className = "input from";
  if (min) from.value = toTimeStr(min);
  row.appendChild(from);

  const to = document.createElement("input");
  to.type = "time";
  to.step = 1;
  to.className = "input to";
  if (max !== Infinity) to.value = toTimeStr(max);
  row.appendChild(to);

  const del = document.createElement("button");
  del.className = "delete";
  del.type = "button";
  del.addEventListener("click", () => row.remove());
  row.appendChild(del);

  return row;
}

function createTextRow(type, value = "") {
  const row = document.createElement("div");
  row.className = "filter-row";
  row.dataset.type = type;

  const lab = document.createElement("label");
  lab.textContent = type === "title" ? "Заголовок" : "Тег";
  row.appendChild(lab);

  const input = document.createElement("input");
  input.type = "text";
  input.className = "input";
  input.value = value;
  row.appendChild(input);

  const del = document.createElement("button");
  del.className = "delete";
  del.type = "button";
  del.addEventListener("click", () => row.remove());
  row.appendChild(del);

  return row;
}


document.addEventListener("DOMContentLoaded", async () => {
  const startInput = document.getElementById("startDate");
  const saveBtn = document.getElementById("saveStartDate");
  const videoInput = document.getElementById("videoId");
  const useBtn = document.getElementById("useVideoId");
  const filtersContainer = document.getElementById("filtersContainer");
  const saveFiltersBtn = document.getElementById("saveFilters");
  const addChannelSelect = document.getElementById("addChannelSelect");
  const addChannelBtn = document.getElementById("addChannel");

  chrome.storage.sync.get(["lastVideoDate"], (res) => {
    if (res.lastVideoDate) {
      const d = new Date(res.lastVideoDate);
      startInput.value = d.toISOString().slice(0, 16);
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
            startInput.value = dt.toISOString().slice(0, 16);
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
          startInput.value = response.date.slice(0, 16);
        }
      }
    );
  });

  const channels = await getChannelMap();
  const filters = await getFilters();

  Object.keys(channels).forEach((id) => {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = channels[id].title || id;
    addChannelSelect.appendChild(opt);
  });

  function createSection(title, data = {}, channelId) {
    const box = document.createElement("div");
    box.className = "box filter-card";
    box.dataset.channel = channelId || "";

    const h = document.createElement("h4");
    h.className = "title is-5 mb-2";
    if (channelId) {
      const link = document.createElement("a");
      link.href = `https://www.youtube.com/channel/${channelId}`;
      link.target = "_blank";
      link.textContent = title;
      h.appendChild(link);
    } else {
      h.textContent = title;
    }
    box.appendChild(h);

    const topRow = document.createElement("div");
    topRow.className = "top-row";
    const chkShorts = document.createElement("label");
    chkShorts.className = "checkbox";
    chkShorts.innerHTML = `<input type="checkbox" class="nos" ${
      data.noShorts ? "checked" : ""
    }> Игнорировать Shorts`;
    topRow.appendChild(chkShorts);

    const chkBroadcast = document.createElement("label");
    chkBroadcast.className = "checkbox";
    chkBroadcast.innerHTML = `<input type="checkbox" class="nob" ${
      data.noBroadcasts ? "checked" : ""
    }> Игнорировать трансляции`;
    topRow.appendChild(chkBroadcast);

    const btnDur = document.createElement("button");
    btnDur.type = "button";
    btnDur.className = "button is-small";
    btnDur.textContent = "+ Длительность";
    topRow.appendChild(btnDur);

    const btnTitle = document.createElement("button");
    btnTitle.type = "button";
    btnTitle.className = "button is-small";
    btnTitle.textContent = "+ Заголовок";
    topRow.appendChild(btnTitle);

    const btnTag = document.createElement("button");
    btnTag.type = "button";
    btnTag.className = "button is-small";
    btnTag.textContent = "+ Тег";
    topRow.appendChild(btnTag);
    box.appendChild(topRow);

    const list = document.createElement("div");
    box.appendChild(list);

    (data.duration || []).forEach((r) => {
      list.appendChild(createDurationRow(r.min, r.max));
    });
    (data.title || []).forEach((t) => list.appendChild(createTextRow("title", t)));
    (data.tags || []).forEach((t) => list.appendChild(createTextRow("tag", t)));

    btnDur.addEventListener("click", () => list.appendChild(createDurationRow()));
    btnTitle.addEventListener("click", () => list.appendChild(createTextRow("title")));
    btnTag.addEventListener("click", () => list.appendChild(createTextRow("tag")));

    return box;
  }

  filtersContainer.appendChild(createSection("Глобальные", filters.global, null));

  for (const id of Object.keys(filters.channels)) {
    const chName = channels[id]?.title || id;
    const sec = createSection(chName, filters.channels[id], id);
    filtersContainer.appendChild(sec);
  }

  Object.keys(filters.channels).forEach((id) => {
    const opt = addChannelSelect.querySelector(`option[value="${id}"]`);
    if (opt) opt.remove();
  });

  saveFiltersBtn?.addEventListener("click", () => {
    const sections = filtersContainer.querySelectorAll(".box");
    const result = { global: {}, channels: {} };
    sections.forEach((sec) => {
      const ch = sec.dataset.channel || null;
      const obj = {};
      if (sec.querySelector(".nos").checked) obj.noShorts = true;
      if (sec.querySelector(".nob").checked) obj.noBroadcasts = true;
      const durs = [];
      const titles = [];
      const tags = [];
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
        }
      });
      if (durs.length) obj.duration = durs;
      if (titles.length) obj.title = titles;
      if (tags.length) obj.tags = tags;
      if (ch) result.channels[ch] = obj;
      else result.global = obj;
    });
    saveFilters(result);
  });

  addChannelBtn?.addEventListener("click", () => {
    const id = addChannelSelect.value;
    if (!id) return;
    const sec = createSection(channels[id]?.title || id, {}, id);
    filtersContainer.appendChild(sec);
    const opt = addChannelSelect.querySelector(`option[value="${id}"]`);
    opt?.remove();
  });
});
