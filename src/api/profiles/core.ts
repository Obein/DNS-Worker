import { Env, User, Profile, ProfileSettings, ExecutionContext } from "../../types";
import { ProfileModel } from "../../models/profile";
import { LogModel } from "../../models/log";
import { generateId } from "../../lib/auth";
import { isSafeUrl } from "../../utils/validator";
import { buildDNSQuery, parseDNSAnswer } from "../../utils/dns";
import { pipeline } from "../../pipeline";

const PROFILE_NAME_REGEX = /^[\p{L}\p{N}_ -]{1,30}$/u;

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

  return new Response("Not Found", { status: 404 });
}
