// Page-actions DOM helpers. Contains host lookup, button state helpers, and small view utilities.
const DEFAULT_TOGGLE_TITLE = "YTautoPlaylist";

function getRuntimeIconUrl() {
  if (typeof chrome !== "undefined" && chrome?.runtime?.getURL) {
    try {
      return chrome.runtime.getURL("icon/icon.png");
    } catch {
      return "";
    }
  }
  if (typeof browser !== "undefined" && browser?.runtime?.getURL) {
    try {
      return browser.runtime.getURL("icon/icon.png");
    } catch {
      return "";
    }
  }
  return "";
}

function createToggleButton(onToggle) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "yta-page-actions__toggle";
  button.setAttribute("aria-label", DEFAULT_TOGGLE_TITLE);
  button.setAttribute("aria-expanded", "false");
  button.title = DEFAULT_TOGGLE_TITLE;
  const iconUrl = getRuntimeIconUrl();
  if (iconUrl) {
    const iconImg = document.createElement("img");
    iconImg.src = iconUrl;
    iconImg.alt = "";
    iconImg.decoding = "async";
    iconImg.loading = "lazy";
    button.appendChild(iconImg);
  } else {
    const fallback = document.createElement("span");
    fallback.className = "yta-page-actions__toggle-fallback";
    fallback.textContent = "YT";
    button.appendChild(fallback);
  }
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onToggle();
  });
  return button;
}

function createActionButton(label, handler) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "yta-page-actions__action";
  button.textContent = label;
  button.addEventListener("click", (event) => {
    event.preventDefault();
    handler();
  });
  return button;
}

function createStopButton(onCancel) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "yta-page-actions__stop";
  button.textContent = "Стоп";
  button.hidden = true;
  button.addEventListener("click", (event) => {
    event.preventDefault();
    onCancel();
  });
  return button;
}

export function setDefaultToggleLabel(toggle) {
  if (!toggle) return;
  toggle.title = DEFAULT_TOGGLE_TITLE;
  toggle.setAttribute("aria-label", DEFAULT_TOGGLE_TITLE);
}

export function setToggleLabelSuffix(toggle, text) {
  if (!toggle) return;
  toggle.title = `${DEFAULT_TOGGLE_TITLE} • ${text}`;
  toggle.setAttribute("aria-label", `${DEFAULT_TOGGLE_TITLE} — ${text}`);
}

export function createPageActionElements({
  actionDefinitions,
  onCancel,
  onFocusOut,
  onMouseEnter,
  onMouseLeave,
  onToggle,
}) {
  const container = document.createElement("div");
  container.className = "yta-page-actions";
  container.dataset.hidden = "1";
  container.dataset.expanded = "0";

  const toggle = createToggleButton(onToggle);
  const panel = document.createElement("div");
  panel.className = "yta-page-actions__panel";

  const actionsWrap = document.createElement("div");
  actionsWrap.className = "yta-page-actions__actions";
  const actionButtons = {};
  actionDefinitions.forEach(({ key, label, handler }) => {
    const button = createActionButton(label, handler);
    actionsWrap.appendChild(button);
    actionButtons[key] = button;
  });

  const info = document.createElement("div");
  info.className = "yta-page-actions__info";
  info.dataset.visible = "0";

  const status = document.createElement("div");
  status.className = "yta-page-actions__status";
  status.dataset.visible = "0";

  const stop = createStopButton(onCancel);
  panel.appendChild(actionsWrap);
  panel.appendChild(info);
  panel.appendChild(status);
  panel.appendChild(stop);

  container.appendChild(toggle);
  container.appendChild(panel);
  container.addEventListener("mouseenter", onMouseEnter);
  container.addEventListener("mouseleave", onMouseLeave);
  container.addEventListener("focusin", onMouseEnter);
  container.addEventListener("focusout", onFocusOut);

  return {
    actionButtons,
    container,
    info,
    panel,
    status,
    stop,
    toggle,
  };
}
