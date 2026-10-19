let currentWorkerOrigin = "https://obex-dns.internal";

export const cacheUtils = {
  /**
   * Updates the canonical origin using the incoming request URL.
   * This ensures Cloudflare's Cache API (caches.default) stores and matches entries
   * against the Worker's active zone, eliminating cross-zone cache drops.
   *
   * @param origin - The HTTP/HTTPS origin string of the active request.
   */
  setOrigin(origin: string): void {
    if (origin && (origin.startsWith("http://") || origin.startsWith("https://"))) {
      currentWorkerOrigin = origin.replace(/\/+$/, "");
    }
  },

  /**
   * Generates a canonical cache URL using the active Worker origin so caches.default
   * recognizes and caches entries under the active zone.
   *
   * @param key - Cache key identifier.
   * @returns Formatted cache URL under the current worker origin.
   */
  generateCacheUrl(key: string): string {
    return `${currentWorkerOrigin}/__cache__/${encodeURIComponent(key)}`;
  },

  async get<T>(cache: Cache | null | undefined, key: string): Promise<T | null> {
    if (!cache) return null;
    const url = this.generateCacheUrl(key);
    const response = await cache.match(url);
    if (!response) return null;
    return response.json();
  },

  async set(cache: Cache | null | undefined, key: string, data: any, ttlSeconds: number, tags: string[] = []): Promise<void> {
    if (!cache) return;
    const url = this.generateCacheUrl(key);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Cache-Control": `public, max-age=${ttlSeconds}`
    };
    if (tags && tags.length > 0) {
      headers["Cache-Tag"] = tags.join(",");
    }
    const response = new Response(JSON.stringify(data), {
      headers
    });
    return cache.put(url, response);
  },

  async delete(cache: Cache | null | undefined, key: string): Promise<boolean> {
    if (!cache) return false;
    const url = this.generateCacheUrl(key);
    return cache.delete(url);
  },

  /**
   * 速率限制检查 (滑动窗口)
   */
  async isRateLimited(cache: Cache | null | undefined, key: string, limit: number, windowSec: number): Promise<boolean> {
    if (!cache) return false;
    const cacheKey = `ratelimit:${key}`;
    const current = await this.get<{ count: number, reset: number }>(cache, cacheKey);
    
    const now = Math.floor(Date.now() / 1000);
    if (!current || now > current.reset) {
      await this.set(cache, cacheKey, { count: 1, reset: now + windowSec }, windowSec);
      return false;
    }

    if (current.count >= limit) return true;

    await this.set(cache, cacheKey, { count: current.count + 1, reset: current.reset }, Math.max(1, current.reset - now));
    return false;
  }
};
