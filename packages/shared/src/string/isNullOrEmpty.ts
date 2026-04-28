/**
 * Checks if a value is null, undefined, empty string, empty array, or empty object
 * @param value - The value to check
 * @returns true if the value is considered empty, false otherwise
 */
export function isNullOrEmpty(value: unknown): boolean {
  if (value === null || value === undefined) {
    return true;
  }

  if (typeof value === "string") {
    return value.trim() === "";
  }

  if (Array.isArray(value)) {
    return value.length === 0;
  }

  if (typeof value === "object") {
    return Object.keys(value).length === 0;
  }

  return false;
}
