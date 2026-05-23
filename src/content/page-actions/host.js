// Page-actions host resolver. Finds the stable YouTube page area where floating add controls should mount.
export function createPageActionHostController({ pageActions }) {
  function positionPageActions(context) {
    if (!pageActions.container) return;
    pageActions.container.dataset.context = context;
    const inPlayer = context === "watch";
    const host = inPlayer
      ? document.getElementById("movie_player") || document.querySelector("#player-container")
      : null;
    if (inPlayer && host) {
      if (pageActions.container.parentElement !== host) {
        pageActions.container.remove();
        host.appendChild(pageActions.container);
      }
      pageActions.container.classList.add("yta-page-actions--player");
      observePageActionsHost(host);
    } else {
      if (pageActions.container.parentElement !== document.body) {
        pageActions.container.remove();
        document.body.appendChild(pageActions.container);
      }
      pageActions.container.classList.remove("yta-page-actions--player");
      observePageActionsHost(null);
    }
  }

  function syncPageActionsHostVisibility(host) {
    if (!pageActions.container) return;
    if (!host) {
      delete pageActions.container.dataset.controlsHidden;
      return;
    }
    const hidden = host.classList.contains("ytp-autohide");
    if (hidden) {
      pageActions.container.dataset.controlsHidden = "1";
    } else {
      delete pageActions.container.dataset.controlsHidden;
    }
  }

  function observePageActionsHost(host) {
    if (!pageActions.container) return;
    if (pageActions.host === host) {
      syncPageActionsHostVisibility(host);
      return;
    }
    if (pageActions.hostObserver) {
      pageActions.hostObserver.disconnect();
      pageActions.hostObserver = null;
    }
    pageActions.host = host || null;
    if (host) {
      const observer = new MutationObserver(() => {
        syncPageActionsHostVisibility(host);
      });
      observer.observe(host, { attributes: true, attributeFilter: ["class"] });
      pageActions.hostObserver = observer;
      syncPageActionsHostVisibility(host);
    } else {
      delete pageActions.container.dataset.controlsHidden;
    }
  }

  return {
    positionPageActions,
  };
}
