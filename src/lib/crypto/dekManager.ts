/**
 * @file dekManager.ts
 * @description Decoupled Post-Quantum DEK (Data Encryption Key) Lifecycle Manager.
 * Operates as an independent key producer: generates and rotates hourly hybrid KEM keys,
 * persists kem_keys to D1, and publishes active keys to the in-memory pool.
 *
 * NOTE: The log encryption pipeline (consumer) does NOT check expiration; it simply uses
 * whatever active key this manager provides.
 */

import { D1Database } from "@cloudflare/workers-types";
import {
  encapsulatePqcDek,
  deriveDekFromSharedSecret,
  fromBase64,
} from "./e2ee";
import { generateLogId } from "../../models/log/core";

export interface ActiveDek {
  kemKeyId: string;
  dek: CryptoKey;
  profileId: string;
  createdAt: number;
  expiresAt: number;
}

/** 1 hour DEK lifetime in milliseconds */
export const DEK_LIFETIME_MS = 3600 * 1000;

/** In-memory pool of currently active DEKs per profile */
const activeDekMap = new Map<string, ActiveDek>();

/**
 * Key Provider / Consumer Interface:
 * Retrieves the currently published DEK for a profile with ZERO expiration checks.
 * The encryption pipeline consumes this directly without blocking or validating timestamps.
 *
 * @param profileId Profile identifier
 * @returns ActiveDek or null if not yet initialized in this worker isolate
 */
export function getCurrentDek(profileId: string): ActiveDek | null {
  return activeDekMap.get(profileId) || null;
}

/**
 * Key Producer Interface:
 * Ensures an active DEK is available for the profile.
 * If none exists or the existing key has exceeded its 1-hour rotation window,
 * generates a fresh post-quantum hybrid KEM key, writes to kem_keys in D1,
 * and publishes the new key to the active memory pool.
 *
 * @param db D1 Database instance
 * @param profileId Profile identifier
 * @param pqcPublicKeyBase64 1249-byte hybrid public key in Base64
 * @returns The active DEK
 */
export async function ensureActiveDek(
  db: D1Database,
  profileId: string,
  pqcPublicKeyBase64: string
): Promise<ActiveDek> {
  const now = Date.now();
  const existing = activeDekMap.get(profileId);

  // If existing key is still within its rotation window, continue using it
  if (existing && existing.expiresAt > now) {
    return existing;
  }

  return await rotateDek(db, profileId, pqcPublicKeyBase64);
}

/**
 * Key Producer Interface:
 * Generates a new DEK via P256-MLKEM768 encapsulation, persists to D1 kem_keys,
 * and atomically updates the in-memory active pool.
 *
 * @param db D1 Database instance
 * @param profileId Profile identifier
 * @param pqcPublicKeyBase64 1249-byte hybrid public key in Base64
 * @returns Newly minted ActiveDek
 */
export async function rotateDek(
  db: D1Database,
  profileId: string,
  pqcPublicKeyBase64: string
): Promise<ActiveDek> {
  const now = Date.now();
  const nowSec = Math.floor(now / 1000);
  const expiresAtSec = nowSec + 3600;

  // 1. Encapsulate with recipient's hybrid public key (1,249 bytes)
  const pkBytes = fromBase64(pqcPublicKeyBase64);
  const { kemCtBase64, sharedSecret } = encapsulatePqcDek(pkBytes);

  // 2. Derive 256-bit AES-GCM DEK via HKDF-SHA256
  const dek = await deriveDekFromSharedSecret(sharedSecret);

  // 3. Generate unique kem_key_id
  const kemKeyId = `kem_${generateLogId()}`;

  // 4. Persist KEM ciphertext to kem_keys table in D1
  try {
    await db
      .prepare(
        "INSERT INTO kem_keys (id, profile_id, kem_ct, created_at, expires_at) VALUES (?, ?, ?, ?, ?)"
      )
      .bind(kemKeyId, profileId, kemCtBase64, nowSec, expiresAtSec)
      .run();
  } catch (err) {
    console.error(`[DekManager] Failed to persist kem_key ${kemKeyId} to D1:`, err);
    // Even if D1 insert throws (e.g. transient network), proceed with in-memory key
  }

  // 5. Publish to in-memory active pool
  const activeDek: ActiveDek = {
    kemKeyId,
    dek,
    profileId,
    createdAt: now,
    expiresAt: now + DEK_LIFETIME_MS,
  };

  activeDekMap.set(profileId, activeDek);
  return activeDek;
}

/**
 * Invalidates the active DEK for a profile (e.g. when user updates or disables E2EE).
 */
export function invalidateActiveDek(profileId: string): void {
  activeDekMap.delete(profileId);
}
