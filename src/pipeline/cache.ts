import { Env, ProfileSettings, Rule } from "../types";
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

/**
 * 通过 Cloudflare Zone Cache Purge API 全球按 Tag 主动失效缓存。
 * 需配置 CF_ZONE_ID 与 CF_PURGE_TOKEN (具备 Zone -> Cache Purge 权限)。
 * 若未配置或调用失败，仅记录日志，不阻断主业务流程。
 */
async function purgeTags(env: Env, tags: string[]): Promise<void> {
  try {
    const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${env.CF_ZONE_ID}/purge_cache`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.CF_PURGE_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ tags }),
    });
    if (!res.ok) {
      const errorText = await res.text();
      console.error(`[Cache] Global cache purge failed (HTTP ${res.status}):`, errorText);
    }
  } catch (e: any) {
    console.error("[Cache] Global cache purge error:", e?.message || e);
  }
}

export const pipelineCache = {
  /**
   * 清理指定 Profile 的各级缓存。
   * 包含 L1 内存缓存、L2 本地数据中心 Cache API，以及 (若配置了 env) L2 全球边缘节点 Cache-Tag 失效。
   *
   * 签名支持多种重载形式，确保向后完全兼容：
   * - clear(profileId)
   * - clear(profileId, clearBloom)
   * - clear(profileId, env)
   * - clear(profileId, clearBloom, env)
   * - clear(profileId, env, clearBloom)
   */
  async clear(
    profileId: string,
    clearBloomOrEnv: boolean | Env = true,
    envOrClearBloom?: Env | boolean
  ): Promise<void> {
    let clearBloom = true;
    let targetEnv: Env | undefined;

    if (typeof clearBloomOrEnv === "boolean") {
      clearBloom = clearBloomOrEnv;
      if (envOrClearBloom && typeof envOrClearBloom === "object") {
        targetEnv = envOrClearBloom as Env;
      }
    } else if (clearBloomOrEnv && typeof clearBloomOrEnv === "object") {
      targetEnv = clearBloomOrEnv as Env;
      if (typeof envOrClearBloom === "boolean") {
        clearBloom = envOrClearBloom;
      }
    }

    // 清理 L1 (内存)
    configCache.delete(profileId);
    if (clearBloom) {
      bloomMemoryMap.delete(profileId);
    }
    profileKeyMemoryMap.clear();
    for (const key of dnsCache.keys()) {
      if (key.startsWith(`${profileId}:`)) {
        dnsCache.delete(key);
      }
    }
    
    // 清理 L2 (本地数据中心 Cache API)
    try {
      if (typeof caches !== "undefined" && caches && (caches as any).default) {
        const cache = (caches as any).default;
        const tasks: Promise<any>[] = [
          cacheUtils.delete(cache, `profile_v6:${profileId}`)
        ];
        if (clearBloom) {
          tasks.push(cache.delete(`https://obex.local/bloom-bin/${profileId}`));
        }
        await Promise.all(tasks);
      }
    } catch (e) {
      console.error("Failed to clear cache API:", e);
    }

    // 清理 L2 全球边缘节点 (Cloudflare Zone Cache Purge by Tag)
    if (targetEnv && targetEnv.CF_ZONE_ID && targetEnv.CF_PURGE_TOKEN) {
      const tags = [`profile-${profileId}`];
      if (clearBloom) {
        tags.push(`bloom-${profileId}`);
      }
      await purgeTags(targetEnv, tags);
    }
  }
};
