// Quick-filter DOM helpers. Finds and updates builder controls and preview elements.
export function createQuickFilterDom(info) {
  const container = document.createElement("div");
  container.className = "quick-filter-controls";

  const heading = document.createElement("h4");
  heading.className = "title is-5";
  heading.textContent = "Создать фильтр";
  container.appendChild(heading);

  const lead = document.createElement("p");
  lead.className = "mb-3";
  lead.textContent =
    "Выберите данные выше или заполните поля вручную, затем создайте фильтр и сохраните изменения.";
  container.appendChild(lead);

  const titleField = document.createElement("div");
  titleField.className = "field";
  const titleLabel = document.createElement("label");
  titleLabel.className = "label";
  titleLabel.textContent = "Название";
  titleField.appendChild(titleLabel);
  const titleControl = document.createElement("div");
  titleControl.className = "control";
  const titleInput = document.createElement("input");
  titleInput.type = "text";
  titleInput.className = "input";
  titleInput.placeholder = "Подстрока в названии";
  titleControl.appendChild(titleInput);
  titleField.appendChild(titleControl);
  container.appendChild(titleField);

  const tagsField = document.createElement("div");
  tagsField.className = "field";
  const tagsLabel = document.createElement("label");
  tagsLabel.className = "label";
  tagsLabel.textContent = "Теги";
  tagsField.appendChild(tagsLabel);

  const tagsControl = document.createElement("div");
  tagsControl.className = "field has-addons mt-2";
  const tagInputControl = document.createElement("div");
  tagInputControl.className = "control";
  const customTagInput = document.createElement("input");
  customTagInput.type = "text";
  customTagInput.className = "input quick-filter-tag-input";
  customTagInput.placeholder = "Добавить тег";
  tagInputControl.appendChild(customTagInput);
  tagsControl.appendChild(tagInputControl);
  const tagBtnControl = document.createElement("div");
  tagBtnControl.className = "control";
  const customTagBtn = document.createElement("button");
  customTagBtn.type = "button";
  customTagBtn.className = "button is-light quick-filter-tag-add";
  customTagBtn.textContent = "Добавить";
  tagBtnControl.appendChild(customTagBtn);
  tagsControl.appendChild(tagBtnControl);
  tagsField.appendChild(tagsControl);

  const selectedTagsContainer = document.createElement("div");
  selectedTagsContainer.className = "quick-filter-selected-tags";
  tagsField.appendChild(selectedTagsContainer);
  container.appendChild(tagsField);

  const durationField = document.createElement("div");
  durationField.className = "field";
  const durationLabel = document.createElement("label");
  durationLabel.className = "label";
  durationLabel.textContent = "Длительность";
  durationField.appendChild(durationLabel);

  const durationInputs = document.createElement("div");
  durationInputs.className = "field has-addons";
  const minControl = document.createElement("div");
  minControl.className = "control";
  const minInput = document.createElement("input");
  minInput.type = "time";
  minInput.className = "input from";
  minInput.placeholder = "От";
  minControl.appendChild(minInput);
  durationInputs.appendChild(minControl);
  const dashControl = document.createElement("div");
  dashControl.className = "control";
  const dash = document.createElement("span");
  dash.className = "button is-static";
  dash.textContent = "—";
  dashControl.appendChild(dash);
  durationInputs.appendChild(dashControl);
  const maxControl = document.createElement("div");
  maxControl.className = "control";
  const maxInput = document.createElement("input");
  maxInput.type = "time";
  maxInput.className = "input to";
  maxInput.placeholder = "До";
  maxControl.appendChild(maxInput);
  durationInputs.appendChild(maxControl);
  durationField.appendChild(durationInputs);
  container.appendChild(durationField);

  const playlistField = document.createElement("div");
  playlistField.className = "field";
  const playlistLabel = document.createElement("label");
  playlistLabel.className = "label";
  playlistLabel.textContent = "Плейлисты канала";
  playlistField.appendChild(playlistLabel);

  const playlistSelectedContainer = document.createElement("div");
  playlistSelectedContainer.className =
    "quick-filter-selected-playlists";
  playlistField.appendChild(playlistSelectedContainer);

  const playlistStatus = document.createElement("p");
  playlistStatus.className = "help quick-filter-playlist-status";
  playlistField.appendChild(playlistStatus);

  const playlistPicker = document.createElement("div");
  playlistPicker.className =
    "field has-addons quick-filter-playlist-picker";
  const playlistSelectControl = document.createElement("div");
  playlistSelectControl.className = "control is-expanded";
  const playlistSelectWrapper = document.createElement("div");
  playlistSelectWrapper.className = "select is-fullwidth";
  const playlistSelect = document.createElement("select");
  playlistSelectWrapper.appendChild(playlistSelect);
  playlistSelectControl.appendChild(playlistSelectWrapper);
  playlistPicker.appendChild(playlistSelectControl);

  const playlistAddControl = document.createElement("div");
  playlistAddControl.className = "control";
  const playlistAddBtn = document.createElement("button");
  playlistAddBtn.type = "button";
  playlistAddBtn.className =
    "button is-info is-light quick-filter-playlist-add";
  playlistAddBtn.disabled = true;
  playlistAddBtn.title = "Нет доступных плейлистов";
  playlistAddBtn.setAttribute("aria-label", "Добавить плейлист");
  playlistAddBtn.innerHTML =
    '<span class="icon"><svg width="1.25em" height="1.25em"><use href="icons.svg#icon-plus"></use></svg></span>';
  playlistAddControl.appendChild(playlistAddBtn);
  playlistPicker.appendChild(playlistAddControl);

  playlistField.appendChild(playlistPicker);

  playlistField.style.display = "none";
  container.appendChild(playlistField);

  const actions = document.createElement("div");
  actions.className = "quick-filter-actions";
  const channelBtn = document.createElement("button");
  channelBtn.type = "button";
  channelBtn.className = "button is-link";
  channelBtn.textContent = "Создать для канала";
  if (!info.channelId) {
    channelBtn.disabled = true;
    channelBtn.title = "Нет ID канала";
  }
  const globalBtn = document.createElement("button");
  globalBtn.type = "button";
  globalBtn.className = "button is-link is-light";
  globalBtn.textContent = "Создать глобально";
  actions.appendChild(channelBtn);
  actions.appendChild(globalBtn);
  container.appendChild(actions);

  const message = document.createElement("p");
  message.className = "quick-filter-message";
  container.appendChild(message);


  return {
    container,
    titleInput,
    customTagInput,
    customTagBtn,
    selectedTagsContainer,
    minInput,
    maxInput,
    playlistField,
    playlistSelectedContainer,
    playlistStatus,
    playlistSelect,
    playlistAddBtn,
    channelBtn,
    globalBtn,
    message,
  };
}
