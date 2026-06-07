import { Env } from "../types";
import {
  generateId,
  createSession, createSessionCookie,
  readSessionCookie, invalidateSession, createBlankSessionCookie,
  createPreauthSession, createPreauthCookie,
  validatePreauthSession, invalidatePreauthSession, clearPreauthCookie,
  readPreauthCookie,
} from "../lib/auth";
import { hashPassword, verifyPassword } from "../utils/crypto";
import { verifyTOTP, findMatchingRecoveryKey } from "../lib/totp";
import { UserModel } from "../models/user";
import { ActivityLogModel } from "../models/activityLog";
import { SystemSettingsModel } from "../models/systemSettings";
import { SessionModel } from "../models/session";
import { cacheUtils } from "../utils/cache";

async function verifyTurnstile(token: string, secret: string, ip: string): Promise<boolean> {
  if (!token || !secret) return false;
  try {
    const formData = new FormData();
    formData.append('secret', secret);
    formData.append('response', token);
    formData.append('remoteip', ip);
    const result = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { body: formData, method: 'POST' });
    const outcome = await result.json() as any;
    return outcome.success;
  } catch (e) { return false; }
}

// getSystemSetting has been replaced by SystemSettingsModel

export async function handleAuthRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const userModel = new UserModel(env.DB);
  const activityLog = new ActivityLogModel(env.DB);
  const cache = (caches as any).default;
  const clientIp = request.headers.get("CF-Connecting-IP") || "127.0.0.1";
  const userAgent = request.headers.get("User-Agent");

  // 公开配置接口
  if (url.pathname === '/api/auth/config' && request.method === 'GET') {
    const settingsModel = new SystemSettingsModel(env.DB);
    const [siteKey, signupEnabled, loginEnabled] = await Promise.all([
      settingsModel.get('turnstile_site_key'),
      settingsModel.get('turnstile_enabled_signup'),
      settingsModel.get('turnstile_enabled_login')
    ]);
    return new Response(JSON.stringify({
      turnstile_site_key: siteKey,
      turnstile_enabled_signup: signupEnabled === 'true',
      turnstile_enabled_login: loginEnabled === 'true'
    }), { headers: { 'Content-Type': 'application/json' } });
  }

  // 注册接口
  if (url.pathname === '/api/auth/signup' && request.method === 'POST') {
    if (await cacheUtils.isRateLimited(cache, `signup:${clientIp}`, 5, 3600)) {
      return new Response("Too many attempts", { status: 429 });
    }
    const { username, password, turnstileToken } = await request.json() as any;
    const settingsModel = new SystemSettingsModel(env.DB);
    const [secretKey, enabled] = await Promise.all([
      settingsModel.get('turnstile_secret_key'),
      settingsModel.get('turnstile_enabled_signup')
    ]);
    if (enabled === 'true' && secretKey) {
      if (!await verifyTurnstile(turnstileToken, secretKey, clientIp)) {
        return new Response("Verification failed", { status: 400 });
      }
    }
    if (!/^[a-zA-Z0-9]{5,15}$/.test(username)) return new Response("Invalid username", { status: 400 });
    const hashedPassword = await hashPassword(password);
    const userId = generateId(15);
    try {
      const role = (await userModel.isEmpty()) ? 'admin' : 'user';
      await userModel.create({ id: userId, username, passwordHash: hashedPassword, role });
      const session = await createSession(env, userId, clientIp, userAgent);
      const sessionCookie = createSessionCookie(session.id, env);
      return new Response(JSON.stringify({ success: true }), {
        headers: { "Set-Cookie": sessionCookie, "Content-Type": "application/json" }
      });
    } catch (e: any) { return new Response(e.message, { status: 400 }); }
  }

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
    if (await cacheUtils.isRateLimited(cache, `login_fail:${clientIp}`, 10, 900)) {
      return new Response("Too many login attempts", { status: 429 });
    }

    const preauthToken = readPreauthCookie(request.headers.get("Cookie"));
    if (!preauthToken) return new Response("Pre-auth session missing or expired", { status: 401 });

    const userId = await validatePreauthSession(env, preauthToken);
    if (!userId) return new Response("Session expired, please start over", { status: 401 });

    const user = await userModel.getById(userId);
    if (!user) return new Response("User not found", { status: 404 });

    const { password, totpToken, totpSalt, recoveryKey } = await request.json() as any;

    // 1. 验证密码
    if (!user.totp_skip_password) {
      const passwordValid = await verifyPassword(password, user.hashed_password);
      if (!passwordValid) {
        await cacheUtils.isRateLimited(cache, `login_fail:${clientIp}`, 100, 900);
        await activityLog.record(userId, 'login_fail', clientIp, userAgent, { reason: 'wrong_password' });
        return new Response("Invalid password", { status: 400 });
      }
    }

    // 2. 验证 TOTP 或 恢复密钥
    if (user.totp_enabled) {
      if (recoveryKey) {
        let storedHashes: string[] = [];
        try { storedHashes = JSON.parse(user.totp_recovery_keys || '[]'); } catch { }
        const matchIndex = await findMatchingRecoveryKey(recoveryKey, storedHashes);
        if (matchIndex === -1) {
          await activityLog.record(userId, 'totp_verify_fail', clientIp, userAgent, { method: 'recovery_key' });
          return new Response("Invalid recovery key", { status: 400 });
        }
        await userModel.consumeRecoveryKey(userId, matchIndex, storedHashes);
        await activityLog.record(userId, 'recovery_key_used', clientIp, userAgent, { remaining: storedHashes.length - 1 });
      } else if (totpToken) {
        const isValid = await verifyTOTP(user.totp_secret || '', totpToken, totpSalt);
        if (!isValid) {
          await activityLog.record(userId, 'totp_verify_fail', clientIp, userAgent);
          return new Response("Invalid TOTP code", { status: 400 });
        }
        await activityLog.record(userId, 'totp_verify_success', clientIp, userAgent);
      } else {
        return new Response("Missing TOTP code or recovery key", { status: 400 });
      }
    }

    // 所有验证通过，颁发正式 Session
    await invalidatePreauthSession(env, preauthToken);
    await cacheUtils.delete(cache, `ratelimit:login_fail:${clientIp}`);
    await activityLog.record(userId, 'login_success', clientIp, userAgent);

    const session = await createSession(env, userId, clientIp, userAgent);
    const headers = new Headers({ "Content-Type": "application/json" });
    headers.append("Set-Cookie", createSessionCookie(session.id, env));
    headers.append("Set-Cookie", clearPreauthCookie());
    
    return new Response(JSON.stringify({ success: true }), { headers });
  }

  if (url.pathname === '/api/auth/logout' && request.method === 'POST') {
    const sessionId = readSessionCookie(request.headers.get("Cookie"));
    if (sessionId) {
      const sessionModel = new SessionModel(env.DB);
      const userId = await sessionModel.getSessionUserId(sessionId);
      await invalidateSession(env, sessionId);
      if (userId) {
        await activityLog.record(userId, 'logout', clientIp, userAgent);
      }
    }
    return new Response(JSON.stringify({ success: true }), {
      headers: { "Set-Cookie": createBlankSessionCookie(), "Content-Type": "application/json" }
    });
  }

  return new Response("Not Found", { status: 404 });
}

