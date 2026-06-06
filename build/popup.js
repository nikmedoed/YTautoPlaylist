// src/popup/lib/dom.js
function applyDataset(target, dataset) {
  if (!target || !dataset) return;
  for (const [key, value] of Object.entries(dataset)) {
    if (value == null) continue;
    target.dataset[key] = String(value);
  }
}
function applyAttributes(target, attrs) {
  if (!target || !attrs) return;
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null) continue;
    target.setAttribute(key, String(value));
  }
}

// src/popup/lib/moveMenu.js
var DEFAULT_PADDING = 12;
var DEFAULT_OFFSET = 6;
function positionMenu(root, anchor, { offset, padding }) {
  if (!anchor || !root) return;
  const rect = anchor.getBoundingClientRect();
  const menuRect = root.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  let left = rect.left;
  let top = rect.bottom + offset;
  if (left + menuRect.width > viewportWidth - padding) {
    left = viewportWidth - menuRect.width - padding;
  }
  if (left < padding) {
    left = padding;
  }
  if (top + menuRect.height > viewportHeight - padding) {
    const alternativeTop = rect.top - menuRect.height - offset;
    if (alternativeTop >= padding) {
      top = alternativeTop;
    } else {
      top = viewportHeight - menuRect.height - padding;
    }
  }
  if (top < padding) {
    top = padding;
  }
  root.style.top = `${Math.round(top)}px`;
  root.style.left = `${Math.round(left)}px`;
}
function createMoveMenu({
  document: doc = globalThis.document,
  headerText = "\u041F\u0435\u0440\u0435\u043D\u0435\u0441\u0442\u0438 \u0432:",
  cancelLabel = "\u041E\u0442\u043C\u0435\u043D\u0430",
  className = "move-menu",
  messageClass = "move-menu__message",
  buttonsClass = "move-menu__buttons",
  getOptions,
  onSelect,
  onEmpty,
  onOpen,
  onClose,
  offset = DEFAULT_OFFSET,
  padding = DEFAULT_PADDING,
  shouldIgnoreClick
} = {}) {
  if (typeof getOptions !== "function") {
    throw new Error("createMoveMenu: getOptions must be a function");
  }
  const root = doc.createElement("div");
  root.className = className;
  root.dataset.visible = "0";
  const message = doc.createElement("div");
  message.className = messageClass;
  root.appendChild(message);
  const buttons = doc.createElement("div");
  buttons.className = buttonsClass;
  buttons.dataset.empty = "1";
  root.appendChild(buttons);
  const cancelButton = doc.createElement("button");
  cancelButton.type = "button";
  cancelButton.classList.add("secondary");
  cancelButton.textContent = cancelLabel;
  root.appendChild(cancelButton);
  doc.body.appendChild(root);
  let state = null;
  const hide = (trigger) => {
    if (root.dataset.visible === "0") return;
    root.dataset.visible = "0";
    state = null;
    buttons.textContent = "";
    buttons.dataset.empty = "1";
    cancelButton.textContent = cancelLabel;
    message.textContent = "";
    if (typeof onClose === "function") {
      onClose(trigger);
    }
  };
  const handleCancel = () => {
    hide({ reason: "cancel" });
  };
  const handleOptionClick = async (event) => {
    const button = event.target.closest("button[data-target-list-id]");
    if (!button || root.dataset.visible !== "1" || !state) return;
    const targetListId = button.dataset.targetListId;
    if (!targetListId) return;
    const { context, options } = state;
    const selected = options.find((option) => option.id === targetListId) || null;
    hide({ reason: "select", targetListId });
    if (typeof onSelect === "function") {
      await onSelect(targetListId, context, selected);
    }
  };
  const handleDocumentClick = (event) => {
    if (root.dataset.visible !== "1") return;
    if (root.contains(event.target)) return;
    const anchor = state?.anchor || null;
    if (anchor && (anchor === event.target || anchor.contains(event.target))) {
      return;
    }
    if (typeof shouldIgnoreClick === "function") {
      if (shouldIgnoreClick({ event, anchor, context: state?.context, menu: root })) {
        return;
      }
    }
    hide({ reason: "outside-click" });
  };
  const handleKeydown = (event) => {
    if (event.key === "Escape" && root.dataset.visible === "1") {
      hide({ reason: "escape" });
    }
  };
  cancelButton.addEventListener("click", handleCancel);
  buttons.addEventListener("click", handleOptionClick);
  doc.addEventListener("click", handleDocumentClick);
  doc.addEventListener("keydown", handleKeydown);
  const show = (anchor, context = {}) => {
    const rawOptions = getOptions(context);
    const normalized = Array.isArray(rawOptions) ? rawOptions.map((option) => {
      if (!option) return null;
      if (typeof option === "string") {
        return { id: option, label: option };
      }
      if (typeof option.id !== "string") return null;
      const label = option.label || option.name;
      if (typeof label !== "string" || !label.trim()) return null;
      return {
        id: option.id,
        label,
        dataset: option.dataset,
        attrs: option.attrs
      };
    }).filter(Boolean) : [];
    if (!normalized.length) {
      hide({ reason: "empty" });
      if (typeof onEmpty === "function") {
        onEmpty(context);
      }
      return false;
    }
    buttons.textContent = "";
    buttons.dataset.empty = "0";
    cancelButton.textContent = cancelLabel;
    message.textContent = headerText;
    normalized.forEach((option) => {
      const button = doc.createElement("button");
      button.type = "button";
      button.textContent = option.label;
      button.dataset.targetListId = option.id;
      applyDataset(button, option.dataset);
      applyAttributes(button, option.attrs);
      buttons.appendChild(button);
    });
    state = { anchor: anchor || null, context, options: normalized };
    root.dataset.visible = "1";
    requestAnimationFrame(() => {
      positionMenu(root, anchor || buttons, { offset, padding });
    });
    if (typeof onOpen === "function") {
      onOpen(context, normalized);
    }
    return true;
  };
  const destroy = () => {
    hide({ reason: "destroy" });
    cancelButton.removeEventListener("click", handleCancel);
    buttons.removeEventListener("click", handleOptionClick);
    doc.removeEventListener("click", handleDocumentClick);
    doc.removeEventListener("keydown", handleKeydown);
    if (root.parentNode) {
      root.parentNode.removeChild(root);
    }
  };
  return {
    show,
    hide,
    destroy,
    get element() {
      return root;
    }
  };
}

// src/popup/modules/shared/status.js
var DEFAULT_TIMEOUT = 5e3;
function ensureAccessibility(statusBox2, statusText2) {
  if (!statusBox2 || !statusText2) return;
  statusBox2.hidden = true;
  statusBox2.dataset.visible = "0";
  statusText2.textContent = "";
  if (!statusBox2.hasAttribute("role")) {
    statusBox2.setAttribute("role", "status");
  }
  statusBox2.setAttribute("aria-live", "polite");
  statusBox2.setAttribute("aria-atomic", "true");
}
function applyStatusProgress(progressEl, progressBarEl, progress) {
  if (!progressEl || !progressBarEl) return;
  if (!progress) {
    progressEl.hidden = true;
    progressEl.removeAttribute("data-indeterminate");
    progressBarEl.style.width = "0%";
    progressBarEl.style.transform = "translateX(0)";
    return;
  }
  if (progress.indeterminate || !progress.total) {
    progressEl.dataset.indeterminate = "1";
    progressBarEl.style.width = "40%";
    progressBarEl.style.transform = "";
  } else {
    progressEl.removeAttribute("data-indeterminate");
    const total = Number(progress.total);
    const added = Number(progress.added);
    if (Number.isFinite(total) && total > 0 && Number.isFinite(added) && added >= 0) {
      const ratio = Math.max(0, Math.min(1, added / total));
      progressBarEl.style.width = `${(ratio * 100).toFixed(2)}%`;
    } else {
      progressBarEl.style.width = "0%";
    }
    progressBarEl.style.transform = "translateX(0)";
  }
  progressEl.hidden = false;
}
function createStatusController({
  statusBox: statusBox2,
  statusText: statusText2,
  progressEl = null,
  progressBarEl = null
}) {
  if (!statusBox2 || !statusText2) {
    return {
      setStatus() {
      },
      hideStatus() {
      }
    };
  }
  let timeoutHandle = null;
  let hideTimer = null;
  const finalizeHide = () => {
    hideTimer = null;
    applyStatusProgress(progressEl, progressBarEl, null);
    statusBox2.hidden = true;
    statusBox2.removeAttribute("data-kind");
    statusText2.textContent = "";
  };
  const hideStatus = (immediate = false) => {
    clearTimeout(hideTimer);
    statusBox2.dataset.visible = "0";
    if (immediate) {
      finalizeHide();
      return;
    }
    hideTimer = window.setTimeout(() => {
      if (statusBox2.dataset.visible !== "1") {
        finalizeHide();
      }
    }, 220);
  };
  const setStatus2 = (text, kind = "info", timeout = DEFAULT_TIMEOUT, options = {}) => {
    if (!text) {
      hideStatus(true);
      return;
    }
    clearTimeout(hideTimer);
    statusText2.textContent = text;
    statusBox2.dataset.kind = kind;
    statusBox2.hidden = false;
    applyStatusProgress(progressEl, progressBarEl, options?.progress ?? null);
    void statusBox2.offsetWidth;
    statusBox2.dataset.visible = "1";
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
    if (timeout && timeout > 0) {
      timeoutHandle = window.setTimeout(() => {
        hideStatus();
      }, timeout);
    } else {
      timeoutHandle = null;
    }
  };
  ensureAccessibility(statusBox2, statusText2);
  if (progressEl) {
    progressEl.hidden = true;
  }
  statusBox2.addEventListener("click", () => {
    hideStatus(true);
  });
  return { setStatus: setStatus2, hideStatus };
}

// src/progress.js
function clampProgressPercent(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  const percent = Math.round(value);
  if (!Number.isFinite(percent)) {
    return null;
  }
  if (percent <= 0) return 0;
  return percent >= 100 ? 100 : percent;
}
function getProgressPercent(progressById, videoId) {
  if (!videoId || !progressById) {
    return null;
  }
  if (typeof progressById !== "object") {
    return null;
  }
  const percent = clampProgressPercent(progressById[videoId]?.percent);
  return percent && percent > 0 ? percent : null;
}

// src/time.js
var ISO_DURATION_PATTERN = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/;
var DISPLAY_DATE_FORMATTER = new Intl.DateTimeFormat("ru-RU", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit"
});
var STORAGE_TIMESTAMP_FORMATTER = new Intl.DateTimeFormat("ru", {
  year: "2-digit",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric"
});
function toDate(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : new Date(value.getTime());
  }
  if (typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === "string" && value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}
function formatHms(totalSeconds) {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  const secs = seconds % 60;
  if (hours) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(
      2,
      "0"
    )}:${String(secs).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}
