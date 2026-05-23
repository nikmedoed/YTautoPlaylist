// Inline queue move menu. Builds the list picker used to move queue entries between extension lists.
import {
  DEFAULT_LIST_ID,
  inlinePlaylistState,
  sendMessage,
} from "../core/base.js";

const inlineMoveMenu = {
  container: null,
  buttons: null,
  message: null,
  videoId: null,
  listId: null,
  anchor: null,
  visible: false,
};

let inlineMoveMenuContext = {
  updateInlinePlaylistState: null,
};

export function configureInlineMoveMenu(context = {}) {
  inlineMoveMenuContext = {
    updateInlinePlaylistState:
      typeof context.updateInlinePlaylistState === "function"
        ? context.updateInlinePlaylistState
        : null,
  };
}

function ensureInlineMoveMenuElements() {
  if (
    inlineMoveMenu.container &&
    inlineMoveMenu.buttons &&
    inlineMoveMenu.message
  ) {
    return inlineMoveMenu;
  }
  const container = document.createElement("div");
  container.className = "yta-inline-move-menu";
  container.dataset.visible = "0";

  const message = document.createElement("div");
  message.className = "yta-inline-move-menu__message";
  message.textContent = "Перенести в список:";

  const buttons = document.createElement("div");
  buttons.className = "yta-inline-move-menu__buttons";
  buttons.dataset.empty = "1";
  buttons.addEventListener("click", handleInlineMoveMenuClick);

  container.append(message, buttons);
  document.body.appendChild(container);

  inlineMoveMenu.container = container;
  inlineMoveMenu.message = message;
  inlineMoveMenu.buttons = buttons;
  return inlineMoveMenu;
}

function removeInlineMoveMenuListeners() {
  document.removeEventListener("pointerdown", handleInlineMoveMenuPointerDown, true);
  document.removeEventListener("keydown", handleInlineMoveMenuKeyDown, true);
  window.removeEventListener("scroll", handleInlineMoveMenuScroll, true);
  window.removeEventListener("resize", handleInlineMoveMenuScroll, true);
}

export function hideInlineMoveMenu() {
  if (!inlineMoveMenu.container) {
    inlineMoveMenu.visible = false;
    return;
  }
  if (inlineMoveMenu.visible) {
    inlineMoveMenu.container.dataset.visible = "0";
    inlineMoveMenu.container.style.visibility = "";
  }
  inlineMoveMenu.visible = false;
  inlineMoveMenu.videoId = null;
  inlineMoveMenu.listId = null;
  inlineMoveMenu.anchor = null;
  removeInlineMoveMenuListeners();
}

function handleInlineMoveMenuPointerDown(event) {
  if (!inlineMoveMenu.visible || !inlineMoveMenu.container) {
    return;
  }
  if (inlineMoveMenu.container.contains(event.target)) {
    return;
  }
  if (
    inlineMoveMenu.anchor &&
    inlineMoveMenu.anchor instanceof HTMLElement &&
    inlineMoveMenu.anchor.contains(event.target)
  ) {
    return;
  }
  hideInlineMoveMenu();
}

function handleInlineMoveMenuKeyDown(event) {
  if (event.key === "Escape") {
    hideInlineMoveMenu();
  }
}

function handleInlineMoveMenuScroll() {
  hideInlineMoveMenu();
}

function handleInlineMoveMenuClick(event) {
  const button = event.target.closest("button[data-target-list]");
  if (!button) {
    return;
  }
  event.preventDefault();
  const targetListId = button.dataset.targetList;
  if (!targetListId) {
    return;
  }
  const videoId = inlineMoveMenu.videoId;
  hideInlineMoveMenu();
  if (!videoId) {
    return;
  }
  sendMessage("playlist:moveVideo", { videoId, targetListId })
    .then((state) => {
      if (state && typeof state === "object") {
        inlineMoveMenuContext.updateInlinePlaylistState?.(state);
      }
    })
    .catch((err) => {
      console.warn("Failed to move video from inline queue", err);
    });
}

function renderInlineMoveMenuTargets(menu, listId) {
  const lists = Array.isArray(inlinePlaylistState.lists)
    ? inlinePlaylistState.lists
    : [];
  const targets = lists.filter(
    (entry) => entry && entry.id && entry.id !== listId
  );
  menu.buttons.textContent = "";
  if (!targets.length) {
    menu.buttons.dataset.empty = "1";
    menu.message.textContent = "Нет других списков";
    return;
  }
  menu.buttons.dataset.empty = "0";
  menu.message.textContent = "Перенести в список:";
  targets.forEach((list) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "yta-inline-move-menu__option";
    btn.dataset.targetList = list.id;
    const label =
      typeof list.name === "string" && list.name.trim()
        ? list.name.trim()
        : list.id === DEFAULT_LIST_ID
          ? "Список по умолчанию"
          : "Список";
    btn.textContent = label;
    menu.buttons.appendChild(btn);
  });
}

function positionInlineMoveMenu(menu, anchor) {
  menu.container.dataset.visible = "1";
  menu.container.style.visibility = "hidden";
  menu.container.style.top = "0px";
  menu.container.style.left = "0px";
  const menuRect = menu.container.getBoundingClientRect();
  const anchorRect = anchor.getBoundingClientRect();
  const margin = 12;
  const viewportWidth =
    window.innerWidth || document.documentElement.clientWidth || 0;
  const viewportHeight =
    window.innerHeight || document.documentElement.clientHeight || 0;
  let top = window.scrollY + anchorRect.bottom + margin;
  if (top + menuRect.height > window.scrollY + viewportHeight - margin) {
    top = window.scrollY + anchorRect.top - margin - menuRect.height;
  }
  let left = window.scrollX + anchorRect.left;
  if (left + menuRect.width > window.scrollX + viewportWidth - margin) {
    left = window.scrollX + viewportWidth - margin - menuRect.width;
  }
  left = Math.max(window.scrollX + margin, left);
  top = Math.max(window.scrollY + margin, top);
  menu.container.style.top = `${top}px`;
  menu.container.style.left = `${left}px`;
  menu.container.style.visibility = "";
}

function addInlineMoveMenuListeners() {
  document.addEventListener("pointerdown", handleInlineMoveMenuPointerDown, {
    capture: true,
  });
  document.addEventListener("keydown", handleInlineMoveMenuKeyDown, {
    capture: true,
  });
  window.addEventListener("scroll", handleInlineMoveMenuScroll, true);
  window.addEventListener("resize", handleInlineMoveMenuScroll, true);
}

export function showInlineMoveMenu(videoId, listId, anchor) {
  if (!videoId || !(anchor instanceof HTMLElement)) {
    return;
  }
  if (inlineMoveMenu.visible && inlineMoveMenu.anchor === anchor) {
    hideInlineMoveMenu();
    return;
  }
  hideInlineMoveMenu();
  const menu = ensureInlineMoveMenuElements();
  renderInlineMoveMenuTargets(menu, listId);
  inlineMoveMenu.videoId = videoId;
  inlineMoveMenu.listId = listId || null;
  inlineMoveMenu.anchor = anchor;
  inlineMoveMenu.visible = true;
  positionInlineMoveMenu(menu, anchor);
  addInlineMoveMenuListeners();
}
