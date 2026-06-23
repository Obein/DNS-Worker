import { Env } from "../../types";
import {
  readRefreshTokenCookie, createBlankRefreshTokenCookie,
  createRefreshTokenCookie, getOrCreateJwtSecret, rotateSession,
  parseRefreshTokenString, generateSessionHash
} from "../../lib/auth";
import { importJwtSecret, signJWT } from "../../lib/jwt";
import { ActivityLogModel } from "../../models/activityLog";
import { cacheUtils } from "../../utils/cache";

/**
 * Handle session token refresh requests
 */
export async function handleRefreshRequest(request: Request, env: Env): Promise<Response> {
  const cache = (caches as any).default;
  const clientIp = request.headers.get("CF-Connecting-IP") || "127.0.0.1";
  const userAgent = request.headers.get("User-Agent");
  const activityLog = new ActivityLogModel(env.DB);

  if (await cacheUtils.isRateLimited(cache, `refresh_fail:${clientIp}`, 20, 60)) {
    return new Response("Too many attempts", { status: 429 });
  }

  const refreshToken = readRefreshTokenCookie(request.headers.get("Cookie"));
  if (!refreshToken) return new Response("Refresh token missing", { status: 401 });

  const { getRequestCoordinates } = await import("../../lib/auth");
  const { latitude, longitude } = getRequestCoordinates(request);
  const { session, user, newRefreshToken, reason } = await rotateSession(env, refreshToken, latitude, longitude);

  if (!session || !user || !newRefreshToken) {
    if (user) {
      const parsed = refreshToken ? parseRefreshTokenString(refreshToken) : null;
      const sessionHash = parsed ? await generateSessionHash(parsed.sid, user.id) : null;
      await activityLog.record(user.id, 'logout', clientIp, userAgent, { reason: reason || 'unknown' }, sessionHash);
    }
    await cacheUtils.isRateLimited(cache, `refresh_fail:${clientIp}`, 100, 60);
    return new Response(JSON.stringify({ error: "Invalid refresh token", reason: reason || "unknown" }), { 
      status: 401,
      headers: {
        "Set-Cookie": createBlankRefreshTokenCookie(),
        "Content-Type": "application/json"
      }
    });
  }

  const secret = await getOrCreateJwtSecret(env);
  const jwtKey = await importJwtSecret(secret);
  const expMinutes = Number(env.ACCESS_TOKEN_EXPIRATION_MINUTES) || 10;
  const accessToken = await signJWT({ 
    userId: user.id, 
    role: user.role, 
    sessionId: session.id,
    exp: Math.floor(Date.now() / 1000) + expMinutes * 60
  }, jwtKey);

  const headers = new Headers({ "Content-Type": "application/json" });
  const isKeepLoggedIn = session.id.startsWith("k_");
  headers.append("Set-Cookie", createRefreshTokenCookie(newRefreshToken, env, isKeepLoggedIn));

  return new Response(JSON.stringify({ success: true, accessToken }), { headers });
}
