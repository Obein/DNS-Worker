import { Env, User, Profile, ProfileSettings, Rule, List, Context, ExecutionContext } from "../types";
import { RBAC } from "../lib/rbac";
import { buildDNSQuery, parseDNSAnswer } from "../utils/dns";
import { pipeline } from "../pipeline";
import { syncProfileLists } from "../utils/sync";
import { LogModel } from "../models/log";
import { ProfileModel } from "../models/profile";
import { generateId } from "../lib/auth";
import { isSafeUrl } from "../utils/validator";

const AP_NAME_REGEX = /^[a-zA-Z0-9_-]{1,30}$/;

export async function handleProfilesRequest(request: Request, env: Env, user: User | null, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const pathParts = url.pathname.split('/').filter(Boolean); // ['api', 'profiles', ':id', ...]
  const profileModel = new ProfileModel(env.DB);
  const logModel = new LogModel(env.DB);

  // 处理列表和创建 (/api/profiles)
  if (pathParts.length === 2) {
    if (!user) return new Response("Unauthorized", { status: 401 });

    if (request.method === 'GET') {
      const results = await profileModel.listByOwner(user.id);
      return new Response(JSON.stringify(results), { headers: { 'Content-Type': 'application/json' } });
    }

    if (request.method === 'POST') {
      const body = await request.json() as { name: string };
      
      const existingProfiles = await profileModel.listByOwner(user.id);
      if (existingProfiles.length >= 10) return new Response("Profile limit exceeded (max 10)", { status: 400 });

      const existing = existingProfiles.find(p => p.name === body.name);
      if (existing) return new Response("The profile name already exists", { status: 400 });

      const newId = generateId(6);
      const defaultSettings: ProfileSettings = {
        upstream: ["https://security.cloudflare-dns.com/dns-query"],
        ecs: { enabled: true, use_client_ip: true },
        log_retention_days: 30,
        default_policy: 'ALLOW'
      };
      await profileModel.create({ id: newId, owner_id: user.id, name: body.name || "Unnamed Profile", settings: defaultSettings });
      return new Response(JSON.stringify({ id: newId }), { status: 201 });
    }
  }

  // 处理特定 Profile (/api/profiles/:id)
  if (pathParts.length >= 3) {
    const profileId = pathParts[2];
    const profile = await profileModel.getById(profileId);
    
    if (!profile) return new Response("Profile Not Found", { status: 404 });

    // 特殊处理：mobileconfig 下载允许免登录访问
    const isMobileConfig = pathParts[3] === 'mobileconfig' && request.method === 'GET';
    
    if (!isMobileConfig) {
      if (!user) return new Response("Unauthorized", { status: 401 });
      if (!RBAC.canAccessProfile(user, profile)) return new Response("Forbidden", { status: 403 });
    }

    // DELETE /api/profiles/:id
    if (pathParts.length === 3 && request.method === 'DELETE') {
      await profileModel.delete(profileId);
      return new Response(null, { status: 204 });
    }

    // PATCH /api/profiles/:id (用于修改名称等基础信息)
    if (pathParts.length === 3 && request.method === 'PATCH') {
      const { name } = await request.json() as { name: string };
      if (!name) return new Response("The name cannot be empty", { status: 400 });
      await profileModel.updateName(profileId, name);
      ctx.waitUntil(pipeline.clearCache(profileId));
      return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
    }

    // GET /api/profiles/:id
    if (pathParts.length === 3 && request.method === 'GET') {
      return new Response(JSON.stringify(profile), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // POST /api/profiles/:id/rotate_key
    if (pathParts[3] === 'rotate_key' && request.method === 'POST') {
      const newKey = generateId(12);
      await profileModel.rotateKey(profileId, newKey);
      ctx.waitUntil(pipeline.clearCache(profileId));
      return new Response(JSON.stringify({ profile_key: newKey }), { headers: { 'Content-Type': 'application/json' } });
    }

    // PATCH /api/profiles/:id/settings
    if (pathParts[3] === 'settings' && request.method === 'PATCH') {
      const newSettings = await request.json() as ProfileSettings;
      
      if (newSettings.upstream && Array.isArray(newSettings.upstream)) {
        for (const url of newSettings.upstream) {
          if (!url.startsWith('https://') && !url.startsWith('http://') && !url.startsWith('tcp://')) {
            return new Response("Invalid upstream URL format. Only HTTP(S) and TCP are allowed.", { status: 400 });
          }
          if (!isSafeUrl(url)) {
            return new Response("Invalid upstream URL. Private networks and localhosts are not allowed.", { status: 400 });
          }
        }
      }

      await profileModel.updateSettings(profileId, newSettings);
      const days = newSettings.log_retention_days || 30;
      const threshold = Math.floor(Date.now() / 1000 - (days * 24 * 3600));
      ctx.waitUntil(logModel.cleanup(profileId, threshold));
      await pipeline.clearCache(profileId);
      return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
    }

    // POST /api/profiles/:id/test
    if (pathParts[3] === 'test' && request.method === 'POST') {
      const { domain, type } = await request.json() as { domain: string, type: string };
      const rawQuery = buildDNSQuery(domain, type);
      const result = await pipeline.process(request, { name: domain, type, raw: rawQuery }, { profileId, startTime: Date.now(), env, ctx });
      return new Response(JSON.stringify({
        action: result.action,
        reason: result.reason,
        answers: result.answer.length > 0 ? parseDNSAnswer(result.answer) : [],
        diagnostics: result.diagnostics,
        latency: result.latency,
        timings: result.timings,
        client_ip: request.headers.get("CF-Connecting-IP") || "127.0.0.1",
        geo_country: (request as any).cf?.country || "UNKNOWN",
        success: true 
      }), { headers: { 'Content-Type': 'application/json' } });
    }

    // 子资源路由: /api/profiles/:id/filters
    if (pathParts[3] === 'filters' && request.method === 'GET') {
      const [rules, lists] = await Promise.all([profileModel.getRules(profileId), profileModel.getLists(profileId)]);
      return new Response(JSON.stringify({ rules, lists }), { headers: { 'Content-Type': 'application/json' } });
    }

    // 子资源路由: /api/profiles/:id/logs
    if (pathParts[3] === 'logs' && request.method === 'GET') {
      if (pathParts.length > 4) {
        const logId = parseInt(pathParts[4], 10);
        if (isNaN(logId)) {
          return new Response("Invalid Log ID", { status: 400 });
        }
        const logDetail = await logModel.getLog(profileId, logId);
        if (!logDetail) {
          return new Response("Log Not Found", { status: 404 });
        }
        return new Response(JSON.stringify(logDetail), { headers: { 'Content-Type': 'application/json' } });
      }

      const urlParams = new URL(request.url).searchParams;
      const range = urlParams.get('range') || '24h';
      const before = urlParams.get('before');
      const status = urlParams.get('status');
      const search = urlParams.get('search');
      const accessPointId = urlParams.get('access_point_id');
      const startParam = urlParams.get('start');
      const endParam = urlParams.get('end');
      
      let since: number;
      let until = Math.floor(Date.now() / 1000);
      const settings: ProfileSettings = JSON.parse(profile.settings);
      const retentionThreshold = Math.floor(until - ((settings.log_retention_days || 30) * 24 * 3600));

      if (startParam && endParam) {
        since = Math.max(parseInt(startParam), retentionThreshold);
        until = parseInt(endParam);
      } else {
        since = until;
        switch (range) {
          case '10m': since -= 600; break;
          case '1h': since -= 3600; break;
          case '24h': since -= 86400; break;
          case '7d': since -= 604800; break;
          case '30d': since -= 2592000; break;
          default: since -= 86400; break;
        }
        since = Math.max(since, retentionThreshold);
      }

      const results = await logModel.getLogs(profileId, { since, until, status: status || undefined, search: search || undefined, before: before ? parseInt(before) : undefined, limit: parseInt(urlParams.get('limit') || '50'), access_point_id: accessPointId || undefined });
      return new Response(JSON.stringify(results), { headers: { 'Content-Type': 'application/json' } });
    }

    // 子资源路由: /api/profiles/:id/analytics
    if (pathParts[3] === 'analytics' && request.method === 'GET') {
      const urlParams = new URL(request.url).searchParams;
      const range = urlParams.get('range');
      const startParam = urlParams.get('start');
      const endParam = urlParams.get('end');
      const accessPointId = urlParams.get('access_point_id') || undefined;
      let since: number; let until = Math.floor(Date.now() / 1000); let interval: string;

      if (startParam && endParam) { since = parseInt(startParam); until = parseInt(endParam); interval = "(timestamp/3600)*3600"; }
      else {
        switch (range) {
          case '10m': since = until - 600; interval = "(timestamp/60)*60"; break;
          case '1h': since = until - 3600; interval = "(timestamp/60)*60"; break;
          case '24h': since = until - 86400; interval = "(timestamp/3600)*3600"; break;
          case '7d': since = until - 604800; interval = "(timestamp/86400)*86400"; break;
          case '30d': since = until - 2592000; interval = "(timestamp/86400)*86400"; break;
          default: since = until - 86400; interval = "(timestamp/3600)*3600"; break;
        }
      }

      const subResource = pathParts[4];
      if (subResource) {
        if (subResource === 'summary') {
          const search = urlParams.get('search') || undefined;
          const summary = await logModel.getSummary(profileId, since, until, search, accessPointId);
          return new Response(JSON.stringify(summary), { headers: { 'Content-Type': 'application/json' } });
        }
        if (subResource === 'trend') {
          const trend = await logModel.getTrend(profileId, since, until, interval, accessPointId);
          return new Response(JSON.stringify(trend), { headers: { 'Content-Type': 'application/json' } });
        }
        if (subResource === 'top_allowed') {
          const topAllowed = await logModel.getTopAllowed(profileId, since, until, accessPointId);
          return new Response(JSON.stringify(topAllowed), { headers: { 'Content-Type': 'application/json' } });
        }
        if (subResource === 'top_blocked') {
          const topBlocked = await logModel.getTopBlocked(profileId, since, until, accessPointId);
          return new Response(JSON.stringify(topBlocked), { headers: { 'Content-Type': 'application/json' } });
        }
        if (subResource === 'clients') {
          const clients = await logModel.getClients(profileId, since, until, accessPointId);
          return new Response(JSON.stringify(clients), { headers: { 'Content-Type': 'application/json' } });
        }
        if (subResource === 'destinations') {
          const destinations = await logModel.getDestinations(profileId, since, until, accessPointId);
          return new Response(JSON.stringify(destinations), { headers: { 'Content-Type': 'application/json' } });
        }
        return new Response("Not Found", { status: 404 });
      }
      
      const analytics = await logModel.getAnalytics(profileId, since, until, interval, accessPointId);
      return new Response(JSON.stringify(analytics), { headers: { 'Content-Type': 'application/json' } });
    }

    // 子资源路由: /api/profiles/:id/lists
    if (pathParts[3] === 'lists') {
      if (request.method === 'POST') {
        if (pathParts[4] === 'sync') { ctx.waitUntil(syncProfileLists(profileId, env, ctx)); return new Response(JSON.stringify({ message: "Sync started" }), { status: 202 }); }
        const { url: listUrl } = await request.json() as { url: string };
        if (!listUrl || (!listUrl.startsWith('http://') && !listUrl.startsWith('https://'))) {
          return new Response("Invalid list URL format", { status: 400 });
        }
        if (!isSafeUrl(listUrl)) {
          return new Response("Invalid list URL. Private networks and localhosts are not allowed.", { status: 400 });
        }
        await profileModel.addList(profileId, listUrl);
        ctx.waitUntil(syncProfileLists(profileId, env, ctx));
        ctx.waitUntil(pipeline.clearCache(profileId));
        return new Response(null, { status: 201 });
      }
      if (request.method === 'DELETE') {
        const { id } = await request.json() as { id: number };
        await profileModel.deleteList(id, profileId);
        ctx.waitUntil(syncProfileLists(profileId, env, ctx));
        ctx.waitUntil(pipeline.clearCache(profileId));
        return new Response(null, { status: 204 });
      }
    }

    // 子资源路由: /api/profiles/:id/access_points
    if (pathParts[3] === 'access_points') {
      if (request.method === 'GET') {
        const results = await profileModel.getAccessPoints(profileId);
        return new Response(JSON.stringify(results), { headers: { 'Content-Type': 'application/json' } });
      }
      if (request.method === 'POST') {
        if (pathParts.length === 6 && pathParts[5] === 'rotate_token') {
          const apId = pathParts[4];
          const newToken = await profileModel.rotateAccessPointToken(apId, profileId);
          return new Response(JSON.stringify({ token: newToken }), { headers: { 'Content-Type': 'application/json' } });
        }
        const body = await request.json() as { name: string };
        if (!body.name) return new Response("Name is required", { status: 400 });
        if (!AP_NAME_REGEX.test(body.name)) return new Response("Invalid Access Point name format", { status: 400 });
        
        const currentAps = await profileModel.getAccessPoints(profileId);
        if (currentAps.length >= 100) return new Response("Access point limit exceeded (max 100)", { status: 400 });
        
        const result = await profileModel.addAccessPoint(profileId, body.name);
        return new Response(JSON.stringify(result), { status: 201, headers: { 'Content-Type': 'application/json' } });
      }
      if (request.method === 'PATCH' && pathParts.length === 5) {
        const apId = pathParts[4];
        const body = await request.json() as { name: string };
        if (!body.name) return new Response("Name is required", { status: 400 });
        if (!AP_NAME_REGEX.test(body.name)) return new Response("Invalid Access Point name format", { status: 400 });
        await profileModel.updateAccessPointName(apId, profileId, body.name);
        return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
      }
      if (request.method === 'DELETE' && pathParts.length === 5) {
        const apId = pathParts[4];
        await profileModel.deleteAccessPoint(apId, profileId);
        return new Response(null, { status: 204 });
      }
    }

    // 子资源路由: /api/profiles/:id/rules
    if (pathParts[3] === 'rules') {
      if (request.method === 'GET') { const results = await profileModel.getRules(profileId); return new Response(JSON.stringify(results), { headers: { 'Content-Type': 'application/json' } }); }
      if (request.method === 'POST') {
        const rule = await request.json() as any;
        const pattern = rule.pattern ? rule.pattern.trim() : "";
        if (!pattern) {
          return new Response("Domain pattern cannot be empty", { status: 400 });
        }
        const existing = await profileModel.getRuleByPattern(profileId, pattern);
        if (existing) {
          return new Response("Rule for this domain already exists", { status: 400 });
        }
        await profileModel.addRule(profileId, rule);
        ctx.waitUntil(pipeline.clearCache(profileId));
        return new Response(null, { status: 201 });
      }
      if (request.method === 'PUT') {
        const rule = await request.json() as any;
        const pattern = rule.pattern ? rule.pattern.trim() : "";
        if (!pattern) {
          return new Response("Domain pattern cannot be empty", { status: 400 });
        }
        const existing = await profileModel.getRuleByPatternExcludeId(profileId, pattern, rule.id);
        if (existing) {
          return new Response("Rule for this domain already exists", { status: 400 });
        }
        await profileModel.updateRule(rule.id, profileId, rule);
        ctx.waitUntil(pipeline.clearCache(profileId));
        return new Response(null, { status: 200 });
      }
      if (request.method === 'DELETE') { const { id } = await request.json() as any; await profileModel.deleteRule(id, profileId); ctx.waitUntil(pipeline.clearCache(profileId)); return new Response(null, { status: 204 }); }
    }
  }

  return new Response("Not Found", { status: 404 });
}
