import { Context, ProfileSettings, Rule } from "../types";
import { ProfileModel } from "../models/profile";
import { BloomFilter } from "../utils/bloom";
import { cacheUtils } from "../utils/cache";
import { configCache, bloomMemoryMap } from "./cache";

const BLOOM_MEM_TTL = 600000; // 内存保留 10 分钟

export const pipelineConfig = {
  async load(context: Context, track: (name: string) => void): Promise<{ settings: ProfileSettings; rules: Rule[]; bloom?: BloomFilter } | null> {
    const { profileId, env, ctx } = context;

    // 检查 L1 Memory (Isolate Global)
    const inMem = bloomMemoryMap.get(profileId);
    const cachedConfig = configCache.get(profileId);
    
    if (cachedConfig && inMem && (Date.now() - inMem.ts < BLOOM_MEM_TTL)) {
      track('load_config_l1_mem');
      return { ...cachedConfig, bloom: inMem.bloom };
    }

    // 检查 L2 Cache API
    const cache = (caches as any).default;
    const profileCacheKey = `profile_v6:${profileId}`;
    const bloomInternalUrl = `https://obex.local/bloom-bin/${profileId}`;
    
    let apiCached = await cacheUtils.get<any>(cache, profileCacheKey);
    let bloom: BloomFilter | undefined;

    if (apiCached) {
      const bloomRes = await cache.match(bloomInternalUrl);
      if (bloomRes) {
        track('load_bloom_l2_cache');
        const buffer = await bloomRes.arrayBuffer();
        bloom = BloomFilter.fromUint8Array(new Uint8Array(buffer));
      }
      
      if (bloom) {
        bloomMemoryMap.set(profileId, { bloom, ts: Date.now() });
        configCache.set(profileId, apiCached);
        return { ...apiCached, bloom };
      }
    }

    // 回退到 D1 (配置) 和 R2 (布隆过滤器)
    const profileModel = new ProfileModel(env.DB);
    const profile = await profileModel.getById(profileId);
    if (!profile) return null;
    
    const settings = JSON.parse(profile.settings);
    const rules = await profileModel.getRules(profileId);
    
    // 从 D1 直接加载布隆过滤器
    try {
      const buffer = await profileModel.getProfileBloom(profileId);
        
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
  }
};