function parseDuration(duration) {
  if (duration == null) return void 0;
  if (typeof duration === "number" && Number.isFinite(duration)) {
    return Math.max(0, duration);
  }
  const match = ISO_DURATION_PATTERN.exec(String(duration));
  if (!match) return void 0;
  const hours = Number(match[1] || 0);
  const minutes = Number(match[2] || 0);
  const seconds = Number(match[3] || 0);
  return hours * 3600 + minutes * 60 + seconds;
}
function formatDuration(duration) {
  if (duration == null) return "";
  const seconds = parseDuration(duration);
  if (seconds == null) return "";
  return formatHms(seconds);
}
function formatDateTime(value) {
  const date = toDate(value);
  return date ? DISPLAY_DATE_FORMATTER.format(date) : "";
}
function formatClockTime(value = /* @__PURE__ */ new Date()) {
  const date = toDate(value);
  if (!date) return "";
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

// src/utils.js
var YOUTUBE_ID_PATTERN = /[\w-]{11}/;
var THUMBNAIL_PRIORITY = ["maxres", "standard", "high", "medium", "default"];
function parseVideoId(input) {
  if (!input) return "";
  const str = String(input).trim();
  if (/^[\w-]{11}$/.test(str)) return str;
  try {
    const baseUrl = typeof globalThis?.location?.href === "string" ? globalThis.location.href : null;
    const url = baseUrl ? new URL(str, baseUrl) : new URL(str);
    if (url.hostname.includes("youtu.be")) {
      const id = url.pathname.split("/").filter(Boolean)[0];
      if (/^[\w-]{11}$/.test(id)) return id;
    }
    const candidate = url.searchParams.get("v");
    if (candidate && /^[\w-]{11}$/.test(candidate)) return candidate;
    const segments = url.pathname.split("/");
    for (const segment of segments) {
      if (/^[\w-]{11}$/.test(segment)) return segment;
    }
  } catch {
  }
  const match = str.match(YOUTUBE_ID_PATTERN);
  return match ? match[0] : "";
}
function pickThumbnailValue(value) {
  if (typeof value === "string" && value) {
    return value;
  }
  if (!value || typeof value !== "object") {
    return "";
  }
  return value.url || value.fallback || value.defaultSrc || "";
}
function pickThumbnailSet(thumbnails) {
  if (!thumbnails || typeof thumbnails !== "object") {
    return "";
  }
  for (const key of THUMBNAIL_PRIORITY) {
    const url = pickThumbnailValue(thumbnails[key]);
    if (url) {
      return url;
    }
  }
  return "";
}
function resolveThumbnailUrl(entry, fallback = "") {
  if (!entry || typeof entry !== "object") {
    return fallback || "";
  }
  const id = parseVideoId(entry.id);
  return pickThumbnailValue(entry.thumbnail) || pickThumbnailSet(entry.thumbnails) || (id ? `https://i.ytimg.com/vi/${id}/mqdefault.jpg` : "") || fallback || "";
}

// src/popup/lib/videoItem.js
var DEFAULT_TITLE = "\u0411\u0435\u0437 \u043D\u0430\u0437\u0432\u0430\u043D\u0438\u044F";
var DEFAULT_ALT = "\u0412\u0438\u0434\u0435\u043E";
function sanitizeText(value) {
  if (!value) return "";
  return String(value).replace(/\s+/g, " ").trim();
}
function createHandle(doc, options = {}) {
  const button = doc.createElement("button");
  button.type = "button";
  button.className = options.className || "video-handle";
  button.title = options.title || "\u041F\u0435\u0440\u0435\u0442\u0430\u0449\u0438\u0442\u044C";
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
    const skipSeparator = typeof part === "object" && part !== null && part.noSeparator;
    if (details.childNodes.length && !skipSeparator) {
      const separator = doc.createElement("span");
      separator.className = "video-details__separator";
      separator.textContent = "\xB7";
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
function createVideoItem(video, options = {}) {
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
    progressBarClassName = "video-thumb__progress-bar"
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
    thumb.src = thumbnail.src || resolveThumbnailUrl(video, thumbnail.fallback || thumbnail.defaultSrc);
    const titleText = typeof titleOptions.text === "string" ? titleOptions.text : video?.title;
    thumb.alt = thumbnail.alt || (titleText ? sanitizeText(titleText) : DEFAULT_ALT) || DEFAULT_ALT;
    thumb.loading = thumbnail.loading || "lazy";
    thumb.decoding = thumbnail.decoding || "async";
    thumbWrapper.appendChild(thumb);
    const durationText = resolveThumbnailDuration(video, thumbnail);
    if (durationText) {
      const durationEl = doc.createElement("span");
      durationEl.className = thumbnail.durationClassName || "video-thumb__duration";
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
  const rawTitle = typeof titleOptions.text === "string" ? titleOptions.text : video?.title || DEFAULT_TITLE;
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

// src/popup/lib/detailParts.js
function normalizeKey(key) {
  if (key === false || key === null || key === "") {
    return null;
  }
  return typeof key === "string" ? key : null;
}
function buildDetailParts(entry, options = {}) {
  const {
    includeChannel = true,
    includeDuration = false,
    publishedKey = "publishedAt",
    listIdKey,
    getListName: getListName2,
    formatDate = formatDateTime,
    formatDurationValue = formatDuration
  } = options;
  const channel = includeChannel && entry?.channelTitle ? entry.channelTitle : null;
  const resolvedPublishedKey = normalizeKey(publishedKey);
  const published = resolvedPublishedKey && entry ? formatDate(entry?.[resolvedPublishedKey]) : null;
  const duration = includeDuration && entry ? formatDurationValue(entry.duration) : null;
  const metaParts = [];
  if (channel)
    metaParts.push({
      text: channel
    });
  if (published)
    metaParts.push({
      text: published
    });
  if (duration)
    metaParts.push({
      text: duration,
      className: "video-detail-duration",
      icon: "\u23F1"
    });
  const parts = [];
  if (metaParts.length) {
    parts.push(...metaParts);
  }
  const resolvedListIdKey = normalizeKey(listIdKey);
  if (resolvedListIdKey && typeof getListName2 === "function") {
    const listId = entry?.[resolvedListIdKey];
    if (listId) {
      const listName = getListName2(listId);
      if (listName) {
        parts.push({
          text: listName,
          className: "list-label",
          noSeparator: true
        });
      }
    }
  }
  return parts;
}

// src/popup/lib/quickFilter.js
var settingsPath = "src/settings/settings.html";
var settingsUrl = chrome.runtime.getURL(settingsPath);
function buildQuickFilterUrl(videoId) {
  if (!videoId || typeof videoId !== "string") {
    return settingsUrl;
  }
  const normalized = videoId.trim();
  const url = new URL(settingsUrl);
  if (normalized) {
    url.searchParams.set("quickFilterVideo", normalized);
  }
  return url.toString();
}
async function openQuickFilter(videoId) {
  if (!videoId || typeof videoId !== "string") {
    return;
  }
  const normalized = videoId.trim();
  if (!normalized) {
    return;
  }
  try {
    await chrome.runtime.sendMessage({
      type: "options:openQuickFilter",
      videoId: normalized
    });
    return;
  } catch (err) {
    console.warn("Failed to open quick filter via background", err);
  }
  const url = buildQuickFilterUrl(normalized);
  try {
    if (chrome?.tabs?.create) {
      await chrome.tabs.create({ url });
      return;
    }
  } catch (err) {
    console.warn("Failed to open quick filter tab", err);
  }
  try {
    window.open(url, "_blank", "noopener,noreferrer");
  } catch (err) {
    console.error("Failed to open quick filter window", err);
  }
}

// src/popup/lib/dragReorderGeometry.js
function createDropIndicator(documentRef, { className, lineClassName }) {
  const indicator = documentRef.createElement("div");
  indicator.className = className;
  const line = documentRef.createElement("div");
  line.className = lineClassName;
  indicator.appendChild(line);
  return indicator;
}
function renderDropIndicator({
  container,
  indicator,
  items,
  pointerY,
  rectFor,
  targetItems
}) {
  if (!items.length) {
    indicator.style.top = `${Math.max(0, container.scrollTop)}px`;
    appendIndicator(container, indicator);
    return 0;
  }
  let targetIndex = items.length;
  for (const item of targetItems) {
    const rect = rectFor(item);
    if (pointerY < rect.top + rect.height / 2) {
      targetIndex = items.indexOf(item);
      break;
    }
  }
  const beforeItem = targetIndex > 0 ? items[targetIndex - 1] : null;
  const afterItem = targetIndex < items.length ? items[targetIndex] : null;
  indicator.style.top = `${resolveIndicatorTop({
    container,
    beforeRect: beforeItem ? rectFor(beforeItem) : null,
    afterRect: afterItem ? rectFor(afterItem) : null
  })}px`;
  appendIndicator(container, indicator);
  return targetIndex;
}
function getWheelPixels(event, container) {
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? container.clientHeight : 1;
  return event.deltaY * unit;
}
function findScrollableContainer(startNode, fallback) {
  let element = startNode && startNode.nodeType === 1 ? startNode : null;
  while (element && element !== fallback && element !== document.body && element !== document.documentElement) {
    if (isScrollable(element)) return element;
    element = element.parentElement;
  }
  if (fallback && isScrollable(fallback)) return fallback;
  return document.scrollingElement || document.documentElement;
}
function getEdgeScroll(container, pointerY, {
  edgeZone = 56,
  maxStep = 28,
  minStep = 6
} = {}) {
  const rect = container.getBoundingClientRect();
  const topBand = rect.top + edgeZone;
  const bottomBand = rect.bottom - edgeZone;
  let speed = 0;
  if (pointerY < topBand) {
    const ratio = Math.min(1, (topBand - pointerY) / edgeZone);
    speed = -Math.max(minStep, Math.round(maxStep * ratio));
  } else if (pointerY > bottomBand) {
    const ratio = Math.min(1, (pointerY - bottomBand) / edgeZone);
    speed = Math.max(minStep, Math.round(maxStep * ratio));
  }
  const previous = container.scrollTop;
  const cannotScrollUp = previous <= 0 && speed < 0;
  const cannotScrollDown = previous >= container.scrollHeight - container.clientHeight && speed > 0;
  return cannotScrollUp || cannotScrollDown ? 0 : speed;
}
function resolveIndicatorTop({ container, beforeRect, afterRect }) {
  const containerRect = container.getBoundingClientRect();
  const edgeOffset = 12;
  let targetTop;
  if (beforeRect && afterRect) {
    const gap = afterRect.top - beforeRect.bottom;
    targetTop = beforeRect.bottom + (gap > 0 ? gap / 2 : 0);
  } else if (!beforeRect && afterRect) {
    targetTop = afterRect.top - Math.min(edgeOffset, afterRect.height / 2);
  } else if (beforeRect && !afterRect) {
    targetTop = beforeRect.bottom + Math.min(edgeOffset, beforeRect.height / 2);
  } else {
    targetTop = containerRect.top + container.clientHeight / 2;
  }
  return Math.max(
    0,
    Math.min(container.scrollHeight, targetTop - containerRect.top + container.scrollTop)
  );
}
function appendIndicator(container, indicator) {
  if (!container.contains(indicator)) {
    container.appendChild(indicator);
  }
}
function isScrollable(element) {
  if (!element || element.nodeType !== 1) return false;
  const styles = getComputedStyle(element);
  if (!styles) return false;
  const overflowY = styles.overflowY;
  return (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") && element.scrollHeight > element.clientHeight;
}

// src/popup/lib/dragReorder.js
function createDragReorderController({
  container,
  itemSelector,
  handleSelector = ".video-handle",
  dragElementSelector = null,
  interactiveSelector = null,
  nativeHandleRequired = true,
  attachNativeEvents = false,
  indicatorClassName = "queue-drop-indicator",
  indicatorLineClassName = "queue-drop-indicator__line",
  skipDraggedItemInIndicator = false,
  edgeScroll = {},
  getQueue = () => [],
  getActiveListId = () => null,
  getItemId = (item) => item?.dataset?.id || null,
  getItemListId = (item) => item?.dataset?.listId || null,
  onReorder
} = {}) {
  if (!container) throw new Error("container element is required for drag reorder");
  if (!itemSelector) throw new Error("itemSelector is required for drag reorder");
  if (typeof onReorder !== "function") throw new Error("onReorder handler is required for drag reorder");
  const doc = container.ownerDocument || document;
  const win = doc.defaultView || window;
  const indicator = createDropIndicator(doc, { className: indicatorClassName, lineClassName: indicatorLineClassName });
  const state = {
    videoId: null,
    listId: null,
    dropIndex: null,
    lastPointerY: null,
    wheelListenerActive: false,
    docDragOverActive: false,
    scrollRepositionActive: false,
    autoScrollRAF: 0,
    autoScrollContainer: null,
    autoScrollSpeed: 0,
    manualActive: false,
    manualHandleEl: null,
    manualPointerId: null
  };
  function itemElementFromEventTarget(target) {
    return target?.closest?.(itemSelector) || null;
  }
  function dragElementFor(item) {
    return dragElementSelector ? item?.querySelector?.(dragElementSelector) || item : item;
  }
  function rectFor(item) {
    return dragElementFor(item)?.getBoundingClientRect?.() || item.getBoundingClientRect();
  }
  function getItems({ skipDragged = false } = {}) {
    return Array.from(container.querySelectorAll(itemSelector)).filter((item) => {
      if (skipDragged && item.dataset.id === state.videoId) return false;
      const { listId } = item.dataset;
      return !state.listId || !listId || listId === state.listId;
    });
  }
  function stopAutoscroll() {
    if (state.autoScrollRAF) {
      win.cancelAnimationFrame(state.autoScrollRAF);
      state.autoScrollRAF = 0;
    }
    state.autoScrollSpeed = 0;
    state.autoScrollContainer = null;
  }
  function updateDropIndicatorAt(pointerY) {
    state.dropIndex = renderDropIndicator({
      container,
      indicator,
      items: getItems(),
      pointerY,
      rectFor,
      targetItems: getItems({ skipDragged: skipDraggedItemInIndicator })
    });
  }
  function autoscrollTick() {
    const scrollContainer = state.autoScrollContainer;
    const speed = state.autoScrollSpeed;
    if (!state.videoId || !scrollContainer || !speed) {
      stopAutoscroll();
      return;
    }
    scrollContainer.scrollTop += speed;
    if (typeof state.lastPointerY === "number") {
      updateDropIndicatorAt(state.lastPointerY);
    }
    state.autoScrollRAF = win.requestAnimationFrame(autoscrollTick);
  }
  function ensureAutoscroll(pointerTarget, pointerY) {
    const scrollContainer = findScrollableContainer(pointerTarget, container);
    const speed = getEdgeScroll(scrollContainer, pointerY, edgeScroll);
    if (!speed) {
      stopAutoscroll();
      return;
    }
    const changed = state.autoScrollContainer !== scrollContainer;
    state.autoScrollContainer = scrollContainer;
    state.autoScrollSpeed = speed;
    if (changed || !state.autoScrollRAF) {
      stopAutoscroll();
      state.autoScrollContainer = scrollContainer;
      state.autoScrollSpeed = speed;
      state.autoScrollRAF = win.requestAnimationFrame(autoscrollTick);
    }
  }
  function clearIndicators() {
    const dropped = container.querySelectorAll(".drop-before, .drop-after");
    dropped.forEach((item) => item.classList.remove("drop-before", "drop-after"));
    indicator.remove();
  }
  function enableDragListeners() {
    if (!state.wheelListenerActive) {
      const opts = { passive: false, capture: true };
      win.addEventListener("wheel", onWheelWhileDragging, opts);
      doc.addEventListener("wheel", onWheelWhileDragging, opts);
      state.wheelListenerActive = true;
    }
    if (!state.docDragOverActive) {
      doc.addEventListener("dragover", onDocDragOver, { capture: true });
      state.docDragOverActive = true;
    }
    enableScrollReposition();
  }
  function enableScrollReposition() {
    if (state.scrollRepositionActive) return;
    const opts = { capture: true, passive: true };
    win.addEventListener("scroll", onAnyScrollDuringDrag, opts);
    doc.addEventListener("scroll", onAnyScrollDuringDrag, opts);
    state.scrollRepositionActive = true;
  }
  function disableDragListeners() {
    if (state.wheelListenerActive) {
      win.removeEventListener("wheel", onWheelWhileDragging, { capture: true });
      doc.removeEventListener("wheel", onWheelWhileDragging, { capture: true });
      state.wheelListenerActive = false;
    }
    if (state.docDragOverActive) {
      doc.removeEventListener("dragover", onDocDragOver, { capture: true });
      state.docDragOverActive = false;
    }
    if (state.scrollRepositionActive) {
      win.removeEventListener("scroll", onAnyScrollDuringDrag, { capture: true });
      doc.removeEventListener("scroll", onAnyScrollDuringDrag, { capture: true });
      state.scrollRepositionActive = false;
    }
    stopAutoscroll();
  }
  function initDrag(item, pointerY) {
    state.videoId = getItemId(item) || null;
    state.listId = getItemListId(item) || getActiveListId?.() || null;
    state.dropIndex = null;
    state.lastPointerY = typeof pointerY === "number" ? pointerY : null;
    indicator.remove();
    dragElementFor(item)?.classList.add("dragging");
  }
  function reset() {
    if (state.videoId) {
      const item = container.querySelector(`${itemSelector}[data-id="${state.videoId}"]`);
      dragElementFor(item)?.classList.remove("dragging");
    }
    clearIndicators();
    state.videoId = null;
    state.listId = null;
    state.dropIndex = null;
    state.lastPointerY = null;
    disableDragListeners();
  }
  function resolveDropIndex(event) {
    if (typeof state.dropIndex === "number") return state.dropIndex;
    const items = getItems();
    const targetItem = itemElementFromEventTarget(event.target);
    if (targetItem && items.includes(targetItem)) {
      const rect = rectFor(targetItem);
      const baseIndex = items.indexOf(targetItem);
      if (rect && typeof event.clientY === "number") {
        return event.clientY < rect.top + rect.height / 2 ? baseIndex : baseIndex + 1;
      }
      return baseIndex;
    }
    return items.length;
  }
  async function commitReorder(targetIndex) {
    const queue = normalizeQueue(getQueue());
    const fromIndex = queue.findIndex((entry) => entry?.id === state.videoId);
    if (fromIndex === -1) {
      return;
    }
    const bounded = Math.max(0, Math.min(queue.length, Number(targetIndex)));
    if (bounded === fromIndex || bounded === fromIndex + 1) {
      return;
    }
    await onReorder({
      videoId: state.videoId,
      targetIndex: bounded,
      listId: state.listId || getActiveListId?.() || null
    });
  }
  const onWheelWhileDragging = (event) => {
    if (!state.videoId) return;
    const scrollContainer = findScrollableContainer(event.target, container);
    const previous = scrollContainer.scrollTop;
    const delta = getWheelPixels(event, scrollContainer);
    const max = Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight);
    scrollContainer.scrollTop = Math.max(0, Math.min(max, previous + delta));
    if (scrollContainer.scrollTop !== previous) {
      event.preventDefault();
      const pointerY = typeof event.clientY === "number" ? event.clientY : state.lastPointerY;
      if (typeof pointerY === "number") {
        updateDropIndicatorAt(pointerY);
      }
    }
  };
  const onDocDragOver = (event) => {
    if (!state.videoId) return;
    state.lastPointerY = event.clientY;
    updateDropIndicatorAt(event.clientY);
    ensureAutoscroll(event.target, event.clientY);
  };
  const onAnyScrollDuringDrag = () => {
    if (!state.videoId || typeof state.lastPointerY !== "number") return;
    updateDropIndicatorAt(state.lastPointerY);
  };
  function handleDragStart(event) {
    if (state.manualActive) {
      event.preventDefault();
      return;
    }
    const handle = event.target.closest?.(handleSelector) || null;
    if (nativeHandleRequired && !handle) {
      event.preventDefault();
      return;
    }
    const interactive = interactiveSelector ? event.target.closest?.(interactiveSelector) : null;
    if (interactive && !handle) {
      event.preventDefault();
      return;
    }
    const item = itemElementFromEventTarget(handle || event.target);
    if (!item) {
      event.preventDefault();
      return;
    }
    initDrag(item, event.clientY);
    if (!state.videoId) {
      event.preventDefault();
      reset();
      return;
    }
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", state.videoId);
    }
    enableDragListeners();
  }
  function handleDragOver(event) {
    if (!state.videoId) return;
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "move";
    }
    state.lastPointerY = event.clientY;
    updateDropIndicatorAt(event.clientY);
    ensureAutoscroll(event.target, event.clientY);
  }
  async function handleDrop(event) {
    if (!state.videoId) return;
    event.preventDefault();
    try {
      await commitReorder(resolveDropIndex(event));
    } finally {
      reset();
    }
  }
  function handleDragEnd() {
    reset();
  }
  function manualStart(event) {
    if (!event.isPrimary || event.button !== 0) return;
    const handle = event.target.closest?.(handleSelector) || null;
    if (!handle) return;
    const item = itemElementFromEventTarget(handle);
    if (!item) return;
    state.manualHandleEl = handle;
    state.manualPointerId = event.pointerId;
    handle.draggable = false;
    state.manualActive = true;
    initDrag(item, event.clientY);
    if (!state.videoId) {
      endManualDrag();
      reset();
      return;
    }
    try {
      handle.setPointerCapture?.(event.pointerId);
    } catch {
    }
    updateDropIndicatorAt(event.clientY);
    doc.addEventListener("pointermove", manualMove, { capture: true });
    doc.addEventListener("pointerup", manualUp, { capture: true });
    enableScrollReposition();
  }
  function manualMove(event) {
    if (!state.manualActive) return;
    state.lastPointerY = event.clientY;
    updateDropIndicatorAt(event.clientY);
    ensureAutoscroll(event.target, event.clientY);
    event.preventDefault();
  }
  async function manualUp(event) {
    if (!state.manualActive) return;
    const targetIndex = resolveDropIndex(event);
    endManualDrag();
    try {
      await commitReorder(targetIndex);
    } finally {
      reset();
    }
  }
  function endManualDrag() {
    try {
      state.manualHandleEl?.releasePointerCapture?.(state.manualPointerId);
    } catch {
    }
    doc.removeEventListener("pointermove", manualMove, { capture: true });
    doc.removeEventListener("pointerup", manualUp, { capture: true });
    if (state.manualHandleEl) state.manualHandleEl.draggable = true;
    state.manualActive = false;
    state.manualHandleEl = null;
    state.manualPointerId = null;
    stopAutoscroll();
  }
  function cancelNativeWhenManual(event) {
    if (state.manualActive) {
      event.preventDefault();
    }
  }
  container.addEventListener("pointerdown", manualStart, { capture: true });
  container.addEventListener("dragstart", cancelNativeWhenManual, { capture: true });
  if (attachNativeEvents) {
    container.addEventListener("dragstart", handleDragStart);
    container.addEventListener("dragover", handleDragOver);
    container.addEventListener("drop", handleDrop);
    container.addEventListener("dragend", handleDragEnd);
  }
  return { handleDragStart, handleDragOver, handleDrop, handleDragEnd, reset };
}
function normalizeQueue(queue) {
  return Array.isArray(queue) ? queue : [];
}

// src/popup/modules/queue/index.js
function createQueueController({
  queueList: queueList2,
  queueEmpty: queueEmpty2,
  queueFreezeIndicator: queueFreezeIndicator2,
  fallbackThumbnail: fallbackThumbnail2,
  showMoveMenu: showMoveMenu2 = () => {
  },
  hideMoveMenu = () => {
  },
  setStatus: setStatus2 = () => {
  },
  sendMessage: sendMessage2,
  onStateChange = () => {
  },
  getPlaylistState = () => null,
  defaultListId = "default"
}) {
  if (!queueList2 || typeof sendMessage2 !== "function") {
    return { render() {
    } };
  }
  const dragController = createDragReorderController({
    container: queueList2,
    itemSelector: ".video-item",
    attachNativeEvents: true,
    skipDraggedItemInIndicator: true,
    getQueue: () => {
      const playlistState2 = getPlaylistState();
      return Array.isArray(playlistState2?.currentQueue?.queue) ? playlistState2.currentQueue.queue : [];
    },
    getActiveListId: () => {
      const playlistState2 = getPlaylistState();
      return playlistState2?.currentQueue?.id || null;
    },
    getItemListId: (item) => {
      const playlistState2 = getPlaylistState();
      return item.dataset.listId || playlistState2?.currentQueue?.id || null;
    },
    onReorder: async ({ videoId, targetIndex, listId }) => {
      try {
        const state = await sendMessage2("playlist:reorder", {
          videoId,
          targetIndex,
          listId
        });
        if (state) {
          onStateChange(state);
          setStatus2("\u041F\u043E\u0440\u044F\u0434\u043E\u043A \u043E\u0431\u043D\u043E\u0432\u043B\u0451\u043D", "info");
        }
      } catch (err) {
        console.error(err);
        setStatus2("\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0438\u0437\u043C\u0435\u043D\u0438\u0442\u044C \u043F\u043E\u0440\u044F\u0434\u043E\u043A", "error", 3e3);
      }
    }
  });
  async function removeQueueItem(item) {
    hideMoveMenu();
    if (!item) return;
    const videoId = item.dataset.id;
    if (!videoId) return;
    const playlistState2 = getPlaylistState();
    const listId = item.dataset.listId || playlistState2?.currentQueue?.id;
    try {
      const state = await sendMessage2("playlist:remove", { videoId, listId });
      if (state) {
        onStateChange(state);
        setStatus2("\u0412\u0438\u0434\u0435\u043E \u0443\u0434\u0430\u043B\u0435\u043D\u043E", "info");
      }
    } catch (err) {
      console.error(err);
      setStatus2("\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0443\u0434\u0430\u043B\u0438\u0442\u044C \u0432\u0438\u0434\u0435\u043E", "error", 3e3);
    }
  }
  async function postponeQueueItem(item) {
    hideMoveMenu();
    if (!item) return;
    const videoId = item.dataset.id;
    if (!videoId) return;
    const playlistState2 = getPlaylistState();
    const listId = item.dataset.listId || playlistState2?.currentQueue?.id || null;
    const isCurrent = Boolean(listId) && listId === playlistState2?.currentQueue?.id && playlistState2?.currentVideoId === videoId;
    setStatus2("\u041E\u0442\u043A\u043B\u0430\u0434\u044B\u0432\u0430\u044E \u0432\u0438\u0434\u0435\u043E...", "info");
    try {
      if (isCurrent) {
        const payload = {
          videoId,
          tabId: Number.isInteger(playlistState2?.currentTabId) ? playlistState2.currentTabId : void 0
        };
        const response = await sendMessage2("playlist:postpone", payload);
        if (response?.handled === false) {
          setStatus2("\u041D\u0435\u0442 \u0441\u043B\u0435\u0434\u0443\u044E\u0449\u0435\u0433\u043E \u0432\u0438\u0434\u0435\u043E", "info", 3e3);
          return;
        }
        const presentation = response?.state || response;
        if (presentation) {
          onStateChange(presentation);
        }
      } else {
        const state = await sendMessage2("playlist:postponeVideo", { videoId, listId });
        if (state) {
          onStateChange(state);
        }
      }
      setStatus2("\u0412\u0438\u0434\u0435\u043E \u043E\u0442\u043B\u043E\u0436\u0435\u043D\u043E", "success", 2200);
    } catch (err) {
      console.error(err);
      setStatus2("\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043E\u0442\u043B\u043E\u0436\u0438\u0442\u044C", "error", 3e3);
    }
  }
  function handleQueueClick(event) {
    const quickFilterBtn = event.target.closest(".video-quick-filter");
    if (quickFilterBtn) {
      event.stopPropagation();
      const item2 = quickFilterBtn.closest(".video-item");
      const videoId2 = quickFilterBtn.dataset.videoId || item2?.dataset.id || item2?.dataset.videoId;
      if (videoId2) {
        openQuickFilter(videoId2);
      }
      return;
    }
    const removeBtn = event.target.closest(".video-remove");
    if (removeBtn) {
      event.stopPropagation();
      const item2 = removeBtn.closest(".video-item");
      removeQueueItem(item2);
      return;
    }
    const postponeBtn2 = event.target.closest(".video-postpone");
    if (postponeBtn2) {
      event.stopPropagation();
      const item2 = postponeBtn2.closest(".video-item");
      postponeQueueItem(item2);
      return;
    }
    const moveBtn = event.target.closest(".video-move");
    if (moveBtn) {
      event.stopPropagation();
      const item2 = moveBtn.closest(".video-item");
      if (item2) {
        showMoveMenu2(item2.dataset.id, item2.dataset.listId, moveBtn);
      }
      return;
    }
    if (event.target.closest(".video-handle")) {
      return;
    }
    const item = event.target.closest(".video-item");
    if (!item) return;
    const videoId = item.dataset.id;
    if (!videoId) return;
    const playlistState2 = getPlaylistState();
    const listId = item.dataset.listId || playlistState2?.currentQueue?.id;
    hideMoveMenu();
    setStatus2("\u0417\u0430\u043F\u0443\u0441\u043A\u0430\u044E \u0432\u0438\u0434\u0435\u043E...", "info");
    sendMessage2("playlist:play", { videoId, listId }).then((state) => {
      if (state) onStateChange(state);
    }).catch((err) => {
      console.error(err);
      setStatus2("\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0437\u0430\u043F\u0443\u0441\u0442\u0438\u0442\u044C \u0432\u0438\u0434\u0435\u043E", "error", 3e3);
    });
  }
  function render(queueState, playlistState2) {
    dragController.reset();
    queueList2.textContent = "";
    const listId = queueState?.id || playlistState2?.currentQueue?.id || playlistState2?.currentListId || null;
    const listName = queueState?.name || playlistState2?.currentQueue?.name || "";
    const items = Array.isArray(queueState?.queue) ? queueState.queue : [];
    const lists = Array.isArray(playlistState2?.lists) ? playlistState2.lists : [];
    const listMeta = lists.find((item) => item.id === listId) || null;
    const isActiveList = Boolean(playlistState2?.currentListId) && Boolean(playlistState2?.currentVideoId) && Boolean(listId) && listId === playlistState2.currentListId;
    const currentId = isActiveList ? playlistState2?.currentVideoId || queueState?.queue?.[queueState?.currentIndex ?? -1]?.id || null : null;
    const isFrozenList = Boolean(
      listId && listId !== defaultListId && (queueState?.freeze || playlistState2?.currentQueue?.freeze || listMeta?.freeze)
    );
    if (queueFreezeIndicator2) {
      const hasList = Boolean(listName);
      if (hasList) {
        const icon = isFrozenList ? "\u{1F9CA}" : "\u{1F525}";
        const label = isFrozenList ? "\u0421\u043F\u0438\u0441\u043E\u043A \u043D\u0435\u0438\u0437\u043C\u0435\u043D\u044F\u0435\u043C\u044B\u0439: \u0432\u0438\u0434\u0435\u043E \u043D\u0435 \u0443\u0434\u0430\u043B\u044F\u044E\u0442\u0441\u044F \u0430\u0432\u0442\u043E\u043C\u0430\u0442\u0438\u0447\u0435\u0441\u043A\u0438" : "\u0421\u043F\u0438\u0441\u043E\u043A \u0430\u0432\u0442\u043E\u043C\u0430\u0442\u0438\u0447\u0435\u0441\u043A\u0438 \u043E\u0447\u0438\u0449\u0430\u0435\u0442\u0441\u044F: \u043F\u0440\u043E\u0441\u043C\u043E\u0442\u0440\u0435\u043D\u043D\u044B\u0435 \u0432\u0438\u0434\u0435\u043E \u0443\u0434\u0430\u043B\u044F\u044E\u0442\u0441\u044F";
        const state = isFrozenList ? "frozen" : "active";
        queueFreezeIndicator2.hidden = false;
        queueFreezeIndicator2.textContent = icon;
        queueFreezeIndicator2.setAttribute("data-state", state);
        queueFreezeIndicator2.setAttribute("title", label);
        queueFreezeIndicator2.setAttribute("aria-label", label);
      } else {
        queueFreezeIndicator2.hidden = true;
        queueFreezeIndicator2.textContent = "";
        queueFreezeIndicator2.removeAttribute("data-state");
        queueFreezeIndicator2.removeAttribute("title");
        queueFreezeIndicator2.removeAttribute("aria-label");
      }
    }
    if (!items.length) {
      if (queueEmpty2) {
        queueEmpty2.hidden = false;
      }
      return;
    }
    if (queueEmpty2) {
      queueEmpty2.hidden = true;
    }
    const allowPostpone = !isFrozenList && items.length > 1;
    items.forEach((entry, index) => {
      const dataset = { id: entry.id, index };
      if (listId) {
        dataset.listId = listId;
      }
      const detailParts = buildDetailParts(entry);
      const progressPercent = getProgressPercent(
        playlistState2?.videoProgress,
        entry.id
      );
      const removeDataset = { action: "remove", listId };
      const moveDataset = { action: "move", listId };
      const postponeDataset = { action: "postpone", listId };
      const quickFilterDataset = { action: "quickFilter", videoId: entry.id, listId };
      const actions = [
        {
          className: "icon-button video-quick-filter",
          textContent: "\u26A1",
          title: "\u0421\u043E\u0437\u0434\u0430\u0442\u044C \u0444\u0438\u043B\u044C\u0442\u0440 \u0434\u043B\u044F \u0432\u0438\u0434\u0435\u043E",
          dataset: quickFilterDataset
        },
        {
          className: "icon-button video-remove",
          textContent: "\u2715",
          title: "\u0423\u0434\u0430\u043B\u0438\u0442\u044C \u0438\u0437 \u043E\u0447\u0435\u0440\u0435\u0434\u0438",
          dataset: removeDataset
        },
        {
          className: "icon-button video-move",
          textContent: "\u21C4",
          title: "\u041F\u0435\u0440\u0435\u043D\u0435\u0441\u0442\u0438 \u0432 \u0434\u0440\u0443\u0433\u043E\u0439 \u0441\u043F\u0438\u0441\u043E\u043A",
          dataset: moveDataset
        }
      ];
      if (allowPostpone) {
        actions.splice(1, 0, {
          className: "icon-button video-postpone",
          textContent: "\u2935",
          title: "\u041E\u0442\u043B\u043E\u0436\u0438\u0442\u044C \u0432 \u043A\u043E\u043D\u0435\u0446 \u0441\u043F\u0438\u0441\u043A\u0430",
          dataset: postponeDataset
        });
      }
      const element = createVideoItem(entry, {
        tag: "li",
        classes: ["queue-item", allowPostpone ? "video-item--has-postpone" : null],
        dataset,
        handle: {
          draggable: true,
          title: "\u041F\u0435\u0440\u0435\u0442\u0430\u0449\u0438\u0442\u044C",
          ariaLabel: "\u041F\u0435\u0440\u0435\u0442\u0430\u0449\u0438\u0442\u044C"
        },
        thumbnail: { fallback: fallbackThumbnail2 },
        details: detailParts,
        actions,
        progress: progressPercent
      });
      if (currentId && entry.id === currentId) {
        element.classList.add("active");
      }
      queueList2.appendChild(element);
    });
  }
  queueList2.addEventListener("click", handleQueueClick);
  return {
    render
  };
}

// src/popup/modules/history/index.js
var MODE_CONFIG = {
  latest: {
    limit: 1,
    source: (state) => Array.isArray(state?.history) ? state.history : [],
    emptyText: "\u0418\u0441\u0442\u043E\u0440\u0438\u0438 \u043F\u043E\u043A\u0430 \u043D\u0435\u0442",
    restore: "history"
  },
  recent: {
    limit: 10,
    source: (state) => Array.isArray(state?.history) ? state.history : [],
    emptyText: "\u0418\u0441\u0442\u043E\u0440\u0438\u0438 \u043F\u043E\u043A\u0430 \u043D\u0435\u0442",
    restore: "history"
  },
  deleted: {
    limit: 10,
    source: (state) => Array.isArray(state?.deletedHistory) ? state.deletedHistory : [],
    emptyText: "\u0423\u0434\u0430\u043B\u0451\u043D\u043D\u044B\u0445 \u043F\u043E\u043A\u0430 \u043D\u0435\u0442",
    restore: "deleted"
  }
};
function createHistoryController({
  historyList: historyList2,
  historyEmpty: historyEmpty2,
  fallbackThumbnail: fallbackThumbnail2,
  getListName: getListName2 = () => "",
  setStatus: setStatus2 = () => {
  },
  hideMoveMenu = () => {
  },
  sendMessage: sendMessage2,
  onStateChange = () => {
  },
  modeButtons = []
}) {
  if (!historyList2 || typeof sendMessage2 !== "function") {
    return { render() {
    } };
  }
  const buttons = Array.isArray(modeButtons) ? modeButtons.filter(Boolean) : [];
  let currentMode = "latest";
  let lastState = null;
  if (historyList2) {
    historyList2.setAttribute("role", "tabpanel");
  }
  function updateButtonsState() {
    let activeId = null;
    buttons.forEach((button) => {
      const mode = button?.dataset?.historyMode;
      const isActive = mode === currentMode;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-selected", isActive ? "true" : "false");
      if (isActive) {
        button.setAttribute("tabindex", "0");
        if (button.id) {
          activeId = button.id;
        }
      } else {
        button.setAttribute("tabindex", "-1");
      }
    });
    if (historyList2 && activeId) {
      historyList2.setAttribute("aria-labelledby", activeId);
    }
  }
  function setMode(mode) {
    if (!mode || mode === currentMode) {
      return;
    }
    currentMode = mode;
    updateButtonsState();
    renderHistory(lastState);
  }
  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      const mode = button?.dataset?.historyMode;
      if (mode) {
        setMode(mode);
      }
    });
  });
  updateButtonsState();
  function renderHistory(state) {
    lastState = state;
    historyList2.textContent = "";
    const modeConfig = MODE_CONFIG[currentMode] || MODE_CONFIG.latest;
    const items = modeConfig.source(state);
    const limit = modeConfig.limit;
    let rendered = 0;
    if (!items.length) {
      if (historyEmpty2) {
        historyEmpty2.textContent = modeConfig.emptyText;
        historyEmpty2.hidden = false;
      }
      return;
    }
    if (historyEmpty2) {
      historyEmpty2.textContent = modeConfig.emptyText;
      historyEmpty2.hidden = true;
    }
    items.forEach((entry, index) => {
      if (typeof limit === "number" && rendered >= limit) {
        return;
      }
      const dataset = { id: entry.id, position: index };
      const detailParts = buildDetailParts(entry, {
        listIdKey: "listId",
        getListName: getListName2
      });
      const isDeletedMode = modeConfig.restore === "deleted";
      const restoreAction = isDeletedMode ? "restore-deleted" : "restore";
      const restoreTitle = isDeletedMode ? "\u0412\u043E\u0441\u0441\u0442\u0430\u043D\u043E\u0432\u0438\u0442\u044C \u0432 \u0441\u043F\u0438\u0441\u043E\u043A" : "\u0412\u0435\u0440\u043D\u0443\u0442\u044C \u0432 \u043E\u0447\u0435\u0440\u0435\u0434\u044C";
      const element = createVideoItem(entry, {
        tag: "li",
        classes: ["video-item--static"],
        dataset,
        thumbnail: { fallback: fallbackThumbnail2 },
        details: detailParts,
        actions: [
          {
            className: "icon-button history-restore",
            textContent: "\u21BA",
            title: restoreTitle,
            dataset: { action: restoreAction }
          }
        ]
      });
      historyList2.appendChild(element);
      rendered += 1;
    });
    if (rendered === 0 && historyEmpty2) {
      historyEmpty2.hidden = false;
    }
  }
  function handleHistoryClick(event) {
    const restoreBtn = event.target.closest("[data-action='restore']");
    const restoreDeletedBtn = event.target.closest(
      "[data-action='restore-deleted']"
    );
    if (!restoreBtn && !restoreDeletedBtn) return;
    event.stopPropagation();
    const li = event.target.closest(".video-item");
    if (!li) return;
    const position = Number(li.dataset.position || "0");
    if (restoreDeletedBtn) {
      setStatus2("\u0412\u043E\u0441\u0441\u0442\u0430\u043D\u0430\u0432\u043B\u0438\u0432\u0430\u044E \u0432\u0438\u0434\u0435\u043E...", "info");
      hideMoveMenu();
      sendMessage2("playlist:restoreDeleted", { position }).then((state) => {
        if (state) onStateChange(state);
      }).catch((err) => {
        console.error(err);
        setStatus2("\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0432\u043E\u0441\u0441\u0442\u0430\u043D\u043E\u0432\u0438\u0442\u044C \u0432\u0438\u0434\u0435\u043E", "error", 3e3);
      });
      return;
    }
    setStatus2("\u0412\u043E\u0437\u0432\u0440\u0430\u0449\u0430\u044E \u0432\u0438\u0434\u0435\u043E...", "info");
    hideMoveMenu();
    sendMessage2("playlist:playPrevious", { position, placement: "beforeCurrent" }).then((state) => {
      if (state) onStateChange(state);
    }).catch((err) => {
      console.error(err);
      setStatus2("\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0432\u0435\u0440\u043D\u0443\u0442\u044C \u0432\u0438\u0434\u0435\u043E", "error", 3e3);
    });
  }
  historyList2.addEventListener("click", handleHistoryClick);
  return {
    render: renderHistory
  };
}

