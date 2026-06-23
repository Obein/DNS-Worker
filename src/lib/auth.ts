import { Env } from "../types";
import { SystemSecretsModel } from "../models/systemSecrets";

// Re-export Geo Utilities
export { getRequestCoordinates, calculateDistanceInKm } from "../utils/geo";

// Re-export Crypto Utilities
export { generateId, extractSaltHex, hmacSha256, generateSessionHash } from "../utils/crypto";

// Re-export Cookie Management
export {
  REFRESH_TOKEN_COOKIE_NAME,
  PREAUTH_COOKIE_NAME,
  createRefreshTokenCookie,
  createBlankRefreshTokenCookie,
  readRefreshTokenCookie,
  createCsrfCookie,
  readCsrfCookie,
  createPreauthCookie,
  clearPreauthCookie,
  readPreauthCookie
} from "./cookies";

// Re-export Session Management (Values)
export {
  SESSION_ID_LENGTH,
  createRefreshTokenString,
  parseRefreshTokenString,
  createSession,
  rotateSession,
  invalidateSession
} from "./session";

// Re-export Session Management (Types)
export type {
  Session,
  SessionValidationResult
} from "./session";

// Re-export Pre-auth Management
export {
  createPreauthSession,
  validatePreauthSession,
  invalidatePreauthSession,
  recordFailedPreauthAttempt
} from "./preauth";

/**
 * Gets or creates the JWT secret from system settings.
 */
export async function getOrCreateJwtSecret(env: Env): Promise<string> {
  const secretsModel = new SystemSecretsModel(env.DB);
  let secret = await secretsModel.get("jwt_secret");
  if (!secret) {
    const bytes = new Uint8Array(64); // 512 bits for HS512 (Post-Quantum safe symmetric key size)
    crypto.getRandomValues(bytes);
    secret = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
    await secretsModel.set("jwt_secret", secret);
  }
  return secret;
}
