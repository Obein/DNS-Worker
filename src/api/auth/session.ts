import { Env } from "../../types";
import {
  generateId,
  createSession, createRefreshTokenCookie,
  readRefreshTokenCookie, invalidateSession, createBlankRefreshTokenCookie,
  createPreauthSession, createPreauthCookie,
  validatePreauthSession, invalidatePreauthSession, clearPreauthCookie,
  readPreauthCookie,
  getRequestCoordinates,
  createCsrfCookie,
  getOrCreateJwtSecret, rotateSession, parseRefreshTokenString
} from "../../lib/auth";
import { importJwtSecret, signJWT } from "../../lib/jwt";
import { verifyPassword } from "../../utils/crypto";
import { verifyTOTP, findMatchingRecoveryKey } from "../../lib/totp";
import { UserModel } from "../../models/user";
import { ActivityLogModel } from "../../models/activityLog";
import { SystemSettingsModel } from "../../models/systemSettings";
import { SessionModel } from "../../models/session";
import { cacheUtils } from "../../utils/cache";
import { verifyTurnstile } from "./utils";

/**
 * Handle session lifecycle: prelogin, login, token refresh, and logout
 */
export async function handleAuthSessionRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const userModel = new UserModel(env.DB);
  const activityLog = new ActivityLogModel(env.DB);
  const cache = (caches as any).default;
  const clientIp = request.headers.get("CF-Connecting-IP") || "127.0.0.1";
  const userAgent = request.headers.get("User-Agent");

  // 第一步：预登录 (只验证用户名和 Turnstile)
  if (url.pathname === '/api/auth/prelogin' && request.method === 'POST') {
    if (await cacheUtils.isRateLimited(cache, `login_fail:${clientIp}`, 10, 900)) {
      return new Response("Too many attempts", { status: 429 });
    }
    const { username, turnstileToken } = await request.json() as any;

    const settingsModel = new SystemSettingsModel(env.DB);
    const [secretKey, enabled] = await Promise.all([
      settingsModel.get('turnstile_secret_key'),
      settingsModel.get('turnstile_enabled_login')
    ]);
    if (enabled === 'true' && secretKey) {
      if (!await verifyTurnstile(turnstileToken, secretKey, clientIp)) {
        return new Response("Verification failed", { status: 400 });
      }
    }

    const user = await userModel.getByUsername(username);
    if (!user) {
      await cacheUtils.isRateLimited(cache, `login_fail:${clientIp}`, 100, 900); // penalty
      return new Response("User not found", { status: 404 });
    }

    // 签发 preauth session
    const preauthToken = await createPreauthSession(env, user.id);
    const preauthCookie = createPreauthCookie(preauthToken, env);

    const requires_password = !user.totp_skip_password;
    const requires_totp = !!user.totp_enabled;

    return new Response(JSON.stringify({ requires_password, requires_totp }), {
      headers: {
        "Set-Cookie": preauthCookie,
        "Content-Type": "application/json"
      }
    });
  }

  // 第二步：正式登录 (提交密码和/或 TOTP)
  if (url.pathname === '/api/auth/login' && request.method === 'POST') {
    if (request.headers.get("X-Password-Leaked") === "true" || request.headers.get("Exposed-Credential-Check") === "true") {
      return new Response("password_leaked", { status: 400 });
    }
    if (await cacheUtils.isRateLimited(cache, `login_fail:${clientIp}`, 10, 900)) {
      return new Response("Too many login attempts", { status: 429 });
    }

    const preauthToken = readPreauthCookie(request.headers.get("Cookie"));
    if (!preauthToken) return new Response("Pre-auth session missing or expired", { status: 401 });

    const userId = await validatePreauthSession(env, preauthToken);
    if (!userId) return new Response("Session expired, please start over", { status: 401 });

    const user = await userModel.getById(userId);
    if (!user) return new Response("User not found", { status: 404 });

    const { password, totpTokenHash, totpSalt, recoveryKey } = await request.json() as any;

    // 验证密码
    if (!user.totp_skip_password) {
      const passwordValid = await verifyPassword(password, user.hashed_password);
      if (!passwordValid) {
        await cacheUtils.isRateLimited(cache, `login_fail:${clientIp}`, 100, 900);
        await activityLog.record(userId, 'login_fail', clientIp, userAgent, { reason: 'wrong_password' });
        await invalidatePreauthSession(env, preauthToken);
        return new Response("Invalid password", { status: 400 });
      }
    }

    // 验证 TOTP 或 恢复密钥
    if (user.totp_enabled) {
      if (recoveryKey) {
        let storedHashes: string[] = [];
        try { storedHashes = JSON.parse(user.totp_recovery_keys || '[]'); } catch { }
        const matchIndex = await findMatchingRecoveryKey(recoveryKey, storedHashes);
        if (matchIndex === -1) {
          await activityLog.record(userId, 'totp_verify_fail', clientIp, userAgent, { method: 'recovery_key' });
          await invalidatePreauthSession(env, preauthToken);
          return new Response("Invalid recovery key", { status: 400 });
        }
        await userModel.consumeRecoveryKey(userId, matchIndex, storedHashes);
        await activityLog.record(userId, 'recovery_key_used', clientIp, userAgent, { remaining: storedHashes.length - 1 });
      } else if (totpTokenHash) {
        const isValid = await verifyTOTP(user.totp_secret || '', totpTokenHash, totpSalt);
        if (!isValid) {
          await activityLog.record(userId, 'totp_verify_fail', clientIp, userAgent);
          await invalidatePreauthSession(env, preauthToken);
          return new Response("Invalid TOTP code", { status: 400 });
        }
        await activityLog.record(userId, 'totp_verify_success', clientIp, userAgent);
      } else {
        await invalidatePreauthSession(env, preauthToken);
        return new Response("Missing TOTP code or recovery key", { status: 400 });
      }
    }

    // 所有验证通过，已消耗 preauthToken 颁发正式 Session
    await invalidatePreauthSession(env, preauthToken);
    await cacheUtils.delete(cache, `ratelimit:login_fail:${clientIp}`);
    await activityLog.record(userId, 'login_success', clientIp, userAgent);

    const { latitude, longitude } = getRequestCoordinates(request);
    if (latitude === null || longitude === null) {
      return new Response("geolocation_missing", { status: 400 });
    }
    const { session, refreshToken } = await createSession(env, userId, clientIp, userAgent, latitude, longitude);
    const csrfToken = generateId(32);
    const csrfCookie = createCsrfCookie(csrfToken);

    const secret = await getOrCreateJwtSecret(env);
    const jwtKey = await importJwtSecret(secret);
    const expMinutes = Number(env.ACCESS_TOKEN_EXPIRATION_MINUTES) || 10;
    const accessToken = await signJWT({ 
      userId: userId, 
      role: user.role, 
      sessionId: session.id,
      exp: Math.floor(Date.now() / 1000) + expMinutes * 60
    }, jwtKey);

    const headers = new Headers({ "Content-Type": "application/json" });
    headers.append("Set-Cookie", createRefreshTokenCookie(refreshToken, env));
    headers.append("Set-Cookie", csrfCookie);
    headers.append("Set-Cookie", clearPreauthCookie());
    
    return new Response(JSON.stringify({ success: true, accessToken }), { headers });
  }

  // 刷新 Token
  if (url.pathname === '/api/auth/refresh' && request.method === 'POST') {
    if (await cacheUtils.isRateLimited(cache, `refresh_fail:${clientIp}`, 20, 60)) {
      return new Response("Too many attempts", { status: 429 });
    }

    const refreshToken = readRefreshTokenCookie(request.headers.get("Cookie"));
    if (!refreshToken) return new Response("Refresh token missing", { status: 401 });

    const { latitude, longitude } = getRequestCoordinates(request);
    const { session, user, newRefreshToken, reason } = await rotateSession(env, refreshToken, latitude, longitude);

    if (!session || !user || !newRefreshToken) {
      if (user) {
        await activityLog.record(user.id, 'logout', clientIp, userAgent, { reason: reason || 'unknown' });
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
    headers.append("Set-Cookie", createRefreshTokenCookie(newRefreshToken, env));

    return new Response(JSON.stringify({ success: true, accessToken }), { headers });
  }

  // 登出
  if (url.pathname === '/api/auth/logout' && request.method === 'POST') {
    const refreshToken = readRefreshTokenCookie(request.headers.get("Cookie"));
    if (refreshToken) {
      // Validate refresh token just enough to get the session ID and invalidate it
      const parsed = parseRefreshTokenString(refreshToken);
      if (parsed) {
        const sessionModel = new SessionModel(env.DB);
        const userId = await sessionModel.getSessionUserId(parsed.sid);
        await invalidateSession(env, parsed.sid);
        if (userId) {
          await activityLog.record(userId, 'logout', clientIp, userAgent, { reason: 'user_active' });
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

  return new Response("Not Found", { status: 404 });
}