// src/popup/modules/collection/constants.js
var MAX_STAGE_LOG_ITEMS = 60;
var COLLECTION_STAGE_DEFS = {
  intake: { title: "\u041F\u043E\u043B\u0443\u0447\u0435\u043D\u0438\u0435 \u043F\u043E\u0434\u043F\u0438\u0441\u043E\u043A" },
  playlists: { title: "\u041F\u043E\u0438\u0441\u043A \u043D\u043E\u0432\u044B\u0445 \u0432\u0438\u0434\u0435\u043E \u0432 \u043F\u043E\u0434\u043F\u0438\u0441\u043A\u0430\u0445" },
  videos: { title: "\u0424\u0438\u043B\u044C\u0442\u0440\u0430\u0446\u0438\u044F \u0432\u0438\u0434\u0435\u043E" },
  queue: { title: "\u0414\u043E\u0431\u0430\u0432\u043B\u0435\u043D\u0438\u0435 \u0432 \u043E\u0447\u0435\u0440\u0435\u0434\u044C" },
  error: { title: "\u041E\u0448\u0438\u0431\u043A\u0430" }
};
var PHASE_TO_STAGE = {
  start: "intake",
  channelsLoaded: "intake",
  playlistFetch: "playlists",
  playlistFetched: "playlists",
  aggregate: "playlists",
  filtering: "videos",
  filterProgress: "videos",
  filterStats: "videos",
  filtered: "videos",
  readyToAdd: "queue",
  adding: "queue",
  complete: "queue",
  error: "error"
};
function resolveStageId(event) {
  if (!event?.phase) {
    return null;
  }
  const mapped = PHASE_TO_STAGE[event.phase];
  if (mapped) {
    return mapped;
  }
  if (event.stageId && COLLECTION_STAGE_DEFS[event.stageId]) {
    return event.stageId;
  }
  return event.phase;
}
function getStageTitle(stageId) {
  return (COLLECTION_STAGE_DEFS[stageId] || { title: stageId }).title;
}

// src/popup/modules/collection/metrics.js
var EMPTY_FILTER_TOTALS = Object.freeze({
  filtered: 0,
  broadcasts: 0,
  shorts: 0,
  stoplists: 0,
  passed: 0
});
var numberFormatter = typeof Intl !== "undefined" ? new Intl.NumberFormat("ru-RU") : null;
function formatCount(value) {
  const numeric = Number.isFinite(Number(value)) ? Number(value) : 0;
  const count = Math.max(0, Math.round(numeric));
  return numberFormatter ? numberFormatter.format(count) : String(count);
}
function formatRatio(value, total) {
  const safeTotal = Number(total) || 0;
  const safeValue = Number(value) || 0;
  if (safeTotal > 0) {
    const clamped = Math.min(Math.max(0, safeValue), safeTotal);
    return `${formatCount(clamped)} / ${formatCount(safeTotal)}`;
  }
  return formatCount(safeValue);
}
function resolveFilterTotals(raw) {
  return {
    filtered: Number(raw?.filtered) || 0,
    broadcasts: Number(raw?.broadcasts) || 0,
    shorts: Number(raw?.shorts) || 0,
    stoplists: Number(raw?.stoplists) || 0,
    passed: Number(raw?.passed) || 0
  };
}

