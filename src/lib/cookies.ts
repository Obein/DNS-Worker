import { Env } from '../types';

export const REFRESH_TOKEN_COOKIE_NAME = "auth_refresh";
export const PREAUTH_COOKIE_NAME = 'preauth_session';

/**
 * Returns a serialized Set-Cookie header string for a new refresh token.
 */
export function createRefreshTokenCookie(refreshToken: string, env: Env): string {
  const expirationDays = Number(env.SESSION_EXPIRATION_DAYS) || 1;
  const maxAge = expirationDays * 24 * 60 * 60;
  return `${REFRESH_TOKEN_COOKIE_NAME}=${refreshToken}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}; Secure`;
}

/**
 * Returns a serialized Set-Cookie header string to clear the refresh token cookie.
 */
export function createBlankRefreshTokenCookie(): string {
  return `${REFRESH_TOKEN_COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0; Secure`;
}

/**
 * Parses the Cookie header and returns the refresh token if present.
 */
export function readRefreshTokenCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${REFRESH_TOKEN_COOKIE_NAME}=([^;]*)`));
  return match ? match[1] : null;
}

/**
 * Returns a serialized Set-Cookie header string for a new CSRF token.
 * This cookie is not HttpOnly so that client-side JavaScript can read it to append the header.
 */
export function createCsrfCookie(token: string): string {
  return `csrf_token=${token}; SameSite=Lax; Path=/; Secure`;
}

/**
 * Parses the Cookie header and returns the CSRF token if present.
 */
export function readCsrfCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(/(?:^|;\s*)csrf_token=([^;]*)/);
  return match ? match[1] : null;
}

/**
 * Returns a Set-Cookie string for the pre-auth token.
 */
export function createPreauthCookie(token: string, env: Env): string {
  const preauthTtl = Number(env.PREAUTH_TTL_SECONDS) || 300;
  return `${PREAUTH_COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${preauthTtl}; Secure`;
}

/**
 * Returns a Set-Cookie string to clear the pre-auth cookie.
 */
export function clearPreauthCookie(): string {
  return `${PREAUTH_COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0; Secure`;
}

/**
 * Reads the pre-auth token from the Cookie header.
 */
export function readPreauthCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${PREAUTH_COOKIE_NAME}=([^;]*)`));
  return match ? match[1] : null;
}
