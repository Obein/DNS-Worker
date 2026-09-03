import { Context, Env, ExecutionContext } from '../types';
import { parseDNSQuery } from '../utils/dns';
import { pipeline } from '../pipeline';
import { ProfileModel, ProfileWithBloom } from '../models/profile';
import { UserModel } from '../models/user';
import { cacheUtils } from '../utils/cache';
import { profileKeyMemoryMap } from '../pipeline/cache';

/**
 * Resolves profile and access point metadata with multi-tier caching (L1 Memory -> L2 Cache API -> D1 DB).
 */
async function resolveProfileByKey(
  profileKey: string,
  env: Env,
  ctx: ExecutionContext
): Promise<(ProfileWithBloom & { access_point_id?: string; access_point_name?: string }) | null> {
  const cache = (caches as any).default;
  const now = Date.now();

  // 1. Check L1 Memory Cache (Isolate Global) - 5 minutes
  const inMem = profileKeyMemoryMap.get(profileKey);
  if (inMem && now - inMem.ts < 300_000) {
    return inMem.data;
  }

  // 2. Check L2 Cloudflare Cache API - 1 hour
  const cacheKey = `doh_key_v1:${profileKey}`;
  try {
    const cached = await cacheUtils.get<any>(cache, cacheKey);
    if (cached) {
      profileKeyMemoryMap.set(profileKey, { data: cached, ts: now });
      return cached;
    }
  } catch {
    /* ignore Cache API match error */
  }

  // 3. Fallback to D1 (only executed on cache miss)
  try {
    const profileModel = new ProfileModel(env.DB);
    const profile = await profileModel.findByKey(profileKey);

    if (profile) {
      profileKeyMemoryMap.set(profileKey, { data: profile, ts: now });
      ctx.waitUntil(cacheUtils.set(cache, cacheKey, profile, 3600));
      return profile;
    }
  } catch (e: any) {
    console.warn(`[DoH] D1 profile lookup failed for key ${profileKey}:`, e.message || e);
    // If D1 is exhausted, attempt to return stale in-memory data if available
    if (inMem?.data) {
      return inMem.data;
    }

    // Emergency fail-open fallback if D1 has exceeded its read quota:
    // Generate a temporary fallback profile so DNS resolution doesn't return 404 or 500
    if (String(e?.message || e).includes("exceeded D1's free tier daily row read limit")) {
      console.warn(`[DoH] D1 read quota exhausted. Providing emergency fallback profile for key ${profileKey}`);
      return {
        id: profileKey,
        name: "Emergency Fallback",
        settings: JSON.stringify({
          upstream: ["https://security.cloudflare-dns.com/dns-query"],
          default_policy: "PASS",
          log_retention_days: 0,
          ecs: false
        }),
        owner_id: "system",
        created_at: Math.floor(now / 1000),
        updated_at: Math.floor(now / 1000)
      } as any;
    }
  }

  return null;
}

/**
 * Handles DNS-over-HTTPS (DoH) requests, coordinates parsing, pipeline resolution, 
 * active connection cache registration, and database active tracking.
 */
export async function handleDoHRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  profileKey: string
): Promise<Response> {
  const cache = (caches as any).default;

  try {
    const profile = await resolveProfileByKey(profileKey, env, ctx);
    if (!profile) {
      return new Response('Invalid Profile Key', { status: 404 });
    }
    const profileId = profile.id;
    const query = await parseDNSQuery(request);
    if (!query) {
      return new Response('Invalid DNS Query', { status: 400 });
    }

    const context: Context = { 
      profileId, 
      accessPointId: profile.access_point_id, 
      accessPointName: profile.access_point_name,
      startTime: Date.now(), 
      env, 
      ctx 
    };
    const result = await pipeline.process(request, query, context);

    // Async task: record active connections and update active timestamps with throttling
    ctx.waitUntil((async () => {
      try {
        const clientIp = request.headers.get("CF-Connecting-IP") || "127.0.0.1";
        
        // Record active connection (used by Debug API)
        const activeDnsTtl = Number(env.ACTIVE_DNS_CACHE_TTL) || 60;
        await cacheUtils.set(cache, `active_dns:${clientIp}`, profileId, activeDnsTtl);

        // Update profile activity timestamp (throttled hourly)
        const nowSec = Math.floor(Date.now() / 1000);
        const lastActiveKey = `active_throttle:${profileId}`;
        const lastActiveThrottled = await cacheUtils.get<number>(cache, lastActiveKey);

        const throttleSec = Number(env.THROTTLE_ACTIVE_SEC) || 3600;
        if (!lastActiveThrottled || nowSec - lastActiveThrottled > throttleSec) {
          try {
            const profileModel = new ProfileModel(env.DB);
            await profileModel.updateLastActive(profileId, nowSec);
            
            const userModel = new UserModel(env.DB, env);
            await userModel.updateLastActiveByProfile(profileId, nowSec);
          } catch {
            /* ignore D1 write quota errors */
          }
          
          await cacheUtils.set(cache, lastActiveKey, nowSec, throttleSec);
        }
      } catch (e) {
        console.error(`[Background Task] Error for ${profileId}:`, e);
      }
    })());

    return new Response(result.answer as any, {
      headers: {
        'Content-Type': 'application/dns-message',
        'Cache-Control': `max-age=${result.ttl}`
      }
    });
  } catch (e: any) {
    console.error(`[DoH Pipeline] Internal Error:`, e);
    try {
      // Emergency fail-open: proxy the DoH request directly to Cloudflare Security DNS
      // Ensures user devices NEVER experience 500 or internet blackout during D1/Worker anomalies
      const fallbackUrl = new URL("https://security.cloudflare-dns.com/dns-query");
      const reqUrl = new URL(request.url);
      fallbackUrl.search = reqUrl.search;
      const fallbackRes = await fetch(fallbackUrl.toString(), {
        method: request.method,
        headers: {
          "Accept": request.headers.get("Accept") || "application/dns-message",
          "Content-Type": request.headers.get("Content-Type") || "application/dns-message"
        },
        body: request.method === "POST" ? request.body : undefined
      });
      return fallbackRes;
    } catch (proxyErr) {
      console.error(`[DoH Pipeline] Emergency fallback proxy failed:`, proxyErr);
      return new Response(`Internal Server Error`, { status: 500 });
    }
  }
}
