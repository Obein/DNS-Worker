import { D1Database } from "@cloudflare/workers-types";
import { Env, User } from "../types";
import { SessionModel } from "../models/session";

export interface Session {
  id: string;
  user_id: string;
  created_at: number;
  expires_at: number;
  ip_address?: string | null;
  user_agent?: string | null;
}

export interface SessionValidationResult {
  session: Session | null;
  user: User | null;
}

const SESSION_COOKIE_NAME = "auth_session";

/**
 * Generates a secure random ID of the specified length.
 */
export function generateId(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, length);
}

/**
 * Creates a new session in the database and returns it.
 */
export async function createSession(env: Env, userId: string, ipAddress: string | null = null, userAgent: string | null = null): Promise<Session> {
  const sessionId = generateId(40);
  const now = Math.floor(Date.now() / 1000);
  const expirationDays = Number(env.SESSION_EXPIRATION_DAYS) || 30;
  const expiresAt = now + expirationDays * 24 * 60 * 60;
  
  const session: Session = {
    id: sessionId,
    user_id: userId,
    created_at: now,
    expires_at: expiresAt,
    ip_address: ipAddress,
    user_agent: userAgent
  };

  const sessionModel = new SessionModel(env.DB);
  await sessionModel.createSession(session.id, session.user_id, session.created_at, session.expires_at, session.ip_address, session.user_agent);

  return session;
}

/**
 * Validates a session from the database. Deletes it if expired.
 */
export async function validateSession(env: Env, sessionId: string): Promise<SessionValidationResult> {
  const sessionModel = new SessionModel(env.DB);
  const result = await sessionModel.getSessionWithUser(sessionId);

  if (!result) {
    return { session: null, user: null };
  }

  const session: Session = {
    id: result.session_id,
    user_id: result.user_id,
    created_at: result.created_at,
    expires_at: result.expires_at,
    ip_address: result.ip_address,
    user_agent: result.user_agent
  };

  const user: User = {
    id: result.u_id,
    username: result.username,
    role: result.role as 'admin' | 'user'
  };
  
  // Check expiration
  if (Math.floor(Date.now() / 1000) >= session.expires_at) {
    await invalidateSession(env, session.id);
    return { session: null, user: null };
  }

  // Optionally extend session if close to expiration (e.g., less than 15 days)
  const timeRemaining = session.expires_at - Math.floor(Date.now() / 1000);
  const fifteenDaysInSeconds = 15 * 24 * 60 * 60;
  if (timeRemaining < fifteenDaysInSeconds) {
    const expirationDays = Number(env.SESSION_EXPIRATION_DAYS) || 30;
    session.expires_at = Math.floor(Date.now() / 1000) + expirationDays * 24 * 60 * 60;
    await sessionModel.extendSession(session.id, session.expires_at);
  }

  return { session, user };
}

/**
 * Deletes a session from the database.
 */
export async function invalidateSession(env: Env, sessionId: string): Promise<void> {
  const sessionModel = new SessionModel(env.DB);
  await sessionModel.deleteSession(sessionId);
}

/**
 * Returns a serialized Set-Cookie header string for a new session.
 */
export function createSessionCookie(sessionId: string, env: Env): string {
  const expirationDays = Number(env.SESSION_EXPIRATION_DAYS) || 30;
  const maxAge = expirationDays * 24 * 60 * 60;
  return `${SESSION_COOKIE_NAME}=${sessionId}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}; Secure`;
}

/**
 * Returns a serialized Set-Cookie header string to clear the session cookie.
 */
export function createBlankSessionCookie(): string {
  return `${SESSION_COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0; Secure`;
}

/**
 * Parses the Cookie header and returns the session ID if present.
 */
export function readSessionCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE_NAME}=([^;]*)`));
  return match ? match[1] : null;
}

// ─── Pre-auth Session (short-lived, bridges username step → password/TOTP step) ───

const PREAUTH_COOKIE_NAME = 'preauth_session';

/**
 * Creates a short-lived pre-auth session after Step 1 (username + Turnstile).
 * @returns The pre-auth session token string
 */
export async function createPreauthSession(env: Env, userId: string): Promise<string> {
  const token = generateId(40);
  const preauthTtl = Number(env.PREAUTH_TTL_SECONDS) || 300;
  const expiresAt = Math.floor(Date.now() / 1000) + preauthTtl;
  const sessionModel = new SessionModel(env.DB);
  await sessionModel.createPendingTotpSession(token, userId, expiresAt);
  return token;
}

/**
 * Validates a pre-auth token and returns the associated userId, or null if invalid/expired.
 * Does NOT delete the session — call invalidatePreauthSession after successful verification.
 */
export async function validatePreauthSession(env: Env, token: string): Promise<string | null> {
  const sessionModel = new SessionModel(env.DB);
  const row = await sessionModel.getPendingTotpSession(token);

  if (!row) return null;
  if (Math.floor(Date.now() / 1000) >= row.expires_at) {
    await sessionModel.deletePendingTotpSession(token);
    return null;
  }
  return row.user_id;
}

/**
 * Deletes a pre-auth session after it has been used (successfully or failed terminally).
 */
export async function invalidatePreauthSession(env: Env, token: string): Promise<void> {
  const sessionModel = new SessionModel(env.DB);
  await sessionModel.deletePendingTotpSession(token);
}

/** Returns a Set-Cookie string for the pre-auth token. */
export function createPreauthCookie(token: string, env: Env): string {
  const preauthTtl = Number(env.PREAUTH_TTL_SECONDS) || 300;
  return `${PREAUTH_COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${preauthTtl}; Secure`;
}

/** Returns a Set-Cookie string to clear the pre-auth cookie. */
export function clearPreauthCookie(): string {
  return `${PREAUTH_COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0; Secure`;
}

/** Reads the pre-auth token from the Cookie header. */
export function readPreauthCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${PREAUTH_COOKIE_NAME}=([^;]*)`));
  return match ? match[1] : null;
}
