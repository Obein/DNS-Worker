import { cacheUtils } from "./cache";

export interface GeoIP {
  country: string;
  country_code: string;
  city?: string;
  isp?: string;
}

// In-memory cache fallback (expires after 14 days)
const memoryCache = new Map<string, { data: GeoIP; expiresAt: number }>();
const MEMORY_CACHE_TTL = 14 * 24 * 60 * 60 * 1000; // 14 days

export async function fetchGeoIP(ip: string): Promise<GeoIP | null> {
  const cacheKey = `geoip:${ip}`;
  const now = Date.now();

  // Try In-memory Cache first (fastest, works in all environments)
  const memCached = memoryCache.get(cacheKey);
  if (memCached) {
    if (now < memCached.expiresAt) {
      return memCached.data;
    } else {
      memoryCache.delete(cacheKey); // Expired
    }
  }

  // Try Cloudflare Cache API (if available and enabled on custom domains)
  let cache: any = null;
  if (typeof caches !== "undefined" && (caches as any).default) {
    cache = (caches as any).default;
  }

  if (cache) {
    try {
      const cached = await cacheUtils.get<GeoIP>(cache, cacheKey);
      if (cached) {
        // Cache in memory for subsequent super-fast lookups
        memoryCache.set(cacheKey, { data: cached, expiresAt: now + MEMORY_CACHE_TTL });
        return cached;
      }
    } catch (err) {
      console.warn("Cloudflare Cache API read error, falling back to memory/network:", err);
    }
  }

  // Fetch from public API
  try {
    const response = await fetch(`http://ip-api.com/json/${ip}?fields=status,country,countryCode,city,isp`);
    const data = await response.json() as any;

    if (data.status === 'success') {
      const geo: GeoIP = {
        country: data.country,
        country_code: data.countryCode,
        city: data.city,
        isp: data.isp
      };

      // Store in memory cache (evict first entry if size exceeds 1000 to prevent leaks)
      if (memoryCache.size >= 1000) {
        const firstKey = memoryCache.keys().next().value;
        if (firstKey !== undefined) {
          memoryCache.delete(firstKey);
        }
      }
      memoryCache.set(cacheKey, { data: geo, expiresAt: now + MEMORY_CACHE_TTL });

      // Store in Cloudflare Cache API
      if (cache) {
        try {
          await cacheUtils.set(cache, cacheKey, geo, 86400 * 14);
        } catch (err) {
          console.warn("Cloudflare Cache API write error:", err);
        }
      }
      return geo;
    }
  } catch (e) {
    console.error("GeoIP Fetch Error:", e);
  }

  return null;
}
