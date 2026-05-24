// Popup video item renderer. Builds compact video rows shared by queue and history views.
import { formatDuration } from "../../time.js";
import { clampProgressPercent } from "../../progress.js";
import { resolveThumbnailUrl } from "../../utils.js";
import { applyDataset } from "./dom.js";

const DEFAULT_TITLE = "Без названия";
const DEFAULT_ALT = "Видео";

function sanitizeText(value) {
  if (!value) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

function createHandle(doc, options = {}) {
  const button = doc.createElement("button");
  button.type = "button";
  button.className = options.className || "video-handle";
  button.title = options.title || "Перетащить";
  button.setAttribute("aria-label", options.ariaLabel || button.title);
  if (options.draggable) {
    button.setAttribute("draggable", "true");
  }
  if (typeof options.tabIndex === "number") {
    button.tabIndex = options.tabIndex;
  }
  if (options.preventClickDefault) {
    button.addEventListener("click", (event) => {
      event.preventDefault();
    });
  }
  return button;
}

function createDetails(doc, parts, className = "video-details") {
  const details = doc.createElement("div");
  details.className = className;
  for (const part of parts || []) {
    const text = typeof part?.text === "string" ? part.text : "";
    if (!text && !part?.icon) continue;
    const node = doc.createElement("span");
    if (part.className) node.className = part.className;
    if (part.title) node.title = part.title;
    if (part.icon) {
      const icon = doc.createElement("span");
      icon.className = part.iconClassName || "video-detail__icon";
      icon.textContent = part.icon;
      icon.setAttribute("aria-hidden", "true");
      node.appendChild(icon);
    }
    if (text) {
      if (part.icon) {
        const textNode = doc.createElement("span");
        textNode.className = part.textClassName || "video-detail__text";
        textNode.textContent = text;
        node.appendChild(textNode);
      } else {
        node.textContent = text;
      }
    }
    const skipSeparator =
      typeof part === "object" && part !== null && part.noSeparator;
    if (details.childNodes.length && !skipSeparator) {
      const separator = doc.createElement("span");
      separator.className = "video-details__separator";
      separator.textContent = "·";
      separator.setAttribute("aria-hidden", "true");
      details.appendChild(separator);
    }
    details.appendChild(node);
  }
  return details;
}

function createActionButton(doc, descriptor) {
  if (!descriptor) return null;
  const element = doc.createElement("button");
  element.type = "button";
  if (descriptor.className) {
    element.className = descriptor.className;
  }
  if (descriptor.textContent != null) {
    element.textContent = descriptor.textContent;
  }
  if (descriptor.title) {
    element.title = descriptor.title;
  }
  applyDataset(element, descriptor.dataset);
  if (typeof descriptor.ariaLabel === "string") {
    element.setAttribute("aria-label", descriptor.ariaLabel);
  } else if (descriptor.title) {
    element.setAttribute("aria-label", descriptor.title);
  }
  return element;
}

function resolveThumbnailDuration(video, thumbnailOptions = {}) {
  if (!thumbnailOptions || thumbnailOptions.showDuration === false) {
    return "";
  }

  if (typeof thumbnailOptions.duration === "string") {
    return thumbnailOptions.duration.trim();
  }

  if (video?.duration == null || video.duration === "") {
    return "";
  }
  const formatted = formatDuration(video.duration);
  return typeof formatted === "string" ? formatted.trim() : "";
}

// Renders the common popup/manager video row shape: optional drag handle,
// thumbnail metadata, title/details, action buttons, and progress marker.
export function createVideoItem(video, options = {}) {
  const {
    document: doc = globalThis.document,
    tag = "li",
    classes = [],
    dataset,
    draggable = false,
    handle,
    thumbnail = {},
    title: titleOptions = {},
    bodyClass = "video-body",
    titleClass = "video-title",
    detailsClass = "video-details",
    details = [],
    actions = [],
    progress: progressOption = null,
    progressClassName = "video-thumb__progress",
    progressBarClassName = "video-thumb__progress-bar",
  } = options;

  const element = doc.createElement(tag);
  element.classList.add("video-item");
  for (const className of classes) {
    if (className) {
      element.classList.add(className);
    }
  }
  if (draggable) {
    element.draggable = true;
  }
  applyDataset(element, dataset);

  let handleElement = null;
  if (handle) {
    handleElement = createHandle(doc, handle);
    element.appendChild(handleElement);
  }
  if (!handleElement) {
    element.classList.add("video-item--no-handle");
  }

  if (thumbnail !== false) {
    const thumbWrapper = doc.createElement("div");
    thumbWrapper.className = thumbnail.wrapperClassName || "video-thumb-wrapper";

    const thumb = doc.createElement("img");
    thumb.className = thumbnail.className || "video-thumb";
    thumb.src =
      thumbnail.src ||
      resolveThumbnailUrl(video, thumbnail.fallback || thumbnail.defaultSrc);
    const titleText =
      typeof titleOptions.text === "string"
        ? titleOptions.text
        : video?.title;
    thumb.alt =
      thumbnail.alt ||
      (titleText ? sanitizeText(titleText) : DEFAULT_ALT) ||
      DEFAULT_ALT;
    thumb.loading = thumbnail.loading || "lazy";
    thumb.decoding = thumbnail.decoding || "async";
    thumbWrapper.appendChild(thumb);

    const durationText = resolveThumbnailDuration(video, thumbnail);
    if (durationText) {
      const durationEl = doc.createElement("span");
      durationEl.className =
        thumbnail.durationClassName || "video-thumb__duration";
      durationEl.textContent = durationText;
      thumbWrapper.appendChild(durationEl);
    }

    let rawProgress = null;
    if (typeof progressOption === "number") {
      rawProgress = progressOption;
    } else if (typeof progressOption === "function") {
      try {
        rawProgress = progressOption(video);
      } catch {
        rawProgress = null;
      }
    } else if (progressOption && typeof progressOption === "object") {
      if (typeof progressOption.percent === "number") {
        rawProgress = progressOption.percent;
      } else if (typeof progressOption.value === "number") {
        rawProgress = progressOption.value;
      }
    }
    const resolvedProgress = clampProgressPercent(rawProgress);
    if (resolvedProgress && resolvedProgress > 0) {
      const progressContainer = doc.createElement("div");
      progressContainer.className = progressClassName;
      const progressBar = doc.createElement("div");
      progressBar.className = progressBarClassName;
      progressBar.style.width = `${resolvedProgress}%`;
      progressContainer.appendChild(progressBar);
      thumbWrapper.appendChild(progressContainer);
    }

    element.appendChild(thumbWrapper);
  }

  const body = doc.createElement("div");
  body.className = bodyClass;

  const titleNode = doc.createElement("div");
  titleNode.className = titleClass;
  const rawTitle =
    typeof titleOptions.text === "string"
      ? titleOptions.text
      : video?.title || DEFAULT_TITLE;
  const resolvedTitle = sanitizeText(rawTitle);
  titleNode.textContent = resolvedTitle || DEFAULT_TITLE;
  body.appendChild(titleNode);

  const detailsNode = createDetails(doc, details, detailsClass);
  body.appendChild(detailsNode);

  element.appendChild(body);

  for (const action of actions) {
    const node = createActionButton(doc, action);
    if (node) {
      element.appendChild(node);
    }
  }

  return element;
}
