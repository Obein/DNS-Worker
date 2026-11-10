/**
 * Normalizes a blocklist URL for canonical indexing by trimming
 * whitespace and removing trailing slashes.
 *
 * @param url - Raw blocklist URL string.
 * @returns Canonicalized URL.
 */
export function normalizeListUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

/**
 * Normalizes an arbitrary timestamp representation into an integer Unix timestamp in seconds.
 * Adheres strictly to the project-wide Timestamp Standardization rule in GEMINI.md.
 *
 * @param val - Timestamp as number, date string, or null/undefined.
 * @returns Integer Unix timestamp in seconds, or null if missing or unparseable.
 */
export function parseUnixTimestamp(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  if (typeof val === "number") {
    return Number.isFinite(val) ? Math.floor(val) : null;
  }
  if (typeof val === "string") {
    const parsed = Date.parse(val);
    return isNaN(parsed) ? null : Math.floor(parsed / 1000);
  }
  return null;
}