// src/popup/modules/collection/summary.js
var INITIAL_STATE = {
  startDate: null,
  channelCount: 0,
  playlistsTotal: 0,
  playlistsDone: 0,
  playlistCurrent: 0,
  playlistId: null,
  lastPlaylistVideoCount: 0,
  fetched: 0,
  filtered: 0,
  filterTotal: 0,
  filterProcessed: 0,
  filterTotals: EMPTY_FILTER_TOTALS,
  filterChannels: [],
  ready: 0,
  readyPotential: 0,
  skippedExisting: 0,
  adding: 0,
  queueBefore: 0,
  added: 0,
  completeTarget: 0,
  errorMessage: ""
};
function createInitialSummary() {
  return {
    ...INITIAL_STATE,
    filterTotals: resolveFilterTotals(EMPTY_FILTER_TOTALS),
    filterChannels: []
  };
}
function createCollectionSummary() {
  const data = createInitialSummary();
  function reset(startDate = null) {
    Object.assign(data, createInitialSummary());
    if (startDate) {
      data.startDate = startDate;
    }
  }
  function update(event = {}) {
    switch (event.phase) {
      case "start":
        if (event.startDate) data.startDate = event.startDate;
        data.channelCount = event.channelCount || 0;
        data.playlistsTotal = event.playlistCount || 0;
        break;
      case "channelsLoaded":
        data.channelCount = event.channelCount || 0;
        data.playlistsTotal = event.playlistCount || 0;
        break;
      case "playlistFetch":
        data.playlistsTotal = event.total || data.playlistsTotal;
        data.playlistCurrent = event.index || data.playlistCurrent;
        break;
      case "playlistFetched":
        data.playlistsTotal = event.total || data.playlistsTotal;
        data.playlistCurrent = event.index || data.playlistCurrent;
        data.playlistsDone = Math.max(
          data.playlistsDone,
          event.index || data.playlistsDone
        );
        data.playlistId = event.playlistId || data.playlistId;
        data.lastPlaylistVideoCount = event.videoCount || data.lastPlaylistVideoCount;
        break;
      case "aggregate":
        data.fetched = event.videoCount || 0;
        break;
      case "filtering":
        data.filtered = 0;
        data.filterTotal = event.videoCount || 0;
        data.filterProcessed = 0;
        data.filterTotals = resolveFilterTotals(EMPTY_FILTER_TOTALS);
        data.filterChannels = [];
        data.readyPotential = 0;
        data.skippedExisting = 0;
        break;
      case "filterProgress":
        if (typeof event.total === "number" && event.total >= 0) {
          data.filterTotal = event.total;
        }
        if (typeof event.processed === "number") {
          const total = data.filterTotal || event.total || event.processed;
          const current = Math.min(
            Math.max(0, event.processed),
            total || event.processed
          );
          data.filterProcessed = Math.max(data.filterProcessed, current);
        }
        break;
      case "filterStats": {
        if (typeof event.total === "number" && event.total >= 0) {
          data.filterTotal = event.total;
        }
        data.filterTotals = resolveFilterTotals(event.totals);
        data.filterChannels = Array.isArray(event.channels) ? event.channels.map((channel) => ({
          name: channel?.name || "",
          title: channel?.title || channel?.name || "",
          new: Number(channel?.new) || 0,
          filtered: Number(channel?.filtered) || 0,
          broadcasts: Number(channel?.broadcasts) || 0,
          shorts: Number(channel?.shorts) || 0,
          add: Number(channel?.add) || 0,
          stoplists: Number(channel?.stoplists) || 0
        })) : [];
        if (typeof event.videoCount === "number") {
          data.filtered = event.videoCount;
        }
        if (data.filterTotal) {
          data.filterProcessed = Math.max(
            data.filterProcessed,
            data.filterTotal
          );
        }
        if (typeof event.readyPotential === "number") {
          data.readyPotential = event.readyPotential;
        } else if (!data.readyPotential) {
          data.readyPotential = data.filterTotals.passed || data.filtered || 0;
        }
        break;
      }
      case "filtered":
        data.filtered = event.videoCount || data.filtered;
        if (data.filterTotal) {
          data.filterProcessed = Math.max(data.filterProcessed, data.filterTotal);
        }
        break;
      case "readyToAdd":
        data.ready = event.videoCount || 0;
        data.skippedExisting = Math.max(0, Number(event.skippedExisting) || 0);
        if (typeof event.sourceTotal === "number" && event.sourceTotal >= 0) {
          data.readyPotential = event.sourceTotal;
        } else if (!data.readyPotential) {
          data.readyPotential = data.filterTotals.passed || data.ready;
        }
        data.completeTarget = data.readyPotential || data.ready || data.completeTarget;
        break;
      case "adding":
        if (typeof event.addCount === "number") {
          data.adding = event.addCount;
        }
        if (typeof event.queueBefore === "number") {
          data.queueBefore = event.queueBefore;
        }
        if (!data.completeTarget) {
          data.completeTarget = data.adding || data.ready || data.readyPotential;
        }
        break;
      case "complete":
        if (typeof event.added === "number") {
          data.added = event.added;
          data.adding = 0;
        }
        if (typeof event.fetched === "number") {
          data.fetched = event.fetched;
          data.completeTarget = event.fetched;
        } else if (!data.completeTarget) {
          data.completeTarget = data.readyPotential || data.ready || data.added;
        }
        if (typeof event.skippedExisting === "number") {
          data.skippedExisting = Math.max(0, event.skippedExisting);
        }
        break;
      case "error":
        data.errorMessage = event.message || "";
        break;
      default:
        break;
    }
  }
  function getMetrics() {
    const metrics = [];
    const playlistTotal = data.playlistsTotal || 0;
    const playlistProgress = Math.max(data.playlistCurrent, data.playlistsDone);
    if (playlistTotal || playlistProgress) {
      const completed = playlistTotal ? Math.min(playlistProgress, playlistTotal) : playlistProgress;
      const total = playlistTotal || completed;
      metrics.push({
        id: "playlists",
        label: "\u041F\u043B\u0435\u0439\u043B\u0438\u0441\u0442\u044B",
        value: completed,
        total,
        text: formatRatio(completed, total)
      });
    }
    const totals = resolveFilterTotals(data.filterTotals);
    const filterTotal = data.filterTotal || data.readyPotential || data.completeTarget || data.fetched || 0;
    const processed = Math.max(
      Number(data.filterProcessed) || 0,
      Number(data.filtered) || 0,
      totals.passed || 0
    );
    if (filterTotal || processed) {
      const total = filterTotal || processed;
      const value = Math.min(processed, total || processed);
      const metric = {
        id: "filter",
        label: "\u0424\u0438\u043B\u044C\u0442\u0440\u0430\u0446\u0438\u044F",
        value,
        total,
        text: formatRatio(value, total)
      };
      if (total > 0 && value >= total && data.added) {
        metric.status = "complete";
      }
      metrics.push(metric);
    }
    return metrics;
  }
  return {
    data,
    reset,
    update,
    getMetrics
  };
}

// src/popup/modules/collection/formatters.js
function shortenId(value, length = 8) {
  if (!value) return "";
  const str = String(value);
  if (str.length <= length) return str;
  const half = Math.max(1, Math.floor((length - 1) / 2));
  return `${str.slice(0, half)}\u2026${str.slice(-half)}`;
}
function formatPlaylistLabel(event = {}) {
  const title = (event.channelTitle || event.playlistTitle || "").trim();
  if (title) {
    return title;
  }
  return shortenId(event.playlistId);
}
function formatFilterBreakdown(totals) {
  const safeTotals = resolveFilterTotals(totals);
  return [
    `\u0412 \u043E\u0447\u0435\u0440\u0435\u0434\u044C ${formatCount(safeTotals.passed)}`,
    `\u0424\u0438\u043B\u044C\u0442\u0440 ${formatCount(safeTotals.filtered)}`,
    `\u0422\u0440\u0430\u043D\u0441\u043B\u044F\u0446\u0438\u0438 ${formatCount(safeTotals.broadcasts)}`,
    `\u0428\u043E\u0440\u0442\u044B ${formatCount(safeTotals.shorts)}`,
    `\u0421\u0442\u043E\u043F-\u043B\u0438\u0441\u0442 ${formatCount(safeTotals.stoplists)}`
  ].join(" \xB7 ");
}
function formatStageMeta(stageId, summary, event = {}) {
  switch (stageId) {
    case "intake": {
      const channels = summary.channelCount || event.channelCount || 0;
      const playlists = summary.playlistsTotal || event.playlistCount || 0;
      if (channels || playlists) {
        if (channels && playlists) {
          return `\u041A\u0430\u043D\u0430\u043B\u044B ${formatCount(channels)}, \u043F\u043B\u0435\u0439\u043B\u0438\u0441\u0442\u044B ${formatCount(
            playlists
          )}`;
        }
        if (channels) {
          return `\u041A\u0430\u043D\u0430\u043B\u044B ${formatCount(channels)}`;
        }
        return `\u041F\u043B\u0435\u0439\u043B\u0438\u0441\u0442\u044B ${formatCount(playlists)}`;
      }
      if (event.startDate || summary.startDate) {
        const text = formatDateTime(event.startDate || summary.startDate);
        if (text) return `\u0421 ${text}`;
      }
      return "\u041F\u043E\u0434\u0433\u043E\u0442\u043E\u0432\u043A\u0430";
    }
    case "playlists": {
      const total = summary.playlistsTotal || event.total || 0;
      const current = Math.max(
        summary.playlistCurrent,
        summary.playlistsDone,
        event.index || 0
      );
      if (total) {
        return `\u041F\u043B\u0435\u0439\u043B\u0438\u0441\u0442 ${formatCount(Math.min(current, total))}/${formatCount(
          total
        )}`;
      }
      if (current) {
        return `\u041F\u043B\u0435\u0439\u043B\u0438\u0441\u0442 ${formatCount(current)}`;
      }
      return "\u0417\u0430\u0433\u0440\u0443\u0437\u043A\u0430 \u043F\u043B\u0435\u0439\u043B\u0438\u0441\u0442\u043E\u0432";
    }
    case "videos": {
      const totals = summary.filterTotals || EMPTY_FILTER_TOTALS;
      const total = summary.filterTotal || event.total || summary.readyPotential || summary.fetched || 0;
      const processed = Math.max(
        summary.filterProcessed || event.processed || 0,
        summary.filtered || event.videoCount || 0,
        totals.passed || 0
      );
      if (total) {
        return `\u0424\u0438\u043B\u044C\u0442\u0440\u0430\u0446\u0438\u044F ${formatCount(Math.min(processed, total))}/${formatCount(
          total
        )}`;
      }
      if (processed) {
        return `\u0424\u0438\u043B\u044C\u0442\u0440\u0430\u0446\u0438\u044F ${formatCount(processed)}`;
      }
      if (summary.fetched || event.videoCount) {
        return `\u041D\u0430\u0439\u0434\u0435\u043D\u043E ${formatCount(summary.fetched || event.videoCount || 0)} \u0432\u0438\u0434\u0435\u043E`;
      }
      return "\u0424\u0438\u043B\u044C\u0442\u0440\u0430\u0446\u0438\u044F";
    }
    case "queue": {
      const added = summary.added || event.added || 0;
      const ready = summary.ready || event.videoCount || 0;
      if (added) {
        const total = summary.completeTarget || summary.readyPotential || summary.fetched || event.fetched || added;
        return `\u0414\u043E\u0431\u0430\u0432\u043B\u0435\u043D\u043E ${formatCount(added)}${total ? ` \u0438\u0437 ${formatCount(total)}` : ""}`;
      }
      if (event.phase === "complete" && !added) {
        const total = summary.completeTarget || summary.readyPotential || summary.fetched || event.fetched || 0;
        if (total) {
          return `\u0414\u043E\u0431\u0430\u0432\u043B\u0435\u043D\u043E 0 \u0438\u0437 ${formatCount(total)}`;
        }
        return "\u041D\u043E\u0432\u044B\u0445 \u0432\u0438\u0434\u0435\u043E \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u043E";
      }
      if (ready) {
        const skipped = summary.skippedExisting || event.skippedExisting || 0;
        if (skipped) {
          return `\u0413\u043E\u0442\u043E\u0432\u043E ${formatCount(ready)} (\u0443\u0436\u0435 \u0432 \u043E\u0447\u0435\u0440\u0435\u0434\u0438 ${formatCount(
            skipped
          )})`;
        }
        return `\u0413\u043E\u0442\u043E\u0432\u043E ${formatCount(ready)}`;
      }
      if (summary.adding || typeof event.addCount === "number") {
        const count = summary.adding || event.addCount || 0;
        const before = summary.queueBefore || event.queueBefore || 0;
        if (before) {
          return `\u0414\u043E\u0431\u0430\u0432\u043B\u044F\u0435\u043C ${formatCount(count)} (\u0431\u044B\u043B\u043E ${formatCount(before)})`;
        }
        return `\u0414\u043E\u0431\u0430\u0432\u043B\u044F\u0435\u043C ${formatCount(count)}`;
      }
      if (summary.queueBefore) {
        return `\u041E\u0447\u0435\u0440\u0435\u0434\u044C \u0431\u044B\u043B\u0430 ${formatCount(summary.queueBefore)}`;
      }
      return "\u0414\u043E\u0431\u0430\u0432\u043B\u0435\u043D\u0438\u0435 \u0432 \u043E\u0447\u0435\u0440\u0435\u0434\u044C";
    }
    case "error":
      return summary.errorMessage || event.message || "\u041E\u0448\u0438\u0431\u043A\u0430";
    default:
      return "";
  }
}
function formatStageLog(event = {}, summary) {
  switch (event.phase) {
    case "start":
      return event.startDate ? `\u0421\u0442\u0430\u0440\u0442 \u0441 ${formatDateTime(event.startDate)}` : "\u0417\u0430\u043F\u0443\u0441\u043A \u043F\u0440\u043E\u0446\u0435\u0441\u0441\u0430";
    case "channelsLoaded":
      return `\u041F\u043E\u043B\u0443\u0447\u0435\u043D\u043E ${event.channelCount || 0} \u043A\u0430\u043D\u0430\u043B\u043E\u0432 \u0438 ${event.playlistCount || 0} \u043F\u043B\u0435\u0439\u043B\u0438\u0441\u0442\u043E\u0432`;
    case "playlistFetch":
      return null;
    case "playlistFetched": {
      const index = Number(event.index);
      const total = Number(event.total);
      const parts = [];
      if (Number.isFinite(total) && total > 0) {
        const boundedIndex = Math.max(0, Math.min(Number.isFinite(index) ? index : 0, total));
        parts.push(`${formatCount(boundedIndex)}/${formatCount(total)}`);
      } else if (Number.isFinite(index) && index > 0) {
        parts.push(formatCount(index));
      }
      parts.push(`${formatCount(event.videoCount || 0)} \u0432\u0438\u0434\u0435\u043E`);
      const label = formatPlaylistLabel(event);
      if (label) {
        parts.push(label);
      }
      return parts.join(" \u2013 ");
    }
    case "aggregate":
      return `\u0421\u043E\u0431\u0440\u0430\u043D\u043E ${event.videoCount || 0} \u0443\u043D\u0438\u043A\u0430\u043B\u044C\u043D\u044B\u0445 \u0432\u0438\u0434\u0435\u043E`;
    case "filtering":
      return `\u0424\u0438\u043B\u044C\u0442\u0440\u0430\u0446\u0438\u044F (${formatCount(event.videoCount || 0)})`;
    case "filterProgress":
      if (event.total) {
        return `\u0424\u0438\u043B\u044C\u0442\u0440\u0430\u0446\u0438\u044F ${formatCount(event.processed || 0)}/${formatCount(
          event.total
        )}`;
      }
      return `\u0424\u0438\u043B\u044C\u0442\u0440\u0430\u0446\u0438\u044F ${formatCount(event.processed || 0)}`;
    case "filterStats":
      return formatFilterBreakdown(event.totals || summary?.filterTotals);
    case "filtered":
      return null;
    case "readyToAdd":
      return event.skippedExisting ? `\u041A \u0434\u043E\u0431\u0430\u0432\u043B\u0435\u043D\u0438\u044E ${formatCount(event.videoCount || 0)} \u0432\u0438\u0434\u0435\u043E (\u0443\u0436\u0435 \u0432 \u043E\u0447\u0435\u0440\u0435\u0434\u0438 ${formatCount(event.skippedExisting || 0)})` : `\u041A \u0434\u043E\u0431\u0430\u0432\u043B\u0435\u043D\u0438\u044E ${formatCount(event.videoCount || 0)} \u0432\u0438\u0434\u0435\u043E`;
    case "adding":
      return `\u0414\u043E\u0431\u0430\u0432\u043B\u044F\u0435\u043C ${formatCount(event.addCount || 0)} \u0432\u0438\u0434\u0435\u043E (\u043E\u0447\u0435\u0440\u0435\u0434\u044C \u0431\u044B\u043B\u0430 ${formatCount(
        event.queueBefore || 0
      )})`;
    case "complete":
      return event.added ? `\u0412 \u043E\u0447\u0435\u0440\u0435\u0434\u044C \u0434\u043E\u0431\u0430\u0432\u043B\u0435\u043D\u043E ${formatCount(event.added)} \u0438\u0437 ${formatCount(
        event.fetched || event.added
      )}` : "\u041D\u043E\u0432\u044B\u0445 \u0432\u0438\u0434\u0435\u043E \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u043E";
    case "error":
      return event.message || "\u041F\u0440\u043E\u0438\u0437\u043E\u0448\u043B\u0430 \u043E\u0448\u0438\u0431\u043A\u0430";
    default:
      return null;
  }
}
function getStatusInfo(event = {}, summary) {
  if (!event.phase) return null;
  switch (event.phase) {
    case "start":
      return { text: "\u0421\u0431\u043E\u0440 \u043F\u043E\u0434\u043F\u0438\u0441\u043E\u043A...", kind: "info", timeout: 0 };
    case "channelsLoaded":
      return {
        text: `\u041A\u0430\u043D\u0430\u043B\u043E\u0432: ${event.channelCount || 0}, \u043F\u043B\u0435\u0439\u043B\u0438\u0441\u0442\u043E\u0432: ${event.playlistCount || 0}`,
        kind: "info",
        timeout: 0
      };
    case "playlistFetch":
      return {
        text: `\u0417\u0430\u0433\u0440\u0443\u0437\u043A\u0430 \u043F\u043B\u0435\u0439\u043B\u0438\u0441\u0442\u043E\u0432 ${event.index || 0}/${event.total || 0}`,
        kind: "info",
        timeout: 0
      };
    case "playlistFetched":
      return {
        text: `\u041F\u043B\u0435\u0439\u043B\u0438\u0441\u0442 ${event.index || 0}/${event.total || 0}: +${event.videoCount || 0}`,
        kind: "info",
        timeout: 0
      };
    case "aggregate":
      return {
        text: `\u041D\u0430\u0439\u0434\u0435\u043D\u043E ${event.videoCount || 0} \u0432\u0438\u0434\u0435\u043E`,
        kind: "info",
        timeout: 0
      };
    case "filtering":
      return {
        text: `\u0424\u0438\u043B\u044C\u0442\u0440\u0430\u0446\u0438\u044F ${event.videoCount || 0} \u0432\u0438\u0434\u0435\u043E`,
        kind: "info",
        timeout: 0
      };
    case "filterProgress": {
      const processed = Number(event.processed) || 0;
      const total = Number(event.total) || processed;
      return {
        text: `\u0424\u0438\u043B\u044C\u0442\u0440\u0430\u0446\u0438\u044F ${processed}/${total}`,
        kind: "info",
        timeout: 0
      };
    }
    case "filterStats": {
      const breakdown = formatFilterBreakdown(
        event.totals || summary?.filterTotals
      );
      if (breakdown) {
        return {
          text: breakdown,
          kind: "info",
          timeout: 0
        };
      }
      const totals = event.totals || {};
      const total = Number(event.total) || Number(event.initialCount) || 0;
      const passed = totals.passed || event.videoCount || 0;
      const base = total ? `\u041F\u043E\u0441\u043B\u0435 \u0444\u0438\u043B\u044C\u0442\u0440\u0430 ${passed}/${total}` : `\u041F\u043E\u0441\u043B\u0435 \u0444\u0438\u043B\u044C\u0442\u0440\u0430 ${passed}`;
      return {
        text: base,
        kind: "info",
        timeout: 0
      };
    }
    case "filtered": {
      const breakdown = formatFilterBreakdown(
        summary?.filterTotals || event.totals
      );
      if (breakdown) {
        return {
          text: breakdown,
          kind: "info",
          timeout: 0
        };
      }
      return {
        text: `\u041F\u043E\u0441\u043B\u0435 \u0444\u0438\u043B\u044C\u0442\u0440\u0430 ${event.videoCount || 0}`,
        kind: "info",
        timeout: 0
      };
    }
    case "readyToAdd":
      return {
        text: event.skippedExisting && event.skippedExisting > 0 ? `\u041A \u0434\u043E\u0431\u0430\u0432\u043B\u0435\u043D\u0438\u044E ${event.videoCount || 0} \u0432\u0438\u0434\u0435\u043E (\u0443\u0436\u0435 \u0432 \u043E\u0447\u0435\u0440\u0435\u0434\u0438 ${event.skippedExisting})` : `\u041A \u0434\u043E\u0431\u0430\u0432\u043B\u0435\u043D\u0438\u044E ${event.videoCount || 0} \u0432\u0438\u0434\u0435\u043E`,
        kind: "info",
        timeout: 0
      };
    case "adding":
      return {
        text: `\u0414\u043E\u0431\u0430\u0432\u043B\u044F\u0435\u043C ${event.addCount || 0} \u0432\u0438\u0434\u0435\u043E`,
        kind: "info",
        timeout: 0
      };
    case "complete":
      return summary?.added ? {
        text: `\u0414\u043E\u0431\u0430\u0432\u043B\u0435\u043D\u043E ${summary.added} \u0438\u0437 ${summary.fetched || summary.added}`,
        kind: "success",
        timeout: 5e3
      } : {
        text: "\u041D\u043E\u0432\u044B\u0445 \u0432\u0438\u0434\u0435\u043E \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u043E",
        kind: "info",
        timeout: 5e3
      };
    case "error":
      return {
        text: event.message || "\u041E\u0448\u0438\u0431\u043A\u0430 \u043F\u0440\u0438 \u0441\u0431\u043E\u0440\u0435 \u043F\u043E\u0434\u043F\u0438\u0441\u043E\u043A",
        kind: "error",
        timeout: 6e3
      };
    default:
      return null;
  }
}
function getStageDefinition(stageId) {
  return COLLECTION_STAGE_DEFS[stageId] || { title: stageId };
}

