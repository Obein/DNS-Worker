import { Env } from "../../types";
import {
  generateId,
  createSession, createRefreshTokenCookie,
  getRequestCoordinates,
  createCsrfCookie,
  getJwtSecretStatus,
  generateSessionHash
} from "../../lib/auth";
import { importJwtSecret, signJWT } from "../../lib/jwt";
import { hashPassword } from "../../utils/crypto";
import { UserModel } from "../../models/user";
import { ActivityLogModel } from "../../models/activityLog";
import { SystemSettingsModel } from "../../models/systemSettings";
import { cacheUtils } from "../../utils/cache";
import { PASSWORD_REGEX, USERNAME_REGEX } from "../../utils/validator";
import { verifyTurnstile } from "./utils";

/**
 * Handle user registration requests (signup)
 */
export async function handleAuthRegisterRequest(request: Request, env: Env): Promise<Response> {
  const userModel = new UserModel(env.DB, env);
  const activityLog = new ActivityLogModel(env.DB);
  const cache = typeof caches !== "undefined" ? (caches as any).default : null;
  const clientIp = request.headers.get("CF-Connecting-IP") || "127.0.0.1";
  const userAgent = request.headers.get("User-Agent");

  if (request.headers.get("X-Password-Leaked") === "true" || request.headers.get("Exposed-Credential-Check") === "true") {
    return new Response("password_leaked", { status: 400 });
  }

  if (await cacheUtils.isRateLimited(cache, `signup:${clientIp}`, 10, 60)) {
    return new Response("Too many attempts", { status: 429 });
  }

  const { username, password, turnstileToken } = await request.json() as any;
  const settingsModel = new SystemSettingsModel(env.DB);
  const [secretKey, enabled, registrationEnabled, isDbEmpty] = await Promise.all([
    settingsModel.get('turnstile_secret_key'),
    settingsModel.get('turnstile_enabled_signup'),
    settingsModel.get('registration_enabled'),
    userModel.isEmpty()
  ]);

  // 停用注册拦截：如果库中已有用户且管理员停用了自主注册，禁止注册
  if (!isDbEmpty && registrationEnabled === 'false') {
    return new Response("registration_disabled", { status: 403 });
  }

  if (enabled === 'true' && secretKey) {
    if (!await verifyTurnstile(turnstileToken, secretKey, clientIp)) {
      return new Response("Verification failed", { status: 400 });
    }
  }

  if (!USERNAME_REGEX.test(username)) return new Response("Invalid username", { status: 400 });
  if (!password || !PASSWORD_REGEX.test(password)) {
    return new Response("Password format error", { status: 400 });
  }

  if (await userModel.getByUsername(username)) {
    return new Response("username_exists", { status: 400 });
  }

  // 1. 验证地理信息（写入数据库前严格检验，若缺失立即返回，避免写入未完成注册的脏数据）
  const { latitude, longitude } = getRequestCoordinates(request);
  if (latitude === null || longitude === null) {
    return new Response("geolocation_missing", { status: 400 });
  }

  // 2. 验证 JWT_SECRET（写入数据库前严格检验，区分缺少配置与仍为预设值）
  const jwtStatus = getJwtSecretStatus(env.JWT_SECRET);
  if (jwtStatus === "missing") {
    return new Response("jwt_secret_missing", { status: 400 });
  }
  if (jwtStatus === "preset") {
    return new Response("jwt_secret_preset", { status: 400 });
  }

  // 3. 预先派生 JWT CryptoKey，确保加密模块可用
  let jwtKey: CryptoKey;
  try {
    jwtKey = await importJwtSecret(env.JWT_SECRET!);
  } catch {
    return new Response("jwt_secret_invalid", { status: 400 });
  }

  const hashedPassword = await hashPassword(password, 2);
  const userId = generateId(15);
  const cf = (request as any).cf;
  const timezone = cf?.timezone || request.headers.get("CF-Timezone") || null;
  const role = isDbEmpty ? 'admin' : 'user';

  let userCreated = false;
  try {
    await userModel.create({ id: userId, username, passwordHash: hashedPassword, role, timezone, passwordVersion: 2 });
    userCreated = true;

    const { session, refreshToken } = await createSession(env, userId, clientIp, userAgent, latitude, longitude, false);
    const sessionHash = await generateSessionHash(session.id, userId);
    await activityLog.record(userId, 'signup', clientIp, userAgent, undefined, sessionHash);
    const refreshCookie = createRefreshTokenCookie(refreshToken, env, false);
    const csrfToken = generateId(32);
    const csrfCookie = createCsrfCookie(csrfToken, env, false);

    const expMinutes = Number(env.ACCESS_TOKEN_EXPIRATION_MINUTES) || 10;
    const accessToken = await signJWT({ 
      userId: userId, 
      role: role, 
      sessionId: session.id,
      exp: Math.floor(Date.now() / 1000) + expMinutes * 60
    }, jwtKey);

    const headers = new Headers();
    headers.append("Set-Cookie", refreshCookie);
    headers.append("Set-Cookie", csrfCookie);
    headers.append("Content-Type", "application/json");
    return new Response(JSON.stringify({ success: true, accessToken }), { headers });
  } catch (e: any) {
    if (userCreated) {
      // 防御性回滚：清除由于后续步骤失败遗留的未完成注册脏数据，防止用户名被锁死
      try {
        await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(userId).run();
      } catch (cleanupErr) {
        console.error("Failed to clean up incomplete user registration:", cleanupErr);
      }
    }
    return new Response(e.message, { status: 400 });
  }
}
