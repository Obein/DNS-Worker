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
  last_active_at?: number | null;
  is_paused?: number;
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
  longitude: number | null = null,
  keepLoggedIn?: boolean
): Promise<{ session: Session; refreshToken: string }> {
  const prefix = keepLoggedIn ? "k_" : "s_";
  const sessionId = prefix + generateId(SESSION_ID_LENGTH - 2);
  const now = Math.floor(Date.now() / 1000);
  let expiresAt: number;
  if (keepLoggedIn) {
    const expirationDays = Number(env.OPTIONAL_SESSION_EXPIRATION_DAYS) || 30;
    expiresAt = now + expirationDays * 24 * 60 * 60;
  } else {
    const expirationMinutes = Number(env.DEFAULT_SESSION_EXPIRATION_MINUTES) || 1440;
    expiresAt = now + expirationMinutes * 60;
  }

  const session: Session = {
    id: sessionId,
    user_id: userId,
    created_at: now,
    expires_at: expiresAt,
    ip_address: ipAddress,
    user_agent: userAgent,
    latitude: latitude,
    longitude: longitude,
    last_active_at: now
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
    session.longitude,
    session.last_active_at
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
): Promise<{ session: Session | null; user: User | null; newRefreshToken: string | null; reason?: string }> {
  const parsed = parseRefreshTokenString(refreshTokenString);
  if (!parsed) {
    return { session: null, user: null, newRefreshToken: null, reason: "invalid_token" };
  }

  const sessionModel = new SessionModel(env.DB);
  const result = await sessionModel.getSessionWithUser(parsed.sid);

  if (!result) {
    return { session: null, user: null, newRefreshToken: null, reason: "session_not_found" };
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
    rotation_counter: result.rotation_counter,
    last_active_at: result.last_active_at,
    is_paused: result.is_paused
  };

  const user: User = {
    id: result.u_id,
    username: result.username,
    role: result.role as 'admin' | 'user',
    pin_hash: result.pin_hash,
    session_lock_timeout: result.session_lock_timeout
  };

  // Anti-reuse mechanism
  if (session.rotation_counter !== parsed.v) {
    // Token reuse detected. Terminate the session immediately.
    await invalidateSession(env, session.id);
    return { session: null, user, newRefreshToken: null, reason: "token_reuse" };
  }

  // Expiration check
  if (Math.floor(Date.now() / 1000) >= session.expires_at) {
    await invalidateSession(env, session.id);
    return { session: null, user, newRefreshToken: null, reason: "expired" };
  }

  const now = Math.floor(Date.now() / 1000);

  // Strict Geolocation Check
  if (
    session.latitude === null || session.latitude === undefined ||
    session.longitude === null || session.longitude === undefined ||
    currentLat === null || currentLon === null
  ) {
    await invalidateSession(env, session.id);
    return { session: null, user, newRefreshToken: null, reason: "geolocation_missing" };
  }

  const distance = calculateDistanceInKm(session.latitude, session.longitude, currentLat, currentLon);
  const maxDistance = Number(env.SESSION_GEO_DISTANCE_KM) || 50;
  if (distance > maxDistance) {
    await invalidateSession(env, session.id);
    return { session: null, user, newRefreshToken: null, reason: "geolocation_mismatch" };
  }

  // Inactivity timeout check during refresh rotation
  const lastActive = session.last_active_at || session.created_at;
  if (user.pin_hash && !session.is_paused) {
    const timeoutSeconds = (user.session_lock_timeout || 15) * 60;
    if (now - lastActive > timeoutSeconds) {
      await sessionModel.pauseSession(session.id);
      session.is_paused = 1;
    }
  }

  // Session extension (if close to expiration)
  const timeRemaining = session.expires_at - Math.floor(Date.now() / 1000);
  const isKeepLoggedIn = session.id.startsWith("k_");
  const totalDurationInSeconds = isKeepLoggedIn
    ? (Number(env.OPTIONAL_SESSION_EXPIRATION_DAYS) || 30) * 24 * 60 * 60
    : (Number(env.DEFAULT_SESSION_EXPIRATION_MINUTES) || 1440) * 60;
  const extensionThreshold = Math.floor(totalDurationInSeconds / 2);
  if (timeRemaining < extensionThreshold) {
    session.expires_at = Math.floor(Date.now() / 1000) + totalDurationInSeconds;
    await sessionModel.extendSession(session.id, session.expires_at);
  }

  // Rotate the token
  await sessionModel.incrementRotationCounter(session.id);
  if (!session.is_paused) {
    await sessionModel.updateLastActive(session.id, now);
  }
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
