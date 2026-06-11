/**
 * sw-geoip-cache.ts - GeoIP Client Caching Service Worker Logic
 *
 * This file intercepts client-side calls to ip-api.com, caching
 * them for 14 days to stay under rate limits and optimize latency.
 */

export const GEOIP_CACHE_NAME = "obex-dns-geoip-v1";
export const IP_API_PREFIX = "ip-api.com/json/";
export const GEOIP_EXPIRATION_TIME = 14 * 24 * 60 * 60 * 1000; // 14 days

/**
 * Checks if a given request URL points to the ip-api.com endpoint.
 */
export function isGeoIPRequest(url: string): boolean {
  return url.includes(IP_API_PREFIX);
}

/**
 * Handles fetching and caching of GeoIP requests using a Cache-First strategy.
 */
export async function handleGeoIPFetch(event: FetchEvent): Promise<Response> {
  const cache = await caches.open(GEOIP_CACHE_NAME);
  const cachedResponse = await cache.match(event.request);

  if (cachedResponse) {
    const timestampRequest = new Request(event.request.url + "?sw-cached-at");
    const timestampResponse = await cache.match(timestampRequest);
    if (timestampResponse) {
      try {
        const cachedTimeText = await timestampResponse.text();
        const cachedTime = parseInt(cachedTimeText, 10);
        if (!isNaN(cachedTime) && (Date.now() - cachedTime < GEOIP_EXPIRATION_TIME)) {
          return cachedResponse;
        }
      } catch (err) {
        // Fall through to network on parsing errors
      }
    }
  }

  try {
    const networkResponse = await fetch(event.request);
    if (networkResponse.ok) {
      const timestampRequest = new Request(event.request.url + "?sw-cached-at");
      const timestampResponse = new Response(Date.now().toString());
      await cache.put(event.request, networkResponse.clone());
      await cache.put(timestampRequest, timestampResponse);
      return networkResponse;
    }
    return cachedResponse || networkResponse;
  } catch (err) {
    return cachedResponse || new Response(JSON.stringify({ status: "fail", message: "network error" }), {
      headers: { "Content-Type": "application/json" }
    });
  }
}

/**
 * Iterates through all cached items in GEOIP_CACHE_NAME and deletes any items
 * that have been cached for more than 14 days.
 */
export async function cleanExpiredGeoIPCache(): Promise<void> {
  try {
    const cache = await caches.open(GEOIP_CACHE_NAME);
    const keys = await cache.keys();
    const now = Date.now();

    const timestampKeys = keys.filter((req) => req.url.includes("?sw-cached-at"));

    for (const tsReq of timestampKeys) {
      const tsRes = await cache.match(tsReq);
      if (tsRes) {
        const cachedTimeText = await tsRes.text();
        const cachedTime = parseInt(cachedTimeText, 10);
        if (!isNaN(cachedTime) && now - cachedTime > GEOIP_EXPIRATION_TIME) {
          const resourceUrl = tsReq.url.split("?")[0];
          await cache.delete(new Request(resourceUrl));
          await cache.delete(tsReq);
        }
      }
    }
  } catch (err) {
    console.error("Failed to execute GeoIP cache cleanup:", err);
  }
}
