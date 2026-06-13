import { Env } from '../types';
import { SessionModel } from '../models/session';
import { generateId } from '../utils/crypto';
import { SESSION_ID_LENGTH } from './session';

/**
 * Creates a short-lived pre-auth session after Step 1 (username + Turnstile).
 * @returns The pre-auth session token string
 */
export async function createPreauthSession(env: Env, userId: string): Promise<string> {
  const token = generateId(SESSION_ID_LENGTH);
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
