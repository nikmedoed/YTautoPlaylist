const DEFAULT_PADDING = 12;
const DEFAULT_OFFSET = 6;

function applyDataset(target, dataset) {
  if (!dataset) return;
  for (const [key, value] of Object.entries(dataset)) {
    if (value == null) continue;
    target.dataset[key] = String(value);
  }
}

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

export function createMoveMenu({
  document: doc = globalThis.document,
  headerText = "Перенести в:",
  emptyMessage = "Нет других списков",
  cancelLabel = "Отмена",
  emptyCancelLabel = "Закрыть",
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
  shouldIgnoreClick,
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
    const normalized = Array.isArray(rawOptions)
      ? rawOptions
          .map((option) => {
            if (!option) return null;
            if (typeof option === "string") {
              return { id: option, label: option };
            }
            if (typeof option.id !== "string") return null;
            const label = option.label || option.name;
            if (typeof label !== "string" || !label.trim()) return null;
            return {
              id: option.id,
              label: label,
              dataset: option.dataset,
              attrs: option.attrs,
            };
          })
          .filter(Boolean)
      : [];

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

  return { show, hide, destroy, get element() {
    return root;
  } };
}

function applyAttributes(target, attrs) {
  if (!attrs) return;
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null) continue;
    target.setAttribute(key, String(value));
  }
}
