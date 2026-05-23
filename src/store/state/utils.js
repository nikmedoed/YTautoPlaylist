// State utility helpers. Contains list creation, cloning, id cleanup, and small schema helpers used by actions.
export function deepClone(value) {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value !== "object") {
    return value;
  }
  return JSON.parse(JSON.stringify(value));
}
