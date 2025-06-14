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

function createGroup(labelText, type, rows, createRowFn) {
  const group = document.createElement("div");
  group.className = "filter-group";
  group.dataset.type = type;

  const header = document.createElement("div");
  header.className = "group-header top-row";

  const lab = document.createElement("span");
  lab.className = "has-text-weight-bold";
  lab.textContent = labelText;
  header.appendChild(lab);

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "button is-small is-success";
  addBtn.innerHTML = '<span class="icon"><i class="fas fa-plus"></i></span>';
  header.appendChild(addBtn);

  const list = document.createElement("div");
  group.appendChild(header);
  group.appendChild(list);

  function checkHeader() {
    header.style.display = list.children.length ? "" : "none";
  }

  addBtn.addEventListener("click", () => {
    list.appendChild(createRowFn());
    checkHeader();
  });

  rows.forEach((r) => {
    list.appendChild(createRowFn(r));
  });
  list.addEventListener("click", (e) => {
    if (e.target.closest(".delete")) {
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
  const filtersContainer = document.getElementById("filtersContainer");
  const globalContainer = document.getElementById("globalFilters");
  const saveFiltersBtn = document.getElementById("saveFilters");
  const exportBtn = document.getElementById("exportFilters");
  const importInput = document.getElementById("importFilters");
  const addChannelSelect = document.getElementById("addChannelSelect");
  const addChannelBtn = document.getElementById("addChannel");
  const addCard = document.getElementById("addChannelCard");

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

  const filters = await getFilters();
  const channels = await getChannelMap(Object.keys(filters.channels));

  Object.keys(channels).forEach((id) => {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = channels[id].title || id;
    addChannelSelect.appendChild(opt);
  });

  function createSection(title, data = {}, channelId) {
    const box = document.createElement("div");
    box.className = channelId ? "box filter-card" : "box filter-card wide";
    box.dataset.channel = channelId || "";

    if (channelId) {
      const h = document.createElement("h4");
      h.className = "title is-5 mb-2";
      const link = document.createElement("a");
      link.href = `https://www.youtube.com/channel/${channelId}`;
      link.target = "_blank";
      link.textContent = title;
      h.appendChild(link);
      box.appendChild(h);
    }

    const topRow = document.createElement("div");
    topRow.className = "top-row";
    if (channelId) {
      const remove = document.createElement("button");
      remove.className = "button is-danger is-light is-small remove-btn";
      remove.type = "button";
      remove.innerHTML = '<span class="icon"><i class="fas fa-trash"></i></span>';
      remove.addEventListener("click", () => {
        box.remove();
        const opt = document.createElement("option");
        opt.value = channelId;
        opt.textContent = channels[channelId]?.title || channelId;
        addChannelSelect.appendChild(opt);
      });
      box.appendChild(remove);
    }
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

    const addRow = document.createElement("div");
    addRow.className = "top-row";

    const addLabel = document.createElement("span");
    addLabel.textContent = "Добавить фильтры:";
    addRow.appendChild(addLabel);

    const btnDur = document.createElement("button");
    btnDur.type = "button";
    btnDur.className = "button is-small is-info";
    btnDur.innerHTML =
      '<span class="icon"><i class="fas fa-plus"></i></span><span>Длительность</span>';
    addRow.appendChild(btnDur);

    const btnTitle = document.createElement("button");
    btnTitle.type = "button";
    btnTitle.className = "button is-small is-info";
    btnTitle.innerHTML =
      '<span class="icon"><i class="fas fa-plus"></i></span><span>Заголовок</span>';
    addRow.appendChild(btnTitle);

    const btnTag = document.createElement("button");
    btnTag.type = "button";
    btnTag.className = "button is-small is-info";
    btnTag.innerHTML =
      '<span class="icon"><i class="fas fa-plus"></i></span><span>Тег</span>';
    addRow.appendChild(btnTag);

    box.appendChild(topRow);
    box.appendChild(addRow);

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

    box.appendChild(durGroup.group);
    box.appendChild(titleGroup.group);
    box.appendChild(tagGroup.group);

    btnDur.addEventListener("click", durGroup.add);
    btnTitle.addEventListener("click", titleGroup.add);
    btnTag.addEventListener("click", tagGroup.add);

    return box;
  }

  globalContainer.appendChild(createSection("Глобальные", filters.global, null));

  for (const id of Object.keys(filters.channels)) {
    const chName = channels[id]?.title || id;
    const sec = createSection(chName, filters.channels[id], id);
    filtersContainer.insertBefore(sec, addCard);
  }

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
    filtersContainer.insertBefore(sec, addCard);
    const opt = addChannelSelect.querySelector(`option[value="${id}"]`);
    opt?.remove();
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
