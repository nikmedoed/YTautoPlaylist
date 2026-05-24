// Inline queue item renderer. Builds one queue row with metadata, progress, active state, and action buttons.
import { formatDateTime, formatDuration } from "../../time.js";
import { resolveThumbnailUrl } from "../../utils.js";

function createInlineQueueDetailContainer(parts) {
  const details = document.createElement("div");
  details.className = "video-details";
  let hasContent = false;

  parts.forEach((part) => {
    if (!part || typeof part !== "object" || !part.text) {
      return;
    }
    if (hasContent) {
      const separator = document.createElement("span");
      separator.className = "video-details__separator";
      separator.textContent = "·";
      separator.setAttribute("aria-hidden", "true");
      details.appendChild(separator);
    }
    const span = document.createElement("span");
    if (part.className) {
      span.className = part.className;
    }
    if (part.icon) {
      const icon = document.createElement("span");
      icon.className = part.iconClassName || "video-detail__icon";
      icon.textContent = part.icon;
      icon.setAttribute("aria-hidden", "true");
      span.appendChild(icon);
    }
    let textNode = null;
    if (part.href) {
      const link = document.createElement("a");
      link.className = part.textClassName || "video-detail__text";
      link.textContent = part.text;
      link.href = part.href;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      textNode = link;
    } else if (part.text) {
      const text = document.createElement("span");
      text.className = part.textClassName || "video-detail__text";
      text.textContent = part.text;
      textNode = text;
    }
    if (textNode) {
      span.appendChild(textNode);
    }
    details.appendChild(span);
    hasContent = true;
  });

  return hasContent ? details : null;
}

function buildInlineQueueDetails(entry) {
  const parts = [];
  if (entry?.channelTitle) {
    let channelHref = null;
    if (typeof entry.channelUrl === "string" && entry.channelUrl) {
      channelHref = entry.channelUrl;
    } else if (typeof entry.channelId === "string" && entry.channelId) {
      channelHref = `https://www.youtube.com/channel/${entry.channelId}`;
    }
    parts.push({
      text: entry.channelTitle,
      href: channelHref,
      textClassName: "video-detail__text yta-inline-queue__detail-link",
    });
  }
  const published = formatDateTime(entry?.publishedAt);
  if (published) {
    parts.push({ text: published, textClassName: "video-detail__text" });
  }
  return createInlineQueueDetailContainer(parts);
}

function createInlineQueueActionButton(className, textContent, title) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `icon-button ${className}`;
  if (textContent != null) {
    button.textContent = textContent;
  }
  if (title) {
    button.title = title;
    button.setAttribute("aria-label", title);
  }
  return button;
}

function applyThumbnailProgress(container, percent) {
  if (!(container instanceof HTMLElement)) {
    return;
  }
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  if (!Number.isFinite(clamped) || clamped <= 0) {
    return;
  }
  const progressEl = document.createElement("div");
  progressEl.className = "video-thumb__progress";
  const barEl = document.createElement("div");
  barEl.className = "video-thumb__progress-bar";
  barEl.style.width = `${clamped}%`;
  progressEl.appendChild(barEl);
  container.appendChild(progressEl);
}

// Builds one inline queue row, including thumbnail progress, drag hooks, move actions, and keyboard behavior.
export function createInlineQueueItem(entry, index, isCurrent, options = {}) {
  const allowPostpone = Boolean(options.allowPostpone);
  const currentListId =
    typeof options.currentListId === "string" ? options.currentListId : "";
  const progressPercent =
    typeof options.progressPercent === "number" ? options.progressPercent : null;
  const item = document.createElement("li");
  item.className = "yta-inline-queue__item";

  const videoItem = document.createElement("div");
  videoItem.className = "video-item";
  if (allowPostpone) {
    videoItem.classList.add("video-item--has-postpone");
  }
  videoItem.dataset.videoId = entry.id;
  videoItem.dataset.index = String(index);
  if (currentListId) {
    videoItem.dataset.listId = currentListId;
  }
  videoItem.tabIndex = 0;
  videoItem.setAttribute("role", "button");

  const baseTitle = entry.title || "Без названия";
  videoItem.setAttribute("aria-label", baseTitle);
  videoItem.title = baseTitle;

  const handle = document.createElement("button");
  handle.type = "button";
  handle.className = "video-handle";
  handle.title = "Перетащить";
  handle.setAttribute("aria-label", "Перетащить");
  handle.draggable = true;
  if (typeof options.onHandlePointerDown === "function") {
    handle.addEventListener("pointerdown", options.onHandlePointerDown);
    handle.addEventListener("mousedown", options.onHandlePointerDown);
  }
  videoItem.appendChild(handle);

  const thumbWrapper = document.createElement("div");
  thumbWrapper.className = "video-thumb-wrapper";

  const thumb = document.createElement("img");
  thumb.className = "video-thumb";
  thumb.decoding = "async";
  thumb.loading = "lazy";
  const thumbUrl = resolveThumbnailUrl(
    entry,
    entry.id ? `https://i.ytimg.com/vi/${entry.id}/mqdefault.jpg` : ""
  );
  if (thumbUrl) {
    thumb.src = thumbUrl;
  }
  thumb.alt = baseTitle;
  thumbWrapper.appendChild(thumb);

  const durationText = formatDuration(entry?.duration);
  if (durationText) {
    const durationEl = document.createElement("span");
    durationEl.className = "video-thumb__duration";
    durationEl.textContent = durationText;
    thumbWrapper.appendChild(durationEl);
  }

  if (progressPercent) {
    applyThumbnailProgress(thumbWrapper, progressPercent);
  }

  videoItem.appendChild(thumbWrapper);

  const body = document.createElement("div");
  body.className = "video-body";

  const title = document.createElement("div");
  title.className = "video-title";
  title.textContent = `${index + 1}. ${baseTitle}`;
  body.appendChild(title);

  const details = buildInlineQueueDetails(entry);
  if (details) {
    body.appendChild(details);
  }

  videoItem.appendChild(body);

  if (entry.id) {
    const quickFilterBtn = createInlineQueueActionButton(
      "video-quick-filter",
      "⚡",
      "Создать фильтр для видео"
    );
    quickFilterBtn.dataset.videoId = entry.id;
    videoItem.appendChild(quickFilterBtn);
  }

  const removeBtn = createInlineQueueActionButton(
    "video-remove",
    "✕",
    "Удалить из очереди"
  );
  videoItem.appendChild(removeBtn);

  if (allowPostpone) {
    const postponeBtn = createInlineQueueActionButton(
      "video-postpone",
      "⤵",
      "Отложить в конец списка"
    );
    videoItem.appendChild(postponeBtn);
  }

  const moveBtn = createInlineQueueActionButton(
    "video-move",
    "⇄",
    "Перенести в другой список"
  );
  videoItem.appendChild(moveBtn);

  if (isCurrent) {
    videoItem.classList.add("active");
    item.dataset.current = "1";
  }

  item.appendChild(videoItem);
  return item;
}
