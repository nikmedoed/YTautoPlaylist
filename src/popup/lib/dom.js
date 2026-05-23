// Popup DOM helpers. Applies optional descriptor fields when rendering reusable UI nodes.
export function applyDataset(target, dataset) {
  if (!target || !dataset) return;
  for (const [key, value] of Object.entries(dataset)) {
    if (value == null) continue;
    target.dataset[key] = String(value);
  }
}

export function applyAttributes(target, attrs) {
  if (!target || !attrs) return;
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null) continue;
    target.setAttribute(key, String(value));
  }
}
