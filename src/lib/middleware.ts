import { Env, User } from '../types';
import { getOrCreateJwtSecret, readCsrfCookie } from './auth';
import { importJwtSecret, verifyJWT } from './jwt';

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
      `default-src 'self'; script-src 'self' 'nonce-${nonce}' https://challenges.cloudflare.com https://static.cloudflareinsights.com; frame-src 'self' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://icons.duckduckgo.com; connect-src 'self' https://challenges.cloudflare.com https://cloudflare-dns.com https://1.1.1.1;`
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
      return { id: payload.userId, username: "", role: payload.role as any };
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
