import { Env } from "../../types";
import {
  readRefreshTokenCookie, parseRefreshTokenString, invalidateSession, createBlankRefreshTokenCookie,
  generateSessionHash
} from "../../lib/auth";
import { SessionModel } from "../../models/session";
import { ActivityLogModel } from "../../models/activityLog";

/**
 * Handle session logout requests
 */
export async function handleLogoutRequest(request: Request, env: Env): Promise<Response> {
  const clientIp = request.headers.get("CF-Connecting-IP") || "127.0.0.1";
  const userAgent = request.headers.get("User-Agent");
  const activityLog = new ActivityLogModel(env.DB);

  const refreshToken = readRefreshTokenCookie(request.headers.get("Cookie"));
  if (refreshToken) {
    const parsed = parseRefreshTokenString(refreshToken);
    if (parsed) {
      const sessionModel = new SessionModel(env.DB);
      const userId = await sessionModel.getSessionUserId(parsed.sid);
      await invalidateSession(env, parsed.sid);
      if (userId) {
        const sessionHash = await generateSessionHash(parsed.sid, userId);
        await activityLog.record(userId, 'logout', clientIp, userAgent, { reason: 'user_active' }, sessionHash);
      }
    }
  }
  const responseHeaders = new Headers({ "Content-Type": "application/json" });
  responseHeaders.append("Set-Cookie", createBlankRefreshTokenCookie());
  responseHeaders.append("Set-Cookie", "csrf_token=; SameSite=Lax; Path=/; Max-Age=0; Secure");
  return new Response(JSON.stringify({ success: true }), {
    headers: responseHeaders
  });
}
