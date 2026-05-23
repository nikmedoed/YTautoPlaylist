// Settings video-check result view. Renders metadata and filter-match results for a manually checked video.
import { parseDuration } from "../../time.js";
import {
  formatDateTime,
  isShortVideo,
  toTimeStr,
} from "../shared/format.js";
import {
  findVideoPlaylists,
  getChannelPlaylists,
} from "../filters/rows.js";

// Renders the manual video-check result and mounts the quick-filter builder
// beside the metadata so a checked video can immediately become a rule.
// Renders checked YouTube metadata beside quick-filter controls so the result can immediately become a rule.
export function renderCheckVideoResult({
  chFilters,
  checkVideoResult,
  durationSeconds,
  info,
  quickFilter,
  reason,
  tags,
}) {
  const layout = document.createElement("div");
  layout.className = "quick-filter-layout";
  const infoColumn = document.createElement("div");
  infoColumn.className = "quick-filter-info";
  const builderColumn = document.createElement("div");
  builderColumn.className = "quick-filter-builder";
  layout.appendChild(infoColumn);
  layout.appendChild(builderColumn);
  checkVideoResult.appendChild(layout);

  const addLine = (label, value) => {
    if (value === undefined || value === null) return null;
    const row = document.createElement("div");
    row.className = "mb-1";
    const b = document.createElement("b");
    b.textContent = label + ": ";
    row.appendChild(b);
    const span = document.createElement("span");
    if (Array.isArray(value)) {
      span.textContent = value.map((v) => `"${v}"`).join(", ");
    } else if (value instanceof Node) {
      span.appendChild(value);
    } else {
      span.textContent = value;
    }
    row.appendChild(span);
    infoColumn.appendChild(row);
    return span;
  };

  const reasonMap = {
    short: "короткое видео",
    broadcast: "трансляция",
    title: "фильтр по названию",
    tag: "фильтр по тегу",
    duration: "длительность",
    playlist: "стоп-лист",
  };

  const verdict = document.createElement("div");
  verdict.className = `notification mb-2 ${reason ? "is-warning" : "is-info"}`;
  verdict.innerHTML = reason
    ? `<b>Будет отфильтровано:</b> ${reasonMap[reason] || reason}`
    : "<b>Не будет отфильтровано</b>";

  if (reason === "tag" && chFilters.tags?.length) {
    const d = document.createElement("div");
    d.textContent = `Теги фильтров: ${chFilters.tags.map((t) => `"${t}"`).join(", ")}`;
    verdict.appendChild(d);
  } else if (reason === "title" && chFilters.title?.length) {
    const d = document.createElement("div");
    d.textContent = `Фильтры названия: ${chFilters.title.map((t) => `"${t}"`).join(", ")}`;
    verdict.appendChild(d);
  }

  infoColumn.appendChild(verdict);

  if (info.id) {
    const videoLink = document.createElement("a");
    videoLink.href = `https://www.youtube.com/watch?v=${info.id}`;
    videoLink.target = "_blank";
    videoLink.rel = "noopener noreferrer";
    videoLink.textContent = info.id;
    addLine("ID", videoLink);
  }
  if (info.channelTitle || info.channelId) {
    const fragment = document.createDocumentFragment();
    if (info.channelId) {
      const channelLink = document.createElement("a");
      channelLink.href = `https://www.youtube.com/channel/${info.channelId}`;
      channelLink.target = "_blank";
      channelLink.rel = "noopener noreferrer";
      channelLink.textContent = info.channelTitle || info.channelId;
      fragment.appendChild(channelLink);
      if (info.channelTitle && info.channelId) {
        fragment.appendChild(
          document.createTextNode(` (${info.channelId})`)
        );
      }
    } else {
      fragment.appendChild(document.createTextNode(info.channelTitle));
    }
    addLine("Канал", fragment);
  }
  const originalTitle =
    typeof info.title === "string" ? info.title.trim() : "";
  if (originalTitle) {
    const titleButton = document.createElement("button");
    titleButton.type = "button";
    titleButton.className = "video-info-action";
    titleButton.textContent = info.title;
    titleButton.title = "Использовать название в фильтре";
    titleButton.setAttribute("aria-pressed", "false");
    let titleActive = false;
    titleButton.addEventListener("click", () => {
      if (titleActive) {
        quickFilter.setTitle("");
      } else {
        quickFilter.setTitle(info.title);
      }
    });
    quickFilter.subscribeTitle((current) => {
      const normalized = (current || "").trim().toLowerCase();
      const matches =
        normalized && normalized === originalTitle.toLowerCase();
      titleActive = Boolean(matches);
      titleButton.classList.toggle("is-active", Boolean(matches));
      titleButton.setAttribute(
        "aria-pressed",
        matches ? "true" : "false"
      );
    });
    addLine("Название", titleButton);
  } else {
    addLine("Название", info.title);
  }

    if (tags.length) {
      const row = document.createElement("div");
      row.className = "mb-1";
      const label = document.createElement("b");
      label.textContent = "Теги: ";
      row.appendChild(label);
      const tagsWrap = document.createElement("span");
      tagsWrap.className = "video-info-tags";
      tags.forEach((tag) => {
        const tagBtn = document.createElement("button");
        tagBtn.type = "button";
        tagBtn.className = "video-info-action video-info-tag";
        tagBtn.textContent = tag;
        tagBtn.title = "Добавить тег в фильтр";
        tagBtn.setAttribute("aria-pressed", "false");
        const toggle = () => {
          const selected = quickFilter.toggleTag(tag);
          tagBtn.classList.toggle("is-active", selected);
          tagBtn.setAttribute("aria-pressed", selected ? "true" : "false");
        };
        tagBtn.addEventListener("click", toggle);
        quickFilter.subscribeTag(tag, (selected) => {
          tagBtn.classList.toggle("is-active", selected);
          tagBtn.setAttribute("aria-pressed", selected ? "true" : "false");
        });
        tagsWrap.appendChild(tagBtn);
      });
      row.appendChild(tagsWrap);
      infoColumn.appendChild(row);
    }

  if (durationSeconds) {
    const durationRow = document.createElement("div");
    durationRow.className = "mb-1";
    const label = document.createElement("b");
    label.textContent = "Длительность: ";
    durationRow.appendChild(label);
    const durationButton = document.createElement("button");
    durationButton.type = "button";
    durationButton.className = "video-info-action";
    const durationStr = toTimeStr(durationSeconds);
    durationButton.textContent = durationStr;
    durationButton.setAttribute("aria-pressed", "false");
    let durationActive = false;
    durationButton.addEventListener("click", () => {
      if (durationActive) {
        quickFilter.clearDuration();
      } else {
        quickFilter.setDurationFromSeconds(durationSeconds);
      }
    });
    quickFilter.subscribeDuration(({ min, max }) => {
      const active =
        Number.isFinite(min) &&
        Number.isFinite(max) &&
        min === durationSeconds &&
        max === durationSeconds;
      durationActive = Boolean(active);
      durationButton.classList.toggle("is-active", Boolean(active));
      durationButton.setAttribute(
        "aria-pressed",
        active ? "true" : "false"
      );
    });
    durationRow.appendChild(durationButton);
    infoColumn.appendChild(durationRow);
  } else if (info.duration) {
    const parsed = parseDuration(info.duration);
    addLine(
      "Длительность",
      Number.isFinite(parsed) && parsed > 0
        ? toTimeStr(parsed)
        : info.duration
    );
  }
  if (info.publishedAt)
    addLine("Опубликовано", formatDateTime(info.publishedAt));
  addLine("Shorts", isShortVideo(info) ? "Да" : "Нет");
  const isBroadcast =
    (typeof info.liveBroadcastContent === "string" &&
      info.liveBroadcastContent !== "none") ||
    Boolean(info.liveStreamingDetails?.actualStartTime);
  addLine("Трансляция", isBroadcast ? "Да" : "Нет");
  const scheduled = info.liveStreamingDetails?.scheduledStartTime;
  if (scheduled) addLine("Запланировано", formatDateTime(scheduled));
  const actual = info.liveStreamingDetails?.actualStartTime;
  if (actual) addLine("Начало трансляции", formatDateTime(actual));
  if (info.description) {
    const descriptionRow = document.createElement("div");
    descriptionRow.className = "mb-1 video-description-row";

    const label = document.createElement("b");
    label.textContent = "Описание:";
    descriptionRow.appendChild(label);

    descriptionRow.appendChild(document.createTextNode(" "));

    const toggle = document.createElement("span");
    toggle.className = "video-description-toggle";
    toggle.textContent = "[показать]";
    toggle.style.cursor = "pointer";
    toggle.style.userSelect = "none";
    toggle.style.marginLeft = "0";
    toggle.style.fontWeight = "normal";
    toggle.style.color = "#3273dc";
    toggle.style.textDecoration = "underline";
    descriptionRow.appendChild(toggle);

    const descriptionBody = document.createElement("pre");
    descriptionBody.textContent = info.description;
    descriptionBody.className = "video-description-body";
    descriptionBody.style.whiteSpace = "pre-wrap";
    descriptionBody.style.margin = "0";
    descriptionBody.style.display = "none";
    descriptionRow.appendChild(descriptionBody);

    let isOpen = false;
    const updateToggle = () => {
      toggle.textContent = isOpen ? "[скрыть]" : "[показать]";
      descriptionBody.style.display = isOpen ? "block" : "none";
    };
    toggle.addEventListener("click", () => {
      isOpen = !isOpen;
      updateToggle();
    });
    toggle.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        isOpen = !isOpen;
        updateToggle();
      }
    });
    toggle.setAttribute("role", "button");
    toggle.setAttribute("tabindex", "0");
    updateToggle();

    infoColumn.appendChild(descriptionRow);
  }

  // quick filter controls appended below

  if (quickFilter?.element) {
    builderColumn.appendChild(quickFilter.element);
  }

  if (info.channelId) {
    quickFilter.setPlaylistOptions([], "Загрузка плейлистов...");
    getChannelPlaylists(info.channelId)
      .then((allPlaylists) => {
        if (Array.isArray(allPlaylists) && allPlaylists.length) {
          quickFilter.setPlaylistOptions(allPlaylists);
        } else {
          quickFilter.setPlaylistOptions([], "Плейлисты не найдены");
        }
      })
      .catch((err) => {
        console.error("Failed to load channel playlists", err);
        quickFilter.setPlaylistOptions(
          [],
          "Не удалось загрузить плейлисты"
        );
      });
  } else {
    quickFilter.setPlaylistOptions(
      [],
      "Плейлисты доступны только для каналов"
    );
  }

  const playlistsContainer = document.createElement("span");
  playlistsContainer.className = "video-info-playlists";
  const initialPlaylistLabel = document.createElement("span");
  initialPlaylistLabel.textContent = info.channelId
    ? "Загрузка..."
    : "Недоступно";
  playlistsContainer.appendChild(initialPlaylistLabel);
  addLine("Состоит в плейлистах", playlistsContainer);

  if (info.channelId && info.id) {
    findVideoPlaylists(info.channelId, info.id)
      .then((playlists) => {
        playlistsContainer.innerHTML = "";
        if (!playlists.length) {
          const none = document.createElement("span");
          none.textContent = "Не найдено";
          playlistsContainer.appendChild(none);
          return;
        }
        playlists.forEach((playlist) => {
          const item = document.createElement("span");
          item.className = "video-info-playlist";
          const link = document.createElement("a");
          link.href = `https://www.youtube.com/playlist?list=${playlist.id}`;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          link.textContent = playlist.title || playlist.id;
          item.appendChild(link);

          const useBtn = document.createElement("button");
          useBtn.type = "button";
          useBtn.className = "video-info-action video-info-action--icon";
          useBtn.title = "Использовать плейлист в фильтре";
          useBtn.setAttribute(
            "aria-label",
            "Использовать плейлист в фильтре"
          );
          useBtn.innerHTML =
            '<span class="icon"><svg width="1.25em" height="1.25em"><use href="icons.svg#icon-plus"></use></svg></span>';
          useBtn.setAttribute("aria-pressed", "false");
          useBtn.addEventListener("click", () => {
            quickFilter.usePlaylist(playlist.id);
          });
          quickFilter.subscribePlaylist(playlist.id, (selected) => {
            useBtn.classList.toggle("is-active", selected);
            useBtn.setAttribute("aria-pressed", selected ? "true" : "false");
          });
          item.appendChild(useBtn);

          playlistsContainer.appendChild(item);
        });
      })
      .catch((err) => {
        console.error("Failed to load channel playlists", err);
        playlistsContainer.innerHTML = "";
        const error = document.createElement("span");
        error.textContent = "Не удалось загрузить";
        playlistsContainer.appendChild(error);
      });
  }
}