// src/popup/modules/collection/stageLog.js
function createStageLogManager({ logEl, collapsed = true } = {}) {
  if (!logEl) {
    return {
      clear() {
      },
      applyUpdate() {
        return null;
      },
      markCompleted() {
      },
      openStage() {
      }
    };
  }
  const isCollapsed = Boolean(collapsed);
  const stages = /* @__PURE__ */ new Map();
  function clear() {
    stages.forEach((entry) => entry.container?.remove());
    stages.clear();
    logEl.textContent = "";
  }
  function ensure(stageId) {
    let entry = stages.get(stageId);
    if (entry) {
      logEl.prepend(entry.container);
      return entry;
    }
    const doc = logEl.ownerDocument;
    const container = doc.createElement("li");
    container.className = "collection-stage";
    const details = doc.createElement("details");
    details.open = !isCollapsed;
    const summaryNode = doc.createElement("summary");
    summaryNode.className = "collection-stage__summary";
    const summaryRow = doc.createElement("div");
    summaryRow.className = "collection-stage__summary-row";
    const title = doc.createElement("span");
    title.className = "collection-stage__title";
    title.textContent = getStageDefinition(stageId).title;
    const meta = doc.createElement("span");
    meta.className = "collection-stage__meta";
    meta.hidden = true;
    summaryRow.append(title, meta);
    const statusLine = doc.createElement("div");
    statusLine.className = "collection-stage__status";
    statusLine.hidden = true;
    summaryNode.append(summaryRow, statusLine);
    const body = doc.createElement("div");
    body.className = "collection-stage__body";
    details.append(summaryNode, body);
    container.append(details);
    logEl.prepend(container);
    entry = {
      id: stageId,
      container,
      details,
      summaryTitle: title,
      summaryMeta: meta,
      summaryStatus: statusLine,
      body,
      logs: [],
      lastLogText: ""
    };
    stages.set(stageId, entry);
    return entry;
  }
  function updateSummaryStatus(entry) {
    if (!entry?.summaryStatus) return;
    if (entry.lastLogText) {
      entry.summaryStatus.textContent = entry.lastLogText;
      entry.summaryStatus.hidden = false;
    } else {
      entry.summaryStatus.textContent = "";
      entry.summaryStatus.hidden = true;
    }
  }
  function addStageLog(entry, text) {
    if (!entry?.body || !text) return;
    if (entry.lastLogText === text) {
      return;
    }
    const item = entry.body.ownerDocument.createElement("div");
    item.className = "collection-stage__log";
    const timestamped = `[${formatClockTime()}] ${text}`;
    item.textContent = timestamped;
    entry.body.prepend(item);
    entry.logs.unshift(item);
    entry.lastLogText = text;
    updateSummaryStatus(entry);
    while (entry.logs.length > MAX_STAGE_LOG_ITEMS) {
      const tail = entry.logs.pop();
      tail?.remove();
    }
  }
  function addFilterTable(entry, channels) {
    if (!entry?.body || !channels?.length) return;
    const doc = entry.body.ownerDocument;
    const item = doc.createElement("div");
    item.className = "collection-stage__log collection-stage__log--table";
    const timestamp = doc.createElement("div");
    timestamp.className = "collection-stage__log-time";
    timestamp.textContent = `[${formatClockTime()}]`;
    const scroll = doc.createElement("div");
    scroll.className = "collection-stage__table-wrap";
    const table = doc.createElement("table");
    table.className = "collection-stage__table";
    const head = doc.createElement("thead");
    const headRow = doc.createElement("tr");
    const headers = [
      "\u041A\u0430\u043D\u0430\u043B",
      "\u041D\u043E\u0432\u044B\u0435",
      "\u0424\u0438\u043B\u044C\u0442\u0440",
      "\u0422\u0440\u0430\u043D\u0441\u043B\u044F\u0446\u0438\u0438",
      "\u0428\u043E\u0440\u0442\u044B",
      "\u0412 \u043E\u0447\u0435\u0440\u0435\u0434\u044C",
      "\u0421\u0442\u043E\u043F-\u043B\u0438\u0441\u0442"
    ];
    headers.forEach((label) => {
      const cell = doc.createElement("th");
      cell.textContent = label;
      headRow.append(cell);
    });
    head.append(headRow);
    const body = doc.createElement("tbody");
    channels.forEach((channel) => {
      const row = doc.createElement("tr");
      const cells = [
        channel?.title || channel?.name || "",
        channel?.new ?? "",
        channel?.filtered ?? "",
        channel?.broadcasts ?? "",
        channel?.shorts ?? "",
        channel?.add ?? "",
        channel?.stoplists ?? ""
      ];
      cells.forEach((value, index) => {
        const cell = doc.createElement("td");
        cell.textContent = `${value ?? ""}`;
        if (index === 0) {
          cell.classList.add("is-name");
        }
        row.append(cell);
      });
      body.append(row);
    });
    table.append(head, body);
    scroll.append(table);
    item.append(timestamp, scroll);
    entry.body.prepend(item);
    entry.logs.unshift(item);
    while (entry.logs.length > MAX_STAGE_LOG_ITEMS) {
      const tail = entry.logs.pop();
      tail?.remove();
    }
  }
  function applyUpdate(stageId, event, summary) {
    const entry = ensure(stageId);
    if (!entry) return null;
    if (entry.summaryTitle && event?.titleOverride) {
      entry.summaryTitle.textContent = event.titleOverride;
    }
    if (entry.summaryMeta) {
      const metaText = formatStageMeta(stageId, summary, event);
      entry.summaryMeta.textContent = metaText || "";
      entry.summaryMeta.hidden = !metaText;
    }
    const logText = formatStageLog(event, summary);
    if (logText) {
      addStageLog(entry, logText);
    }
    if (event?.phase === "filterStats" && Array.isArray(event.channels)) {
      addFilterTable(entry, event.channels);
    } else if (Array.isArray(event?.logEntries) && event.logEntries.length) {
      for (let i = event.logEntries.length - 1; i >= 0; i -= 1) {
        const text = event.logEntries[i];
        if (typeof text === "string" && text.trim()) {
          addStageLog(entry, text);
        }
      }
    }
    updateSummaryStatus(entry);
    return entry;
  }
  function markCompleted(stageId, isError = false) {
    const entry = stages.get(stageId);
    if (!entry || !entry.container) return;
    entry.container.classList.add(isError ? "error" : "completed");
    if (entry.details) {
      entry.details.open = false;
    }
  }
  function openStage(stageId) {
    stages.forEach((entry, id) => {
      if (!entry.details) return;
      if (id === stageId) {
        entry.details.open = true;
      } else if (isCollapsed || entry.container.classList.contains("completed")) {
        entry.details.open = false;
      }
    });
  }
  return {
    clear,
    applyUpdate,
    markCompleted,
    openStage
  };
}

// src/popup/modules/collection/index.js
function createCollectionController({
  progressEl,
  stageTextEl,
  countersEl,
  logEl,
  titleEl,
  setStatus: setStatus2 = () => {
  }
} = {}) {
  const summary = createCollectionSummary();
  const stageLog = createStageLogManager({ logEl, collapsed: true });
  const headerTitleEl = titleEl || progressEl?.querySelector?.(".collection-info h4") || null;
  const baseTitle = (headerTitleEl?.textContent || "").trim() || "\u0421\u0431\u043E\u0440 \u043F\u043E\u0434\u043F\u0438\u0441\u043E\u043A";
  const state = {
    active: false,
    currentStage: null,
    hasHistory: false
  };
  function renderCounters() {
    if (!countersEl) {
      return;
    }
    const metrics = summary.getMetrics();
    const doc = countersEl.ownerDocument || document;
    countersEl.textContent = "";
    countersEl.classList.add("collection-metrics");
    if (!metrics.length) {
      return;
    }
    for (const metric of metrics) {
      const item = doc.createElement("div");
      item.className = "collection-metric";
      if (metric?.id) {
        item.dataset.metricId = metric.id;
      }
      if (metric?.status === "complete") {
        item.classList.add("is-complete");
      }
      const header = doc.createElement("div");
      header.className = "collection-metric__header";
      const label = doc.createElement("span");
      label.className = "collection-metric__label";
      label.textContent = metric?.label || "";
      const value = doc.createElement("span");
      value.className = "collection-metric__value";
      value.textContent = metric?.text || "";
      header.append(label, value);
      item.append(header);
      const bar = doc.createElement("div");
      bar.className = "collection-metric__bar";
      const fill = doc.createElement("div");
      fill.className = "collection-metric__fill";
      const total = Number(metric?.total);
      const current = Number(metric?.value);
      let ratio = 0;
      if (Number.isFinite(total) && total > 0) {
        const safeValue = Number.isFinite(current) ? current : 0;
        ratio = Math.max(0, Math.min(1, safeValue / total));
      } else if (Number.isFinite(current) && current > 0) {
        ratio = 1;
      }
      const width = `${(ratio * 100).toFixed(1)}%`;
      fill.style.width = width;
      if (ratio > 0 && ratio < 0.04) {
        fill.style.minWidth = "3%";
      }
      bar.append(fill);
      item.append(bar);
      if (metric?.caption) {
        const caption = doc.createElement("div");
        caption.className = "collection-metric__caption";
        caption.textContent = metric.caption;
        item.append(caption);
      }
      if (Array.isArray(metric?.details) && metric.details.length) {
        const details = doc.createElement("div");
        details.className = "collection-metric__details";
        for (const detail of metric.details) {
          if (!detail?.label) continue;
          const detailItem = doc.createElement("span");
          detailItem.className = "collection-metric__detail";
          const detailLabel = doc.createElement("span");
          detailLabel.className = "collection-metric__detail-label";
          detailLabel.textContent = detail.label;
          const detailValue = doc.createElement("span");
          detailValue.className = "collection-metric__detail-value";
          detailValue.textContent = detail?.text || String(detail?.value ?? "");
          detailItem.append(detailLabel, detailValue);
          details.append(detailItem);
        }
        if (details.childNodes.length) {
          item.append(details);
        }
      }
      countersEl.append(item);
    }
  }
  function resetView(startDate) {
    state.currentStage = null;
    summary.reset(startDate);
    stageLog.clear();
    if (progressEl) {
      progressEl.classList.remove("finished", "error");
    }
    if (stageTextEl) {
      stageTextEl.textContent = "";
      stageTextEl.hidden = true;
    }
    if (headerTitleEl) {
      headerTitleEl.textContent = baseTitle;
    }
    renderCounters();
  }
  function hidePanel({ clear = false } = {}) {
    if (!progressEl) return;
    if (clear) {
      resetView();
      state.hasHistory = false;
    }
    progressEl.hidden = true;
    progressEl.classList.add("is-hidden");
  }
  function showPanel() {
    if (!progressEl) return;
    progressEl.hidden = false;
    progressEl.classList.remove("is-hidden");
  }
  function updateHeader(stageId) {
    const stageTitle = getStageTitle(stageId);
    if (headerTitleEl) {
      headerTitleEl.textContent = stageTitle ? `${baseTitle} \u2013 ${stageTitle}` : baseTitle;
    }
    if (stageTextEl) {
      stageTextEl.textContent = "";
      stageTextEl.hidden = true;
    }
    renderCounters();
  }
  function beginProgress(event) {
    state.active = true;
    state.hasHistory = true;
    resetView(event?.startDate);
    showPanel();
  }
  function ensureVisible() {
    if (!progressEl) return;
    if (!progressEl.hidden) return;
    if (!state.hasHistory && !state.active) return;
    showPanel();
  }
  function handleEvent(event) {
    if (!event?.phase) return null;
    const stageId = resolveStageId(event);
    if (!stageId) return null;
    if (event.phase === "start") {
      beginProgress(event);
    } else {
      state.hasHistory = true;
      ensureVisible();
      if (progressEl) {
        progressEl.classList.remove("finished", "error");
      }
    }
    summary.update(event);
    if (state.currentStage && state.currentStage !== stageId) {
      stageLog.markCompleted(state.currentStage);
    }
    const entry = stageLog.applyUpdate(stageId, event, summary.data);
    state.currentStage = stageId;
    if (event.phase === "complete") {
      stageLog.markCompleted(stageId);
      if (progressEl) {
        progressEl.classList.add("finished");
      }
      state.active = false;
    } else if (event.phase === "error") {
      stageLog.markCompleted(stageId, true);
      if (progressEl) {
        progressEl.classList.add("error");
      }
      state.active = false;
    } else if (entry) {
      stageLog.openStage(stageId);
    }
    updateHeader(stageId);
    const statusInfo = getStatusInfo(event, summary.data);
    if (statusInfo) {
      setStatus2(statusInfo.text, statusInfo.kind, statusInfo.timeout);
    }
    return event.phase;
  }
  hidePanel({ clear: true });
  return {
    handleEvent,
    hidePanel,
    showPanel,
    showIfHasHistory: () => {
      if (state.hasHistory || state.active) {
        showPanel();
      }
    },
    clear: () => hidePanel({ clear: true }),
    isActive: () => state.active,
    hasHistory: () => state.hasHistory
  };
}

// src/addResultMessages.js
function normalizeAddResponse(response) {
  if (!response || typeof response !== "object") {
    return { state: null, requested: null, missing: 0, added: 0 };
  }
  const state = response.state && typeof response.state === "object" ? response.state : response;
  const requested = Number.isInteger(response.requested) && response.requested >= 0 ? response.requested : null;
  const missing = Number.isInteger(response.missing) && response.missing > 0 ? response.missing : 0;
  const added = Number.isInteger(response.added) && response.added >= 0 ? response.added : 0;
  return { state, requested, missing, added };
}
function formatAddResultMessage({
  added = 0,
  requested = null,
  missing = 0,
  scopeLabel = "",
  alreadyMessage = ""
} = {}) {
  const addedCount = Number.isInteger(added) && added > 0 ? added : 0;
  const totalRequested = Number.isInteger(requested) && requested >= 0 ? requested : null;
  const missingCount = Number.isInteger(missing) && missing > 0 ? missing : 0;
  const duplicates = totalRequested !== null ? Math.max(0, totalRequested - missingCount - addedCount) : null;
  const fragments = [];
  if (addedCount > 0) {
    let message = `\u0414\u043E\u0431\u0430\u0432\u043B\u0435\u043D\u043E ${addedCount} \u0432\u0438\u0434\u0435\u043E`;
    if (duplicates && duplicates > 0) {
      message += ` (\u0435\u0449\u0451 ${duplicates} \u0432\u0438\u0434\u0435\u043E \u0443\u0436\u0435 \u0431\u044B\u043B\u0438)`;
    } else if (totalRequested !== null && totalRequested !== addedCount) {
      message += ` \u0438\u0437 ${totalRequested}`;
    }
    fragments.push(message);
  } else if (duplicates && duplicates > 0) {
    if (alreadyMessage) {
      fragments.push(alreadyMessage);
    } else if (scopeLabel) {
      fragments.push(`\u0412\u0441\u0435 ${scopeLabel} \u0443\u0436\u0435 \u0432 \u0441\u043F\u0438\u0441\u043A\u0435`);
    } else if (totalRequested !== null && totalRequested > 0) {
      fragments.push(`\u0412\u0441\u0435 ${totalRequested} \u0432\u0438\u0434\u0435\u043E \u0443\u0436\u0435 \u0432 \u0441\u043F\u0438\u0441\u043A\u0435`);
    } else {
      fragments.push("\u0412\u0441\u0435 \u0432\u0438\u0434\u0435\u043E \u0443\u0436\u0435 \u0432 \u0441\u043F\u0438\u0441\u043A\u0435");
    }
  } else if (totalRequested === 0) {
    fragments.push("\u0412\u0438\u0434\u0435\u043E \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u044B");
  } else if (scopeLabel) {
    fragments.push(`\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0434\u043E\u0431\u0430\u0432\u0438\u0442\u044C ${scopeLabel}`);
  } else {
    fragments.push("\u0412\u0438\u0434\u0435\u043E \u043D\u0435 \u0434\u043E\u0431\u0430\u0432\u043B\u0435\u043D\u044B");
  }
  if (missingCount > 0) {
    fragments.push(`\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043F\u043E\u043B\u0443\u0447\u0438\u0442\u044C \u0434\u0430\u043D\u043D\u044B\u0435 \u0434\u043B\u044F ${missingCount} \u0432\u0438\u0434\u0435\u043E`);
  }
  return {
    message: fragments.join(". "),
    kind: addedCount > 0 ? "success" : missingCount > 0 ? "error" : "info"
  };
}

