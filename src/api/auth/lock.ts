import { Env } from "../../types";
import { getOrCreateJwtSecret, generateSessionHash } from "../../lib/auth";
import { importJwtSecret, verifyJWT } from "../../lib/jwt";
import { generateId, verifyPassword, hashChallenge } from "../../utils/crypto";
import { UserModel } from "../../models/user";
import { ActivityLogModel } from "../../models/activityLog";
import { SessionModel } from "../../models/session";
import { cacheUtils } from "../../utils/cache";
import { invalidateAuthUserCache } from "../../lib/middleware";

/**
 * Verifies client PIN hash against stored legacy base64 PIN hash using pre-challenge methods.
 */
async function verifyLegacyPin(clientPinHash: string, storedPinHash: string): Promise<boolean> {
  // Method A: PBKDF2 (stored as standard password hash)
  try {
    if (await verifyPassword(clientPinHash, storedPinHash)) {
      return true;
    }
  } catch (e) {}

  // Method B: Custom SHA-256 with Salt
  try {
    const binaryString = atob(storedPinHash);
    const combined = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      combined[i] = binaryString.charCodeAt(i);
    }
    if (combined.length === 48) {
      const salt = combined.slice(0, 16);
      const storedHash = combined.slice(16);
      
      const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('');
      const msgWithSalt = new TextEncoder().encode(clientPinHash + saltHex);
      
      const computedHashBuffer = await crypto.subtle.digest('SHA-256', msgWithSalt);
      const computedHash = new Uint8Array(computedHashBuffer);
      
      if (computedHash.length === storedHash.length) {
        let result = 0;
        for (let i = 0; i < computedHash.length; i++) {
          result |= computedHash[i] ^ storedHash[i];
        }
        if (result === 0) return true;
      }
    }
  } catch (e) {}

  return false;
}

/**
 * Handle session locking and unlocking requests
 */
