/**
 * Single access layer for localStorage in the renderer.
 *
 * All feature modules should go through readJSON/writeJSON instead of touching
 * localStorage directly — this keeps key names discoverable (grep for
 * `loom-` constants), centralizes quota/parse error handling, and makes the
 * storage surface auditable.
 */

/** Safely read and parse a JSON value; returns `fallback` when absent/corrupt. */
export function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** Safely serialize and write a value; returns false on quota errors. */
export function writeJSON(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function removeItem(key: string): void {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}
