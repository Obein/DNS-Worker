import { Context, Env, ExecutionContext } from '../types';
import { parseDNSQuery } from '../utils/dns';
import { pipeline } from '../pipeline';
import { ProfileModel, ProfileWithBloom } from '../models/profile';
import { UserModel } from '../models/user';
import { cacheUtils } from '../utils/cache';
import { profileKeyMemoryMap } from '../pipeline/cache';
import { resolveUpstreamEndpoint, fetchFromUpstream } from '../pipeline/resolver/transport';

/**
 * Safely extracts raw wire-format DNS query bytes from incoming HTTP GET or POST request.
 */
async function extractRawQuery(request: Request): Promise<Uint8Array | null> {
  try {
    if (request.method === "GET") {
      const url = new URL(request.url);
      const dnsParam = url.searchParams.get("dns");
      if (!dnsParam) return null;
      let base64 = dnsParam.replace(/-/g, "+").replace(/_/g, "/");
      while (base64.length % 4) base64 += "=";
      const binary = atob(base64);
      const raw = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        raw[i] = binary.charCodeAt(i);
      }
      return raw;
    } else if (request.method === "POST") {
      const buffer = await request.clone().arrayBuffer();
      return new Uint8Array(buffer);
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Resolves profile and access point metadata with multi-tier caching (L1 Memory -> L2 Cache API -> D1 DB).
 */
export async function resolveProfileByKey(
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
    // If D1 is exhausted or erroring, attempt to return stale in-memory data if available
    if (inMem?.data) {
      return inMem.data;
    }

    // Emergency fail-open fallback if D1 has exceeded its read quota or is unavailable:
    // Generate a temporary fallback profile so DNS resolution doesn't return 404 or 500
    const failOpenUpstream = env.FAIL_OPEN_UPSTREAM || "https://freedns.controld.com/no-ads-malware-typo";
    console.warn(`[DoH] D1 unavailable. Providing emergency fallback profile for key ${profileKey} -> ${failOpenUpstream}`);
    return {
      id: profileKey,
      name: "Emergency Fallback",
      settings: JSON.stringify({
        upstream: [failOpenUpstream],
        default_policy: "ALLOW",
        log_retention_days: 0,
        ecs: { enabled: true, use_client_ip: true }
      }),
      owner_id: "system",
      created_at: Math.floor(now / 1000),
      updated_at: Math.floor(now / 1000)
    } as any;
  }

  return null;
}

/**
 * Resolves default profile when no profile key is specified in connection or query.
 */
export async function resolveDefaultProfile(
  env: Env,
  ctx: ExecutionContext
): Promise<(ProfileWithBloom & { access_point_id?: string; access_point_name?: string }) | null> {
  const defaultKey = env.SERVERFULL_DEFAULT_PROFILE_KEY || env.DEFAULT_PROFILE_KEY;
  if (defaultKey) {
    const profile = await resolveProfileByKey(defaultKey, env, ctx);
    if (profile) return profile;
  }

  try {
    const profileModel = new ProfileModel(env.DB);
    const profiles = await profileModel.list("ORDER BY created_at ASC LIMIT 1", []);
    if (profiles && profiles.length > 0) {
      const fullProfile = await profileModel.getById(profiles[0].id);
      if (fullProfile) return fullProfile;
    }
  } catch (e: any) {
    console.warn("[Profile] Failed to query fallback default profile:", e.message || e);
  }

  return {
    id: "default",
    name: "Default Profile",
    settings: JSON.stringify({
      upstream: [env.FAIL_OPEN_UPSTREAM || "https://security.cloudflare-dns.com/dns-query"],
      default_policy: "ALLOW",
      log_retention_days: 0,
      ecs: { enabled: true, use_client_ip: true }
    }),
    owner_id: "system",
    created_at: Math.floor(Date.now() / 1000),
    updated_at: Math.floor(Date.now() / 1000)
  } as any;
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
  let queryRaw: Uint8Array | null = null;

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
    queryRaw = query.raw;

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
      // Emergency fail-open: dispatch DNS wire query directly to FAIL_OPEN_UPSTREAM
      // Supports HTTPS (DoH), TLS/DoT (RFC 7858), TCP (RFC 7766), and DNS Stamps (sdns://)
      const failOpenUpstream = env.FAIL_OPEN_UPSTREAM || "https://freedns.controld.com/no-ads-malware-typo";
      const rawBytes = queryRaw || (await extractRawQuery(request));

      if (rawBytes && rawBytes.length > 0) {
        const endpoint = resolveUpstreamEndpoint(failOpenUpstream);
        const transportRes = await fetchFromUpstream(endpoint, rawBytes);
        return new Response(transportRes.answer as any, {
          headers: {
            "Content-Type": "application/dns-message",
            "Cache-Control": "max-age=60"
          }
        });
      }

      // If wire query bytes couldn't be decoded and upstream is HTTP(S), proxy request directly
      if (failOpenUpstream.startsWith("http://") || failOpenUpstream.startsWith("https://")) {
        const fallbackUrl = new URL(failOpenUpstream);
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
      }

      return new Response("Invalid DNS Query", { status: 400 });
    } catch (proxyErr) {
      console.error(`[DoH Pipeline] Emergency fallback failed:`, proxyErr);
      return new Response(`Internal Server Error`, { status: 500 });
    }
  }
}
