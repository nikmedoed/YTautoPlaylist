// Add-result messages. Normalizes add responses and builds shared popup/content status text.
export function normalizeAddResponse(response) {
  if (!response || typeof response !== "object") {
    return { state: null, requested: null, missing: 0, added: 0 };
  }

  const state =
    response.state && typeof response.state === "object"
      ? response.state
      : response;
  const requested =
    Number.isInteger(response.requested) && response.requested >= 0
      ? response.requested
      : null;
  const missing =
    Number.isInteger(response.missing) && response.missing > 0
      ? response.missing
      : 0;
  const added =
    Number.isInteger(response.added) && response.added >= 0
      ? response.added
      : 0;

  return { state, requested, missing, added };
}

export function formatAddResultMessage({
  added = 0,
  requested = null,
  missing = 0,
  scopeLabel = "",
  alreadyMessage = "",
} = {}) {
  const addedCount = Number.isInteger(added) && added > 0 ? added : 0;
  const totalRequested =
    Number.isInteger(requested) && requested >= 0 ? requested : null;
  const missingCount = Number.isInteger(missing) && missing > 0 ? missing : 0;
  const duplicates =
    totalRequested !== null
      ? Math.max(0, totalRequested - missingCount - addedCount)
      : null;

  const fragments = [];
  if (addedCount > 0) {
    let message = `Добавлено ${addedCount} видео`;
    if (duplicates && duplicates > 0) {
      message += ` (ещё ${duplicates} видео уже были)`;
    } else if (totalRequested !== null && totalRequested !== addedCount) {
      message += ` из ${totalRequested}`;
    }
    fragments.push(message);
  } else if (duplicates && duplicates > 0) {
    if (alreadyMessage) {
      fragments.push(alreadyMessage);
    } else if (scopeLabel) {
      fragments.push(`Все ${scopeLabel} уже в списке`);
    } else if (totalRequested !== null && totalRequested > 0) {
      fragments.push(`Все ${totalRequested} видео уже в списке`);
    } else {
      fragments.push("Все видео уже в списке");
    }
  } else if (totalRequested === 0) {
    fragments.push("Видео не найдены");
  } else if (scopeLabel) {
    fragments.push(`Не удалось добавить ${scopeLabel}`);
  } else {
    fragments.push("Видео не добавлены");
  }

  if (missingCount > 0) {
    fragments.push(`Не удалось получить данные для ${missingCount} видео`);
  }

  return {
    message: fragments.join(". "),
    kind: addedCount > 0 ? "success" : missingCount > 0 ? "error" : "info",
  };
}
