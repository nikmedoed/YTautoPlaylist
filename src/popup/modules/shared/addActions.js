// Shared popup add-actions controller. Collects videos from the active tab, sends add requests, and renders result messages.
import {
  formatAddResultMessage,
  normalizeAddResponse,
} from "../../../addResultMessages.js";

// Handles popup add-current/add-visible/add-all commands and converts runtime responses into status text.
export function createAddActionsController({
  addCurrentBtn,
  addVisibleBtn,
  addAllBtn,
  addRow,
  defaultListId,
  getSelectedListId,
  renderState,
  setLoading,
  setStatus,
  sendMessage,
  updatePlaybackControls,
}) {
  let capabilitiesState = {
    canAddCurrent: false,
    canAddVisible: false,
    canAddAll: false,
    context: "unknown",
    controlling: false,
  };

  // Shared popup add command. It asks the active tab to collect ids, sends them
  // to background, then applies the returned presentation state and status text.
  async function addFromScope(scope) {
    const button =
      scope === "current"
        ? addCurrentBtn
        : scope === "visible"
        ? addVisibleBtn
        : addAllBtn;
    if (!button || button.classList.contains("hidden")) return;
    if (
      (scope === "current" && !capabilitiesState.canAddCurrent) ||
      (scope === "visible" && !capabilitiesState.canAddVisible) ||
      (scope === "page" && !capabilitiesState.canAddAll)
    ) {
      return;
    }
    setLoading(button, true);
    setStatus("Ищу видео...", "info");
    try {
      const collect = await sendMessage("collector:collect", { scope });
      if (collect?.error) {
        if (collect.error === "NOT_ALLOWED") {
          setStatus("Эта кнопка недоступна на текущей странице", "info", 3500);
        } else {
          setStatus("Не получилось собрать список", "error", 4000);
        }
        return;
      }
      const ids = Array.isArray(collect?.videoIds) ? collect.videoIds : [];
      if (collect?.aborted) {
        setStatus(
          ids.length
            ? `Сбор остановлен на ${ids.length}`
            : "Сбор остановлен",
          "info",
          3600
        );
        return;
      }
      if (!ids.length) {
        setStatus("Видео не найдены", "info");
        return;
      }
      const uniqueRequested = Array.from(new Set(ids)).length;
      const response = await sendMessage("playlist:addByIds", {
        videoIds: ids,
        listId: getSelectedListId() || defaultListId,
      });
      const { state, requested, missing, added } = normalizeAddResponse(response);
      if (!state) {
        setStatus("Не удалось обновить очередь", "error", 4000);
        return;
      }
      renderState(state);
      const totalRequested = requested ?? uniqueRequested;
      const summary = formatAddResultMessage({
        added,
        requested: totalRequested,
        missing,
        scopeLabel:
          scope === "visible"
            ? "видимые видео"
            : scope === "page"
            ? "видео на странице"
            : "",
        alreadyMessage: scope === "current" ? "Видео уже в очереди" : "",
      });
      setStatus(summary.message, summary.kind);
    } catch (err) {
      setStatus("Ошибка добавления видео", "error", 4000);
      console.error(err);
    } finally {
      setLoading(button, false);
    }
  }

  function applyControlCapabilities(caps) {
    capabilitiesState = {
      canAddCurrent: Boolean(caps?.canAddCurrent),
      canAddVisible: Boolean(caps?.canAddVisible),
      canAddAll: Boolean(caps?.canAddAll),
      context: caps?.context || "unknown",
      controlling: Boolean(caps?.controlling),
    };
    if (addCurrentBtn) {
      addCurrentBtn.classList.toggle("hidden", !capabilitiesState.canAddCurrent);
    }
    if (addVisibleBtn) {
      addVisibleBtn.classList.toggle("hidden", !capabilitiesState.canAddVisible);
    }
    if (addAllBtn) {
      addAllBtn.classList.toggle("hidden", !capabilitiesState.canAddAll);
    }
    if (addRow) {
      const visible = Array.from(addRow.querySelectorAll("button")).filter(
        (btn) => !btn.classList.contains("hidden")
      );
      addRow.classList.toggle("hidden", visible.length === 0);
    }
    updatePlaybackControls();
  }

  async function updateControlCapabilities() {
    if (!chrome?.tabs?.query) {
      applyControlCapabilities({
        canAddCurrent: false,
        canAddVisible: false,
        canAddAll: false,
        context: "extension",
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
          context: "unknown",
        });
        return;
      }
      const isYoutube = /https?:\/\/(www\.)?youtube\.com/i.test(tab.url);
      if (!isYoutube) {
        applyControlCapabilities({
          canAddCurrent: false,
          canAddVisible: false,
          canAddAll: false,
          context: "external",
        });
        return;
      }
      const response = await chrome.tabs.sendMessage(tab.id, {
        type: "collector:getCapabilities",
      });
      if (response) {
        applyControlCapabilities(response);
      } else {
        applyControlCapabilities({
          canAddCurrent: false,
          canAddVisible: false,
          canAddAll: false,
          context: "unknown",
        });
      }
    } catch {
      applyControlCapabilities({
        canAddCurrent: false,
        canAddVisible: false,
        canAddAll: false,
        context: "unknown",
      });
    }
  }

  return {
    addFromScope,
    applyControlCapabilities,
    updateControlCapabilities,
  };
}
