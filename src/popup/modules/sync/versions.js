// Read-only version selection. Restore by hash so rotation cannot change the target.
export async function chooseCloudVersion(sendMessage) {
  const status = await sendMessage("sync:getStatus", { refreshRemote: true });
  if (status?.drive?.lastError && !status.drive.remoteAvailable) {
    throw new Error(status.drive.lastError);
  }
  const versions = status?.drive?.playlistBackups || [];
  const dialog = document.createElement("dialog");
  dialog.style.cssText = "max-width:90vw;width:640px;max-height:80vh;overflow:auto;padding:24px;color:inherit;background:var(--bg-color,#202124);border:1px solid #777;border-radius:12px";
  const title = document.createElement("h2");
  title.textContent = "Сохранённые версии списков";
  dialog.append(title);
  const description = document.createElement("p");
  description.textContent = versions.length
    ? "Выберите версию. Восстановление заменит списки на этом устройстве и в облаке."
    : "В облаке нет сохранённых версий.";
  dialog.append(description);
  return new Promise((resolve) => {
    let selected = null;
    versions.forEach((version) => {
      const button = document.createElement("button");
      button.type = "button";
      button.style.cssText = "display:block;width:100%;text-align:left;margin:8px 0;padding:12px;white-space:normal";
      button.textContent = `${new Date(version.updatedAt).toLocaleString("ru-RU")} · списков: ${version.listCount} · видео: ${version.videoCount} · ${version.deviceId || "устройство неизвестно"}`;
      button.addEventListener("click", () => {
        if (!window.confirm(`Восстановить версию от ${new Date(version.updatedAt).toLocaleString("ru-RU")}?`)) return;
        selected = version.hash;
        dialog.close();
      });
      dialog.append(button);
    });
    const close = document.createElement("button");
    close.textContent = "Закрыть";
    close.addEventListener("click", () => dialog.close());
    dialog.append(close);
    dialog.addEventListener("close", () => {
      dialog.remove();
      resolve(selected);
    }, { once: true });
    document.body.append(dialog);
    dialog.showModal();
  });
}
