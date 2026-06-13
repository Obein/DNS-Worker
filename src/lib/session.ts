import { Env, User } from '../types';
import { SessionModel } from '../models/session';
import { generateId } from '../utils/crypto';
import { base64urlEncode, base64urlDecode } from './jwt';
import { calculateDistanceInKm } from '../utils/geo';

export interface Session {
  id: string;
  user_id: string;
  created_at: number;
  expires_at: number;
  ip_address?: string | null;
  user_agent?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  rotation_counter?: number;
}

export interface SessionValidationResult {
  session: Session | null;
  user: User | null;
}

export const SESSION_ID_LENGTH = 80;

/**
 * Creates a refresh token string containing session ID, rotation version, and timestamp.
 */
export function createRefreshTokenString(sessionId: string, version: number): string {
  const payload = {
    sid: sessionId,
    v: version,
    ts: Date.now()
  };
  return base64urlEncode(JSON.stringify(payload));
}

/**
 * Parses a refresh token string.
 */
export function parseRefreshTokenString(token: string): { sid: string; v: number; ts: number } | null {
  try {
    const jsonStr = new TextDecoder().decode(base64urlDecode(token));
    return JSON.parse(jsonStr);
  } catch (e) {
    return null;
  }
}

/**
 * Creates a new session in the database and returns it along with the initial refresh token.
 */
export async function createSession(
  env: Env,
  userId: string,
  ipAddress: string | null = null,
  userAgent: string | null = null,
  latitude: number | null = null,
  longitude: number | null = null
): Promise<{ session: Session; refreshToken: string }> {
  const sessionId = generateId(SESSION_ID_LENGTH);
  const now = Math.floor(Date.now() / 1000);
  const expirationDays = Number(env.SESSION_EXPIRATION_DAYS) || 1;
  const expiresAt = now + expirationDays * 24 * 60 * 60;

  const session: Session = {
    id: sessionId,
    user_id: userId,
    created_at: now,
    expires_at: expiresAt,
    ip_address: ipAddress,
    user_agent: userAgent,
    latitude: latitude,
    longitude: longitude
  };

  const sessionModel = new SessionModel(env.DB);
  await sessionModel.createSession(
    session.id,
    session.user_id,
    session.created_at,
    session.expires_at,
    session.ip_address,
    session.user_agent,
    session.latitude,
    session.longitude
  );

  const refreshToken = createRefreshTokenString(session.id, 0);

  return { session, refreshToken };
}

/**
 * Rotates a refresh token. Validates anti-reuse, geographic distance, and expiry.
 * Returns the session, user, and a newly rotated refresh token.
 */
export async function rotateSession(
  env: Env,
  refreshTokenString: string,
  currentLat: number | null = null,
  currentLon: number | null = null
): Promise<{ session: Session | null; user: User | null; newRefreshToken: string | null }> {
  const parsed = parseRefreshTokenString(refreshTokenString);
  if (!parsed) {
    return { session: null, user: null, newRefreshToken: null };
  }

  const sessionModel = new SessionModel(env.DB);
  const result = await sessionModel.getSessionWithUser(parsed.sid);

  if (!result) {
    return { session: null, user: null, newRefreshToken: null };
  }

  const session: Session = {
    id: result.session_id,
    user_id: result.user_id,
    created_at: result.created_at,
    expires_at: result.expires_at,
    ip_address: result.ip_address,
    user_agent: result.user_agent,
    latitude: result.latitude,
    longitude: result.longitude,
    rotation_counter: result.rotation_counter
  };

  const user: User = {
    id: result.u_id,
    username: result.username,
    role: result.role as 'admin' | 'user'
  };

  // Anti-reuse mechanism
  if (session.rotation_counter !== parsed.v) {
    // Token reuse detected. Terminate the session immediately.
    await invalidateSession(env, session.id);
    return { session: null, user: null, newRefreshToken: null };
  }

  // Expiration check
  if (Math.floor(Date.now() / 1000) >= session.expires_at) {
    await invalidateSession(env, session.id);
    return { session: null, user: null, newRefreshToken: null };
  }

  // Strict Geolocation Check
  if (
    session.latitude === null || session.latitude === undefined ||
    session.longitude === null || session.longitude === undefined ||
    currentLat === null || currentLon === null
  ) {
    await invalidateSession(env, session.id);
    return { session: null, user: null, newRefreshToken: null };
  }

  const distance = calculateDistanceInKm(session.latitude, session.longitude, currentLat, currentLon);
  const maxDistance = Number(env.SESSION_GEO_DISTANCE_KM) || 50;
  if (distance > maxDistance) {
    await invalidateSession(env, session.id);
    return { session: null, user: null, newRefreshToken: null };
  }

  // Session extension (if close to expiration)
  const timeRemaining = session.expires_at - Math.floor(Date.now() / 1000);
  const expirationDays = Number(env.SESSION_EXPIRATION_DAYS) || 1;
  const totalDurationInSeconds = expirationDays * 24 * 60 * 60;
  const extensionThreshold = Math.floor(totalDurationInSeconds / 2);
  if (timeRemaining < extensionThreshold) {
    session.expires_at = Math.floor(Date.now() / 1000) + totalDurationInSeconds;
    await sessionModel.extendSession(session.id, session.expires_at);
  }

  // Rotate the token
  await sessionModel.incrementRotationCounter(session.id);
  const newCounter = (session.rotation_counter || 0) + 1;
  const newRefreshToken = createRefreshTokenString(session.id, newCounter);

  return { session, user, newRefreshToken };
}

/**
 * Deletes a session from the database.
 */
export async function invalidateSession(env: Env, sessionId: string): Promise<void> {
  const sessionModel = new SessionModel(env.DB);
  await sessionModel.deleteSession(sessionId);
}
