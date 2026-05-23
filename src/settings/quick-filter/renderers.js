// Quick-filter renderers. Displays rule previews, chips, and selectable filter targets.
export function renderSelectedTags({ container, onRemove, selectedTags }) {
  container.innerHTML = "";
  if (!selectedTags.size) {
    const empty = document.createElement("p");
    empty.className = "quick-filter-empty";
    empty.textContent = "Теги не выбраны";
    container.appendChild(empty);
    return;
  }
  selectedTags.forEach((tag) => {
    const tagEl = document.createElement("span");
    tagEl.className = "tag is-info is-light";
    tagEl.appendChild(document.createTextNode(tag));
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "delete is-small";
    removeBtn.setAttribute("aria-label", `Удалить тег ${tag}`);
    removeBtn.addEventListener("click", () => onRemove(tag));
    tagEl.appendChild(removeBtn);
    container.appendChild(tagEl);
  });
}

export function renderSelectedPlaylists({
  container,
  onRemove,
  playlistOptions,
  refreshPlaylistSelectOptions,
  selectedPlaylists,
}) {
  container.innerHTML = "";
  if (!selectedPlaylists.size) {
    const empty = document.createElement("p");
    empty.className = "quick-filter-empty";
    empty.textContent = "Плейлисты не выбраны";
    container.appendChild(empty);
    refreshPlaylistSelectOptions();
    return;
  }
  selectedPlaylists.forEach((id) => {
    const playlistInfo = playlistOptions.get(id) || { id };
    const card = document.createElement("div");
    card.className = "quick-filter-playlist-card";
    const link = document.createElement("a");
    link.className = "quick-filter-playlist-link";
    link.textContent = playlistInfo.title || playlistInfo.id || id;
    link.href = `https://www.youtube.com/playlist?list=${id}`;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    card.appendChild(link);
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "button is-light quick-filter-playlist-remove";
    removeBtn.title = "Удалить плейлист из фильтра";
    removeBtn.setAttribute(
      "aria-label",
      `Удалить плейлист ${playlistInfo.title || id}`
    );
    removeBtn.innerHTML =
      '<span class="icon"><svg width="1.25em" height="1.25em"><use href="icons.svg#icon-x"></use></svg></span>';
    removeBtn.addEventListener("click", () => onRemove(id));
    card.appendChild(removeBtn);
    container.appendChild(card);
  });
  refreshPlaylistSelectOptions();
}
