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

function createTimeRow(min = 0, max = Infinity) {
  const row = document.createElement("div");
  row.className = "field has-addons duration-row";
  const fromCtrl = document.createElement("div");
  fromCtrl.className = "control";
  const from = document.createElement("input");
  from.type = "time";
  from.step = 1;
  from.className = "input from";
  if (min) from.value = toTimeStr(min);
  fromCtrl.appendChild(from);
  const toCtrl = document.createElement("div");
  toCtrl.className = "control";
  const to = document.createElement("input");
  to.type = "time";
  to.step = 1;
  to.className = "input to";
  if (max !== Infinity) to.value = toTimeStr(max);
  toCtrl.appendChild(to);
  const delCtrl = document.createElement("div");
  delCtrl.className = "control";
  const del = document.createElement("button");
  del.className = "delete";
  del.type = "button";
  delCtrl.appendChild(del);
  del.addEventListener("click", () => row.remove());
  row.appendChild(fromCtrl);
  row.appendChild(toCtrl);
  row.appendChild(delCtrl);
  return row;
}

function createTextRow(value = "") {
  const row = document.createElement("div");
  row.className = "field has-addons item-row";
  const ctrl = document.createElement("div");
  ctrl.className = "control is-expanded";
  const input = document.createElement("input");
  input.type = "text";
  input.className = "input";
  input.value = value;
  ctrl.appendChild(input);
  const delCtrl = document.createElement("div");
  delCtrl.className = "control";
  const del = document.createElement("button");
  del.className = "delete";
  del.type = "button";
  delCtrl.appendChild(del);
  del.addEventListener("click", () => row.remove());
  row.appendChild(ctrl);
  row.appendChild(delCtrl);
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

    const nsField = document.createElement("div");
    nsField.className = "field";
    nsField.innerHTML = `<label class="checkbox"><input type="checkbox" class="nos" ${
      data.noShorts ? "checked" : ""
    }> Игнорировать Shorts</label>`;
    box.appendChild(nsField);

    const nbField = document.createElement("div");
    nbField.className = "field";
    nbField.innerHTML = `<label class="checkbox"><input type="checkbox" class="nob" ${
      data.noBroadcasts ? "checked" : ""
    }> Игнорировать трансляции</label>`;
    box.appendChild(nbField);

    const durField = document.createElement("div");
    durField.className = "field dur-wrap";
    const durLabel = document.createElement("label");
    durLabel.className = "label";
    durLabel.textContent = "Длительность";
    durField.appendChild(durLabel);
    const durList = document.createElement("div");
    durList.className = "dur-list";
    durField.appendChild(durList);
    (data.duration || []).forEach((r) => {
      durList.appendChild(createTimeRow(r.min, r.max));
    });
    const addDur = document.createElement("button");
    addDur.type = "button";
    addDur.className = "button is-small mt-1";
    addDur.textContent = "Добавить диапазон";
    addDur.addEventListener("click", () => {
      durList.appendChild(createTimeRow());
    });
    durField.appendChild(addDur);
    box.appendChild(durField);

    const titleField = document.createElement("div");
    titleField.className = "field title-wrap";
    const tl = document.createElement("label");
    tl.className = "label";
    tl.textContent = "Заголовок содержит";
    titleField.appendChild(tl);
    const titleList = document.createElement("div");
    titleField.appendChild(titleList);
    (data.title || []).forEach((t) => titleList.appendChild(createTextRow(t)));
    const addTitle = document.createElement("button");
    addTitle.type = "button";
    addTitle.className = "button is-small mt-1";
    addTitle.textContent = "Добавить";
    addTitle.addEventListener("click", () => {
      titleList.appendChild(createTextRow());
    });
    titleField.appendChild(addTitle);
    box.appendChild(titleField);

    const tagField = document.createElement("div");
    tagField.className = "field tag-wrap";
    const tg = document.createElement("label");
    tg.className = "label";
    tg.textContent = "Теги";
    tagField.appendChild(tg);
    const tagList = document.createElement("div");
    tagField.appendChild(tagList);
    (data.tags || []).forEach((t) => tagList.appendChild(createTextRow(t)));
    const addTag = document.createElement("button");
    addTag.type = "button";
    addTag.className = "button is-small mt-1";
    addTag.textContent = "Добавить";
    addTag.addEventListener("click", () => {
      tagList.appendChild(createTextRow());
    });
    tagField.appendChild(addTag);
    box.appendChild(tagField);

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
      sec.querySelectorAll(".duration-row").forEach((row) => {
        const min = parseTime(row.querySelector(".from").value);
        const toVal = row.querySelector(".to").value;
        const max = toVal ? parseTime(toVal) : Infinity;
        if (min || max !== Infinity) durs.push({ min, max });
      });
      if (durs.length) obj.duration = durs;
      const titles = Array.from(
        sec.querySelectorAll(".title-wrap .item-row input")
      )
        .map((i) => i.value.trim())
        .filter(Boolean);
      if (titles.length) obj.title = titles;
      const tags = Array.from(sec.querySelectorAll(".tag-wrap .item-row input"))
        .map((i) => i.value.trim())
        .filter(Boolean);
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
