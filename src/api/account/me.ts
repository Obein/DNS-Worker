import { Env, User, ExecutionContext } from "../../types";
import { createBlankRefreshTokenCookie, readRefreshTokenCookie, parseRefreshTokenString } from "../../lib/auth";
import { UserModel } from "../../models/user";
import { LogModel } from "../../models/log";

/**
 * Handle requests to /api/account/me, /api/account/logs, /api/account/delete
 */
export async function handleMeRequest(
  request: Request,
  env: Env,
  user: User,
  pathParts: string[],
  ctx: ExecutionContext
): Promise<Response> {
  const userModel = new UserModel(env.DB);
  const logModel = new LogModel(env.DB);
  const action = pathParts[2];

  // GET /api/account/me & PATCH /api/account/me
  if (action === 'me') {
    if (request.method === 'GET') {
      const dbUser = await userModel.getById(user.id);
      return new Response(JSON.stringify({
        id: user.id,
        username: dbUser?.username || "",
        role: user.role,
        totp_enabled: !!(dbUser?.totp_enabled),
        totp_skip_password: !!(dbUser?.totp_skip_password),
        timezone: dbUser?.timezone || null,
        locale: dbUser?.locale || "en-US",
      }), { headers: { 'Content-Type': 'application/json' } });
    }

    if (request.method === 'PATCH') {
      const body = await request.json() as any;
      try {
        if (body.username !== undefined) {
          const newUsername = body.username;
          if (!newUsername || !/^[a-z_][a-z0-9_-]{4,31}$/.test(newUsername)) {
            return new Response("Username format error", { status: 400 });
          }
          await userModel.updateUsername(user.id, newUsername);
        }

        if (body.timezone !== undefined) {
          const newTimezone = body.timezone;
          if (newTimezone !== null && typeof newTimezone === 'string' && newTimezone !== '') {
            try {
              Intl.DateTimeFormat(undefined, { timeZone: newTimezone });
            } catch (e) {
              return new Response("Invalid timezone format", { status: 400 });
            }
          }
          await userModel.updateTimezone(user.id, newTimezone || null);
        }

        if (body.locale !== undefined) {
          const newLocale = body.locale;
          if (newLocale !== null && typeof newLocale === 'string' && newLocale !== '') {
            try {
              Intl.DateTimeFormat(newLocale);
            } catch (e) {
              return new Response("Invalid locale format", { status: 400 });
            }
          }
          await userModel.updateLocale(user.id, newLocale || "en-US");
        }

        return new Response(JSON.stringify({ success: true }));
      } catch (e: any) {
        if (e.message?.includes("UNIQUE constraint failed")) return new Response("The username is already taken", { status: 400 });
        return new Response("Failed to update settings", { status: 500 });
      }
    }

    return new Response("Method Not Allowed", { status: 405 });
  }

  // DELETE /api/account/logs
  if (action === 'logs' && request.method === 'DELETE') {
    await logModel.deleteByOwner(user.id);
    return new Response(JSON.stringify({ success: true }));
  }

  // POST /api/account/delete (delete account)
  if (action === 'delete' && request.method === 'POST') {
    const { invalidateSession } = await import("../../lib/auth");
    const cookieHeader = request.headers.get("Cookie") || "";
    const refreshToken = readRefreshTokenCookie(cookieHeader);
    const sessionId = refreshToken ? parseRefreshTokenString(refreshToken)?.sid || null : null;
    if (sessionId) await invalidateSession(env, sessionId);
    await userModel.delete(user.id);
    return new Response(JSON.stringify({ success: true }), {
      headers: { "Set-Cookie": createBlankRefreshTokenCookie(), "Content-Type": "application/json" }
    });
  }

  return new Response("Not Found", { status: 404 });
}
