import { Env } from "../../types";
import { getOrCreateJwtSecret, generateSessionHash } from "../../lib/auth";
import { importJwtSecret, verifyJWT } from "../../lib/jwt";
import { verifyPinServer } from "../../utils/crypto";
import { UserModel } from "../../models/user";
import { ActivityLogModel } from "../../models/activityLog";
import { SessionModel } from "../../models/session";
import { cacheUtils } from "../../utils/cache";

/**
 * Handle session locking and unlocking requests
 */
export async function handleSessionLockRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const userModel = new UserModel(env.DB);
  const activityLog = new ActivityLogModel(env.DB);
  const cache = (caches as any).default;
  const clientIp = request.headers.get("CF-Connecting-IP") || "127.0.0.1";
  const userAgent = request.headers.get("User-Agent");

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

      const { pinHash } = await request.json() as any;
      if (!pinHash) return new Response("Missing pinHash", { status: 400 });

      // 验证 Session 存在
      const sessionModel = new SessionModel(env.DB);
      const session = await sessionModel.getSession(payload.sessionId);
      if (!session) return new Response("Session not found", { status: 401 });

      // 验证用户的 PIN
      const dbUser = await userModel.getById(payload.userId);
      if (!dbUser || !dbUser.pin_hash) return new Response("PIN not configured", { status: 400 });

      const cacheKey = `unlock_fail:${session.id}`;
      const failedAttemptsState = await cacheUtils.get<{ count: number }>(cache, cacheKey);
      const failedAttempts = failedAttemptsState?.count || 0;

      const sessionHash = await generateSessionHash(session.id, payload.userId);
      const isPinValid = await verifyPinServer(pinHash, dbUser.pin_hash);
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
      await cacheUtils.delete(cache, cacheKey);
      await activityLog.record(payload.userId, 'pin_verify_success', clientIp, userAgent, undefined, sessionHash);

      return new Response(JSON.stringify({ success: true }), {
        headers: { "Content-Type": "application/json" }
      });
    } catch (e: any) {
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
      return new Response(JSON.stringify({ success: true }), {
        headers: { "Content-Type": "application/json" }
      });
    } catch (e: any) {
      return new Response("Unauthorized", { status: 401 });
    }
  }

  return new Response("Not Found", { status: 404 });
}
