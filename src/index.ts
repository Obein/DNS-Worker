import { Context, Env, User, ExecutionContext } from './types';
import { parseDNSQuery } from './utils/dns';
import { pipeline } from './pipeline';
import { getRequestCoordinates, readCsrfCookie, createCsrfCookie, generateId, getOrCreateJwtSecret } from './lib/auth';
import { importJwtSecret, verifyJWT } from './lib/jwt';
import { handleAuthRequest } from './api/auth';
import { handleProfilesRequest } from './api/profiles';
import { handleAccountRequest } from './api/account';
import { LogModel } from './models/log';
import { ProfileModel } from './models/profile';
import { UserModel } from './models/user';
import { SessionModel } from './models/session';
import { syncProfileLists } from './utils/sync';
import { ScheduledEvent } from '@cloudflare/workers-types';
import { cacheUtils } from './utils/cache';
import { generateLinuxSetupScript } from './utils/linuxSetup';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const nonceBytes = new Uint8Array(16);
    crypto.getRandomValues(nonceBytes);
    const nonce = Array.from(nonceBytes).map(b => b.toString(16).padStart(2, '0')).join('');

    const applySecurityHeaders = (response: Response) => {
      const newHeaders = new Headers(response.headers);
      newHeaders.set('X-Content-Type-Options', 'nosniff');
      newHeaders.set('X-Frame-Options', 'DENY');
      newHeaders.set('X-XSS-Protection', '1; mode=block');
      newHeaders.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
      // Allow Turnstile API and basic SPA needs
      if (!newHeaders.has('Content-Security-Policy')) {
        newHeaders.set('Content-Security-Policy', `default-src 'self'; script-src 'self' 'nonce-${nonce}' https://challenges.cloudflare.com https://static.cloudflareinsights.com; frame-src 'self' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://icons.duckduckgo.com; connect-src 'self' https://challenges.cloudflare.com https://cloudflare-dns.com https://1.1.1.1;`);
      }
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders
      });
    };

    let currentUser: User | null = null;

    const handleRequest = async (): Promise<Response> => {
      const url = new URL(request.url);

      const cache = (caches as any).default;

      // Auth API 路由 (无需鉴权)
      if (url.pathname.startsWith('/api/auth/')) {
        return handleAuthRequest(request, env);
      }

      // 鉴权中间件逻辑 (仅对 /api 路由生效)
      if (url.pathname.startsWith('/api/')) {
        const authHeader = request.headers.get("Authorization") || "";
        let accessToken = "";
        if (authHeader.startsWith("Bearer ")) {
          accessToken = authHeader.slice(7);
        }

        if (accessToken) {
          try {
            const secret = await getOrCreateJwtSecret(env);
            const jwtKey = await importJwtSecret(secret);
            const payload = await verifyJWT<{userId: string, role: string, sessionId: string, exp: number}>(accessToken, jwtKey);
            if (payload) {
              // We only set id and role because the rest of the app relies primarily on these for API authorization.
              // Note: `username` and other fields are omitted to avoid hitting the DB.
              currentUser = { id: payload.userId, username: "", role: payload.role as any };
            }
          } catch (e) {}
        }

        const isAuthRoute = [
          '/api/auth/login', '/api/auth/signup', '/api/auth/prelogin', '/api/auth/check-username'
        ].includes(url.pathname);
        const isMobileConfigRoute = url.pathname.endsWith('/mobileconfig');

        if (!currentUser && !isAuthRoute && !isMobileConfigRoute) {
          return new Response("Unauthorized", { status: 401 });
        }

        // CSRF Double Submit Cookie check for mutations
        if (currentUser && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method) && !isAuthRoute) {
          const cookieHeader = request.headers.get("Cookie") || "";
          const csrfCookie = readCsrfCookie(cookieHeader);
          const csrfHeader = request.headers.get("X-CSRF-Token");
          if (!csrfCookie || !csrfHeader || csrfCookie !== csrfHeader) {
            return new Response("CSRF validation failed", { status: 403 });
          }
        }

        // 业务 API 路由
        if (url.pathname === '/api/debug') {
          const clientIp = request.headers.get("CF-Connecting-IP") || "127.0.0.1";
          const connectedProfileId = await cacheUtils.get<string>(cache, `active_dns:${clientIp}`);
          const cf = (request as any).cf;

          // 提取地区配置变量
          const regions: Record<string, any> = {};
          for (const [key, value] of Object.entries(env)) {
            if (key.startsWith('IP_REGION_') && typeof value === 'string') {
              try {
                const regionKey = key.replace('IP_REGION_', '');
                let cleanVal = value.trim();
                cleanVal = cleanVal
                  .replace(/^"""|"""$/g, "")
                  .replace(/^"|"$/g, "")
                  .replace(/^'|'$/g, "")
                  .trim();
                regions[regionKey] = JSON.parse(cleanVal);
              } catch (e) { }
            }
          }

          return new Response(JSON.stringify({
            ip: clientIp,
            country: cf?.country || "UNKNOWN",
            city: cf?.city || "UNKNOWN",
            asn: cf?.asn || 0,
            asOrganization: cf?.asOrganization || "UNKNOWN",
            connectedProfileId: connectedProfileId || null,
            substituteDomain: env.SUBSTITUTE_DOMAIN || "pages.dev",
            regions
          }), { headers: { 'Content-Type': 'application/json' } });
        }
        if (url.pathname === '/api/substitute') {
          const subDomain = env.SUBSTITUTE_DOMAIN || "pages.dev";
          let substituteDomainIp: string | null = null;
          let substituteDomainIpv6: string | null = null;

          const resolveRecord = async (type: 'A' | 'AAAA'): Promise<string | null> => {
            const dnsServers = [
              'https://cloudflare-dns.com/dns-query',
              'https://1.1.1.1/dns-query'
            ];
            for (const server of dnsServers) {
              try {
                const res = await fetch(`${server}?name=${subDomain}&type=${type}`, {
                  headers: { 'Accept': 'application/dns-json' },
                  signal: AbortSignal.timeout(3000)
                });
                if (res.ok) {
                  const data = await res.json() as any;
                  if (data?.Answer?.length > 0) {
                    const record = data.Answer.find((a: any) => a.type === (type === 'A' ? 1 : 28));
                    if (record?.data) {
                      return record.data;
                    }
                  }
                }
              } catch (e) {
                console.error(`[Substitute Resolve] Failed resolving ${type} via ${server}:`, e);
              }
            }
            return null;
          };

          try {
            const [ip, ipv6] = await Promise.all([
              resolveRecord('A'),
              resolveRecord('AAAA')
            ]);
            substituteDomainIp = ip;
            substituteDomainIpv6 = ipv6;
          } catch (e) {
            console.error('[Substitute API] Error resolving substitute domain:', e);
          }

          return new Response(JSON.stringify({
            ip: substituteDomainIp,
            ipv6: substituteDomainIpv6
          }), { headers: { 'Content-Type': 'application/json' } });
        }
        if (url.pathname.startsWith('/api/profiles')) {
          return handleProfilesRequest(request, env, currentUser, ctx);
        }
        if (url.pathname.startsWith('/api/account') || url.pathname.startsWith('/api/admin')) {
          return handleAccountRequest(request, env, currentUser!, ctx);
        }
        return new Response("API Not Found", { status: 404 });
      }

      // DoH 解析路由: /<6到12位字符串>
      const profileKeyMatch = url.pathname.match(/^\/([a-zA-Z0-9]{6,12})$/);
      const isDoHRequest = request.method === 'POST' || 
                           url.searchParams.has('dns') || 
                           request.headers.get('accept')?.includes('dns-message');
                           
      if (profileKeyMatch && isDoHRequest) {
        try {
          const profileKey = profileKeyMatch[1];
          const profileModel = new ProfileModel(env.DB);
          const profile = await profileModel.findByKey(profileKey);
          if (!profile) return new Response('Invalid Profile Key', { status: 404 });
          const profileId = profile.id;
          const query = await parseDNSQuery(request);
          if (!query) return new Response('Invalid DNS Query', { status: 400 });
          const context: Context = { profileId, startTime: Date.now(), env, ctx };
          const result = await pipeline.process(request, query, context);

          // 异步处理：记录活跃连接与更新活跃时间 (Throttled)
          ctx.waitUntil((async () => {
            try {
              const clientIp = request.headers.get("CF-Connecting-IP") || "127.0.0.1";
              // 记录活跃连接（用于 Debug 页面）
              const activeDnsTtl = Number(env.ACTIVE_DNS_CACHE_TTL) || 60;
              await cacheUtils.set(cache, `active_dns:${clientIp}`, profileId, activeDnsTtl);

              // 记录账号/配置活跃时间 (每小时节流一次)
              const nowSec = Math.floor(Date.now() / 1000);
              const lastActiveKey = `active_throttle:${profileId}`;
              const lastActiveThrottled = await cacheUtils.get<number>(cache, lastActiveKey);

              const throttleSec = Number(env.THROTTLE_ACTIVE_SEC) || 3600;
              if (!lastActiveThrottled || nowSec - lastActiveThrottled > throttleSec) {
                // 更新 Profile 活跃时间
                await profileModel.updateLastActive(profileId, nowSec);
                // 级联更新 Owner 活跃时间
                const userModel = new UserModel(env.DB);
                await userModel.updateLastActiveByProfile(profileId, nowSec);
                // 写入节流标记
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

      // Linux /setup.sh 路由
      if (url.pathname === '/setup.sh') {
        const key = url.searchParams.get('key');
        if (!key || !/^[a-zA-Z0-9]{6,12}$/.test(key)) {
          return new Response('Missing or invalid key parameter', { status: 400 });
        }
        const script = generateLinuxSetupScript(url.origin, key);
        return new Response(script, {
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'no-cache'
          }
        });
      }

      // 静态资源托管与 SPA 回退
      try {
        let response = await (env as any).ASSETS.fetch(request);
        if (response.status === 404) {
          response = await (env as any).ASSETS.fetch(new Request(url.origin + '/', request));
        }

        const contentType = response.headers.get('Content-Type') || '';
        if (contentType.includes('text/html')) {
          let configStr = "{}";
          try {
             const upstreams = env.PRESET_UPSTREAMS ? JSON.parse(env.PRESET_UPSTREAMS) : null;
             const filters = env.PRESET_EXTERNAL_FILTERS ? JSON.parse(env.PRESET_EXTERNAL_FILTERS) : null;
             configStr = JSON.stringify({ upstreams, filters });
          } catch (e) { }
          
          return new HTMLRewriter()
            .on('head', {
              element(element) {
                element.prepend(`<script nonce="${nonce}">window.OBEX_CONFIG = ${configStr};</script>`, { html: true });
              }
            })
            .transform(response);
        }

        return response;
      } catch (e) {
        return new Response("Asset Fetch Error", { status: 500 });
      }
    };

    let response = await handleRequest();
    // Ensure CSRF token is set in cookies if authenticated but cookie is missing from the request
    if (currentUser && !readCsrfCookie(request.headers.get("Cookie"))) {
      try {
        const csrfToken = generateId(32);
        response.headers.append("Set-Cookie", createCsrfCookie(csrfToken));
      } catch (e) {
        // If headers are immutable (e.g. from static asset fetch), clone the response and set the header
        const newHeaders = new Headers(response.headers);
        const csrfToken = generateId(32);
        newHeaders.append("Set-Cookie", createCsrfCookie(csrfToken));
        response = new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: newHeaders
        });
      }
    }

    return applySecurityHeaders(response);
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    try {
      const logModel = new LogModel(env.DB);
      const now = Math.floor(Date.now() / 1000);
      const inactivityDays = Number(env.INACTIVITY_THRESHOLD_DAYS) || 180;
      const inactivityThreshold = now - (inactivityDays * 24 * 3600);

      // 清理 180 天无活动的普通用户 (级联删除)
      try {
        const userModel = new UserModel(env.DB);
        await userModel.cleanupInactiveUsers(inactivityThreshold);
      } catch (e) {
        console.error("[Cron] Inactive users cleanup failed:", e);
      }

      // 清理过期 Session 及 TOTP 临时会话
      try {
        const sessionModel = new SessionModel(env.DB);
        await sessionModel.cleanupExpired(now);
      } catch (e) {
        console.error("[Cron] Expired sessions cleanup failed:", e);
      }

      // 全局日志清理 (高效 SQL)
      try {
        await logModel.cleanupGlobal();
      } catch (e) {
        console.error("[Cron] Global log cleanup failed:", e);
      }

      // 限制同步频率：每次同步最久没更新且更新时间超过 24 小时的 10 个 Profile
      try {
        const syncIntervalSec = Number(env.SYNC_PROFILE_INTERVAL_SEC) || 86400;
        const cutoffTime = now - syncIntervalSec;
        const profileModel = new ProfileModel(env.DB);
        const syncTargets = await profileModel.getSyncTargets(cutoffTime, 10);

        for (const target of syncTargets) {
          // 使用 waitUntil 确保即便同步较慢也不会阻塞 Cron 主进程
          ctx.waitUntil(syncProfileLists(target.id, env, ctx));
        }
        if (syncTargets.length > 0) {
          console.log(`[Cron] Scheduled sync for ${syncTargets.length} profiles.`);
        }
      } catch (e) {
        console.error("[Cron] List sync scheduling failed:", e);
      }

      console.log(`[Cron] Scheduled tasks completed at ${new Date().toISOString()}`);
    } catch (e: any) {
      console.error("[Cron] Critical Failure:", e.message);
    }
  }
};
