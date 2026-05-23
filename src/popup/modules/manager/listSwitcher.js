// Manager list switcher renderer. Builds and updates the select control for choosing the active list.
const VIDEO_COUNT_ICON = "🎬";

function createListOption(list, defaultListId) {
  const option = document.createElement("option");
  option.value = list.id;
  const textParts = [list.name];
  const metaLabelParts = [];
  if (list.length != null) {
    const lengthValue =
      typeof list.length === "number" ? list.length : Number(list.length);
    if (Number.isFinite(lengthValue)) {
      textParts.push(`${lengthValue} ${VIDEO_COUNT_ICON}`);
      const lengthLabel =
        lengthValue === 1 ? "1 видео" : `${lengthValue} видео`;
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
    metaLabelParts.push("без удаления");
  }
  option.textContent = textParts.join(" · ");
  const ariaLabel = metaLabelParts.length
    ? `${list.name}. ${metaLabelParts.join(", ")}`
    : list.name;
  option.title = ariaLabel;
  option.setAttribute("aria-label", ariaLabel);
  return option;
}

export function updateListSelection(listSwitcher, listId) {
  if (!listSwitcher) return;
  if (!listId) {
    if (listSwitcher.options.length) {
      listSwitcher.selectedIndex = 0;
    }
    return;
  }
  const option = Array.from(listSwitcher.options).find((item) => item.value === listId);
  if (option) {
    listSwitcher.value = listId;
  } else if (listSwitcher.options.length) {
    listSwitcher.selectedIndex = 0;
  }
}

export function renderListSwitcher({
  listSwitcher,
  state,
  defaultListId,
  requestAnimationFrameFn = requestAnimationFrame,
}) {
  if (!listSwitcher) return;
  const lists = Array.isArray(state?.lists) ? state.lists : [];
  const currentId = state?.currentListId || null;
  const hadFocus = document.activeElement === listSwitcher;
  const previousValue = listSwitcher.value;

  listSwitcher.innerHTML = "";

  if (!lists.length) {
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Нет доступных списков";
    placeholder.disabled = true;
    placeholder.selected = true;
    listSwitcher.appendChild(placeholder);
    listSwitcher.disabled = true;
    listSwitcher.value = "";
    return;
  }

  lists.forEach((list) => {
    listSwitcher.appendChild(createListOption(list, defaultListId));
  });

  listSwitcher.disabled = lists.length <= 1;

  const validIds = new Set(lists.map((list) => list.id));
  let nextValue = null;
  if (currentId && validIds.has(currentId)) {
    nextValue = currentId;
  } else if (previousValue && validIds.has(previousValue)) {
    nextValue = previousValue;
  } else {
    nextValue = lists[0]?.id || "";
  }

  updateListSelection(listSwitcher, nextValue);

  if (hadFocus) {
    requestAnimationFrameFn(() => {
      listSwitcher.focus({ preventScroll: true });
    });
  }
}
