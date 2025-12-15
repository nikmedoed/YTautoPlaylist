import { createVideoItem } from "../lib/videoItem.js";
import { buildDetailParts } from "../lib/detailParts.js";

const MODE_CONFIG = {
  latest: {
    limit: 1,
    source: (state) => (Array.isArray(state?.history) ? state.history : []),
    emptyText: "Истории пока нет",
    restore: "history",
  },
  recent: {
    limit: 10,
    source: (state) => (Array.isArray(state?.history) ? state.history : []),
    emptyText: "Истории пока нет",
    restore: "history",
  },
  deleted: {
    limit: 10,
    source: (state) =>
      Array.isArray(state?.deletedHistory) ? state.deletedHistory : [],
    emptyText: "Удалённых пока нет",
    restore: "deleted",
  },
};

export function createHistoryController({
  historyList,
  historyEmpty,
  fallbackThumbnail,
  getListName = () => "",
  setStatus = () => {},
  hideMoveMenu = () => {},
  sendMessage,
  onStateChange = () => {},
  modeButtons = [],
}) {
  if (!historyList || typeof sendMessage !== "function") {
    return { render() {} };
  }

  const buttons = Array.isArray(modeButtons) ? modeButtons.filter(Boolean) : [];
  let currentMode = "latest";
  let lastState = null;

  if (historyList) {
    historyList.setAttribute("role", "tabpanel");
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
    if (historyList && activeId) {
      historyList.setAttribute("aria-labelledby", activeId);
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
    historyList.textContent = "";
    const modeConfig = MODE_CONFIG[currentMode] || MODE_CONFIG.latest;
    const items = modeConfig.source(state);
    const limit = modeConfig.limit;
    let rendered = 0;

    if (!items.length) {
      if (historyEmpty) {
        historyEmpty.textContent = modeConfig.emptyText;
        historyEmpty.hidden = false;
      }
      return;
    }
    if (historyEmpty) {
      historyEmpty.textContent = modeConfig.emptyText;
      historyEmpty.hidden = true;
    }
    items.forEach((entry, index) => {
      if (typeof limit === "number" && rendered >= limit) {
        return;
      }
      const dataset = { id: entry.id, position: index };

      const detailParts = buildDetailParts(entry, {
        listIdKey: "listId",
        getListName,
      });

      const isDeletedMode = modeConfig.restore === "deleted";
      const restoreAction = isDeletedMode ? "restore-deleted" : "restore";
      const restoreTitle = isDeletedMode
        ? "Восстановить в список"
        : "Вернуть в очередь";

      const { element } = createVideoItem(entry, {
        tag: "li",
        classes: ["video-item--static"],
        dataset,
        thumbnail: { fallback: fallbackThumbnail },
        details: detailParts,
        actions: [
          {
            className: "icon-button history-restore",
            textContent: "↺",
            title: restoreTitle,
            dataset: { action: restoreAction },
          },
        ],
      });

      historyList.appendChild(element);
      rendered += 1;
    });

    if (rendered === 0 && historyEmpty) {
      historyEmpty.hidden = false;
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
      setStatus("Восстанавливаю видео...", "info");
      hideMoveMenu();
      sendMessage("playlist:restoreDeleted", { position })
        .then((state) => {
          if (state) onStateChange(state);
        })
        .catch((err) => {
          console.error(err);
          setStatus("Не удалось восстановить видео", "error", 3000);
        });
      return;
    }
    setStatus("Возвращаю видео...", "info");
    hideMoveMenu();
    sendMessage("playlist:playPrevious", { position, placement: "beforeCurrent" })
      .then((state) => {
        if (state) onStateChange(state);
      })
      .catch((err) => {
        console.error(err);
        setStatus("Не удалось вернуть видео", "error", 3000);
      });
  }

  historyList.addEventListener("click", handleHistoryClick);

  return {
    render: renderHistory,
  };
}
