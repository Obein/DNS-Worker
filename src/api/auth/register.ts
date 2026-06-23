import { Env } from "../../types";
import {
  generateId,
  createSession, createRefreshTokenCookie,
  getRequestCoordinates,
  createCsrfCookie,
  getOrCreateJwtSecret,
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
  const userModel = new UserModel(env.DB);
  const activityLog = new ActivityLogModel(env.DB);
  const cache = (caches as any).default;
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
  const [secretKey, enabled] = await Promise.all([
    settingsModel.get('turnstile_secret_key'),
    settingsModel.get('turnstile_enabled_signup')
  ]);

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

  const hashedPassword = await hashPassword(password, 2);
  const userId = generateId(15);
  const cf = (request as any).cf;
  const timezone = cf?.timezone || request.headers.get("CF-Timezone") || null;
  try {
    const role = (await userModel.isEmpty()) ? 'admin' : 'user';
    await userModel.create({ id: userId, username, passwordHash: hashedPassword, role, timezone, passwordVersion: 2 });
    const { latitude, longitude } = getRequestCoordinates(request);
    if (latitude === null || longitude === null) {
      return new Response("geolocation_missing", { status: 400 });
    }
    const { session, refreshToken } = await createSession(env, userId, clientIp, userAgent, latitude, longitude, false);
    const sessionHash = await generateSessionHash(session.id, userId);
    await activityLog.record(userId, 'signup', clientIp, userAgent, undefined, sessionHash);
    const refreshCookie = createRefreshTokenCookie(refreshToken, env, false);
    const csrfToken = generateId(32);
    const csrfCookie = createCsrfCookie(csrfToken, env, false);
    
    const secret = await getOrCreateJwtSecret(env);
    const jwtKey = await importJwtSecret(secret);
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
    return new Response(e.message, { status: 400 });
  }
}