// src/popup/modules/shared/addActions.js
function createAddActionsController({
  addCurrentBtn: addCurrentBtn2,
  addVisibleBtn: addVisibleBtn2,
  addAllBtn: addAllBtn2,
  addRow: addRow2,
  defaultListId,
  getSelectedListId: getSelectedListId2,
  renderState: renderState2,
  setLoading: setLoading2,
  setStatus: setStatus2,
  sendMessage: sendMessage2,
  updatePlaybackControls
}) {
  let capabilitiesState = {
    canAddCurrent: false,
    canAddVisible: false,
    canAddAll: false,
    context: "unknown",
    controlling: false
  };
  async function addFromScope(scope) {
    const button = scope === "current" ? addCurrentBtn2 : scope === "visible" ? addVisibleBtn2 : addAllBtn2;
    if (!button || button.classList.contains("hidden")) return;
    if (scope === "current" && !capabilitiesState.canAddCurrent || scope === "visible" && !capabilitiesState.canAddVisible || scope === "page" && !capabilitiesState.canAddAll) {
      return;
    }
    setLoading2(button, true);
    setStatus2("\u0418\u0449\u0443 \u0432\u0438\u0434\u0435\u043E...", "info");
    try {
      const collect = await sendMessage2("collector:collect", { scope });
      if (collect?.error) {
        if (collect.error === "NOT_ALLOWED") {
          setStatus2("\u042D\u0442\u0430 \u043A\u043D\u043E\u043F\u043A\u0430 \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u043D\u0430 \u043D\u0430 \u0442\u0435\u043A\u0443\u0449\u0435\u0439 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0435", "info", 3500);
        } else {
          setStatus2("\u041D\u0435 \u043F\u043E\u043B\u0443\u0447\u0438\u043B\u043E\u0441\u044C \u0441\u043E\u0431\u0440\u0430\u0442\u044C \u0441\u043F\u0438\u0441\u043E\u043A", "error", 4e3);
        }
        return;
      }
      const ids = Array.isArray(collect?.videoIds) ? collect.videoIds : [];
      if (collect?.aborted) {
        setStatus2(
          ids.length ? `\u0421\u0431\u043E\u0440 \u043E\u0441\u0442\u0430\u043D\u043E\u0432\u043B\u0435\u043D \u043D\u0430 ${ids.length}` : "\u0421\u0431\u043E\u0440 \u043E\u0441\u0442\u0430\u043D\u043E\u0432\u043B\u0435\u043D",
          "info",
          3600
        );
        return;
      }
      if (!ids.length) {
        setStatus2("\u0412\u0438\u0434\u0435\u043E \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u044B", "info");
        return;
      }
      const uniqueRequested = Array.from(new Set(ids)).length;
      const response = await sendMessage2("playlist:addByIds", {
        videoIds: ids,
        listId: getSelectedListId2() || defaultListId
      });
      const { state, requested, missing, added } = normalizeAddResponse(response);
      if (!state) {
        setStatus2("\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043E\u0431\u043D\u043E\u0432\u0438\u0442\u044C \u043E\u0447\u0435\u0440\u0435\u0434\u044C", "error", 4e3);
        return;
      }
      renderState2(state);
      const totalRequested = requested ?? uniqueRequested;
      const summary = formatAddResultMessage({
        added,
        requested: totalRequested,
        missing,
        scopeLabel: scope === "visible" ? "\u0432\u0438\u0434\u0438\u043C\u044B\u0435 \u0432\u0438\u0434\u0435\u043E" : scope === "page" ? "\u0432\u0438\u0434\u0435\u043E \u043D\u0430 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0435" : "",
        alreadyMessage: scope === "current" ? "\u0412\u0438\u0434\u0435\u043E \u0443\u0436\u0435 \u0432 \u043E\u0447\u0435\u0440\u0435\u0434\u0438" : ""
      });
      setStatus2(summary.message, summary.kind);
    } catch (err) {
      setStatus2("\u041E\u0448\u0438\u0431\u043A\u0430 \u0434\u043E\u0431\u0430\u0432\u043B\u0435\u043D\u0438\u044F \u0432\u0438\u0434\u0435\u043E", "error", 4e3);
      console.error(err);
    } finally {
      setLoading2(button, false);
    }
  }
  function applyControlCapabilities(caps) {
    capabilitiesState = {
      canAddCurrent: Boolean(caps?.canAddCurrent),
      canAddVisible: Boolean(caps?.canAddVisible),
      canAddAll: Boolean(caps?.canAddAll),
      context: caps?.context || "unknown",
      controlling: Boolean(caps?.controlling)
    };
    if (addCurrentBtn2) {
      addCurrentBtn2.classList.toggle("hidden", !capabilitiesState.canAddCurrent);
    }
    if (addVisibleBtn2) {
      addVisibleBtn2.classList.toggle("hidden", !capabilitiesState.canAddVisible);
    }
    if (addAllBtn2) {
      addAllBtn2.classList.toggle("hidden", !capabilitiesState.canAddAll);
    }
    if (addRow2) {
      const visible = Array.from(addRow2.querySelectorAll("button")).filter(
        (btn) => !btn.classList.contains("hidden")
      );
      addRow2.classList.toggle("hidden", visible.length === 0);
    }
    updatePlaybackControls();
  }
  async function updateControlCapabilities() {
    if (!chrome?.tabs?.query) {
      applyControlCapabilities({
        canAddCurrent: false,
        canAddVisible: false,
        canAddAll: false,
        context: "extension"
      });
      return;
    }
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.id || !tab.url) {
        applyControlCapabilities({
          canAddCurrent: false,
          canAddVisible: false,
          canAddAll: false,
          context: "unknown"
        });
        return;
      }
      const isYoutube = /https?:\/\/(www\.)?youtube\.com/i.test(tab.url);
      if (!isYoutube) {
        applyControlCapabilities({
          canAddCurrent: false,
          canAddVisible: false,
          canAddAll: false,
          context: "external"
        });
        return;
      }
      const response = await chrome.tabs.sendMessage(tab.id, {
        type: "collector:getCapabilities"
      });
      if (response) {
        applyControlCapabilities(response);
      } else {
        applyControlCapabilities({
          canAddCurrent: false,
          canAddVisible: false,
          canAddAll: false,
          context: "unknown"
        });
      }
    } catch {
      applyControlCapabilities({
        canAddCurrent: false,
        canAddVisible: false,
        canAddAll: false,
        context: "unknown"
      });
    }
  }
  return {
    addFromScope,
    applyControlCapabilities,
    updateControlCapabilities
  };
}

// src/popup/modules/collection/availability.js
function readAutoCollectMeta(state) {
  const meta = state?.autoCollect || {};
  const cooldownMs = Number(meta.cooldownMs) || 0;
  const lastRunAt = Number(meta.lastRunAt) || 0;
  const storedNext = Number(meta.nextAutoCollectAt) || 0;
  let nextRun = storedNext;
  if (!nextRun && cooldownMs > 0 && lastRunAt > 0) {
    nextRun = lastRunAt + cooldownMs;
  }
  return {
    lastRunAt,
    lastAdded: Number(meta.lastAdded) || 0,
    lastFetched: Number(meta.lastFetched) || 0,
    nextAutoCollectAt: storedNext,
    nextRunAt: nextRun > 0 ? nextRun : 0,
    cooldownMs
  };
}
function formatTimeOfDay(timestamp) {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}
function formatCooldownMessage(remainingMs, targetTime) {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1e3));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor(totalSeconds % 3600 / 60);
  const seconds = totalSeconds % 60;
  const parts = [];
  if (hours > 0) {
    parts.push(`${hours} \u0447`);
  }
  if (minutes > 0 || hours > 0) {
    parts.push(`${minutes} \u043C\u0438\u043D`);
  }
  if (!parts.length) {
    parts.push(`${seconds} \u0441\u0435\u043A`);
  }
  const timeLabel = formatTimeOfDay(targetTime);
  return timeLabel ? `\u0421\u0431\u043E\u0440 \u0431\u0443\u0434\u0435\u0442 \u0434\u043E\u0441\u0442\u0443\u043F\u0435\u043D \u0447\u0435\u0440\u0435\u0437 ${parts.join(" ")} (\u2248 ${timeLabel})` : `\u0421\u0431\u043E\u0440 \u0431\u0443\u0434\u0435\u0442 \u0434\u043E\u0441\u0442\u0443\u043F\u0435\u043D \u0447\u0435\u0440\u0435\u0437 ${parts.join(" ")}`;
}
function createCollectionAvailabilityController({
  applyState,
  collectBtn: collectBtn2,
  collectionArea: collectionArea2,
  collectionNote: collectionNote2,
  collectionController: collectionController2,
  defaultListId,
  getPlaylistState,
  getSelectedListId: getSelectedListId2,
  refreshState: refreshState2,
  setLoading: setLoading2,
  setStatus: setStatus2,
  sendMessage: sendMessage2
}) {
  let isCollecting = false;
  let collectionCooldownTimer = null;
  let collectionCooldownTarget = 0;
  function stopCollectionCooldownTimer() {
    if (collectionCooldownTimer) {
      clearInterval(collectionCooldownTimer);
      collectionCooldownTimer = null;
    }
  }
  function updateCollectionCooldownMessage() {
    if (!collectionNote2) {
      stopCollectionCooldownTimer();
      collectionCooldownTarget = 0;
      return;
    }
    if (!collectionCooldownTarget) {
      stopCollectionCooldownTimer();
      collectionNote2.hidden = true;
      collectionNote2.textContent = "";
      return;
    }
    const remaining = Math.max(0, collectionCooldownTarget - Date.now());
    if (remaining <= 0) {
      collectionCooldownTarget = 0;
      stopCollectionCooldownTimer();
      collectionNote2.hidden = true;
      collectionNote2.textContent = "";
      updateAvailability();
      return;
    }
    collectionNote2.hidden = false;
    collectionNote2.textContent = formatCooldownMessage(
      remaining,
      collectionCooldownTarget
    );
  }
  function startCollectionCooldownTimer(targetTime) {
    collectionCooldownTarget = Number(targetTime) || 0;
    if (!collectionCooldownTarget) {
      updateCollectionCooldownMessage();
      return;
    }
    updateCollectionCooldownMessage();
    if (!collectionCooldownTimer) {
      collectionCooldownTimer = window.setInterval(
        updateCollectionCooldownMessage,
        1e3
      );
    }
  }
  function updateAvailability() {
    if (!collectBtn2 && !collectionArea2) return;
    const playlistState2 = getPlaylistState() || {};
    const selectedListId = getSelectedListId2();
    const isDefaultList = selectedListId === defaultListId;
    const autoMeta = readAutoCollectMeta(playlistState2);
    const now = Date.now();
    const nextRunAt = autoMeta.nextRunAt || autoMeta.nextAutoCollectAt || 0;
    const onCooldown = isDefaultList && nextRunAt > now;
    const controllerActive = Boolean(collectionController2?.isActive?.());
    const showArea = isDefaultList || controllerActive;
    const busy = isCollecting || controllerActive;
    if (collectionArea2) {
      const hidden = !showArea;
      collectionArea2.hidden = hidden;
      collectionArea2.classList.toggle("hidden", hidden);
      if (hidden) {
        stopCollectionCooldownTimer();
        if (collectionNote2) {
          collectionNote2.hidden = true;
          collectionNote2.textContent = "";
        }
      } else {
        collectionController2?.showIfHasHistory?.();
      }
    }
    if (collectBtn2) {
      const showButton = isDefaultList && !onCooldown && !busy;
      collectBtn2.classList.toggle("hidden", !showButton);
      if (showButton) {
        const loading = collectBtn2.dataset.loading === "1";
        collectBtn2.disabled = loading || busy;
      } else {
        collectBtn2.disabled = true;
      }
    }
    if (collectionNote2) {
      if (isDefaultList && onCooldown) {
        startCollectionCooldownTimer(nextRunAt);
      } else {
        collectionNote2.hidden = true;
        collectionNote2.textContent = "";
        stopCollectionCooldownTimer();
      }
    }
  }
  async function collectSubscriptions() {
    if (collectBtn2?.classList.contains("hidden")) return;
    if (isCollecting) return;
    isCollecting = true;
    setLoading2(collectBtn2, true);
    setStatus2("\u0421\u043E\u0431\u0438\u0440\u0430\u044E \u043D\u043E\u0432\u044B\u0435 \u0432\u0438\u0434\u0435\u043E...", "info", 0);
    updateAvailability();
    try {
      const result = await sendMessage2("playlist:collectSubscriptions");
      if (result?.error === "ON_COOLDOWN") {
        if (result?.state) {
          await applyState?.(result.state);
        }
        const nextRunAt = Number(result.nextRunAt) || 0;
        const remaining = Number(result.remainingMs) || (nextRunAt ? Math.max(0, nextRunAt - Date.now()) : 0);
        const message = remaining ? formatCooldownMessage(remaining, nextRunAt) : "\u0421\u0431\u043E\u0440 \u043C\u043E\u0436\u043D\u043E \u0437\u0430\u043F\u0443\u0441\u043A\u0430\u0442\u044C \u043D\u0435 \u0447\u0430\u0449\u0435 \u0440\u0430\u0437\u0430 \u0432 \u0447\u0430\u0441";
        setStatus2(message, "info", 4e3);
        return;
      }
      if (result?.state) {
        await applyState?.(result.state);
      } else {
        await refreshState2?.();
      }
    } catch (err) {
      console.error(err);
      setStatus2("\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0441\u043E\u0431\u0440\u0430\u0442\u044C \u043F\u043E\u0434\u043F\u0438\u0441\u043A\u0438", "error", 4e3);
    } finally {
      setLoading2(collectBtn2, false);
      isCollecting = false;
      updateAvailability();
    }
  }
  function handleProgressMessage(message) {
    const phase = collectionController2?.handleEvent?.(message.event || message);
    if (phase === "complete" || phase === "error") {
      isCollecting = false;
      setLoading2?.(collectBtn2, false);
    }
    updateAvailability();
    return phase;
  }
  return {
    collectSubscriptions,
    handleProgressMessage,
    teardown: stopCollectionCooldownTimer,
    updateAvailability
  };
}