export async function handleSessionLockRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const userModel = new UserModel(env.DB, env);
  const activityLog = new ActivityLogModel(env.DB);
  const cache = (caches as any).default;
  const clientIp = request.headers.get("CF-Connecting-IP") || "127.0.0.1";
  const userAgent = request.headers.get("User-Agent");

  // 获取解锁会话的 Nonce 挑战
  if (url.pathname === '/api/auth/unlock-session' && request.method === 'GET') {
    const authHeader = request.headers.get("Authorization") || "";
    let accessToken = "";
    if (authHeader.startsWith("Bearer ")) {
      accessToken = authHeader.slice(7);
    }
    if (!accessToken) return new Response("Unauthorized", { status: 401 });

    try {
      const secret = await getOrCreateJwtSecret(env);
      const jwtKey = await importJwtSecret(secret);
      const payload = await verifyJWT<{ userId: string; role: string; sessionId: string; exp: number }>(
        accessToken,
        jwtKey
      );
      if (!payload) return new Response("Unauthorized", { status: 401 });

      const dbUser = await userModel.getById(payload.userId);
      /**
       * PIN 兼容性说明：
       * 旧版 PIN 是以 base64 编码的 SHA-256 哈希值存储在数据库中。
       * 新版 PIN 是以 PBKDF2 哈希值存储在数据库中。
       * 为了兼容旧版用户，我们需要检查用户的 pin_hash 是否符合旧版格式（base64 编码的 SHA-256 哈希）。
       * 如果是旧版格式，我们将使用 verifyLegacyPin 方法进行验证，并在验证成功后自动迁移到新格式。
       */
      const isLegacy = !!(dbUser?.pin_hash && !/^[a-f0-9]{64}$/.test(dbUser.pin_hash));

      const nonce = generateId(32);
      const cacheKey = `unlock_nonce:${payload.sessionId}`;
      await cacheUtils.set(cache, cacheKey, { nonce, isLegacy }, 300); // 5 minutes TTL

      return new Response(JSON.stringify({ nonce, legacy: isLegacy }), {
        headers: { "Content-Type": "application/json" }
      });
    } catch (e) {
      return new Response("Unauthorized", { status: 401 });
    }
  }

  // 解锁会话
  if (url.pathname === '/api/auth/unlock-session' && request.method === 'POST') {
    const authHeader = request.headers.get("Authorization") || "";
    let accessToken = "";
    if (authHeader.startsWith("Bearer ")) {
      accessToken = authHeader.slice(7);
    }
    if (!accessToken) return new Response("Unauthorized", { status: 401 });

    try {
      const secret = await getOrCreateJwtSecret(env);
      const jwtKey = await importJwtSecret(secret);
      const payload = await verifyJWT<{ userId: string; role: string; sessionId: string; exp: number }>(
        accessToken,
        jwtKey
      );
      if (!payload) return new Response("Unauthorized", { status: 401 });

      const { pinHash, nonce } = await request.json() as any;
      if (!pinHash) return new Response("Missing pinHash", { status: 400 });
      if (!nonce) return new Response("Missing nonce", { status: 400 });

      // 验证 Session 存在
      const sessionModel = new SessionModel(env.DB);
      const session = await sessionModel.getSession(payload.sessionId);
      if (!session) return new Response("Session not found", { status: 401 });

      // 验证用户的 PIN
      const dbUser = await userModel.getById(payload.userId);
      if (!dbUser || !dbUser.pin_hash) return new Response("PIN not configured", { status: 400 });

      // 获取缓存的 Nonce 挑战
      const cacheKeyNonce = `unlock_nonce:${payload.sessionId}`;
      const cachedNonceState = await cacheUtils.get<{ nonce: string; isLegacy?: boolean }>(cache, cacheKeyNonce);
      if (!cachedNonceState?.nonce) {
        return new Response("Challenge expired, please start over", { status: 400 });
      }
      const cachedNonce = cachedNonceState.nonce;
      const isLegacy = !!cachedNonceState.isLegacy;

      // 消费掉 nonce 防止重放
      await cacheUtils.delete(cache, cacheKeyNonce);

      // 验证客户端提交的 nonce 是否与缓存的 nonce 一致
      if (nonce !== cachedNonce) {
        return new Response("Invalid nonce", { status: 400 });
      }

      const cacheKey = `unlock_fail:${session.id}`;
      const failedAttemptsState = await cacheUtils.get<{ count: number }>(cache, cacheKey);
      const failedAttempts = failedAttemptsState?.count || 0;

      const sessionHash = await generateSessionHash(session.id, payload.userId);

      let isPinValid = false;
      if (isLegacy) {
        // 兼容原有的 PIN 逻辑
        isPinValid = await verifyLegacyPin(pinHash, dbUser.pin_hash);
        if (isPinValid) {
          // 成功验证后，自动将原有账号的 PIN 升级迁移为直接存储 client-side pinHash 的新格式
          await userModel.updatePinHash(payload.userId, pinHash);
        }
      } else {
        // 验证挑战响应：hashChallenge(dbUser.pin_hash, cachedNonce)
        const expectedChallengedHash = await hashChallenge(dbUser.pin_hash, cachedNonce);
        
        // Constant-time comparison
        if (pinHash.length === expectedChallengedHash.length) {
          let result = 0;
          for (let i = 0; i < pinHash.length; i++) {
            result |= pinHash.charCodeAt(i) ^ expectedChallengedHash.charCodeAt(i);
          }
          isPinValid = result === 0;
        }
      }

      if (!isPinValid) {
        const nextFailedCount = failedAttempts + 1;
        if (nextFailedCount >= 3) {
          // 超过 3 次失败，销毁 Session 强制登出
          await sessionModel.deleteSession(session.id);
          await cacheUtils.delete(cache, cacheKey);
          await activityLog.record(payload.userId, 'pin_verify_fail', clientIp, userAgent, { reason: 'too_many_attempts' }, sessionHash);
          return new Response(JSON.stringify({ success: false, error: "too_many_attempts" }), {
            status: 401,
            headers: { "Content-Type": "application/json" }
          });
        }
        await cacheUtils.set(cache, cacheKey, { count: nextFailedCount }, 900); // 15分钟锁定追踪
        await activityLog.record(payload.userId, 'pin_verify_fail', clientIp, userAgent, { reason: 'incorrect_pin', attempt: nextFailedCount }, sessionHash);
        return new Response(JSON.stringify({
          success: false,
          error: "incorrect_pin",
          attemptsRemaining: 3 - nextFailedCount
        }), {
          status: 400,
          headers: { "Content-Type": "application/json" }
        });
      }

      // 验证成功：恢复会话状态
      const now = Math.floor(Date.now() / 1000);
      await sessionModel.resumeSession(session.id, now);
      invalidateAuthUserCache(session.id);
      await cacheUtils.delete(cache, cacheKey);
      await activityLog.record(payload.userId, 'pin_verify_success', clientIp, userAgent, undefined, sessionHash);

      return new Response(JSON.stringify({ success: true }), {
        headers: { "Content-Type": "application/json" }
      });
    } catch (e: any) {
      console.error("Unlock session error:", e);
      return new Response("Unauthorized", { status: 401 });
    }
  }

  // 锁定会话
  if (url.pathname === '/api/auth/lock-session' && request.method === 'POST') {
    const authHeader = request.headers.get("Authorization") || "";
    let accessToken = "";
    if (authHeader.startsWith("Bearer ")) {
      accessToken = authHeader.slice(7);
    }
    if (!accessToken) return new Response("Unauthorized", { status: 401 });

    try {
      const secret = await getOrCreateJwtSecret(env);
      const jwtKey = await importJwtSecret(secret);
      const payload = await verifyJWT<{ userId: string; role: string; sessionId: string; exp: number }>(
        accessToken,
        jwtKey
      );
      if (!payload) return new Response("Unauthorized", { status: 401 });

      const sessionModel = new SessionModel(env.DB);
      const session = await sessionModel.getSession(payload.sessionId);
      if (!session) return new Response("Session not found", { status: 401 });

      await sessionModel.pauseSession(session.id);
      invalidateAuthUserCache(session.id);
      return new Response(JSON.stringify({ success: true }), {
        headers: { "Content-Type": "application/json" }
      });
    } catch (e: any) {
      return new Response("Unauthorized", { status: 401 });
    }
  }

  return new Response("Not Found", { status: 404 });
}
