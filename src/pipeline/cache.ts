import { ProfileSettings, Rule } from "../types";
import { BloomFilter } from "../utils/bloom";
import { cacheUtils } from "../utils/cache";

export interface ConfigCacheEntry {
  settings: ProfileSettings;
  rules: Rule[];
  timestamp: number;
}

/**
 * 高性能、零依赖的容量受限 Map (LRU 淘汰策略)。
 * 利用 JavaScript Map 保证的“按插入顺序迭代”特性，在 O(1) 复杂度内自动淘汰最旧的数据。
 */
class SizeCappedMap<K, V> extends Map<K, V> {
  constructor(private maxEntries: number) {
    super();
  }

  override set(key: K, value: V): this {
    // 若键不存在且即将超出容量，淘汰最旧的记录 (第一项)
    if (!this.has(key) && this.size >= this.maxEntries) {
      const oldestKey = this.keys().next().value;
      if (oldestKey !== undefined) {
        this.delete(oldestKey);
      }
    }
    // 重新更新插入顺序，使其作为最近活跃项移到链表末尾
    this.delete(key);
    super.set(key, value);
    return this;
  }
}

// --- L1 Memory Cache (Isolate 全局，容量硬性限制) ---
// 布隆过滤器占用较大（每个 ~2.4MB），限制最多缓存 3 个 Profile，内存硬顶为 ~7.2MB，规避 GC 抖动崩溃
export const bloomMemoryMap = new SizeCappedMap<string, { bloom: BloomFilter; ts: number }>(3);

// 基础配置体积较小，允许缓存 10 个 Profile
export const configCache = new SizeCappedMap<string, ConfigCacheEntry>(10);

// DNS 缓存限制最多 500 条记录，防止遭受海量随机子域名查询（DNS Tunnel / Random Query Attack）时导致 Isolate 内存耗尽
export const dnsCache = new SizeCappedMap<string, any>(500);

// Profile Key 到 Profile 元数据映射缓存 (L1 内存缓存，限制最多 100 个 Key)
export const profileKeyMemoryMap = new SizeCappedMap<string, { data: any; ts: number }>(100);

export const pipelineCache = {
  async clear(profileId: string) {
    // 清理 L1 (内存)
    configCache.delete(profileId);
    bloomMemoryMap.delete(profileId);
    profileKeyMemoryMap.clear();
    for (const key of dnsCache.keys()) {
      if (key.startsWith(`${profileId}:`)) {
        dnsCache.delete(key);
      }
    }
    
    // 清理 L2 (Cache API)
    try {
      const cache = (caches as any).default;
      await Promise.all([
        cacheUtils.delete(cache, `profile_v6:${profileId}`),
        cache.delete(`https://obex.local/bloom-bin/${profileId}`)
      ]);
    } catch (e) {
      console.error("Failed to clear cache API:", e);
    }
  }
};
