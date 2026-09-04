import { Env, User, Profile, ProfileSettings, ExecutionContext } from "../../types";
import { LogModel } from "../../models/log";
import { cacheUtils } from "../../utils/cache";

/**
 * Handle logs and analytics requests to /api/profiles/:id/logs and /api/profiles/:id/analytics
 */
export async function handleProfileLogsAndAnalyticsRequest(
  request: Request,
  env: Env,
  user: User,
  profile: Profile,
  pathParts: string[],
  ctx: ExecutionContext
): Promise<Response> {
  const logModel = new LogModel(env.DB);
  const profileId = profile.id;

  // Handle Logs endpoint: /api/profiles/:id/logs
  if (pathParts[3] === 'logs') {
    if (request.method !== 'GET') {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const urlParams = new URL(request.url).searchParams;
    const range = urlParams.get('range') || '24h';
    const before = urlParams.get('before');
    const status = urlParams.get('status');
    const search = urlParams.get('search');
    const accessPointId = urlParams.get('access_point_id');
    const destCountry = urlParams.get('dest_country');
    const isp = urlParams.get('isp');
    const domain = urlParams.get('domain') || undefined;
    const recordType = urlParams.get('record_type') || undefined;
    const geoCountry = urlParams.get('geo_country') || undefined;
    const reason = urlParams.get('reason') || undefined;
    const startParam = urlParams.get('start');
    const endParam = urlParams.get('end');
    
    let since: number;
    let until = Math.floor(Date.now() / 1000);
    const settings: ProfileSettings = JSON.parse(profile.settings);
    const logRetentionDays = settings.log_retention_days !== undefined ? Number(settings.log_retention_days) : 30;
    const retentionThreshold = Math.floor(until - (logRetentionDays * 24 * 3600));

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

    if (pathParts.length > 4) {
      if (pathParts[4] === 'export') {
        const results = await logModel.getLogs(profileId, {
          since,
          until,
          status: status || undefined,
          search: search || undefined,
          access_point_id: accessPointId || undefined,
          dest_country: destCountry || undefined,
          isp: isp || undefined,
          domain,
          record_type: recordType,
          geo_country: geoCountry,
          reason,
          export: true
        });
        return new Response(JSON.stringify(results), { headers: { 'Content-Type': 'application/json' } });
      }

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

    let limit = parseInt(urlParams.get('limit') || '50', 10);
    if (isNaN(limit) || limit <= 0) {
      limit = 50;
    } else if (limit > 100) {
      limit = 100;
    }

    const results = await logModel.getLogs(profileId, {
      since,
      until,
      status: status || undefined,
      search: search || undefined,
      before: before ? parseInt(before) : undefined,
      limit,
      access_point_id: accessPointId || undefined,
      dest_country: destCountry || undefined,
      isp: isp || undefined,
      domain,
      record_type: recordType,
      geo_country: geoCountry,
      reason
    });
    return new Response(JSON.stringify(results), { headers: { 'Content-Type': 'application/json' } });
  }

  // Handle Analytics endpoint: /api/profiles/:id/analytics
  if (pathParts[3] === 'analytics') {
    if (request.method !== 'GET') {
      return new Response("Method Not Allowed", { status: 405 });
    }

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
      const cache = (caches as any).default;
      const subCacheKey = `analytics_sub:${profileId}:${subResource}:${urlParams.toString()}`;
      const cached = await cacheUtils.get<any>(cache, subCacheKey);
      if (cached) {
        return new Response(JSON.stringify(cached), {
          headers: {
            'Content-Type': 'application/json',
            'X-Cache': 'HIT',
            'Cache-Control': 'public, max-age=300'
          }
        });
      }

      let data: any = null;
      if (subResource === 'summary') {
        const search = urlParams.get('search') || undefined;
        data = await logModel.getSummary(profileId, since, until, search, accessPointId);
      } else if (subResource === 'trend') {
        data = await logModel.getTrend(profileId, since, until, interval, accessPointId);
      } else if (subResource === 'top_allowed') {
        data = await logModel.getTopAllowed(profileId, since, until, accessPointId);
      } else if (subResource === 'top_blocked') {
        data = await logModel.getTopBlocked(profileId, since, until, accessPointId);
      } else if (subResource === 'clients') {
        data = await logModel.getClients(profileId, since, until, accessPointId);
      } else if (subResource === 'destinations') {
        const limitParam = urlParams.get('limit');
        const limit = limitParam ? parseInt(limitParam, 10) : undefined;
        data = await logModel.getDestinations(profileId, since, until, accessPointId, limit !== undefined && !isNaN(limit) ? limit : undefined);
      } else if (subResource === 'isps') {
        const countryCode = urlParams.get('country_code') || undefined;
        const limitParam = urlParams.get('limit');
        const limit = limitParam ? parseInt(limitParam, 10) : undefined;
        data = await logModel.getISPByCountry(profileId, countryCode, since, until, accessPointId, limit !== undefined && !isNaN(limit) ? limit : undefined);
      } else {
        return new Response("Not Found", { status: 404 });
      }

      await cacheUtils.set(cache, subCacheKey, data, 300);
      return new Response(JSON.stringify(data), {
        headers: {
          'Content-Type': 'application/json',
          'X-Cache': 'MISS',
          'Cache-Control': 'public, max-age=300'
        }
      });
    }
    
    const cache = (caches as any).default;
    const cacheKey = `analytics:${profileId}:${since}:${until}:${interval}:${accessPointId || 'all'}`;
    const cached = await cacheUtils.get<any>(cache, cacheKey);
    if (cached) {
      return new Response(JSON.stringify(cached), {
        headers: {
          'Content-Type': 'application/json',
          'X-Cache': 'HIT',
          'Cache-Control': 'public, max-age=60'
        }
      });
    }

    const analytics = await logModel.getAnalytics(profileId, since, until, interval, accessPointId);
    await cacheUtils.set(cache, cacheKey, analytics, 60);

    return new Response(JSON.stringify(analytics), {
      headers: {
        'Content-Type': 'application/json',
        'X-Cache': 'MISS',
        'Cache-Control': 'public, max-age=60'
      }
    });
  }

  return new Response("Not Found", { status: 404 });
}
