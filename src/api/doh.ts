import { Context, Env, ExecutionContext } from '../types';
import { parseDNSQuery } from '../utils/dns';
import { pipeline } from '../pipeline';
import { ProfileModel } from '../models/profile';
import { UserModel } from '../models/user';
import { cacheUtils } from '../utils/cache';

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
    const profileModel = new ProfileModel(env.DB);
    const profile = await profileModel.findByKey(profileKey);
    if (!profile) {
      return new Response('Invalid Profile Key', { status: 404 });
    }
    const profileId = profile.id;
    const query = await parseDNSQuery(request);
    if (!query) {
      return new Response('Invalid DNS Query', { status: 400 });
    }

    const context: Context = { profileId, startTime: Date.now(), env, ctx };
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
          // Update profile active timestamp
          await profileModel.updateLastActive(profileId, nowSec);
          
          // Cascading update to profile owner active timestamp
          const userModel = new UserModel(env.DB);
          await userModel.updateLastActiveByProfile(profileId, nowSec);
          
          // Store throttle marker
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
    return new Response(`Internal Server Error`, { status: 500 });
  }
}
