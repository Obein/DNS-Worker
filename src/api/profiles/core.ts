import { Env, User, Profile, ProfileSettings, ExecutionContext } from "../../types";
import { ProfileModel } from "../../models/profile";
import { LogModel } from "../../models/log";
import { generateId } from "../../lib/auth";
import { isSafeUrl } from "../../utils/validator";
import { buildDNSQuery, parseDNSAnswer } from "../../utils/dns";
import { pipeline } from "../../pipeline";
import { PROFILE_NAME_REGEX } from "../../utils/validator";

/**
 * Handle requests to /api/profiles (without specific profile ID)
 */
export async function handleProfilesCoreCollectionRequest(
  request: Request,
  env: Env,
  user: User,
  pathParts: string[]
): Promise<Response> {
  const profileModel = new ProfileModel(env.DB);

  // GET /api/profiles
  if (request.method === 'GET') {
    const results = await profileModel.listByOwner(user.id);
    return new Response(JSON.stringify(results), { headers: { 'Content-Type': 'application/json' } });
  }

  // POST /api/profiles
  if (request.method === 'POST') {
    const body = await request.json() as { name: string };
    
    if (!body.name || !PROFILE_NAME_REGEX.test(body.name)) {
      return new Response("Invalid Profile Name format", { status: 400 });
    }

    const existingProfiles = await profileModel.listByOwner(user.id);
    const maxProfiles = Number(env.MAX_PROFILES_PER_USER) || 10;
    if (existingProfiles.length >= maxProfiles) return new Response(`Profile limit exceeded (max ${maxProfiles})`, { status: 400 });

    const existing = existingProfiles.find(p => p.name === body.name);
    if (existing) return new Response("The profile name already exists", { status: 400 });

    const newId = generateId(6);
    const defaultSettings: ProfileSettings = {
      upstream: ["https://security.cloudflare-dns.com/dns-query"],
      ecs: { enabled: true, use_client_ip: true },
      log_retention_days: user?.role !== 'admin' ? Number(env.NORMAL_USER_DEFAULT_LOG_RETENTION_DAYS) : Number(env.DEFAULT_LOG_RETENTION_DAYS) || 30,
      default_policy: 'ALLOW',
      best_effort_ech: { enabled: false, fronting_domain: "crypto.cloudflare.com" }
    };
    await profileModel.create({ id: newId, owner_id: user.id, name: body.name || "Unnamed Profile", settings: defaultSettings });
    return new Response(JSON.stringify({ id: newId }), { status: 201 });
  }

  return new Response("Method Not Allowed", { status: 405 });
}

/**
 * Handle core requests to /api/profiles/:id
 */
export async function handleProfilesCoreRequest(
  request: Request,
  env: Env,
  user: User | null,
  profile: Profile,
  pathParts: string[],
  ctx: ExecutionContext
): Promise<Response> {
  const profileModel = new ProfileModel(env.DB);
  const logModel = new LogModel(env.DB);
  const profileId = profile.id;

  // Handles:
  // - DELETE /api/profiles/:id
  // - PATCH /api/profiles/:id (updateName)
  // - GET /api/profiles/:id
  if (pathParts.length === 3) {
    if (request.method === 'DELETE') {
      await profileModel.delete(profileId);
      return new Response(null, { status: 204 });
    }

    if (request.method === 'PATCH') {
      const { name } = await request.json() as { name: string };
      if (!name || !PROFILE_NAME_REGEX.test(name)) return new Response("Invalid Profile Name format", { status: 400 });
      await profileModel.updateName(profileId, name);
      ctx.waitUntil(pipeline.clearCache(profileId));
      return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
    }

    if (request.method === 'GET') {
      return new Response(JSON.stringify(profile), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response("Method Not Allowed", { status: 405 });
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
    
    // Enforce log retention limit for non-admin users
    if (user?.role !== 'admin' && newSettings.log_retention_days != null) {
      newSettings.log_retention_days = Math.min(newSettings.log_retention_days, Number(env.NORMAL_USER_MAX_LOG_RETENTION_DAYS) || 7);
    }
    
    if (newSettings.upstream && Array.isArray(newSettings.upstream)) {
      for (const url of newSettings.upstream) {
        // 允许三种格式：https://...、http://...、tcp://...、裸 IP（8.8.8.8）或 IP:port（8.8.8.8:5353）
        // resolver.ts 中裸 IP 已被视为经典 TCP DNS，API 验证层对齐此行为。
        const isHttps = url.startsWith('https://');
        const isHttp  = url.startsWith('http://');
        const isTcp   = url.startsWith('tcp://');
        // 裸 host[:port]：不含 / 且不含 scheme
        const isBareHost = !url.includes('//') && !url.startsWith('/');

        if (!isHttps && !isHttp && !isTcp && !isBareHost) {
          return new Response("Invalid upstream URL format. Only HTTP(S), TCP, or bare host[:port] are allowed.", { status: 400 });
        }
        // 统一规范化后做安全检查（防 SSRF）
        const normalized = isBareHost ? `tcp://${url}` : url;
        if (!isSafeUrl(normalized)) {
          return new Response("Invalid upstream URL. Private networks and localhosts are not allowed.", { status: 400 });
        }
      }
    }

    await profileModel.updateSettings(profileId, newSettings);
    const days = newSettings.log_retention_days;
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
      geo_country: (request as any).cf?.country || request.headers.get("CF-IPCountry") || "UNKNOWN",
      success: true 
    }), { headers: { 'Content-Type': 'application/json' } });
  }

  return new Response("Not Found", { status: 404 });
}
