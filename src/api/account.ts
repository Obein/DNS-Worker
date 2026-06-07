import { Env, User, ExecutionContext } from "../types";
import { RBAC } from "../lib/rbac";
import { generateId, createBlankSessionCookie } from "../lib/auth";
import { hashPassword, verifyPassword } from "../utils/crypto";
import { generateTOTPSecret, getTOTPUri, generateRecoveryKeys, hashRecoveryKey, verifyTOTP } from "../lib/totp";
import { UserModel } from "../models/user";
import { ProfileModel } from "../models/profile";
import { LogModel } from "../models/log";
import { ActivityLogModel } from "../models/activityLog";
import { SystemSettingsModel } from "../models/systemSettings";

export async function handleAccountRequest(request: Request, env: Env, user: User, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const pathParts = url.pathname.split('/').filter(Boolean);
  const userModel = new UserModel(env.DB);
  const profileModel = new ProfileModel(env.DB);
  const logModel = new LogModel(env.DB);
  const activityLog = new ActivityLogModel(env.DB);
  const clientIp = request.headers.get("CF-Connecting-IP") || "127.0.0.1";
  const userAgent = request.headers.get("User-Agent");

  // ─── 个人账号接口 (/api/account/...) ───────────────────────────────────────
  if (pathParts[1] === 'account') {

    // GET /api/account/me
    if (pathParts[2] === 'me' && request.method === 'GET') {
      const dbUser = await userModel.getById(user.id);
      return new Response(JSON.stringify({
        id: user.id,
        username: user.username,
        role: user.role,
        totp_enabled: !!(dbUser?.totp_enabled),
        totp_skip_password: !!(dbUser?.totp_skip_password),
      }), { headers: { 'Content-Type': 'application/json' } });
    }

    // PATCH /api/account/me (username update)
    if (pathParts[2] === 'me' && request.method === 'PATCH') {
      const { username: newUsername } = await request.json() as any;
      if (!newUsername || !/^[a-zA-Z0-9]{5,15}$/.test(newUsername)) {
        return new Response("Username format error", { status: 400 });
      }
      try {
        await userModel.updateUsername(user.id, newUsername);
        return new Response(JSON.stringify({ success: true }));
      } catch (e: any) {
        if (e.message?.includes("UNIQUE constraint failed")) return new Response("The username is already taken", { status: 400 });
        return new Response("Failed to update username", { status: 500 });
      }
    }

    // POST /api/account/password (password change)
    if (pathParts[2] === 'password' && request.method === 'POST') {
      const { oldPassword, totpToken, totpSalt, newPassword } = await request.json() as any;
      if (!newPassword || newPassword.length < 8 || !/(?=.*[a-zA-Z])(?=.*[0-9])/.test(newPassword)) {
        return new Response("Password format error", { status: 400 });
      }
      const dbUser = await userModel.getById(user.id);
      if (!dbUser) return new Response("User not found", { status: 404 });

      let authenticated = false;

      // 如果提供了 TOTP Token，并且用户启用了 TOTP，则使用 TOTP 校验
      if (totpToken && dbUser.totp_enabled && dbUser.totp_secret) {
        authenticated = await verifyTOTP(dbUser.totp_secret, totpToken, totpSalt);
        if (!authenticated) {
          await activityLog.record(user.id, 'password_change_fail', clientIp, userAgent, { reason: 'invalid_totp' });
          return new Response("Invalid TOTP code", { status: 400 });
        }
      } 
      // 否则使用旧密码校验
      else if (oldPassword) {
        authenticated = await verifyPassword(oldPassword, dbUser.hashed_password);
        if (!authenticated) {
          await activityLog.record(user.id, 'password_change_fail', clientIp, userAgent, { reason: 'wrong_current_password' });
          return new Response("Current password is incorrect", { status: 400 });
        }
      } 
      else {
        return new Response("Authentication required (Old Password or TOTP)", { status: 400 });
      }

      const hashedPassword = await hashPassword(newPassword);
      await userModel.updatePassword(user.id, hashedPassword);
      await activityLog.record(user.id, 'password_change_success', clientIp, userAgent, { method: totpToken ? 'totp' : 'password' });
      return new Response(JSON.stringify({ success: true }));
    }

    // GET /api/account/activity (user activity log)
    if (pathParts[2] === 'activity' && request.method === 'GET') {
      const params = new URL(request.url).searchParams;
      const limit = Math.min(parseInt(params.get('limit') || '20', 10), 50);
      const before = params.get('before') ? parseInt(params.get('before')!, 10) : undefined;
      const entries = await activityLog.listByUser(user.id, limit, before);
      return new Response(JSON.stringify(entries), { headers: { 'Content-Type': 'application/json' } });
    }

    // GET /api/account/sessions (active sessions)
    if (pathParts[2] === 'sessions' && !pathParts[3] && request.method === 'GET') {
      const { SessionModel } = await import("../models/session");
      const sessionModel = new SessionModel(env.DB);
      const sessions = await sessionModel.getSessionsByUser(user.id);
      
      const { readSessionCookie } = await import("../lib/auth");
      const currentSessionId = readSessionCookie(request.headers.get("Cookie"));
      
      const sessionData = sessions.map(s => ({
        ...s,
        is_current: s.id === currentSessionId
      }));
      
      return new Response(JSON.stringify(sessionData), { headers: { 'Content-Type': 'application/json' } });
    }

    // DELETE /api/account/sessions/:id (revoke session)
    if (pathParts[2] === 'sessions' && pathParts[3] && request.method === 'DELETE') {
      const targetSessionId = pathParts[3];
      const { SessionModel } = await import("../models/session");
      const sessionModel = new SessionModel(env.DB);
      
      // Ensure the session belongs to the user
      const sessionUserId = await sessionModel.getSessionUserId(targetSessionId);
      if (sessionUserId !== user.id) {
        return new Response("Forbidden", { status: 403 });
      }
      
      const { invalidateSession, readSessionCookie, createBlankSessionCookie } = await import("../lib/auth");
      await invalidateSession(env, targetSessionId);
      await activityLog.record(user.id, 'session_revoked', clientIp, userAgent);
      
      // If revoking current session, clear cookie
      const currentSessionId = readSessionCookie(request.headers.get("Cookie"));
      if (targetSessionId === currentSessionId) {
        return new Response(JSON.stringify({ success: true, is_current: true }), {
          headers: { "Set-Cookie": createBlankSessionCookie(), "Content-Type": "application/json" }
        });
      }
      
      return new Response(JSON.stringify({ success: true, is_current: false }), {
        headers: { "Content-Type": "application/json" }
      });
    }

    // ─── TOTP 管理接口 (/api/account/totp/...) ───

    // GET /api/account/totp/setup — generate new TOTP secret (not yet saved)
    if (pathParts[2] === 'totp' && pathParts[3] === 'setup' && request.method === 'GET') {
      const dbUser = await userModel.getById(user.id);
      if (dbUser?.totp_enabled) {
        return new Response("TOTP is already enabled", { status: 409 });
      }
      const secret = generateTOTPSecret();
      const uri = getTOTPUri(secret, user.username, 'ObexDNS');
      return new Response(JSON.stringify({ secret, uri }), { headers: { 'Content-Type': 'application/json' } });
    }

    // POST /api/account/totp/confirm — verify TOTP code and activate
    if (pathParts[2] === 'totp' && pathParts[3] === 'confirm' && request.method === 'POST') {
      const { secret, token, salt } = await request.json() as { secret: string; token: string; salt?: string };
      if (!secret || !token) return new Response("Missing secret or token", { status: 400 });

      const isValid = await verifyTOTP(secret, token, salt);
      if (!isValid) return new Response("Invalid TOTP code", { status: 400 });

      // Generate 8 recovery keys, hash them for storage, return plaintext once
      const plaintextKeys = generateRecoveryKeys();
      const hashedKeys = await Promise.all(plaintextKeys.map(hashRecoveryKey));

      await userModel.updateTOTP(user.id, secret, hashedKeys);
      await activityLog.record(user.id, 'totp_setup', clientIp, userAgent);

      return new Response(JSON.stringify({ success: true, recovery_keys: plaintextKeys }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // DELETE /api/account/totp — disable TOTP (requires password verification)
    if (pathParts[2] === 'totp' && !pathParts[3] && request.method === 'DELETE') {
      const { password } = await request.json() as { password: string };
      const dbUser = await userModel.getById(user.id);
      if (!dbUser) return new Response("User not found", { status: 404 });

      // If the user is in skip_password mode, they may not have a usable password — allow
      // them to disable via TOTP token instead
      if (!dbUser.totp_skip_password) {
        if (!password || !(await verifyPassword(password, dbUser.hashed_password))) {
          return new Response("Incorrect password", { status: 400 });
        }
      }

      await userModel.removeTOTP(user.id);
      await activityLog.record(user.id, 'totp_removed', clientIp, userAgent);
      return new Response(JSON.stringify({ success: true }));
    }

    // PATCH /api/account/totp/settings — update skip_password toggle
    if (pathParts[2] === 'totp' && pathParts[3] === 'settings' && request.method === 'PATCH') {
      const dbUser = await userModel.getById(user.id);
      if (!dbUser?.totp_enabled) return new Response("TOTP is not enabled", { status: 400 });

      const { skip_password } = await request.json() as { skip_password: boolean };
      await userModel.updateTOTPSettings(user.id, !!skip_password);
      return new Response(JSON.stringify({ success: true }));
    }

    // DELETE /api/account/logs
    if (pathParts[2] === 'logs' && request.method === 'DELETE') {
      await logModel.deleteByOwner(user.id);
      return new Response(JSON.stringify({ success: true }));
    }

    // DELETE /api/account/me (delete account)
    if (pathParts[2] === 'me' && request.method === 'DELETE') {
      if (RBAC.isAdmin(user)) return new Response("Administrator accounts cannot be deleted directly", { status: 400 });
      await profileModel.deleteByOwner(user.id);
      await userModel.delete(user.id);
      const blankCookie = createBlankSessionCookie();
      return new Response(JSON.stringify({ success: true }), { headers: { "Set-Cookie": blankCookie } });
    }
  }

  // ─── 管理员接口 (/api/admin/...) ────────────────────────────────────────────
  if (pathParts[1] === 'admin') {
    if (!RBAC.isAdmin(user)) return new Response("Forbidden", { status: 403 });

    if (pathParts[2] === 'users') {
      if (request.method === 'GET') {
        const users = await userModel.listAll();
        return new Response(JSON.stringify(users), { headers: { 'Content-Type': 'application/json' } });
      }
      if (request.method === 'POST') {
        const { username, password, role } = await request.json() as any;
        const hashedPassword = await hashPassword(password);
        const userId = generateId(15);
        try {
          await userModel.create({ id: userId, username, passwordHash: hashedPassword, role: role || 'user' });
          return new Response(JSON.stringify({ id: userId }), { status: 201 });
        } catch (e: any) {
          return new Response(e.message, { status: 400 });
        }
      }
      if (request.method === 'DELETE' && pathParts[3]) {
        const targetId = pathParts[3];
        if (targetId === user.id) return new Response("Cannot delete yourself", { status: 400 });
        await profileModel.deleteByOwner(targetId);
        await userModel.delete(targetId);
        return new Response(null, { status: 204 });
      }
    }

    // 系统设置接口: /api/admin/settings
    if (pathParts[2] === 'settings') {
      const systemSettings = new SystemSettingsModel(env.DB);
      if (request.method === 'GET') {
        const settings = await systemSettings.getAll();
        return new Response(JSON.stringify(settings), { headers: { 'Content-Type': 'application/json' } });
      }
      if (request.method === 'PATCH') {
        const body = await request.json() as Record<string, string>;
        await systemSettings.setMany(body);
        return new Response(JSON.stringify({ success: true }));
      }
    }
  }

  return new Response("Not Found", { status: 404 });
}
