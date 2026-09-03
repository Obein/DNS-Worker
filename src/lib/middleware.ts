import { Env, User } from '../types';
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

export function invalidateAuthUserCache(sessionId: string): void {
  authUserMemoryCache.delete(sessionId);
}

export async function getCurrentUser(request: Request, env: Env): Promise<User | null> {
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
        return cached.user;
      }

      // Validate session in database (enforce statefulness and idle timeout)
      const sessionModel = new SessionModel(env.DB);
      const session = await sessionModel.getSession(payload.sessionId);
      if (!session) {
        authUserMemoryCache.delete(payload.sessionId);
        return null;
      }

      const now = Math.floor(Date.now() / 1000);
      const lastActive = session.last_active_at || session.created_at;

      // Single Source of Truth inactivity check on server
      const userModel = new UserModel(env.DB, env);
      const dbUser = await userModel.getById(payload.userId);

      if (dbUser && dbUser.pin_hash && !session.is_paused) {
        const timeoutSeconds = (dbUser.session_lock_timeout || 15) * 60;
        if (now - lastActive > timeoutSeconds) {
          await sessionModel.pauseSession(session.id);
          session.is_paused = 1;
        }
      }

      if (session.is_paused) {
        const pausedUser: User = { id: payload.userId, username: "", role: payload.role as any, isPaused: true, sessionId: payload.sessionId };
        return pausedUser;
      }

      // Throttle DB updates: only update if at least 10 seconds have elapsed since last active time
      if (now - lastActive > 10) {
        await sessionModel.updateLastActive(session.id, now);
      }

      const validatedUser: User = { id: payload.userId, username: "", role: payload.role as any, sessionId: payload.sessionId };

      // Cache for 10 seconds (cap size at 100)
      if (authUserMemoryCache.size > 100) {
        const oldestKey = authUserMemoryCache.keys().next().value;
        if (oldestKey) authUserMemoryCache.delete(oldestKey);
      }
      authUserMemoryCache.set(payload.sessionId, {
        user: validatedUser,
        expiresAt: Date.now() + 10_000
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
