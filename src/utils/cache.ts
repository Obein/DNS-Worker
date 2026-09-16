export const cacheUtils = {
  /**
   * 生成规范的缓存 URL
   */
  generateCacheUrl(key: string): string {
    return `https://obex.local/cache/${encodeURIComponent(key)}`;
  },

  async get<T>(cache: Cache | null | undefined, key: string): Promise<T | null> {
    if (!cache) return null;
    const url = this.generateCacheUrl(key);
    const response = await cache.match(url);
    if (!response) return null;
    return response.json();
  },

  async set(cache: Cache | null | undefined, key: string, data: any, ttlSeconds: number): Promise<void> {
    if (!cache) return;
    const url = this.generateCacheUrl(key);
    const response = new Response(JSON.stringify(data), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": `public, max-age=${ttlSeconds}`
      }
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
