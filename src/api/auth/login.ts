import { Env } from "../../types";
import {
  generateId,
  createSession, createRefreshTokenCookie,
  createPreauthSession, createPreauthCookie,
  validatePreauthSession, invalidatePreauthSession, clearPreauthCookie,
  readPreauthCookie,
  recordFailedPreauthAttempt,
  getRequestCoordinates,
  createCsrfCookie,
  getOrCreateJwtSecret,
  extractSaltHex, hmacSha256,
  generateSessionHash
} from "../../lib/auth";
import { importJwtSecret, signJWT } from "../../lib/jwt";
import { verifyPassword } from "../../utils/crypto";
import { verifyTOTP, findMatchingRecoveryKey } from "../../lib/totp";
import { UserModel } from "../../models/user";
import { ActivityLogModel } from "../../models/activityLog";
import { SystemSettingsModel } from "../../models/systemSettings";
import { cacheUtils } from "../../utils/cache";
import { verifyTurnstile } from "./utils";

/**
 * Handle prelogin and login requests
 */
export async function handleLoginRequest(request: Request, env: Env): Promise<Response> {
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
    const password_version = user.password_version ?? 1;

    // Generate nonce for Step 2 challenge-response verification
    const nonce = generateId(32);
    let serverSalt: string | null = null;
    if (password_version === 2 && user.hashed_password) {
      serverSalt = extractSaltHex(user.hashed_password);
    }

    const preauthTtl = Number(env.PREAUTH_TTL_SECONDS) || 300;
    await cacheUtils.set(cache, `preauth_state:${preauthToken}`, { nonce, failedAttempts: 0 }, preauthTtl);

    return new Response(JSON.stringify({
      requires_password,
      requires_totp,
      password_version,
      nonce,
      serverSalt
    }), {
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

    const preauthState = await cacheUtils.get<{ nonce: string, failedAttempts: number }>(cache, `preauth_state:${preauthToken}`);
    if (!preauthState) {
      await invalidatePreauthSession(env, preauthToken);
      return new Response("Session expired, please start over", { status: 401 });
    }
    const { nonce } = preauthState;

    const user = await userModel.getById(userId);
    if (!user) return new Response("User not found", { status: 404 });

    const { password, totpTokenHash, totpSalt, recoveryKey, keepLoggedIn } = await request.json() as any;

    let needsMigration = false;
    // 验证密码
    if (!user.totp_skip_password) {
      if ((user.password_version ?? 1) === 2) {
        // Nonce challenge-response validation
        const expectedResponse = await hmacSha256(user.hashed_password, nonce);
        if (password !== expectedResponse) {
          await cacheUtils.isRateLimited(cache, `login_fail:${clientIp}`, 100, 900);
          await activityLog.record(userId, 'login_fail', clientIp, userAgent, { reason: 'wrong_password' });
          const remaining = await recordFailedPreauthAttempt(cache, preauthToken, env);
          if (remaining <= 0) {
            return new Response("Invalid password", { status: 400 });
          } else {
            return new Response(`Invalid password. ${remaining} attempt${remaining > 1 ? 's' : ''} remaining.`, { status: 400 });
          }
        }
      } else {
        // Plaintext validation (v1)
        const passwordValid = await verifyPassword(password, user.hashed_password, 1);
        if (!passwordValid) {
          await cacheUtils.isRateLimited(cache, `login_fail:${clientIp}`, 100, 900);
          await activityLog.record(userId, 'login_fail', clientIp, userAgent, { reason: 'wrong_password' });
          const remaining = await recordFailedPreauthAttempt(cache, preauthToken, env);
          if (remaining <= 0) {
            return new Response("Invalid password", { status: 400 });
          } else {
            return new Response(`Invalid password. ${remaining} attempt${remaining > 1 ? 's' : ''} remaining.`, { status: 400 });
          }
        }
        needsMigration = true;
      }
    }

    // 验证 TOTP 或 恢复密钥
    let isTotpSuccess = false;
    let isRecoverySuccess = false;
    let recoveryRemaining = 0;

    if (user.totp_enabled) {
      if (recoveryKey) {
        let storedHashes: string[] = [];
        try { storedHashes = JSON.parse(user.totp_recovery_keys || '[]'); } catch { }
        const matchIndex = await findMatchingRecoveryKey(recoveryKey, storedHashes);
        if (matchIndex === -1) {
          await activityLog.record(userId, 'totp_verify_fail', clientIp, userAgent, { method: 'recovery_key' });
          const remaining = await recordFailedPreauthAttempt(cache, preauthToken, env);
          if (remaining <= 0) {
            return new Response("Invalid recovery key", { status: 400 });
          } else {
            return new Response(`Invalid recovery key. ${remaining} attempt${remaining > 1 ? 's' : ''} remaining.`, { status: 400 });
          }
        }
        await userModel.consumeRecoveryKey(userId, matchIndex, storedHashes);
        isRecoverySuccess = true;
        recoveryRemaining = storedHashes.length - 1;
      } else if (totpTokenHash) {
        const isValid = await verifyTOTP(user.totp_secret || '', totpTokenHash, totpSalt);
        if (!isValid) {
          await activityLog.record(userId, 'totp_verify_fail', clientIp, userAgent);
          const remaining = await recordFailedPreauthAttempt(cache, preauthToken, env);
          if (remaining <= 0) {
            return new Response("Invalid TOTP code", { status: 400 });
          } else {
            return new Response(`Invalid TOTP code. ${remaining} attempt${remaining > 1 ? 's' : ''} remaining.`, { status: 400 });
          }
        }
        isTotpSuccess = true;
      } else {
        const remaining = await recordFailedPreauthAttempt(cache, preauthToken, env);
        if (remaining <= 0) {
          return new Response("Missing TOTP code or recovery key", { status: 400 });
        } else {
          return new Response(`Missing TOTP code or recovery key. ${remaining} attempt${remaining > 1 ? 's' : ''} remaining.`, { status: 400 });
        }
      }
    }

    // 所有验证通过，已消耗 preauthToken 颁发正式 Session
    await invalidatePreauthSession(env, preauthToken);
    await cacheUtils.delete(cache, `preauth_state:${preauthToken}`);
    await cacheUtils.delete(cache, `ratelimit:login_fail:${clientIp}`);

    const { latitude, longitude } = getRequestCoordinates(request);
    if (latitude === null || longitude === null) {
      return new Response("geolocation_missing", { status: 400 });
    }
    const { session, refreshToken } = await createSession(env, userId, clientIp, userAgent, latitude, longitude, !!keepLoggedIn);
    const sessionHash = await generateSessionHash(session.id, userId);

    if (isTotpSuccess) {
      await activityLog.record(userId, 'totp_verify_success', clientIp, userAgent, undefined, sessionHash);
    } else if (isRecoverySuccess) {
      await activityLog.record(userId, 'recovery_key_used', clientIp, userAgent, { remaining: recoveryRemaining }, sessionHash);
    }
    await activityLog.record(userId, 'login_success', clientIp, userAgent, undefined, sessionHash);

    const csrfToken = generateId(32);
    const csrfCookie = createCsrfCookie(csrfToken, env, !!keepLoggedIn);

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
    headers.append("Set-Cookie", createRefreshTokenCookie(refreshToken, env, !!keepLoggedIn));
    headers.append("Set-Cookie", csrfCookie);
    headers.append("Set-Cookie", clearPreauthCookie());
    
    return new Response(JSON.stringify({ success: true, accessToken, needsMigration }), { headers });
  }

  return new Response("Not Found", { status: 404 });
}
