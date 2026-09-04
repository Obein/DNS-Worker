import { Context, ProfileSettings, Rule } from "../types";
import { ProfileModel } from "../models/profile";
import { RuleModel } from "../models/rule";
import { ProfileBloomModel } from "../models/profileBloom";
import { BloomFilter } from "../utils/bloom";
import { cacheUtils } from "../utils/cache";
import { configCache, bloomMemoryMap } from "./cache";

export const pipelineConfig = {
  async load(context: Context, track: (name: string) => void): Promise<{ settings: ProfileSettings; rules: Rule[]; bloom?: BloomFilter } | null> {
    const { profileId, env, ctx } = context;

    // 1. 检查 L1 Memory (Isolate Global)
    const inMem = bloomMemoryMap.get(profileId);
    const cachedConfig = configCache.get(profileId);
    
    const bloomMemTtl = Number(env.BLOOM_MEM_TTL) || 600000;
    const configMemTtl = 300000; // 5 minutes memory TTL for config
    if (cachedConfig && (Date.now() - (cachedConfig.timestamp || 0) < configMemTtl)) {
      track('load_config_l1_mem');
      const validBloom = (inMem && Date.now() - inMem.ts < bloomMemTtl) ? inMem.bloom : undefined;
      return { ...cachedConfig, bloom: validBloom };
    }

    // 2. 检查 L2 Cache API
    const cache = (caches as any).default;
    const profileCacheKey = `profile_v6:${profileId}`;
    const bloomInternalUrl = `https://obex.local/bloom-bin/${profileId}`;
    
    let apiCached = await cacheUtils.get<any>(cache, profileCacheKey);
    let bloom: BloomFilter | undefined;

    if (apiCached) {
      track('load_config_l2_cache');
      if (inMem && Date.now() - inMem.ts < bloomMemTtl) {
        bloom = inMem.bloom;
      } else {
        try {
          const bloomRes = await cache.match(bloomInternalUrl);
          if (bloomRes) {
            track('load_bloom_l2_cache');
            const buffer = await bloomRes.arrayBuffer();
            bloom = BloomFilter.fromUint8Array(new Uint8Array(buffer));
            bloomMemoryMap.set(profileId, { bloom, ts: Date.now() });
          }
        } catch {
          // Non-critical bloom cache read error
        }
      }
      
      // 关键修复：无论布隆过滤器是否存在，apiCached 本身都是有效的配置，绝对不能穿透回 D1！
      configCache.set(profileId, { ...apiCached, timestamp: Date.now() });
      return { ...apiCached, bloom };
    }

    // 3. 回退到 D1 (带 Fail-Open 降级保护)
    try {
      const profileModel = new ProfileModel(env.DB);
      const ruleModel = new RuleModel(env.DB);
      const bloomModel = new ProfileBloomModel(env.DB);

      const profile = await profileModel.getById(profileId);
      if (!profile) {
        if (cachedConfig) {
          console.warn(`[Config] Profile ${profileId} not in D1, using stale memory config.`);
          return { ...cachedConfig, bloom: inMem?.bloom };
        }
        return null;
      }
      
      const settings = JSON.parse(profile.settings);
      const rules = await ruleModel.getRules(profileId);
      
      // 从 D1 直接加载布隆过滤器
      try {
        const buffer = await bloomModel.getProfileBloom(profileId);
          
        if (buffer) {
          track('load_bloom_l3_d1');
          const uint8 = new Uint8Array(buffer);
          bloom = BloomFilter.fromUint8Array(uint8);

          // 写入 L2 Cache API 供下次使用
          ctx.waitUntil(cache.put(bloomInternalUrl, new Response(uint8, {
            headers: { 
              'Content-Type': 'application/octet-stream',
              'Cache-Control': 'public, max-age=3600' 
            }
          })));
        }
      } catch (e) {
        console.error("[Config] D1 Bloom loading failed:", e);
      }

      const config = { settings, rules };
      if (bloom) bloomMemoryMap.set(profileId, { bloom, ts: Date.now() });
      
      configCache.set(profileId, { ...config, timestamp: Date.now() });
      ctx.waitUntil(cacheUtils.set(cache, profileCacheKey, config, 1800));
      
      track('load_config_full_sync');
      return { ...config, bloom };
    } catch (e: any) {
      console.warn(`[Config] D1 profile fetch failed for ${profileId}:`, e?.message || e);
      
      // 容灾模式 1: Stale-While-Error (使用过期的 L1 缓存)
      if (cachedConfig) {
        console.warn(`[Config] Serving stale config from memory for profile ${profileId}`);
        return { ...cachedConfig, bloom: inMem?.bloom };
      }

      // 容灾模式 2: Emergency Safe Default Fallback
      // 当 D1 读额度耗尽且无缓存时，使用内置安全上游兜底，保证 DNS 绝不报 500 断网
      console.warn(`[Config] Serving emergency fail-open safe fallback for profile ${profileId}`);
      const failOpenUpstream = env.FAIL_OPEN_UPSTREAM || "https://freedns.controld.com/no-ads-malware-typo";
      const fallbackSettings: ProfileSettings = {
        upstream: [failOpenUpstream],
        default_policy: "ALLOW",
        log_retention_days: 0,
        ecs: { enabled: true, use_client_ip: true }
      };
      return { settings: fallbackSettings, rules: [], bloom: undefined };
    }
  }
};
