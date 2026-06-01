import { Env } from "../types";
import { generateId, createSession, createSessionCookie, readSessionCookie, invalidateSession, createBlankSessionCookie } from "../lib/auth";
import { hashPassword, verifyPassword } from "../utils/crypto";
import { UserModel } from "../models/user";
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

async function getSystemSetting(db: any, key: string): Promise<string> {
  const res = await db.prepare("SELECT value FROM system_settings WHERE key = ?").bind(key).first();
  return res ? res.value : "";
}

export async function handleAuthRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  const userModel = new UserModel(env.DB);
  const cache = (caches as any).default;
  const clientIp = request.headers.get("CF-Connecting-IP") || "127.0.0.1";

  // 公开配置接口 (用于前端展示验证码)
  if (url.pathname === '/api/auth/config' && request.method === 'GET') {
    const [siteKey, signupEnabled, loginEnabled] = await Promise.all([
      getSystemSetting(env.DB, 'turnstile_site_key'),
      getSystemSetting(env.DB, 'turnstile_enabled_signup'),
      getSystemSetting(env.DB, 'turnstile_enabled_login')
    ]);
    return new Response(JSON.stringify({
      turnstile_site_key: siteKey,
      turnstile_enabled_signup: signupEnabled === 'true',
      turnstile_enabled_login: loginEnabled === 'true'
    }), { headers: { 'Content-Type': 'application/json' } });
  }

  if (url.pathname === '/api/auth/signup' && request.method === 'POST') {
    if (await cacheUtils.isRateLimited(cache, `signup:${clientIp}`, 5, 3600)) {
      return new Response("Too many attempts", { status: 429 });
    }

    const { username, password, turnstileToken } = await request.json() as any;
    
    // 校验 Turnstile
    const [secretKey, enabled] = await Promise.all([
      getSystemSetting(env.DB, 'turnstile_secret_key'),
      getSystemSetting(env.DB, 'turnstile_enabled_signup')
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
      const session = await createSession(env.DB, userId);
      const sessionCookie = createSessionCookie(session.id);
      return new Response(JSON.stringify({ success: true }), { headers: { "Set-Cookie": sessionCookie, "Content-Type": "application/json" } });
    } catch (e: any) { return new Response(e.message, { status: 400 }); }
  }

  if (url.pathname === '/api/auth/login' && request.method === 'POST') {
    if (await cacheUtils.isRateLimited(cache, `login_fail:${clientIp}`, 5, 900)) {
      return new Response("Too many login attempts", { status: 429 });
    }

    const { username, password, turnstileToken } = await request.json() as any;

    // 校验 Turnstile
    const [secretKey, enabled] = await Promise.all([
      getSystemSetting(env.DB, 'turnstile_secret_key'),
      getSystemSetting(env.DB, 'turnstile_enabled_login')
    ]);
    if (enabled === 'true' && secretKey) {
      if (!await verifyTurnstile(turnstileToken, secretKey, clientIp)) {
        return new Response("Verification failed", { status: 400 });
      }
    }

    const user = await userModel.getByUsername(username);
    if (!user || !(await verifyPassword(password, user.hashed_password))) {
      await cacheUtils.isRateLimited(cache, `login_fail:${clientIp}`, 100, 900);
      return new Response("Invalid credentials", { status: 400 });
    }

    await cacheUtils.delete(cache, `ratelimit:login_fail:${clientIp}`);
    const session = await createSession(env.DB, user.id);
    const sessionCookie = createSessionCookie(session.id);
    return new Response(JSON.stringify({ success: true }), { headers: { "Set-Cookie": sessionCookie, "Content-Type": "application/json" } });
  }

  if (url.pathname === '/api/auth/logout' && request.method === 'POST') {
    const sessionId = readSessionCookie(request.headers.get("Cookie"));
    if (sessionId) await invalidateSession(env.DB, sessionId);
    const blankCookie = createBlankSessionCookie();
    return new Response(JSON.stringify({ success: true }), { headers: { "Set-Cookie": blankCookie, "Content-Type": "application/json" } });
  }

  return new Response("Not Found", { status: 404 });
}
