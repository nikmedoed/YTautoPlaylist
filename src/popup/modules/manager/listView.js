// Manager list-card renderer. Builds list cards, import targets, selected-state highlighting, and freeze indicators.
function makeActionButton(text, action, listId, options = {}) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = text;
  button.dataset.action = action;
  button.dataset.listId = listId;
  if (options.className) button.className = options.className;
  if (options.disabled) button.disabled = true;
  return button;
}

function createFreezeIndicator(list, defaultListId) {
  const indicator = document.createElement("span");
  indicator.className = "list-card-freeze-indicator";
  indicator.setAttribute("role", "img");

  const isFrozen = Boolean(
    list?.id && list.id !== defaultListId && list.freeze
  );

  const icon = isFrozen ? "🧊" : "🔥";
  const label = isFrozen
    ? "Список неизменяемый: видео не удаляются автоматически"
    : "Список автоматически очищается: просмотренные видео удаляются";
  const state = isFrozen ? "frozen" : "active";

  indicator.textContent = icon;
  indicator.setAttribute("data-state", state);
  indicator.setAttribute("title", label);
  indicator.setAttribute("aria-label", label);

  return indicator;
}

// Builds one manager list row with actions, freeze state, import target control, and selected marker.
function createListCard({
  list,
  activeListId,
  selectedListId,
  defaultListId,
  onOpenList,
}) {
  const item = document.createElement("li");
  item.className = "list-card";
  item.dataset.listId = list.id;
  if (list.id === selectedListId) {
    item.classList.add("active");
  }

  const main = document.createElement("div");
  main.className = "list-card-main";

  const header = document.createElement("div");
  header.className = "list-card-header";

  const title = document.createElement("div");
  title.className = "list-card-title";
  const isDefaultList = list.id === defaultListId;
  if (isDefaultList) {
    title.classList.add("list-card-title--system");
    title.title = "Системный список — редактирование недоступно";
    const lock = document.createElement("span");
    lock.className = "list-card-title-lock";
    lock.textContent = "🔒";
    lock.setAttribute("aria-hidden", "true");
    title.appendChild(lock);
  }
  const freezeIndicator = createFreezeIndicator(list, defaultListId);
  freezeIndicator.classList.add("list-card-freeze-indicator--inline");
  title.appendChild(freezeIndicator);

  const titleText = document.createElement("span");
  titleText.className = "list-card-title-text";
  titleText.textContent = list.name || "Без названия";
  title.appendChild(titleText);

  if (list.id && list.id === activeListId) {
    const activeBadge = document.createElement("span");
    activeBadge.className = "list-card-toggle list-card-toggle--active";
    activeBadge.textContent = "Смотрим";
    activeBadge.setAttribute(
      "aria-label",
      "Этот список используется для воспроизведения"
    );
    title.appendChild(activeBadge);
  } else if (list.id) {
    const activateButton = document.createElement("button");
    activateButton.type = "button";
    activateButton.className = "list-card-toggle";
    activateButton.dataset.action = "activate";
    activateButton.dataset.listId = list.id;
    activateButton.textContent = "Смотреть этот";
    activateButton.setAttribute(
      "aria-label",
      "Сделать список активным для воспроизведения"
    );
    title.appendChild(activateButton);
  }

  header.appendChild(title);
  main.appendChild(header);

  const meta = document.createElement("div");
  meta.className = "list-card-meta";
  const metaText = document.createElement("span");
  metaText.className = "list-card-meta-text";
  const metaParts = [`${list.length ?? 0} видео`];
  metaParts.push(
    list.freeze ? "Сохраняет просмотренные" : "Удаляет просмотренные"
  );
  metaText.textContent = metaParts.join(" • ");
  meta.appendChild(metaText);
  main.appendChild(meta);

  item.appendChild(main);

  const actions = document.createElement("div");
  actions.className = "list-card-actions";
  if (!isDefaultList) {
    actions.appendChild(makeActionButton("Редактировать", "edit", list.id));
  }
  actions.appendChild(makeActionButton("Экспорт", "export", list.id));
  actions.appendChild(
    makeActionButton("Создать плейлист ютуб", "createYoutubePlaylist", list.id)
  );
  if (list.id !== defaultListId) {
    actions.appendChild(
      makeActionButton("Удалить", "delete", list.id, { className: "secondary" })
    );
  }
  item.appendChild(actions);

  item.addEventListener("click", (event) => {
    if (event.target.closest("button")) return;
    onOpenList(list.id);
  });

  return item;
}

export function renderListCards({
  listsBody,
  lists,
  activeListId,
  selectedListId,
  defaultListId,
  onOpenList,
}) {
  if (!listsBody) return;
  listsBody.textContent = "";
  const safeLists = Array.isArray(lists) ? lists : [];
  safeLists.forEach((list) => {
    listsBody.appendChild(
      createListCard({
        list,
        activeListId,
        selectedListId,
        defaultListId,
        onOpenList,
      })
    );
  });
}

export function highlightSelectedList(listsBody, listId) {
  Array.from(listsBody?.querySelectorAll(".list-card") || []).forEach((item) => {
    item.classList.toggle("active", item.dataset.listId === listId);
  });
}

export function toggleImportTarget({
  importModeSelect,
  importTargetField,
  importTargetSelect,
}) {
  if (!importModeSelect || !importTargetField || !importTargetSelect) return;
  const mode = importModeSelect.value;
  const show = mode === "append" && importTargetSelect.options.length > 0;
  importTargetField.hidden = !show;
  importTargetSelect.disabled = !show;
}

export function populateImportTargets({
  importTargetSelect,
  lists,
  onToggleTarget,
}) {
  if (!importTargetSelect) return;
  importTargetSelect.textContent = "";
  const safeLists = Array.isArray(lists) ? lists : [];
  safeLists.forEach((list) => {
    const option = document.createElement("option");
    option.value = list.id;
    option.textContent = list.name;
    importTargetSelect.appendChild(option);
  });
  onToggleTarget();
}
