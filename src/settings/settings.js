import { parseVideoId } from "../utils.js";
import { getFilters, saveFilters } from "../filter.js";
import { getChannelMap } from "../youTubeApiConnectors.js";

function secToMin(sec) {
  if (sec === Infinity) return "";
  return Math.round(sec / 60);
}

function rangesToStr(ranges = []) {
  return ranges
    .map((r) => `${secToMin(r.min || 0)}-${r.max === Infinity ? "" : secToMin(r.max)}`)
    .join("; ");
}

function parseRanges(str) {
  if (!str) return [];
  return str.split(/;+/).map((part) => {
    const [a, b] = part.split("-").map((s) => s.trim());
    const min = a ? parseInt(a, 10) * 60 : 0;
    const max = b ? parseInt(b, 10) * 60 : Infinity;
    return { min, max };
  });
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

  function createSection(title, data, channelId) {
    const box = document.createElement("div");
    box.className = "box";
    box.dataset.channel = channelId || "";
    const h = document.createElement("h4");
    h.className = "title is-5";
    h.textContent = title;
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
    durField.className = "field";
    durField.innerHTML = `<label class="label">Длительность (мин-мин)</label><input class="input dur" type="text" value="${rangesToStr(
      data.duration
    )}">`;
    box.appendChild(durField);

    const titleField = document.createElement("div");
    titleField.className = "field";
    titleField.innerHTML = `<label class="label">Заголовок содержит</label><textarea class="textarea titlef" rows="2">${(data.title || []).join(
      ";"
    )}</textarea>`;
    box.appendChild(titleField);

    const tagField = document.createElement("div");
    tagField.className = "field";
    tagField.innerHTML = `<label class="label">Теги</label><textarea class="textarea tagsf" rows="2">${(data.tags || []).join(
      ";"
    )}</textarea>`;
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
      obj.noShorts = sec.querySelector(".nos").checked;
      obj.noBroadcasts = sec.querySelector(".nob").checked;
      obj.duration = parseRanges(sec.querySelector(".dur").value);
      obj.title = sec.querySelector(".titlef").value
        .split(";")
        .map((s) => s.trim())
        .filter(Boolean);
      obj.tags = sec.querySelector(".tagsf").value
        .split(";")
        .map((s) => s.trim())
        .filter(Boolean);
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
