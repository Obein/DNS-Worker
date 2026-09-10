import { Env, User, ExecutionContext } from "../../types";
import { createBlankRefreshTokenCookie, readRefreshTokenCookie, parseRefreshTokenString } from "../../lib/auth";
import { UserModel } from "../../models/user";
import { LogModel } from "../../models/log";
import { PasskeyModel } from "../../models/passkey";
import { USERNAME_REGEX } from "../../utils/validator";

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
  const userModel = new UserModel(env.DB, env);
  const logModel = new LogModel(env.DB);
  const action = pathParts[2];

  // GET /api/account/me & PATCH /api/account/me
  if (action === 'me') {
    if (request.method === 'GET') {
      const dbUser = await userModel.getById(user.id);
      const globalMaxRetention = env.MAX_LOG_RETENTION_DAYS !== undefined && env.MAX_LOG_RETENTION_DAYS !== ''
        ? Number(env.MAX_LOG_RETENTION_DAYS)
        : 30;
      const adminMaxRetention = env.ADMIN_USER_MAX_LOG_RETENTION_DAYS !== undefined && env.ADMIN_USER_MAX_LOG_RETENTION_DAYS !== ''
        ? Math.min(Number(env.ADMIN_USER_MAX_LOG_RETENTION_DAYS), globalMaxRetention)
        : globalMaxRetention;
      const normalUserMax = env.NORMAL_USER_MAX_LOG_RETENTION_DAYS !== undefined && env.NORMAL_USER_MAX_LOG_RETENTION_DAYS !== ''
        ? Math.min(Number(env.NORMAL_USER_MAX_LOG_RETENTION_DAYS), globalMaxRetention)
        : Math.min(7, globalMaxRetention);

      const passkeyModel = new PasskeyModel(env.DB);
      const passkeysCount = await passkeyModel.countByUser(user.id);
      const mfaEnabled = !!(dbUser?.totp_enabled) || passkeysCount > 0;

      return new Response(JSON.stringify({
        id: user.id,
        username: dbUser?.username || "",
        role: user.role,
        totp_enabled: !!(dbUser?.totp_enabled),
        totp_skip_password: !!(dbUser?.totp_skip_password),
        passkeys_count: passkeysCount,
        mfa_enabled: mfaEnabled,
        timezone: dbUser?.timezone || null,
        locale: dbUser?.locale || "en-US",
        password_version: dbUser?.password_version ?? 1,
        pin_enabled: !!(dbUser?.pin_hash),
        session_lock_timeout: dbUser?.session_lock_timeout ?? 15,
        max_log_retention_days: user.role === 'admin' ? adminMaxRetention : normalUserMax,
      }), { headers: { 'Content-Type': 'application/json' } });
    }

    if (request.method === 'PATCH') {
      const body = await request.json() as any;
      try {
        if (body.session_lock_timeout !== undefined) {
          const timeout = Number(body.session_lock_timeout);
          await userModel.updateSessionLockTimeout(user.id, timeout);
        }

        if (body.username !== undefined) {
          const newUsername = body.username;
          if (!newUsername || !USERNAME_REGEX.test(newUsername)) {
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
