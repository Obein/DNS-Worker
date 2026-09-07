/**
 * sw-log-cache.ts - Log Details Caching Business Logic (TypeScript)
 *
 * This file contains the single responsibility of managing the cache,
 * fetch logic, and expiration for log detail API responses.
 */

import { putInCache } from "./sw-icon-cache.ts";

export const LOGS_CACHE_NAME = "dns-worker-logs-v1";
export const ONE_DAY = 24 * 60 * 60 * 1000;
export const SEVEN_DAYS = 7 * ONE_DAY;

/**
 * Checks if a given request URL matches the log detail API request.
 */
export function isLogDetailRequest(urlStr: string): boolean {
  try {
    const url = new URL(urlStr);
    return /^\/api\/profiles\/[^/]+\/logs\/\d+$/.test(url.pathname);
  } catch {
    return false;
  }
}

/**
 * Handles fetching of log detail requests with Cache-First policy.
 */
export async function handleLogDetailFetch(event: FetchEvent): Promise<Response> {
  const cache = await caches.open(LOGS_CACHE_NAME);
  const cachedResponse = await cache.match(event.request);

  if (cachedResponse) {
    return cachedResponse;
  }

  try {
    const networkResponse = await fetch(event.request);
    if (networkResponse.ok) {
      await putInCache(cache, event.request, networkResponse.clone());
    }
    return networkResponse;
  } catch (err) {
    return new Response(JSON.stringify({ error: "Network error fetching log details" }), {
      status: 503,
      headers: { "Content-Type": "application/json" }
    });
  }
}

/**
 * Iterates through all cached items in LOGS_CACHE_NAME and deletes any items
 * that have been cached for more than 7 days.
 */
export async function cleanExpiredLogCache(): Promise<void> {
  try {
    const cache = await caches.open(LOGS_CACHE_NAME);
    const keys = await cache.keys();
    const now = Date.now();

    const timestampKeys = keys.filter((req) => req.url.includes("?sw-cached-at"));

    for (const tsReq of timestampKeys) {
      const tsRes = await cache.match(tsReq);
      if (tsRes) {
        const cachedTimeText = await tsRes.text();
        const cachedTime = parseInt(cachedTimeText, 10);
        if (!isNaN(cachedTime) && now - cachedTime > ONE_DAY) {
          const resourceUrl = tsReq.url.split("?")[0];
          await cache.delete(new Request(resourceUrl));
          await cache.delete(tsReq);
        }
      }
    }
  } catch (err) {
    console.error("Failed to execute service worker log cache cleanup:", err);
  }
}
