import { D1Database } from "@cloudflare/workers-types";
import { User } from "../types";

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

  await db.prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(session.id, session.user_id, session.expires_at)
    .run();

  return session;
}

/**
 * Validates a session from the database. Deletes it if expired.
 */
export async function validateSession(db: D1Database, sessionId: string): Promise<SessionValidationResult> {
  const result = await db.prepare(`
    SELECT sessions.id as session_id, sessions.user_id, sessions.expires_at,
           users.id as u_id, users.username, users.role
    FROM sessions
    INNER JOIN users ON sessions.user_id = users.id
    WHERE sessions.id = ?
  `).bind(sessionId).first<any>();

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
    await db.prepare("UPDATE sessions SET expires_at = ? WHERE id = ?")
      .bind(session.expires_at, session.id)
      .run();
  }

  return { session, user };
}

/**
 * Deletes a session from the database.
 */
export async function invalidateSession(db: D1Database, sessionId: string): Promise<void> {
  await db.prepare("DELETE FROM sessions WHERE id = ?").bind(sessionId).run();
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
