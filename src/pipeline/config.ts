import { Context, ProfileSettings, Rule } from "../types";
import { ProfileModel } from "../models/profile";
import { RuleModel } from "../models/rule";
import { ProfileBloomModel } from "../models/profileBloom";
import { AdguardRulesModel } from "../models/adguardRules";
import { BloomFilter } from "../utils/bloom";
import { cacheUtils } from "../utils/cache";
import { configCache, bloomMemoryMap, adguardMemoryMap, PROFILE_CACHE_KEY_PREFIX } from "./cache";
import { DEFAULT_FAIL_OPEN_UPSTREAM } from "../constants/presets";
import { AdGuardProfileEngine, AdGuardPayload } from "../lib/adguard";

export const pipelineConfig = {
  async load(context: Context, track: (name: string) => void): Promise<{
    settings: ProfileSettings;
    rules: Rule[];
    bloom?: BloomFilter;
    adguard?: AdGuardProfileEngine;
  } | null> {
    const { profileId, env, ctx } = context;

    // Fast-path: Default profile for unauthenticated access points or emergency fail-open
    if (profileId === 'default') {
      const failOpenUpstream = env.FAIL_OPEN_UPSTREAM || DEFAULT_FAIL_OPEN_UPSTREAM;
      const defaultSettings: ProfileSettings = {
        upstream: [failOpenUpstream],
        default_policy: "ALLOW",
        log_retention_days: 0,
        ecs: { enabled: true, use_client_ip: true }
      };
      return { settings: defaultSettings, rules: [], bloom: undefined, adguard: undefined };
    }

    // 1. 检查 L1 Memory (Isolate Global)
    const inMem = bloomMemoryMap.get(profileId);
    const inMemAdguard = adguardMemoryMap.get(profileId);
    const cachedConfig = configCache.get(profileId);
    
    const bloomMemTtl = Number(env.BLOOM_MEM_TTL) || 600000;
    const configuredMemTtl = Number(env.CONFIG_MEM_TTL) || 300000;
    const configMemTtl = Number.isFinite(configuredMemTtl) && configuredMemTtl > 0
      ? configuredMemTtl
      : 300000;
    if (cachedConfig && (Date.now() - (cachedConfig.timestamp || 0) < configMemTtl)) {
      track('load_config_l1_mem');
      const validBloom = (inMem && Date.now() - inMem.ts < bloomMemTtl) ? inMem.bloom : undefined;
      // 若该配置标记包含 Bloom，但内存中 Bloom 已过期缺失，不盲目短路返回，继续向下恢复 Bloom
      if (!cachedConfig.hasBloom || validBloom) {
        const validAdguard = inMemAdguard ? inMemAdguard.engine : (cachedConfig.adguard ? new AdGuardProfileEngine(cachedConfig.adguard) : undefined);
        return { ...cachedConfig, bloom: validBloom, adguard: validAdguard };
      }
    }

    // 2. 检查 L2 Cache API
    const cache = typeof caches !== "undefined" ? (caches as any).default : null;
    const profileCacheKey = `${PROFILE_CACHE_KEY_PREFIX}:${profileId}`;
    const bloomInternalUrl = cacheUtils.generateCacheUrl(`bloom-bin:${profileId}`);
    
    let apiCached = cache ? await cacheUtils.get<any>(cache, profileCacheKey) : null;
    let bloom: BloomFilter | undefined;
    let adguardEngine: AdGuardProfileEngine | undefined;

    if (apiCached) {
      track('load_config_l2_cache');
      if (inMem && Date.now() - inMem.ts < bloomMemTtl) {
        bloom = inMem.bloom;
      } else if (cache) {
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

      // 防御回退：若 L2 缓存指示存在 Bloom 规则，但在内存及 Cache API 中均未命中，从 D1 回退拉取 Bloom
      if (apiCached.hasBloom && !bloom && env.DB) {
        try {
          const bloomModel = new ProfileBloomModel(env.DB);
          const buffer = await bloomModel.getProfileBloom(profileId);
          if (buffer) {
            track('load_bloom_d1_fallback');
            bloom = BloomFilter.fromUint8Array(new Uint8Array(buffer));
            bloomMemoryMap.set(profileId, { bloom, ts: Date.now() });
            if (cache) {
              const bloomRes = new Response(buffer, {
                headers: {
                  "Content-Type": "application/octet-stream",
                  "Cache-Control": "public, max-age=86400",
                  "Cache-Tag": `bloom-${profileId}`
                }
              });
              ctx.waitUntil(cache.put(bloomInternalUrl, bloomRes));
            }
          }
        } catch (e) {
          console.error(`[Config] D1 Bloom fallback fetch failed for profile ${profileId}:`, e);
        }
      }

      if (inMemAdguard) {
        adguardEngine = inMemAdguard.engine;
      } else if (apiCached.adguard) {
        adguardEngine = new AdGuardProfileEngine(apiCached.adguard);
        adguardMemoryMap.set(profileId, { engine: adguardEngine, ts: Date.now() });
      }
      
      configCache.set(profileId, { ...apiCached, timestamp: Date.now() });
      return { ...apiCached, bloom, adguard: adguardEngine };
    }

    // 3. 回退到 D1 (带 Fail-Open 降级保护)
    try {
      const profileModel = new ProfileModel(env.DB);
      const ruleModel = new RuleModel(env.DB);
      const bloomModel = new ProfileBloomModel(env.DB);
      const adguardModel = new AdguardRulesModel(env.DB);

      // 并发从 D1 读取配置、规则、布隆过滤器及 AdGuard 扩展规则
      const [profile, rules, buffer, adguardPayload] = await Promise.all([
        profileModel.getById(profileId),
        ruleModel.getRules(profileId),
        bloomModel.getProfileBloom(profileId).catch((e) => {
          console.error("[Config] D1 Bloom loading failed:", e);
          return null;
        }),
        adguardModel.getProfileRules(profileId).catch((e) => {
          console.error("[Config] D1 AdGuard rules loading failed:", e);
          return null;
        })
      ]);

      if (!profile) {
        if (cachedConfig) {
          console.warn(`[Config] Profile ${profileId} not in D1, using stale memory config.`);
          return { ...cachedConfig, bloom: inMem?.bloom, adguard: inMemAdguard?.engine };
        }
        console.warn(`[Config] Profile ${profileId} not found in DB. Serving emergency fail-open fallback.`);
        const failOpenUpstream = env.FAIL_OPEN_UPSTREAM || DEFAULT_FAIL_OPEN_UPSTREAM;
        const fallbackSettings: ProfileSettings = {
          upstream: [failOpenUpstream],
          default_policy: "ALLOW",
          log_retention_days: 0,
          ecs: { enabled: true, use_client_ip: true }
        };
        return { settings: fallbackSettings, rules: [], bloom: undefined, adguard: undefined };
      }
      
      const settings = JSON.parse(profile.settings);
      
      // 处理布隆过滤器并写入 L2 Cache API
      if (buffer) {
        track('load_bloom_l3_d1');
        const uint8 = new Uint8Array(buffer);
        bloom = BloomFilter.fromUint8Array(uint8);

        ctx.waitUntil(cache.put(bloomInternalUrl, new Response(uint8, {
          headers: { 
            'Content-Type': 'application/octet-stream',
            'Cache-Control': 'public, max-age=604800',
            'Cache-Tag': `bloom-${profileId}`
          }
        })));
      }

      if (adguardPayload) {
        adguardEngine = new AdGuardProfileEngine(adguardPayload);
        adguardMemoryMap.set(profileId, { engine: adguardEngine, ts: Date.now() });
      }

      const config = { settings, rules, adguard: adguardPayload, hasBloom: Boolean(buffer) };
      if (bloom) bloomMemoryMap.set(profileId, { bloom, ts: Date.now() });
      
      configCache.set(profileId, { ...config, timestamp: Date.now() });
      if (cache) {
        ctx.waitUntil(cacheUtils.set(cache, profileCacheKey, config, 86400, [`profile-${profileId}`]));
        if (buffer) {
          const bloomRes = new Response(buffer, {
            headers: {
              "Content-Type": "application/octet-stream",
              "Cache-Control": "public, max-age=86400",
              "Cache-Tag": `bloom-${profileId}`
            }
          });
          ctx.waitUntil(cache.put(bloomInternalUrl, bloomRes));
        }
      }
      
      track('load_config_full_sync');
      return { ...config, bloom, adguard: adguardEngine };
    } catch (e: any) {
      console.warn(`[Config] D1 profile fetch failed for ${profileId}:`, e?.message || e);
      
      // 容灾模式 1: Stale-While-Error (使用过期的 L1 缓存)
      if (cachedConfig) {
        console.warn(`[Config] Serving stale config from memory for profile ${profileId}`);
        return { ...cachedConfig, bloom: inMem?.bloom, adguard: inMemAdguard?.engine };
      }

      // 容灾模式 2: Emergency Safe Default Fallback
      console.warn(`[Config] Serving emergency fail-open safe fallback for profile ${profileId}`);
      const failOpenUpstream = env.FAIL_OPEN_UPSTREAM || DEFAULT_FAIL_OPEN_UPSTREAM;
      const fallbackSettings: ProfileSettings = {
        upstream: [failOpenUpstream],
        default_policy: "ALLOW",
        log_retention_days: 0,
        ecs: { enabled: true, use_client_ip: true }
      };
      return { settings: fallbackSettings, rules: [], bloom: undefined, adguard: undefined };
    }
  }
};
