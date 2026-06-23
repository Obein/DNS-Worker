import { Env, User, ExecutionContext } from "../../types";
import { createBlankRefreshTokenCookie, readRefreshTokenCookie, parseRefreshTokenString, generateSessionHash } from "../../lib/auth";
import { ActivityLogModel } from "../../models/activityLog";

/**
 * Handle user sessions and activity logs requests under /api/account/sessions and /api/account/activity
 */
export async function handleSessionsRequest(
  request: Request,
  env: Env,
  user: User,
  pathParts: string[],
  ctx: ExecutionContext
): Promise<Response> {
  const activityLog = new ActivityLogModel(env.DB);
  const clientIp = request.headers.get("CF-Connecting-IP") || "127.0.0.1";
  const userAgent = request.headers.get("User-Agent");
  const action = pathParts[2];

  // GET /api/account/activity (user activity log)
  if (action === 'activity' && request.method === 'GET') {
    const params = new URL(request.url).searchParams;
    const limit = Math.min(parseInt(params.get('limit') || '20', 10), 50);
    const before = params.get('before') ? parseInt(params.get('before')!, 10) : undefined;
    const entries = await activityLog.listByUser(user.id, limit, before);
    return new Response(JSON.stringify(entries), { headers: { 'Content-Type': 'application/json' } });
  }

  // Active Sessions
  if (action === 'sessions') {
    // GET /api/account/sessions (active sessions)
    if (!pathParts[3] && request.method === 'GET') {
      const { SessionModel } = await import("../../models/session");
      const sessionModel = new SessionModel(env.DB);
      const sessions = await sessionModel.getSessionsByUser(user.id);
      
      const cookieHeader = request.headers.get("Cookie") || "";
      const refreshToken = readRefreshTokenCookie(cookieHeader);
      const currentSessionId = refreshToken ? parseRefreshTokenString(refreshToken)?.sid || null : null;
      
      const sessionData = await Promise.all(sessions.map(async s => ({
        ...s,
        id: await generateSessionHash(s.id, user.id),
        is_current: s.id === currentSessionId
      })));
      
      return new Response(JSON.stringify(sessionData), { headers: { 'Content-Type': 'application/json' } });
    }

    // DELETE /api/account/sessions/:id (revoke session)
    if (pathParts[3] && request.method === 'DELETE') {
      const targetSessionHash = pathParts[3];
      const { SessionModel } = await import("../../models/session");
      const sessionModel = new SessionModel(env.DB);
      
      const sessions = await sessionModel.getSessionsByUser(user.id);
      let targetSessionId: string | null = null;
      for (const s of sessions) {
        if (await generateSessionHash(s.id, user.id) === targetSessionHash) {
          targetSessionId = s.id;
          break;
        }
      }
      
      if (!targetSessionId) {
        return new Response("Not Found", { status: 404 });
      }
      
      const { invalidateSession } = await import("../../lib/auth");
      await invalidateSession(env, targetSessionId);
      
      const refreshToken = readRefreshTokenCookie(request.headers.get("Cookie") || "");
      const currentSessionId = refreshToken ? parseRefreshTokenString(refreshToken)?.sid || null : null;
      const currentSessionHash = currentSessionId ? await generateSessionHash(currentSessionId, user.id) : null;
      
      await activityLog.record(user.id, 'session_revoked', clientIp, userAgent, { reason: 'user_revoke', target_session: targetSessionHash }, targetSessionHash);
      
      // If revoking current session, clear cookie
      if (targetSessionId === currentSessionId) {
        return new Response(JSON.stringify({ success: true, is_current: true }), {
          headers: { "Set-Cookie": createBlankRefreshTokenCookie(), "Content-Type": "application/json" }
        });
      }
      
      return new Response(JSON.stringify({ success: true, is_current: false }), {
        headers: { "Content-Type": "application/json" }
      });
    }
  }

  return new Response("Not Found", { status: 404 });
}