// src/popup/modules/sync/index.js
var AUTO_REFRESH_MS = 20 * 1e3;
function maxTimestamp(...values) {
  return Math.max(...values.map((value) => Number(value) || 0), 0);
}
function isBenignSyncError(error) {
  const text = String(error || "");
  return !text || /not initialized/i.test(text) || /no-drive-remote/i.test(text) || /no-remote/i.test(text);
}
function formatFullTime(timestamp) {
  const value = Number(timestamp) || 0;
  if (!value) return "\u043D\u0435\u0442 \u0434\u0430\u043D\u043D\u044B\u0445";
  return new Date(value).toLocaleString("ru-RU");
}
function formatAge(timestamp) {
  const value = Number(timestamp) || 0;
  if (!value) return "\u043D\u0435\u0442";
  const diff = Math.max(0, Date.now() - value);
  return formatDuration2(diff);
}
function formatDuration2(diff) {
  const minutes = Math.floor(diff / 6e4);
  if (minutes < 1) return "\u0441\u0435\u0439\u0447\u0430\u0441";
  if (minutes < 60) return `${minutes} \u043C\u0438\u043D \u043D\u0430\u0437\u0430\u0434`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} \u0447 \u043D\u0430\u0437\u0430\u0434`;
  return `${Math.floor(hours / 24)} \u0434 \u043D\u0430\u0437\u0430\u0434`;
}
function formatDelta(fromTimestamp, toTimestamp) {
  const from = Number(fromTimestamp) || 0;
  const to = Number(toTimestamp) || 0;
  if (!from || !to) return "";
  const diff = Math.abs(from - to);
  const label = formatDuration2(diff).replace(" \u043D\u0430\u0437\u0430\u0434", "");
  return label === "\u0441\u0435\u0439\u0447\u0430\u0441" ? "\u043C\u0435\u043D\u044C\u0448\u0435 \u043C\u0438\u043D\u0443\u0442\u044B" : label;
}
function createSummary(statusText2, kind, localUpdatedAt, remoteUpdatedAt) {
  const localAge = formatAge(localUpdatedAt);
  const remoteAge = formatAge(remoteUpdatedAt);
  const hasRemote = Boolean(remoteUpdatedAt);
  let meta = "\u041E\u0431\u043B\u0430\u043A\u0430 \u043D\u0435\u0442";
  if (hasRemote && localUpdatedAt > remoteUpdatedAt + 1e3) {
    meta = `\u041E\u0431\u043B\u0430\u043A\u043E \u043E\u0442\u0441\u0442\u0430\u0451\u0442 \u043D\u0430 ${formatDelta(localUpdatedAt, remoteUpdatedAt)}`;
  } else if (hasRemote && remoteUpdatedAt > localUpdatedAt + 1e3) {
    meta = `\u041E\u0431\u043B\u0430\u043A\u043E \u043D\u043E\u0432\u0435\u0435 \u043D\u0430 ${formatDelta(remoteUpdatedAt, localUpdatedAt)}`;
  } else if (hasRemote) {
    meta = `\u041E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u043E ${remoteAge}`;
  }
  const title = [
    `\u041D\u0430 \u0443\u0441\u0442\u0440\u043E\u0439\u0441\u0442\u0432\u0435: ${formatFullTime(localUpdatedAt)} (${localAge})`,
    `\u0412 \u043E\u0431\u043B\u0430\u043A\u0435: ${formatFullTime(remoteUpdatedAt)} (${remoteAge})`
  ].join("\n");
  return { text: statusText2, meta, title, kind };
}
function describeSyncStatus(status) {
  const playlist = status?.playlist || {};
  const settings = status?.settings || {};
  const drive = status?.drive || {};
  const localUpdatedAt = maxTimestamp(
    playlist.localUpdatedAt,
    settings.localUpdatedAt
  );
  const remoteUpdatedAt = Number(drive.remoteUpdatedAt) || 0;
  const errors = [
    playlist.lastError,
    settings.lastError,
    drive.lastError
  ].filter((error) => !isBenignSyncError(error));
  if (errors.length) {
    return createSummary("\u041E\u0448\u0438\u0431\u043A\u0430 \u0441\u0438\u043D\u0445\u0440\u043E\u043D\u0438\u0437\u0430\u0446\u0438\u0438", "error", localUpdatedAt, remoteUpdatedAt);
  }
  if (!remoteUpdatedAt) {
    return createSummary("\u041E\u0431\u043B\u0430\u043A\u043E \u043D\u0435 \u0441\u043E\u0437\u0434\u0430\u043D\u043E", "warning", localUpdatedAt, remoteUpdatedAt);
  }
  if (playlist.pending || settings.pending || localUpdatedAt > remoteUpdatedAt + 1e3) {
    return createSummary("\u0415\u0441\u0442\u044C \u0438\u0437\u043C\u0435\u043D\u0435\u043D\u0438\u044F", "warning", localUpdatedAt, remoteUpdatedAt);
  }
  if (remoteUpdatedAt > localUpdatedAt + 1e3) {
    return createSummary("\u0412 \u043E\u0431\u043B\u0430\u043A\u0435 \u0441\u0432\u0435\u0436\u0435\u0435", "warning", localUpdatedAt, remoteUpdatedAt);
  }
  return createSummary("\u0410\u043A\u0442\u0443\u0430\u043B\u044C\u043D\u043E", "ok", localUpdatedAt, remoteUpdatedAt);
}
function createPopupSyncController({
  stateEl,
  metaEl,
  pullBtn,
  pushBtn,
  sendMessage: sendMessage2,
  setStatus: setStatus2 = () => {
  },
  refreshState: refreshState2 = () => {
  }
}) {
  const buttons = [pullBtn, pushBtn].filter(Boolean);
  let refreshTimer = null;
  let refreshInFlight = false;
  function setBusy(busy) {
    buttons.forEach((button) => {
      button.disabled = busy;
      button.classList.toggle("is-loading", busy);
    });
  }
  function renderStatus(status) {
    if (!stateEl) return;
    const summary = describeSyncStatus(status);
    stateEl.textContent = summary.text;
    stateEl.dataset.kind = summary.kind;
    stateEl.title = summary.title;
    if (metaEl) {
      metaEl.textContent = summary.meta;
      metaEl.title = summary.title;
      metaEl.dataset.kind = summary.kind;
    }
  }
  async function refresh({ refreshRemote = false } = {}) {
    if (refreshInFlight) return;
    refreshInFlight = true;
    try {
      const status = await sendMessage2("sync:getStatus", { refreshRemote });
      renderStatus(status);
    } catch (err) {
      console.error("Failed to load popup sync status", err);
      if (stateEl) {
        stateEl.textContent = "\u0421\u0438\u043D\u0445\u0440\u043E\u043D\u0438\u0437\u0430\u0446\u0438\u044F \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u043D\u0430";
        stateEl.dataset.kind = "error";
      }
      if (metaEl) {
        metaEl.textContent = "";
        metaEl.removeAttribute("data-kind");
      }
    } finally {
      refreshInFlight = false;
    }
  }
  function scheduleRefresh(delay2 = 500) {
    if (refreshTimer) {
      window.clearTimeout(refreshTimer);
    }
    refreshTimer = window.setTimeout(() => {
      refreshTimer = null;
      refresh();
    }, delay2);
  }
  window.setInterval(() => {
    refresh({ refreshRemote: true });
  }, AUTO_REFRESH_MS);
  async function runAction(action, message, afterLocalChange = false) {
    try {
      setBusy(true);
      const result = await action();
      await refresh({ refreshRemote: true });
      if (afterLocalChange && (result?.playlistImported || result?.driveImported)) {
        await refreshState2();
      }
      setStatus2(message(result), "success", 2200);
    } catch (err) {
      console.error("Popup sync action failed", err);
      await refresh();
      setStatus2("\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0432\u044B\u043F\u043E\u043B\u043D\u0438\u0442\u044C \u0441\u0438\u043D\u0445\u0440\u043E\u043D\u0438\u0437\u0430\u0446\u0438\u044E", "error", 3e3);
    } finally {
      setBusy(false);
    }
  }
  pullBtn?.addEventListener("click", () => {
    runAction(
      () => sendMessage2("sync:pullRemote"),
      (result) => result?.playlistImported || result?.settingsImported ? "\u0414\u0430\u043D\u043D\u044B\u0435 \u0441\u043B\u0438\u0442\u044B \u0441 \u043E\u0431\u043B\u0430\u043A\u043E\u043C" : "\u041E\u0431\u043B\u0430\u0447\u043D\u043E\u0439 \u0432\u0435\u0440\u0441\u0438\u0438 \u043F\u043E\u043A\u0430 \u043D\u0435\u0442",
      true
    );
  });
  pushBtn?.addEventListener("click", () => {
    runAction(
      () => sendMessage2("sync:pushLocal"),
      (result) => result?.drivePushed || result?.playlistPushed || result?.settingsPushed ? "\u0414\u0430\u043D\u043D\u044B\u0435 \u043E\u0442\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u044B \u0432 \u043E\u0431\u043B\u0430\u043A\u043E" : "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043E\u0442\u043F\u0440\u0430\u0432\u0438\u0442\u044C \u0434\u0430\u043D\u043D\u044B\u0435"
    );
  });
  return { refresh, scheduleRefresh };
}

// src/popup/modules/manager/listSwitcher.js
var VIDEO_COUNT_ICON = "\u{1F3AC}";
function createListOption(list, defaultListId) {
  const option = document.createElement("option");
  option.value = list.id;
  const textParts = [list.name];
  const metaLabelParts = [];
  if (list.length != null) {
    const lengthValue = typeof list.length === "number" ? list.length : Number(list.length);
    if (Number.isFinite(lengthValue)) {
      textParts.push(`${lengthValue} ${VIDEO_COUNT_ICON}`);
      const lengthLabel = lengthValue === 1 ? "1 \u0432\u0438\u0434\u0435\u043E" : `${lengthValue} \u0432\u0438\u0434\u0435\u043E`;
      metaLabelParts.push(lengthLabel);
    } else {
      const rawLength = String(list.length).trim();
      if (rawLength) {
        textParts.push(`${rawLength} ${VIDEO_COUNT_ICON}`);
        metaLabelParts.push(rawLength);
      }
    }
  }
  if (list.freeze && list.id !== defaultListId) {
    metaLabelParts.push("\u0431\u0435\u0437 \u0443\u0434\u0430\u043B\u0435\u043D\u0438\u044F");
  }
  option.textContent = textParts.join(" \xB7 ");
  const ariaLabel = metaLabelParts.length ? `${list.name}. ${metaLabelParts.join(", ")}` : list.name;
  option.title = ariaLabel;
  option.setAttribute("aria-label", ariaLabel);
  return option;
}
function updateListSelection(listSwitcher2, listId) {
  if (!listSwitcher2) return;
  if (!listId) {
    if (listSwitcher2.options.length) {
      listSwitcher2.selectedIndex = 0;
    }
    return;
  }
  const option = Array.from(listSwitcher2.options).find((item) => item.value === listId);
  if (option) {
    listSwitcher2.value = listId;
  } else if (listSwitcher2.options.length) {
    listSwitcher2.selectedIndex = 0;
  }
}
function renderListSwitcher({
  listSwitcher: listSwitcher2,
  state,
  defaultListId,
  requestAnimationFrameFn = requestAnimationFrame
}) {
  if (!listSwitcher2) return;
  const lists = Array.isArray(state?.lists) ? state.lists : [];
  const currentId = state?.currentListId || null;
  const hadFocus = document.activeElement === listSwitcher2;
  const previousValue = listSwitcher2.value;
  listSwitcher2.innerHTML = "";
  if (!lists.length) {
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "\u041D\u0435\u0442 \u0434\u043E\u0441\u0442\u0443\u043F\u043D\u044B\u0445 \u0441\u043F\u0438\u0441\u043A\u043E\u0432";
    placeholder.disabled = true;
    placeholder.selected = true;
    listSwitcher2.appendChild(placeholder);
    listSwitcher2.disabled = true;
    listSwitcher2.value = "";
    return;
  }
  lists.forEach((list) => {
    listSwitcher2.appendChild(createListOption(list, defaultListId));
  });
  listSwitcher2.disabled = lists.length <= 1;
  const validIds = new Set(lists.map((list) => list.id));
  let nextValue = null;
  if (currentId && validIds.has(currentId)) {
    nextValue = currentId;
  } else if (previousValue && validIds.has(previousValue)) {
    nextValue = previousValue;
  } else {
    nextValue = lists[0]?.id || "";
  }
  updateListSelection(listSwitcher2, nextValue);
  if (hadFocus) {
    requestAnimationFrameFn(() => {
      listSwitcher2.focus({ preventScroll: true });
    });
  }
}

// src/popup/modules/playback/meta.js
function computePlaybackMeta(state) {
  const queue = Array.isArray(state?.currentQueue?.queue) ? state.currentQueue.queue : [];
  const queueIds = queue.map((entry) => entry && typeof entry === "object" ? entry.id : null).filter((id) => typeof id === "string" && id);
  const queueId = state?.currentQueue?.id || null;
  const activeListId = state?.currentListId || null;
  const queueMatchesActive = Boolean(
    activeListId && queueId && queueId === activeListId
  );
  const pointerIndex = Number.isInteger(state?.currentQueue?.currentIndex) && state.currentQueue.currentIndex >= 0 && state.currentQueue.currentIndex < queueIds.length ? state.currentQueue.currentIndex : queueIds.length ? 0 : -1;
  const currentId = queueMatchesActive ? state?.currentVideoId || null : null;
  const currentIndex = currentId ? queueIds.indexOf(currentId) : -1;
  const inQueue = currentIndex !== -1;
  const historyLength = Array.isArray(state?.history) ? state.history.length : 0;
  const controlling = queueMatchesActive && inQueue;
  return {
    queue,
    queueIds,
    pointerIndex,
    currentIndex,
    inQueue,
    queueMatchesActive,
    controlling,
    frozen: Boolean(state?.currentQueue?.freeze),
    hasPrev: controlling && (currentIndex > 0 || historyLength > 0),
    hasNext: controlling && currentIndex < queueIds.length - 1
  };
}

// src/popup/modules/playback/controller.js
function createPlaybackController({
  startPlaybackBtn: startPlaybackBtn2,
  playPrevBtn: playPrevBtn2,
  postponeBtn: postponeBtn2,
  playNextBtn: playNextBtn2,
  togglePlaybackBtn: togglePlaybackBtn2,
  playbackControls: playbackControls2,
  getPlaylistState,
  renderState: renderState2,
  setLoading: setLoading2,
  setStatus: setStatus2,
  sendMessage: sendMessage2
}) {
  let activePlaybackTabId = null;
  let playbackStatus = {
    playing: false,
    hasVideo: false,
    known: false
  };
  let lastPlaybackStatusRequest = 0;
  let playbackStatusPromise = null;
  function applyPlaybackStatus(status = {}) {
    playbackStatus = {
      playing: Boolean(status.playing),
      hasVideo: Boolean(status.hasVideo),
      known: status.known === false ? false : true
    };
  }
  function resetPlaybackStatus() {
    applyPlaybackStatus({ playing: false, hasVideo: false, known: true });
  }
  function getActivePlaybackTabId(state = getPlaylistState() || {}) {
    return Boolean(state?.currentListId) && Boolean(state?.currentVideoId) && Number.isInteger(state?.currentTabId) ? state.currentTabId : null;
  }
  function updatePlaybackControls() {
    const playlistState2 = getPlaylistState() || {};
    const meta = computePlaybackMeta(playlistState2);
    const queueHasEntries = meta.queueIds.length > 0;
    const hasPlaybackContext = getActivePlaybackTabId(playlistState2) !== null;
    const hasActivePlayback = hasPlaybackContext && meta.controlling;
    const shouldShowStart = queueHasEntries && !hasPlaybackContext;
    let showPlaybackCluster = false;
    if (startPlaybackBtn2) {
      startPlaybackBtn2.classList.toggle("hidden", !shouldShowStart);
      if (!startPlaybackBtn2.dataset.loading) {
        startPlaybackBtn2.disabled = !queueHasEntries;
      }
    }
    if (togglePlaybackBtn2) {
      const allowToggle = hasActivePlayback && (playbackStatus.hasVideo || !playbackStatus.known);
      togglePlaybackBtn2.classList.toggle("hidden", !allowToggle);
      showPlaybackCluster = showPlaybackCluster || allowToggle;
      if (!togglePlaybackBtn2.dataset.loading) {
        togglePlaybackBtn2.disabled = false;
      }
      if (allowToggle) {
        const isPlaying = playbackStatus.known ? playbackStatus.playing : true;
        const icon = togglePlaybackBtn2.querySelector(".icon");
        if (icon) {
          icon.textContent = isPlaying ? "\u23F8" : "\u25B6";
        }
        togglePlaybackBtn2.dataset.state = isPlaying ? "playing" : "paused";
        togglePlaybackBtn2.setAttribute("aria-label", isPlaying ? "\u041F\u0430\u0443\u0437\u0430" : "\u0412\u043E\u0441\u043F\u0440\u043E\u0438\u0437\u0432\u0435\u0441\u0442\u0438");
        togglePlaybackBtn2.title = isPlaying ? "\u041F\u0430\u0443\u0437\u0430" : "\u0412\u043E\u0441\u043F\u0440\u043E\u0438\u0437\u0432\u0435\u0441\u0442\u0438";
      }
    }
    const showQueueControls = hasActivePlayback;
    if (playPrevBtn2) {
      const showPrev = showQueueControls && meta.hasPrev;
      playPrevBtn2.classList.toggle("hidden", !showPrev);
      showPlaybackCluster = showPlaybackCluster || showPrev;
      if (!playPrevBtn2.dataset.loading) {
        playPrevBtn2.disabled = false;
      }
    }
    if (playNextBtn2) {
      const showNext = showQueueControls && meta.hasNext;
      playNextBtn2.classList.toggle("hidden", !showNext);
      showPlaybackCluster = showPlaybackCluster || showNext;
      if (!playNextBtn2.dataset.loading) {
        playNextBtn2.disabled = false;
      }
    }
    if (postponeBtn2) {
      const showPostpone = showQueueControls && meta.hasNext && !meta.frozen;
      postponeBtn2.classList.toggle("hidden", !showPostpone);
      if (!postponeBtn2.dataset.loading) {
        postponeBtn2.disabled = false;
      }
    }
    if (playbackControls2) {
      playbackControls2.classList.toggle("hidden", !showPlaybackCluster);
      if (showPlaybackCluster) {
        playbackControls2.removeAttribute("aria-hidden");
      } else {
        playbackControls2.setAttribute("aria-hidden", "true");
      }
    }
  }
  async function startPlayback() {
    if (!startPlaybackBtn2) return;
    const playlistState2 = getPlaylistState() || {};
    const meta = computePlaybackMeta(playlistState2);
    if (!meta.queueIds.length) {
      setStatus2("\u041E\u0447\u0435\u0440\u0435\u0434\u044C \u043F\u0443\u0441\u0442\u0430\u044F", "info", 3e3);
      return;
    }
    const entry = meta.queue[0];
    if (!entry || !entry.id) {
      setStatus2("\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043E\u043F\u0440\u0435\u0434\u0435\u043B\u0438\u0442\u044C \u0432\u0438\u0434\u0435\u043E", "error", 3500);
      return;
    }
    setLoading2(startPlaybackBtn2, true);
    setStatus2("\u0417\u0430\u043F\u0443\u0441\u043A\u0430\u044E \u043F\u043B\u0435\u0439\u043B\u0438\u0441\u0442...", "info");
    try {
      const state = await sendMessage2("playlist:play", {
        videoId: entry.id,
        listId: playlistState2?.currentQueue?.id || playlistState2?.currentListId || null,
        forceNewTab: true,
        activate: true
      });
      if (state) {
        renderState2(state);
        setStatus2("\u041F\u043B\u0435\u0439\u043B\u0438\u0441\u0442 \u0437\u0430\u043F\u0443\u0449\u0435\u043D", "success", 2500);
      } else {
        setStatus2("\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0437\u0430\u043F\u0443\u0441\u0442\u0438\u0442\u044C \u043F\u043B\u0435\u0439\u043B\u0438\u0441\u0442", "error", 3500);
      }
    } catch (err) {
      console.error(err);
      setStatus2("\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0437\u0430\u043F\u0443\u0441\u0442\u0438\u0442\u044C \u043F\u043B\u0435\u0439\u043B\u0438\u0441\u0442", "error", 4e3);
    } finally {
      setLoading2(startPlaybackBtn2, false);
    }
  }
  async function togglePlayback() {
    if (!togglePlaybackBtn2) return;
    if (togglePlaybackBtn2.dataset.loading === "1") return;
    const playlistState2 = getPlaylistState() || {};
    togglePlaybackBtn2.dataset.loading = "1";
    togglePlaybackBtn2.disabled = true;
    try {
      const response = await sendMessage2("player:togglePlayback", {});
      if (response?.state && response.state.currentTabId !== playlistState2?.currentTabId) {
        renderState2(response.state);
        return;
      }
      if (response?.reason === "NO_ACTIVE_TAB" || response?.reason === "TAB_UNREACHABLE") {
        setStatus2("\u041D\u0435\u0442 \u0430\u043A\u0442\u0438\u0432\u043D\u043E\u0433\u043E \u0432\u043E\u0441\u043F\u0440\u043E\u0438\u0437\u0432\u0435\u0434\u0435\u043D\u0438\u044F", "info", 2500);
        resetPlaybackStatus();
        updatePlaybackControls();
        return;
      }
      if (response?.reason === "NO_VIDEO") {
        setStatus2("\u0412\u0438\u0434\u0435\u043E \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u043E \u043D\u0430 \u0432\u043A\u043B\u0430\u0434\u043A\u0435", "info", 2500);
        resetPlaybackStatus();
        updatePlaybackControls();
        return;
      }
      if (response?.handled === false) {
        setStatus2("\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0443\u043F\u0440\u0430\u0432\u043B\u044F\u0442\u044C \u0432\u043E\u0441\u043F\u0440\u043E\u0438\u0437\u0432\u0435\u0434\u0435\u043D\u0438\u0435\u043C", "error", 3200);
        return;
      }
      if (response) {
        const playing = response.playing === true;
        applyPlaybackStatus({ playing, hasVideo: true, known: true });
        updatePlaybackControls();
        setStatus2(
          playing ? "\u0412\u043E\u0441\u043F\u0440\u043E\u0438\u0437\u0432\u0435\u0434\u0435\u043D\u0438\u0435 \u0432\u043E\u0437\u043E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u043E" : "\u0412\u0438\u0434\u0435\u043E \u043D\u0430 \u043F\u0430\u0443\u0437\u0435",
          playing ? "success" : "info",
          1800
        );
      }
    } catch (err) {
      console.error("Toggle playback failed", err);
      setStatus2("\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0443\u043F\u0440\u0430\u0432\u043B\u044F\u0442\u044C \u0432\u043E\u0441\u043F\u0440\u043E\u0438\u0437\u0432\u0435\u0434\u0435\u043D\u0438\u0435\u043C", "error", 3500);
      resetPlaybackStatus();
      updatePlaybackControls();
    } finally {
      togglePlaybackBtn2.removeAttribute("data-loading");
      togglePlaybackBtn2.disabled = false;
      refreshPlaybackStatus({ force: true }).catch(() => {
      });
    }
  }
  function hasActivePlaybackTab() {
    return getActivePlaybackTabId() !== null;
  }
  async function refreshPlaybackStatus({ force = false } = {}) {
    if (!hasActivePlaybackTab()) {
      playbackStatusPromise = null;
      lastPlaybackStatusRequest = 0;
      resetPlaybackStatus();
      updatePlaybackControls();
      return;
    }
    const playlistState2 = getPlaylistState() || {};
    const now = Date.now();
    if (!force && playbackStatusPromise) {
      return playbackStatusPromise;
    }
    if (!force && now - lastPlaybackStatusRequest < 400) {
      return playbackStatusPromise || Promise.resolve();
    }
    lastPlaybackStatusRequest = now;
    playbackStatusPromise = sendMessage2("player:getPlaybackStatus", {}).then((response) => {
      playbackStatusPromise = null;
      if (response?.state && response.state.currentTabId !== playlistState2?.currentTabId) {
        renderState2(response.state);
        return;
      }
      if (response?.active) {
        applyPlaybackStatus({
          playing: response.playing === true,
          hasVideo: true,
          known: true
        });
        updatePlaybackControls();
        return;
      }
      if (response?.reason === "NO_VIDEO" || response?.reason === "TAB_UNREACHABLE") {
        resetPlaybackStatus();
        updatePlaybackControls();
        return;
      }
      if (response?.reason === "NO_ACTIVE_TAB") {
        resetPlaybackStatus();
        updatePlaybackControls();
      }
    }).catch((err) => {
      playbackStatusPromise = null;
      if (!err || !/receiving end/i.test(err.message || "")) {
        console.error("Failed to get playback status", err);
      }
      resetPlaybackStatus();
      updatePlaybackControls();
    });
    return playbackStatusPromise;
  }
  async function playPrevious() {
    if (!playPrevBtn2) return;
    const playlistState2 = getPlaylistState() || {};
    setLoading2(playPrevBtn2, true);
    setStatus2("\u0412\u043E\u0437\u0432\u0440\u0430\u0449\u0430\u044E\u0441\u044C \u043A \u043F\u0440\u0435\u0434\u044B\u0434\u0443\u0449\u0435\u043C\u0443...", "info");
    try {
      const state = await sendMessage2("playlist:playPrevious", {
        placement: "beforeCurrent",
        tabId: Number.isInteger(playlistState2?.currentTabId) ? playlistState2.currentTabId : void 0
      });
      if (state?.handled === false) {
        setStatus2("\u041F\u0440\u0435\u0434\u044B\u0434\u0443\u0449\u0435\u0435 \u0432\u0438\u0434\u0435\u043E \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u043E", "info", 3e3);
        return;
      }
      if (state?.state) {
        renderState2(state.state);
        setStatus2("\u041F\u0440\u0435\u0434\u044B\u0434\u0443\u0449\u0435\u0435 \u0432\u0438\u0434\u0435\u043E \u0437\u0430\u043F\u0443\u0449\u0435\u043D\u043E", "success", 2500);
      } else if (state) {
        renderState2(state);
      }
    } catch (err) {
      console.error(err);
      setStatus2("\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043F\u0435\u0440\u0435\u043A\u043B\u044E\u0447\u0438\u0442\u044C\u0441\u044F", "error", 4e3);
    } finally {
      setLoading2(playPrevBtn2, false);
      refreshPlaybackStatus({ force: true }).catch(() => {
      });
    }
  }
  async function postponeCurrentVideo() {
    if (!postponeBtn2) return;
    const playlistState2 = getPlaylistState() || {};
    if (playlistState2?.currentQueue?.freeze) {
      setStatus2("\u0421\u043F\u0438\u0441\u043E\u043A \u0437\u0430\u043C\u043E\u0440\u043E\u0436\u0435\u043D, \u043D\u0435\u043B\u044C\u0437\u044F \u043E\u0442\u043B\u043E\u0436\u0438\u0442\u044C", "info", 3e3);
      return;
    }
    setLoading2(postponeBtn2, true);
    setStatus2("\u041E\u0442\u043A\u043B\u0430\u0434\u044B\u0432\u0430\u044E \u0432\u0438\u0434\u0435\u043E...", "info");
    try {
      const payload = {
        tabId: Number.isInteger(playlistState2?.currentTabId) ? playlistState2.currentTabId : void 0
      };
      if (playlistState2?.currentVideoId) {
        payload.videoId = playlistState2.currentVideoId;
      }
      const state = await sendMessage2("playlist:postpone", payload);
      if (state?.handled === false) {
        setStatus2("\u041D\u0435\u0442 \u0441\u043B\u0435\u0434\u0443\u044E\u0449\u0435\u0433\u043E \u0432\u0438\u0434\u0435\u043E", "info", 3e3);
        return;
      }
      if (state?.state) {
        renderState2(state.state);
      } else if (state) {
        renderState2(state);
      }
      setStatus2("\u0412\u0438\u0434\u0435\u043E \u043E\u0442\u043B\u043E\u0436\u0435\u043D\u043E", "success", 2500);
    } catch (err) {
      console.error(err);
      setStatus2("\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043E\u0442\u043B\u043E\u0436\u0438\u0442\u044C", "error", 4e3);
    } finally {
      setLoading2(postponeBtn2, false);
      refreshPlaybackStatus({ force: true }).catch(() => {
      });
    }
  }
  async function playNext() {
    const playlistState2 = getPlaylistState() || {};
    const videoId = typeof playlistState2?.currentVideoId === "string" ? playlistState2.currentVideoId : null;
    if (!videoId) {
      setStatus2("\u0422\u0435\u043A\u0443\u0449\u0435\u0435 \u0432\u0438\u0434\u0435\u043E \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u043E", "info", 3e3);
      return;
    }
    setLoading2(playNextBtn2, true);
    setStatus2("\u041F\u0435\u0440\u0435\u0445\u043E\u0434\u0438\u043C \u043A \u0441\u043B\u0435\u0434\u0443\u044E\u0449\u0435\u043C\u0443...", "info");
    try {
      const state = await sendMessage2("playlist:playNext", {
        videoId,
        tabId: Number.isInteger(playlistState2?.currentTabId) ? playlistState2.currentTabId : void 0
      });
      if (state?.handled === false) {
        setStatus2("\u0421\u043B\u0435\u0434\u0443\u044E\u0449\u0435\u0435 \u0432\u0438\u0434\u0435\u043E \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u043E", "info");
        return;
      }
      if (state?.state) {
        renderState2(state.state);
        setStatus2("\u0421\u043B\u0435\u0434\u0443\u044E\u0449\u0435\u0435 \u0432\u0438\u0434\u0435\u043E \u0437\u0430\u043F\u0443\u0449\u0435\u043D\u043E", "success");
      } else if (state) {
        renderState2(state);
      }
    } catch (err) {
      console.error(err);
      setStatus2("\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043F\u0435\u0440\u0435\u043A\u043B\u044E\u0447\u0438\u0442\u044C\u0441\u044F", "error", 4e3);
    } finally {
      setLoading2(playNextBtn2, false);
      refreshPlaybackStatus({ force: true }).catch(() => {
      });
    }
  }
  function syncState(state) {
    const nextActiveTabId = getActivePlaybackTabId(state);
    const activeTabChanged = nextActiveTabId !== activePlaybackTabId;
    activePlaybackTabId = nextActiveTabId;
    if (!activePlaybackTabId) {
      playbackStatusPromise = null;
      lastPlaybackStatusRequest = 0;
      resetPlaybackStatus();
    } else if (activeTabChanged) {
      applyPlaybackStatus({ playing: true, hasVideo: true, known: false });
    }
    updatePlaybackControls();
    if (activePlaybackTabId) {
      refreshPlaybackStatus({ force: activeTabChanged }).catch(() => {
      });
    }
  }
  return {
    playNext,
    playPrevious,
    postponeCurrentVideo,
    refreshPlaybackStatus,
    startPlayback,
    syncState,
    togglePlayback,
    updatePlaybackControls
  };
}

// src/popup/lib/runtimeMessages.js
async function sendMessage(type, payload = {}, options = {}) {
  try {
    return await chrome.runtime.sendMessage({ type, ...payload });
  } catch (err) {
    const recoverable = isRecoverableRuntimeError(err);
    if (!recoverable || options.logRecoverable) {
      console.error(options.label || "Message failed", type, err);
    }
    throw err;
  }
}
function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
function getErrorMessage(err) {
  if (!err) return "";
  if (typeof err === "string") return err;
  if (typeof err.message === "string") return err.message;
  return String(err);
}
function isRecoverableRuntimeError(err) {
  const message = getErrorMessage(err);
  return /receiving end/i.test(message) || /could not establish connection/i.test(message) || /message port closed/i.test(message) || /context invalidated/i.test(message);
}

// src/popup/popup.js
var queueList = document.getElementById("queueList");
var historyList = document.getElementById("historyList");
var queueEmpty = document.getElementById("queueEmpty");
var historyEmpty = document.getElementById("historyEmpty");
var historyModeButtons = Array.from(
  document.querySelectorAll(".history-tab")
);
var statusBox = document.getElementById("status");
var statusText = document.getElementById("statusText");
var collectionProgress = document.getElementById("collectionProgress");
var collectionTitle = collectionProgress?.querySelector?.(".collection-info h4") || null;
var collectionStageText = document.getElementById("collectionStage");
var collectionCounters = document.getElementById("collectionCounters");
var collectionLog = document.getElementById("collectionLog");
var collectionArea = document.getElementById("collectionArea");
var collectionNote = document.getElementById("collectionNote");
var listSwitcher = document.getElementById("listSwitcher");
var queueFreezeIndicator = document.getElementById("queueFreezeIndicator");
var addCurrentBtn = document.getElementById("addCurrent");
var addVisibleBtn = document.getElementById("addVisible");
var addAllBtn = document.getElementById("addAll");
var collectBtn = document.getElementById("collectSubscriptions");
var startPlaybackBtn = document.getElementById("startPlayback");
var playPrevBtn = document.getElementById("playPrev");
var postponeBtn = document.getElementById("postponeCurrent");
var playNextBtn = document.getElementById("playNext");
var togglePlaybackBtn = document.getElementById("togglePlayback");
var playbackControls = document.querySelector(".playback-controls");
var openManagerBtn = document.getElementById("openManager");
var openFilterSettingsBtn = document.getElementById("openFilterSettings");
var addRow = document.querySelector(".control-row--add");
var popupSyncState = document.getElementById("popupSyncState");
var popupSyncMeta = document.getElementById("popupSyncMeta");
var popupSyncPullBtn = document.getElementById("popupSyncPull");
var popupSyncPushBtn = document.getElementById("popupSyncPush");
var fallbackThumbnail = chrome.runtime.getURL("icon/icon.png");
var DEFAULT_LIST_ID = "default";
var playlistState = null;
var { setStatus } = createStatusController({ statusBox, statusText });
var moveMenu = createMoveMenu({
  getOptions: ({ sourceListId }) => {
    const lists = Array.isArray(playlistState?.lists) ? playlistState.lists : [];
    return lists.filter((list) => list.id !== sourceListId).map((list) => ({ id: list.id, label: list.name }));
  },
  onEmpty: () => {
    setStatus("\u041D\u0435\u0442 \u0434\u0440\u0443\u0433\u0438\u0445 \u0441\u043F\u0438\u0441\u043A\u043E\u0432", "info", 2500);
  },
  onSelect: async (targetListId, context) => {
    if (!targetListId || !context?.videoId) return;
    setStatus("\u041F\u0435\u0440\u0435\u043D\u043E\u0448\u0443 \u0432\u0438\u0434\u0435\u043E...", "info");
    try {
      const state = await sendMessage("playlist:moveVideo", {
        videoId: context.videoId,
        targetListId
      });
      if (state) {
        renderState(state);
        setStatus("\u0412\u0438\u0434\u0435\u043E \u043F\u0435\u0440\u0435\u043D\u0435\u0441\u0435\u043D\u043E", "success", 2500);
      }
    } catch (err) {
      console.error(err);
      setStatus("\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043F\u0435\u0440\u0435\u043D\u0435\u0441\u0442\u0438", "error", 3e3);
    }
  }
});
function showMoveMenu(videoId, sourceListId, anchor) {
  moveMenu.show(anchor, { videoId, sourceListId });
}
var queueController = createQueueController({
  queueList,
  queueEmpty,
  queueFreezeIndicator,
  fallbackThumbnail,
  showMoveMenu,
  hideMoveMenu: () => moveMenu.hide(),
  setStatus,
  sendMessage,
  onStateChange: renderState,
  getPlaylistState: () => playlistState,
  defaultListId: DEFAULT_LIST_ID
});
var historyController = createHistoryController({
  historyList,
  historyEmpty,
  fallbackThumbnail,
  getListName,
  setStatus,
  hideMoveMenu: () => moveMenu.hide(),
  sendMessage,
  onStateChange: renderState,
  modeButtons: historyModeButtons
});
var collectionController = createCollectionController({
  progressEl: collectionProgress,
  titleEl: collectionTitle,
  stageTextEl: collectionStageText,
  countersEl: collectionCounters,
  logEl: collectionLog,
  setStatus
});
var collectionAvailabilityController = createCollectionAvailabilityController({
  applyState: renderState,
  collectBtn,
  collectionArea,
  collectionNote,
  collectionController,
  defaultListId: DEFAULT_LIST_ID,
  getPlaylistState: () => playlistState,
  getSelectedListId,
  setLoading,
  setStatus,
  sendMessage
});
var playbackController = createPlaybackController({
  startPlaybackBtn,
  playPrevBtn,
  postponeBtn,
  playNextBtn,
  togglePlaybackBtn,
  playbackControls,
  getPlaylistState: () => playlistState,
  renderState,
  setLoading,
  setStatus,
  sendMessage
});
var addActionsController = createAddActionsController({
  addCurrentBtn,
  addVisibleBtn,
  addAllBtn,
  addRow,
  defaultListId: DEFAULT_LIST_ID,
  getSelectedListId,
  renderState,
  setLoading,
  setStatus,
  sendMessage,
  updatePlaybackControls: playbackController.updatePlaybackControls
});
var popupSyncController = createPopupSyncController({
  stateEl: popupSyncState,
  metaEl: popupSyncMeta,
  pullBtn: popupSyncPullBtn,
  pushBtn: popupSyncPushBtn,
  sendMessage,
  setStatus,
  refreshState
});
function getSelectedListId() {
  if (playlistState?.currentQueue?.id) {
    return playlistState.currentQueue.id;
  }
  if (playlistState?.currentListId) {
    return playlistState.currentListId;
  }
  return null;
}
function openManager() {
  const url = chrome.runtime.getURL("src/popup/lists.html");
  chrome.tabs.create({ url });
}
function openFilterSettings() {
  if (chrome?.runtime?.openOptionsPage) {
    chrome.runtime.openOptionsPage();
    return;
  }
  const url = chrome.runtime.getURL("src/settings/settings.html");
  chrome.tabs.create({ url });
}
listSwitcher?.addEventListener("change", () => {
  const value = listSwitcher.value;
  if (value) {
    selectList(value);
  }
});
addCurrentBtn?.addEventListener("click", () => addActionsController.addFromScope("current"));
addVisibleBtn?.addEventListener("click", () => addActionsController.addFromScope("visible"));
addAllBtn?.addEventListener("click", () => addActionsController.addFromScope("page"));
collectBtn?.addEventListener(
  "click",
  collectionAvailabilityController.collectSubscriptions
);
startPlaybackBtn?.addEventListener("click", playbackController.startPlayback);
togglePlaybackBtn?.addEventListener("click", playbackController.togglePlayback);
playPrevBtn?.addEventListener("click", playbackController.playPrevious);
postponeBtn?.addEventListener("click", playbackController.postponeCurrentVideo);
playNextBtn?.addEventListener("click", playbackController.playNext);
openManagerBtn?.addEventListener("click", openManager);
openFilterSettingsBtn?.addEventListener("click", openFilterSettings);
collectionAvailabilityController.updateAvailability();
chrome.runtime.onMessage.addListener((message) => {
  if (!message || !message.type) return;
  if (message.type === "playlist:stateUpdated") {
    if (message.state) {
      renderState(message.state);
    }
  } else if (message.type === "playlist:collectProgress") {
    collectionAvailabilityController.handleProgressMessage(message);
  }
});
refreshState();
popupSyncController.refresh();
addActionsController.updateControlCapabilities().catch(() => {
});
function getListName(listId) {
  if (!playlistState || !Array.isArray(playlistState.lists)) return "";
  const match = playlistState.lists.find((list) => list.id === listId);
  return match ? match.name : "";
}
function renderLists(state) {
  renderListSwitcher({
    listSwitcher,
    state,
    defaultListId: DEFAULT_LIST_ID
  });
}
function updateListSelection2(listId) {
  updateListSelection(listSwitcher, listId);
}
function selectList(listId) {
  if (!listId) {
    return;
  }
  updateListSelection2(listId);
  if (listId === playlistState?.currentListId) {
    return;
  }
  setStatus("\u041F\u0435\u0440\u0435\u043A\u043B\u044E\u0447\u0430\u044E \u0441\u043F\u0438\u0441\u043E\u043A...", "info");
  sendMessage("playlist:setCurrentList", { listId }).then((state) => {
    if (state) renderState(state);
  }).catch((err) => {
    console.error(err);
    setStatus("\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043F\u0435\u0440\u0435\u043A\u043B\u044E\u0447\u0438\u0442\u044C \u0441\u043F\u0438\u0441\u043E\u043A", "error", 3e3);
  });
}
function renderState(state) {
  playlistState = state || {};
  moveMenu.hide();
  renderLists(playlistState);
  const queueState = playlistState?.currentQueue || {
    id: playlistState?.currentListId,
    name: getListName(playlistState?.currentListId) || "\u041E\u0447\u0435\u0440\u0435\u0434\u044C",
    freeze: false,
    queue: [],
    currentIndex: null
  };
  queueController.render(queueState, playlistState);
  historyController.render(playlistState);
  playbackController.syncState(playlistState);
  collectionAvailabilityController.updateAvailability();
  popupSyncController.scheduleRefresh();
}
async function refreshState() {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const state = await sendMessage("playlist:getState");
      renderState(state || {});
      return;
    } catch (err) {
      if (isRecoverableRuntimeError(err)) {
        if (attempt === 0) {
          await delay(120);
          continue;
        }
        return;
      }
      console.error("Failed to refresh state", err);
      return;
    }
  }
}
function setLoading(button, isLoading) {
  if (!button) return;
  button.disabled = Boolean(isLoading);
  if (isLoading) {
    button.dataset.loading = "1";
  } else {
    button.removeAttribute("data-loading");
  }
}
