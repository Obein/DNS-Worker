import { cacheUtils } from "./cache";
import { isPublicInternetIP } from "./validator";

export interface GeoIP {
  country: string;
  country_code: string;
  city?: string;
  isp?: string;
  org?: string;
  region?: string;
  as?: string;
}

// In-memory cache fallback (expires after 14 days)
const memoryCache = new Map<string, { data: GeoIP; expiresAt: number }>();
const MEMORY_CACHE_TTL = 14 * 24 * 60 * 60 * 1000; // 14 days

export async function fetchGeoIP(ip: string): Promise<GeoIP | null> {
  if (!isPublicInternetIP(ip)) {
    return null;
  }

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

  const storeInCache = async (geo: GeoIP) => {
    if (memoryCache.size >= 100000) {
      const firstKey = memoryCache.keys().next().value;
      if (firstKey !== undefined) {
        memoryCache.delete(firstKey);
      }
    }
    memoryCache.set(cacheKey, { data: geo, expiresAt: now + MEMORY_CACHE_TTL });

    if (cache) {
      try {
        await cacheUtils.set(cache, cacheKey, geo, 86400 * 14);
      } catch (err) {
        console.warn("Cloudflare Cache API write error:", err);
      }
    }
  };

  // 1. Primary provider: ip-api.com
  try {
    const response = await fetch(
      `http://ip-api.com/json/${ip}?fields=status,country,countryCode,regionName,city,isp,org,as`,
      {
        cf: {
          cacheTtlByStatus: {
            "200-299": 86400 * 14, // 14 days
            "400-499": 5,
            "500-599": 0,
          },
          cacheEverything: true,
        },
      }
    );
    if (response.ok) {
      const data = (await response.json()) as any;
      if (data.status === "success") {
        const geo: GeoIP = {
          country: data.country,
          country_code: data.countryCode,
          region: data.regionName,
          city: data.city,
          isp: data.isp,
          org: data.org,
          as: data.as,
        };
        await storeInCache(geo);
        return geo;
      }
    }
  } catch {
    // Fall through to fallback provider
  }

  // 2. Secondary fallback provider: ipwho.is (HTTPS, no auth required)
  try {
    const response2 = await fetch(`https://ipwho.is/${ip}`);
    if (response2.ok) {
      const data2 = (await response2.json()) as any;
      if (data2.success) {
        const geo: GeoIP = {
          country: data2.country,
          country_code: data2.country_code,
          region: data2.region,
          city: data2.city,
          isp: data2.connection?.isp,
          org: data2.connection?.org,
          as: data2.connection?.asn
            ? `AS${data2.connection.asn} ${data2.connection?.org || ""}`.trim()
            : undefined,
        };
        await storeInCache(geo);
        return geo;
      }
    }
  } catch (e2) {
    console.error("GeoIP Fetch Error:", e2);
  }

  return null;
}
