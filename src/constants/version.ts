/**
 * @file version.ts
 * @description Canonical system version and standardized User-Agent headers.
 */

/**
 * Current system version of DNS Worker (x.y.z).
 * Synchronized with package.json.
 */
export const APP_VERSION = '1.2.0';

/**
 * Resolves the real system version string (x.y.z).
 * Evaluates process.env.npm_package_version when running under npm/Node.js,
 * falling back to the canonical APP_VERSION.
 *
 * @returns Semantic version string (e.g. "1.2.0").
 */
export function getSystemVersion(): string {
  if (typeof process !== 'undefined' && process.env?.npm_package_version) {
    return process.env.npm_package_version;
  }
  return APP_VERSION;
}

/**
 * Standard User-Agent header for upstream DNS resolution (DoH / HTTP/2 / fetch).
 * Format: "DNS-Worker/x.y.z"
 *
 * @returns Formatted User-Agent string.
 */
export function getAppUserAgent(): string {
  return `DNS-Worker/${getSystemVersion()}`;
}

/**
 * Standard User-Agent header for external filter list fetching.
 * Format: "DNS-Worker/x.y.z (+https://github.com/Obein/DNS-Worker)"
 *
 * @returns Formatted User-Agent string.
 */
export function getListFetcherUserAgent(): string {
  return `DNS-Worker/${getSystemVersion()} (+https://github.com/Obein/DNS-Worker)`;
}

export const APP_USER_AGENT = `DNS-Worker/${APP_VERSION}`;
export const LIST_FETCHER_USER_AGENT = `DNS-Worker/${APP_VERSION} (+https://github.com/Obein/DNS-Worker)`;
