import { formatDuration } from "../../time.js";

const DEFAULT_TITLE = "Без названия";
const DEFAULT_ALT = "Видео";

function sanitizeText(value) {
  if (!value) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

function applyDataset(target, dataset) {
  if (!dataset) return;
  for (const [key, value] of Object.entries(dataset)) {
    if (value == null) continue;
    target.dataset[key] = String(value);
  }
}

function applyAttributes(target, attrs) {
  if (!attrs) return;
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null) continue;
    target.setAttribute(key, String(value));
  }
}

function clampProgress(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  const rounded = Math.round(value);
  if (!Number.isFinite(rounded)) {
    return null;
  }
  if (rounded <= 0) {
    return 0;
  }
  if (rounded >= 100) {
    return 100;
  }
  return rounded;
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

function createDetailNode(doc, part) {
  if (!part) return null;
  if (part instanceof Node) return part;
  if (typeof part === "string") {
    const span = doc.createElement("span");
    span.textContent = part;
    return span;
  }
  if (part.node instanceof Node) {
    return part.node;
  }
  if (typeof part === "object" && part !== null) {
    const text = typeof part.text === "string" ? part.text : "";
    if (!text && !part.icon) {
      return null;
    }
    const span = doc.createElement("span");
    if (part.className) span.classList.add(part.className);
    if (part.title) span.title = part.title;

    if (part.icon) {
      const iconSpan = doc.createElement("span");
      iconSpan.className = part.iconClassName || "video-detail__icon";
      iconSpan.textContent = part.icon;
      iconSpan.setAttribute("aria-hidden", "true");
      span.appendChild(iconSpan);
    }

    if (text) {
      if (part.icon) {
        const textSpan = doc.createElement("span");
        textSpan.className = part.textClassName || "video-detail__text";
        textSpan.textContent = text;
        span.appendChild(textSpan);
      } else {
        span.textContent = text;
      }
    }

    return span;
  }
  return null;
}

function createDetails(doc, parts, className = "video-details") {
  const details = doc.createElement("div");
  details.className = className;
  for (const part of parts || []) {
    const node = createDetailNode(doc, part);
    if (!node) continue;
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
  if (typeof descriptor.element === "function") {
    const node = descriptor.element(doc);
    return node instanceof Node ? node : null;
  }
  const tag = descriptor.tag || "button";
  const element = doc.createElement(tag);
  if (tag === "button") {
    element.type = descriptor.type || "button";
  }
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
  applyAttributes(element, descriptor.attrs);
  if (typeof descriptor.ariaLabel === "string") {
    element.setAttribute("aria-label", descriptor.ariaLabel);
  }
  return element;
}

export function resolveThumbnail(entry, fallback) {
  if (entry && typeof entry.thumbnail === "string" && entry.thumbnail) {
    return entry.thumbnail;
  }
  if (entry?.thumbnail?.url) {
    return entry.thumbnail.url;
  }
  return fallback || "";
}

function resolveThumbnailDuration(video, thumbnailOptions = {}) {
  if (!thumbnailOptions || thumbnailOptions.showDuration === false) {
    return "";
  }

  if (typeof thumbnailOptions.duration === "string") {
    return thumbnailOptions.duration.trim();
  }

  let rawDuration = null;
  if (typeof thumbnailOptions.durationExtractor === "function") {
    rawDuration = thumbnailOptions.durationExtractor(video, thumbnailOptions);
  } else if (
    thumbnailOptions.durationKey &&
    typeof thumbnailOptions.durationKey === "string"
  ) {
    rawDuration = video?.[thumbnailOptions.durationKey];
  } else {
    rawDuration = video?.duration;
  }

  if (rawDuration == null || rawDuration === "") {
    return "";
  }

  const formatter =
    typeof thumbnailOptions.formatDuration === "function"
      ? thumbnailOptions.formatDuration
      : formatDuration;
  const formatted = formatter(rawDuration);
  return typeof formatted === "string" ? formatted.trim() : "";
}

export function createVideoItem(video, options = {}) {
  const {
    document: doc = globalThis.document,
    tag = "li",
    classes = [],
    dataset,
    attrs,
    draggable = false,
    handle,
    thumbnail = {},
    title: titleOptions = {},
    bodyClass = "video-body",
    titleClass = "video-title",
    detailsClass = "video-details",
    details = [],
    actions = [],
    sanitize = sanitizeText,
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
  applyAttributes(element, attrs);

  let handleElement = null;
  if (handle) {
    handleElement = createHandle(doc, handle);
    element.appendChild(handleElement);
  }
  if (!handleElement) {
    element.classList.add("video-item--no-handle");
  }

  let thumbnailElement = null;
  if (thumbnail !== false) {
    const thumbWrapper = doc.createElement("div");
    thumbWrapper.className = thumbnail.wrapperClassName || "video-thumb-wrapper";

    const thumb = doc.createElement("img");
    thumb.className = thumbnail.className || "video-thumb";
    thumb.src =
      thumbnail.src ||
      resolveThumbnail(video, thumbnail.fallback || thumbnail.defaultSrc);
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
    const resolvedProgress = clampProgress(rawProgress);
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
    thumbnailElement = thumb;
  }

  const body = doc.createElement("div");
  body.className = bodyClass;

  const titleNode = doc.createElement("div");
  titleNode.className = titleClass;
  const rawTitle =
    typeof titleOptions.text === "string"
      ? titleOptions.text
      : video?.title || DEFAULT_TITLE;
  const resolvedTitle = sanitize ? sanitize(rawTitle) : rawTitle;
  titleNode.textContent = resolvedTitle || DEFAULT_TITLE;
  if (titleOptions.titleAttr) {
    titleNode.title = titleOptions.titleAttr;
  }
  body.appendChild(titleNode);

  const detailsNode = createDetails(doc, details, detailsClass);
  body.appendChild(detailsNode);

  element.appendChild(body);

  const actionNodes = [];
  for (const action of actions) {
    const node = createActionButton(doc, action);
    if (node) {
      element.appendChild(node);
      actionNodes.push(node);
    }
  }

  return {
    element,
    handle: handleElement,
    thumbnail: thumbnailElement,
    body,
    title: titleNode,
    details: detailsNode,
    actions: actionNodes,
  };
}

export { sanitizeText };
