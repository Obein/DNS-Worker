import { Env } from "../types";

// Re-export Geo Utilities
export { getRequestCoordinates, calculateDistanceInKm } from "../utils/geo";

// Re-export Crypto Utilities
export {
  generateId,
  generateZBase32Token,
  ZBASE32_ALPHABET,
  extractSaltHex,
  hmacSha256,
  generateSessionHash
} from "../utils/crypto";

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
import {
  isUsableJwtSecret,
  isStrongJwtSecret,
  isPresetJwtSecret,
  isMissingJwtSecret,
  getJwtSecretStatus,
  MIN_JWT_SECRET_LENGTH
} from "./jwt";
export {
  isUsableJwtSecret,
  isStrongJwtSecret,
  isPresetJwtSecret,
  isMissingJwtSecret,
  getJwtSecretStatus,
  MIN_JWT_SECRET_LENGTH
};

/**
 * Gets or creates the JWT secret from environment configuration.
 * Differentiates between missing JWT_SECRET and unedited preset JWT_SECRET.
 */
export async function getOrCreateJwtSecret(env: Env): Promise<string> {
  const status = getJwtSecretStatus(env.JWT_SECRET);
  if (status === "missing") {
    throw new Error("jwt_secret_missing");
  }
  if (status === "preset") {
    throw new Error("jwt_secret_preset");
  }
  return env.JWT_SECRET!;
}
