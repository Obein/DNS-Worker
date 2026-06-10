/**
 * sw-icon-cache.js - Icon Caching Business Logic
 *
 * This file contains the single responsibility of managing the cache,
 * fetch logic, and prefetching for DuckDuckGo favicon icons, including
 * fallback to an SVG placeholder on 404 errors or network failures.
 */

const CACHE_NAME = "obex-dns-icons-v1";
const DUCKDUCKGO_ICON_PREFIX = "https://icons.duckduckgo.com/ip3/";

const ONE_DAY = 24 * 60 * 60 * 1000;
const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;

// An elegant, lightweight SVG placeholder showing a generic globe icon
const PLACEHOLDER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>`;

/**
 * Returns a new Response object containing the SVG placeholder.
 * @returns {Response}
 */
function getPlaceholderResponse() {
  return new Response(PLACEHOLDER_SVG, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, max-age=86400"
    }
  });
}

/**
 * Fetches the icon URL using CORS by default to catch 404 status codes.
 * Falls back to no-cors if CORS request fails (e.g., due to CORS policy block).
 * @param {string} url
 * @returns {Promise<Response>}
 */
async function fetchIcon(url) {
  try {
    const response = await fetch(url, { mode: "cors" });
    return response;
  } catch (err) {
    // Fallback to no-cors (returns opaque response with status: 0)
    return fetch(url, { mode: "no-cors" });
  }
}

/**
 * Checks if a given request URL matches the DuckDuckGo icon prefix.
 * @param {string} url
 * @returns {boolean}
 */
function isIconRequest(url) {
  return url.startsWith(DUCKDUCKGO_ICON_PREFIX);
}

/**
 * Helper to write a request-response pair along with a timestamp to the cache.
 * @param {Cache} cache
 * @param {Request} request
 * @param {Response} response
 */
async function putInCache(cache, request, response) {
  const timestampRequest = new Request(request.url + "?sw-cached-at");
  const timestampResponse = new Response(Date.now().toString());

  await cache.put(request, response);
  await cache.put(timestampRequest, timestampResponse);
}

/**
 * Helper to get the age of a cached request in milliseconds.
 * @param {Cache} cache
 * @param {Request} request
 * @returns {Promise<number>} age in milliseconds
 */
async function getCacheAge(cache, request) {
  try {
    const timestampRequest = new Request(request.url + "?sw-cached-at");
    const timestampResponse = await cache.match(timestampRequest);
    if (!timestampResponse) return Infinity;

    const cachedTimeText = await timestampResponse.text();
    const cachedTime = parseInt(cachedTimeText, 10);
    if (isNaN(cachedTime)) return Infinity;

    return Date.now() - cachedTime;
  } catch (err) {
    return Infinity;
  }
}

/**
 * Handles fetching of icon requests with Timed Stale-While-Revalidate policy.
 * @param {FetchEvent} event
 * @returns {Promise<Response>}
 */
async function handleIconFetch(event) {
  const cache = await caches.open(CACHE_NAME);
  const cachedResponse = await cache.match(event.request);

  if (cachedResponse) {
    const age = await getCacheAge(cache, event.request);

    // 1. Fresh cache (< 1 day): return immediately, no network request.
    if (age < ONE_DAY) {
      return cachedResponse;
    }

    // 2. Stale cache (1-7 days): return immediately, fetch/update in background.
    if (age < SEVEN_DAYS) {
      fetchIcon(event.request.url)
        .then((networkResponse) => {
          if (networkResponse.ok || networkResponse.status === 0) {
            putInCache(cache, event.request, networkResponse);
          } else if (networkResponse.status === 404) {
            // Cache the placeholder on 404 to follow cache expiration
            putInCache(cache, event.request, getPlaceholderResponse());
          }
        })
        .catch(() => {
          /* Ignore background update errors */
        });
      return cachedResponse;
    }
  }

  // 3. Expired or not cached: fetch from network.
  try {
    const networkResponse = await fetchIcon(event.request.url);
    if (networkResponse.ok || networkResponse.status === 0) {
      await putInCache(cache, event.request, networkResponse.clone());
      return networkResponse;
    } else if (networkResponse.status === 404) {
      // Cache the placeholder for 404 errors as well
      const placeholder = getPlaceholderResponse();
      await putInCache(cache, event.request, placeholder.clone());
      return placeholder;
    }
    return cachedResponse || getPlaceholderResponse();
  } catch (err) {
    // If the network request fails completely, cache and return placeholder
    const placeholder = getPlaceholderResponse();
    await putInCache(cache, event.request, placeholder.clone());
    return cachedResponse || placeholder;
  }
}

/**
 * Prefetches and caches a list of domains.
 * @param {string[]} domains
 */
function handleIconPrefetch(domains = []) {
  caches.open(CACHE_NAME).then((cache) => {
    domains.forEach((domain) => {
      const url = `${DUCKDUCKGO_ICON_PREFIX}${domain.replace(/^\*\./, "")}.ico`;
      const request = new Request(url);

      cache.match(request).then((res) => {
        if (!res) {
          fetchIcon(url)
            .then((networkResponse) => {
              if (networkResponse.ok || networkResponse.status === 0) {
                putInCache(cache, request, networkResponse);
              } else if (networkResponse.status === 404) {
                putInCache(cache, request, getPlaceholderResponse());
              }
            })
            .catch(() => {
              putInCache(cache, request, getPlaceholderResponse());
            });
        }
      });
    });
  });
}
