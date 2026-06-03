import { D1Database } from "@cloudflare/workers-types";
import { User } from "../types";
import { SessionModel } from "../models/session";

export interface Session {
  id: string;
  user_id: string;
  expires_at: number;
}

export interface SessionValidationResult {
  session: Session | null;
  user: User | null;
}

const SESSION_COOKIE_NAME = "auth_session";
const SESSION_EXPIRATION_DAYS = 30;

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
export async function createSession(db: D1Database, userId: string): Promise<Session> {
  const sessionId = generateId(40);
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_EXPIRATION_DAYS * 24 * 60 * 60;
  
  const session: Session = {
    id: sessionId,
    user_id: userId,
    expires_at: expiresAt
  };

  const sessionModel = new SessionModel(db);
  await sessionModel.createSession(session.id, session.user_id, session.expires_at);

  return session;
}

/**
 * Validates a session from the database. Deletes it if expired.
 */
export async function validateSession(db: D1Database, sessionId: string): Promise<SessionValidationResult> {
  const sessionModel = new SessionModel(db);
  const result = await sessionModel.getSessionWithUser(sessionId);

  if (!result) {
    return { session: null, user: null };
  }

  const session: Session = {
    id: result.session_id,
    user_id: result.user_id,
    expires_at: result.expires_at
  };

  const user: User = {
    id: result.u_id,
    username: result.username,
    role: result.role as 'admin' | 'user'
  };
  
  // Check expiration
  if (Math.floor(Date.now() / 1000) >= session.expires_at) {
    await invalidateSession(db, session.id);
    return { session: null, user: null };
  }

  // Optionally extend session if close to expiration (e.g., less than 15 days)
  const timeRemaining = session.expires_at - Math.floor(Date.now() / 1000);
  const fifteenDaysInSeconds = 15 * 24 * 60 * 60;
  if (timeRemaining < fifteenDaysInSeconds) {
    session.expires_at = Math.floor(Date.now() / 1000) + SESSION_EXPIRATION_DAYS * 24 * 60 * 60;
    await sessionModel.extendSession(session.id, session.expires_at);
  }

  return { session, user };
}

/**
 * Deletes a session from the database.
 */
export async function invalidateSession(db: D1Database, sessionId: string): Promise<void> {
  const sessionModel = new SessionModel(db);
  await sessionModel.deleteSession(sessionId);
}

/**
 * Returns a serialized Set-Cookie header string for a new session.
 */
export function createSessionCookie(sessionId: string): string {
  const maxAge = SESSION_EXPIRATION_DAYS * 24 * 60 * 60;
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
const PREAUTH_TTL_SECONDS = 5 * 60; // 5 minutes

/**
 * Creates a short-lived pre-auth session after Step 1 (username + Turnstile).
 * @returns The pre-auth session token string
 */
export async function createPreauthSession(db: D1Database, userId: string): Promise<string> {
  const token = generateId(40);
  const expiresAt = Math.floor(Date.now() / 1000) + PREAUTH_TTL_SECONDS;
  const sessionModel = new SessionModel(db);
  await sessionModel.createPendingTotpSession(token, userId, expiresAt);
  return token;
}

/**
 * Validates a pre-auth token and returns the associated userId, or null if invalid/expired.
 * Does NOT delete the session — call invalidatePreauthSession after successful verification.
 */
export async function validatePreauthSession(db: D1Database, token: string): Promise<string | null> {
  const sessionModel = new SessionModel(db);
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
export async function invalidatePreauthSession(db: D1Database, token: string): Promise<void> {
  const sessionModel = new SessionModel(db);
  await sessionModel.deletePendingTotpSession(token);
}

/** Returns a Set-Cookie string for the pre-auth token. */
export function createPreauthCookie(token: string): string {
  return `${PREAUTH_COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${PREAUTH_TTL_SECONDS}; Secure`;
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
