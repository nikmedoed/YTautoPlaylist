// State utility helpers. Contains cloning used by persistence and serialization.
export function deepClone(value) {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value !== "object") {
    return value;
  }
  return JSON.parse(JSON.stringify(value));
}
