import { Env, ExecutionContext, User } from '../types';
import { getOrCreateJwtSecret, readCsrfCookie } from './auth';
import { importJwtSecret, verifyJWT } from './jwt';
import { SessionModel } from '../models/session';
import { UserModel } from '../models/user';

/**
 * Applies standard security headers and Content-Security-Policy (CSP) with a nonce.
 */
export function applySecurityHeaders(response: Response, nonce: string): Response {
  const newHeaders = new Headers(response.headers);
  newHeaders.set('X-Content-Type-Options', 'nosniff');
  newHeaders.set('X-Frame-Options', 'DENY');
  newHeaders.set('X-XSS-Protection', '1; mode=block');
  newHeaders.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  
  if (!newHeaders.has('Content-Security-Policy')) {
    newHeaders.set(
      'Content-Security-Policy',
      `default-src 'self'; script-src 'self' 'nonce-${nonce}' https://challenges.cloudflare.com https://static.cloudflareinsights.com; script-src-attr 'unsafe-inline'; frame-src 'self' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://icons.duckduckgo.com; connect-src 'self' https://challenges.cloudflare.com https://cloudflare-dns.com https://1.1.1.1;`
    );
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders
  });
}

/**
 * Parses authorization header and verifies JWT to get the current authenticated user.
 */
interface CachedAuthUser {
  user: User;
  expiresAt: number;
}
const authUserMemoryCache = new Map<string, CachedAuthUser>();

/**
 * In-memory activity tracking to prevent premature PIN locking
 * and throttle D1 writes even when DB writes fail or are delayed.
 */
interface SessionActivityRecord {
  lastObserved: number;
  lastWriteAttempt: number;
}
const sessionActivityMemory = new Map<string, SessionActivityRecord>();

export function invalidateAuthUserCache(sessionId: string): void {
  authUserMemoryCache.delete(sessionId);
  sessionActivityMemory.delete(sessionId);
}

export async function getCurrentUser(request: Request, env: Env, ctx?: ExecutionContext): Promise<User | null> {
  const authHeader = request.headers.get("Authorization") || "";
  let accessToken = "";
  if (authHeader.startsWith("Bearer ")) {
    accessToken = authHeader.slice(7);
  }

  if (!accessToken) {
    return null;
  }

  try {
    const secret = await getOrCreateJwtSecret(env);
    const jwtKey = await importJwtSecret(secret);
    const payload = await verifyJWT<{ userId: string; role: string; sessionId: string; exp: number }>(
      accessToken,
      jwtKey
    );
    if (payload) {
      // Check 10-second micro-cache to collapse parallel dashboard requests into 1 D1 read
      const cached = authUserMemoryCache.get(payload.sessionId);
      if (cached && cached.expiresAt > Date.now()) {
        const activity = sessionActivityMemory.get(payload.sessionId);
        if (activity) {
          activity.lastObserved = Math.floor(Date.now() / 1000);
        }
        return cached.user;
      }

      // Validate session & user in database via single atomic JOIN query (halves D1 reads)
      const sessionModel = new SessionModel(env.DB);
      const session = await sessionModel.getSessionWithUser(payload.sessionId);
      if (!session) {
        authUserMemoryCache.delete(payload.sessionId);
        sessionActivityMemory.delete(payload.sessionId);
        return null;
      }

      const sessionId = session.id || session.session_id || payload.sessionId;
      const now = Math.floor(Date.now() / 1000);
      const lastActive = session.last_active_at || session.created_at;
      const activityRecord = sessionActivityMemory.get(payload.sessionId);
      const effectiveLastActive = Math.max(lastActive, activityRecord?.lastObserved ?? 0);

      // Single Source of Truth inactivity check on server (fields from JOINed users table)
      if (session.pin_hash && !session.is_paused) {
        const timeoutSeconds = (session.session_lock_timeout || 15) * 60;
        if (now - effectiveLastActive > timeoutSeconds) {
          try {
            await sessionModel.pauseSession(sessionId);
          } catch (e) {
            console.error("[Auth] Failed to update pauseSession in D1:", e);
          }
          session.is_paused = 1;
        }
      }

      if (session.is_paused) {
        const pausedUser: User = { id: payload.userId, username: session.username || "", role: (session.role || payload.role) as any, isPaused: true, sessionId: payload.sessionId };
        return pausedUser;
      }

      // Throttle DB updates: only update if at least intervalSec have elapsed since last write attempt
      const lastWriteAttempt = activityRecord?.lastWriteAttempt ?? lastActive;
      const intervalSec = parseInt(String(env.SESSION_LAST_ACTIVE_UPDATE_INTERVAL || "60"), 10) || 60;

      let newWriteAttempt = lastWriteAttempt;
      if (now - lastWriteAttempt > intervalSec) {
        newWriteAttempt = now;
        const writePromise = sessionModel
          .updateLastActive(sessionId, now)
          .catch((e) => console.error("[Auth] session last-active write failed:", e));

        if (ctx && typeof ctx.waitUntil === "function") {
          ctx.waitUntil(writePromise);
        }
      }

      // Update in-memory activity tracking (cap size at 1000)
      if (sessionActivityMemory.size > 1000) {
        const oldestKey = sessionActivityMemory.keys().next().value;
        if (oldestKey) sessionActivityMemory.delete(oldestKey);
      }
      sessionActivityMemory.set(payload.sessionId, {
        lastObserved: now,
        lastWriteAttempt: newWriteAttempt
      });

      const validatedUser: User = { id: payload.userId, username: session.username || "", role: (session.role || payload.role) as any, sessionId: payload.sessionId };

      // Micro-cache user authentication (default 30 seconds, configurable via AUTH_CACHE_TTL_SEC)
      const cacheTtlSec = parseInt(String(env.AUTH_CACHE_TTL_SEC || "30"), 10) || 30;
      if (authUserMemoryCache.size > 100) {
        const oldestKey = authUserMemoryCache.keys().next().value;
        if (oldestKey) authUserMemoryCache.delete(oldestKey);
      }
      authUserMemoryCache.set(payload.sessionId, {
        user: validatedUser,
        expiresAt: Date.now() + cacheTtlSec * 1000
      });

      return validatedUser;
    }
  } catch (e) {
    // Ignore verification errors and return null
  }
  return null;
}

/**
 * Validates CSRF double submit cookie against the request header.
 */
export function validateCsrf(request: Request): boolean {
  const cookieHeader = request.headers.get("Cookie") || "";
  const csrfCookie = readCsrfCookie(cookieHeader);
  const csrfHeader = request.headers.get("X-CSRF-Token");
  return !!csrfCookie && !!csrfHeader && csrfCookie === csrfHeader;
}
