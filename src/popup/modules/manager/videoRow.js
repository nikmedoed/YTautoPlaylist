// Manager video-row renderer. Builds one detailed list row with thumbnail, metadata, progress, selection, and action controls.
import { getProgressPercent } from "../../../progress.js";
import { buildDetailParts } from "../../lib/detailParts.js";
import { createVideoItem } from "../../lib/videoItem.js";

// Builds a manager detail row with playback state, selection controls, drag handle, and row actions.
export function createManagerVideoRow({
  video,
  index,
  listId,
  frozen = false,
  fallbackThumbnail,
  videoProgress,
}) {
  const row = document.createElement("li");
  row.className = "manage-list-row";
  row.dataset.id = video.id;
  row.dataset.index = String(index);
  row.dataset.listId = listId;

  const selectCell = document.createElement("div");
  selectCell.className = "manage-select";
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.dataset.videoId = video.id;
  checkbox.dataset.index = String(index);
  selectCell.appendChild(checkbox);
  row.appendChild(selectCell);

  const dataset = { id: video.id, index };
  if (listId != null) {
    dataset.listId = listId;
  }

  const removeDataset = { action: "remove", videoId: video.id };
  const moveDataset = { action: "move", videoId: video.id };
  const postponeDataset = { action: "postpone", videoId: video.id };
  const quickFilterDataset = { action: "quickFilter", videoId: video.id };
  if (listId != null) {
    removeDataset.listId = listId;
    moveDataset.listId = listId;
    postponeDataset.listId = listId;
    quickFilterDataset.listId = listId;
  }

  const actions = [
    {
      className: "icon-button video-quick-filter",
      textContent: "⚡",
      title: "Создать фильтр для видео",
      dataset: quickFilterDataset,
    },
    {
      className: "icon-button video-remove",
      textContent: "✕",
      title: "Удалить из списка",
      dataset: removeDataset,
    },
    {
      className: "icon-button video-move",
      textContent: "⇄",
      title: "Перенести в другой список",
      dataset: moveDataset,
    },
  ];
  if (!frozen) {
    actions.splice(1, 0, {
      className: "icon-button video-postpone",
      textContent: "⤵",
      title: "Отложить в конец списка",
      dataset: postponeDataset,
    });
  }

  const progressPercent = getProgressPercent(videoProgress, video.id);
  const { element: card } = createVideoItem(video, {
    tag: "div",
    classes: [
      "manage-video-item",
      !frozen ? "video-item--has-postpone" : null,
    ],
    dataset,
    draggable: true,
    handle: {
      draggable: true,
      title: "Перетащить",
      ariaLabel: "Перетащить",
      preventClickDefault: true,
      tabIndex: -1,
    },
    thumbnail: { fallback: fallbackThumbnail },
    details: buildDetailParts(video),
    actions,
    progress: progressPercent,
  });

  row.appendChild(card);
  return row;
}
