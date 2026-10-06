/**
 * @file dekManager.ts
 * @description Decoupled Post-Quantum DEK (Data Encryption Key) Lifecycle Manager.
 * Operates as an independent key producer: generates and rotates hourly hybrid KEM keys,
 * persists kem_keys to D1 (with server-wrapped DEK for cross-isolate reuse), and publishes
 * active keys to the in-memory pool.
 *
 * NOTE: The log encryption pipeline (consumer) does NOT check expiration; it simply uses
 * whatever active key this manager provides.
 */

import { D1Database } from "@cloudflare/workers-types";
import {
  encapsulatePqcDek,
  deriveDekFromSharedSecret,
  fromBase64,
  toBase64,
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

/** Mutex to deduplicate concurrent in-flight DEK provisionings per profile */
const inFlightDekPromises = new Map<string, Promise<ActiveDek>>();

/**
 * Derives an AES-GCM wrapping key from the server secret (e.g. JWT_SECRET).
 */
async function getServerDekWrapKey(secret: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const secretData = encoder.encode(secret.trim());
  const hashBuffer = await crypto.subtle.digest("SHA-256", secretData);
  return await crypto.subtle.importKey(
    "raw",
    hashBuffer,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * Wraps (encrypts) the 32-byte sharedSecret with the server secret for secure persistence in D1.
 * This allows any distributed Worker isolate sharing the same JWT_SECRET to reuse the active DEK.
 */
async function wrapSharedSecretForServer(
  sharedSecret: Uint8Array,
  secret: string
): Promise<string> {
  const wrapKey = await getServerDekWrapKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertextBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    wrapKey,
    sharedSecret as BufferSource
  );
  return JSON.stringify({
    iv: toBase64(iv),
    ciphertext: toBase64(new Uint8Array(ciphertextBuf)),
  });
}

/**
 * Unwraps (decrypts) the 32-byte sharedSecret from its server-wrapped ciphertext.
 */
async function unwrapSharedSecretForServer(
  encryptedDekJson: string,
  secret: string
): Promise<Uint8Array | null> {
  try {
    const parsed = JSON.parse(encryptedDekJson);
    if (!parsed.iv || !parsed.ciphertext) return null;
    const wrapKey = await getServerDekWrapKey(secret);
    const iv = fromBase64(parsed.iv);
    const ciphertext = fromBase64(parsed.ciphertext);
    const decryptedBuf = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv as BufferSource },
      wrapKey,
      ciphertext as BufferSource
    );
    return new Uint8Array(decryptedBuf);
  } catch (err) {
    console.warn("[DekManager] Failed to unwrap shared secret with server key:", err);
    return null;
  }
}

/**
 * Resolves the server secret string from the execution environment bindings or process.env.
 */
function resolveServerSecret(env?: unknown): string | null {
  if (env && typeof env === "object") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyEnv = env as any;
    if (anyEnv.JWT_SECRET && typeof anyEnv.JWT_SECRET === "string" && anyEnv.JWT_SECRET.trim() !== "") {
      return anyEnv.JWT_SECRET;
    }
    if (anyEnv.KEK_v1 && typeof anyEnv.KEK_v1 === "string" && anyEnv.KEK_v1.trim() !== "") {
      return anyEnv.KEK_v1;
    }
  }
  if (typeof process !== "undefined" && process.env?.JWT_SECRET) {
    return process.env.JWT_SECRET;
  }
  return null;
}

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
 * First checks in-memory cache, then checks D1 for an active unexpired key created by another isolate,
 * and only generates a new key if none exists or the existing key has expired.
 *
 * @param db D1 Database instance
 * @param profileId Profile identifier
 * @param pqcPublicKeyBase64 1249-byte hybrid public key in Base64
 * @param env Optional environment bindings containing JWT_SECRET
 * @returns The active DEK
 */
export async function ensureActiveDek(
  db: D1Database,
  profileId: string,
  pqcPublicKeyBase64: string,
  env?: unknown
): Promise<ActiveDek> {
  const now = Date.now();
  const existing = activeDekMap.get(profileId);

  // If existing key is still within its rotation window, continue using it
  if (existing && existing.expiresAt > now) {
    return existing;
  }

  // Deduplicate concurrent in-flight requests for the same profile
  const inFlight = inFlightDekPromises.get(profileId);
  if (inFlight) {
    return await inFlight;
  }

  const promise = (async () => {
    try {
      return await fetchOrRotateDek(db, profileId, pqcPublicKeyBase64, env);
    } finally {
      inFlightDekPromises.delete(profileId);
    }
  })();

  inFlightDekPromises.set(profileId, promise);
  return await promise;
}

/**
 * Internal logic: checks D1 for an unexpired active key before minting a new one.
 */
async function fetchOrRotateDek(
  db: D1Database,
  profileId: string,
  pqcPublicKeyBase64: string,
  env?: unknown
): Promise<ActiveDek> {
  const nowSec = Math.floor(Date.now() / 1000);
  const serverSecret = resolveServerSecret(env);

  // 1. Check D1 for an existing unexpired key that has server-wrapped DEK
  if (serverSecret) {
    try {
      const row = await db
        .prepare(
          "SELECT id, kem_ct, encrypted_dek, created_at, expires_at FROM kem_keys WHERE profile_id = ? AND expires_at > ? AND encrypted_dek IS NOT NULL ORDER BY created_at DESC LIMIT 1"
        )
        .bind(profileId, nowSec + 60) // Require at least 60s of validity remaining
        .first<{
          id: string;
          kem_ct: string;
          encrypted_dek: string;
          created_at: number;
          expires_at: number;
        }>();

      if (row && row.encrypted_dek) {
        const sharedSecret = await unwrapSharedSecretForServer(row.encrypted_dek, serverSecret);
        if (sharedSecret) {
          const dek = await deriveDekFromSharedSecret(sharedSecret);
          const activeDek: ActiveDek = {
            kemKeyId: row.id,
            dek,
            profileId,
            createdAt: row.created_at * 1000,
            expiresAt: row.expires_at * 1000,
          };
          activeDekMap.set(profileId, activeDek);
          return activeDek;
        }
      }
    } catch (dbErr: unknown) {
      // Gracefully handle if encrypted_dek column does not yet exist
      const msg = String((dbErr as Error)?.message || dbErr);
      if (!msg.includes("no such column")) {
        console.warn(`[DekManager] Error querying active kem_key for ${profileId}:`, dbErr);
      }
    }
  }

  // 2. If no valid unexpired key in D1, generate and persist a fresh hourly key
  return await rotateDek(db, profileId, pqcPublicKeyBase64, env);
}

/**
 * Key Producer Interface:
 * Generates a new DEK via P256-MLKEM768 encapsulation, persists to D1 kem_keys,
 * and atomically updates the in-memory active pool.
 *
 * @param db D1 Database instance
 * @param profileId Profile identifier
 * @param pqcPublicKeyBase64 1249-byte hybrid public key in Base64
 * @param env Optional environment bindings containing JWT_SECRET
 * @returns Newly minted ActiveDek
 */
export async function rotateDek(
  db: D1Database,
  profileId: string,
  pqcPublicKeyBase64: string,
  env?: unknown
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

  // 4. Wrap sharedSecret with server secret for cross-isolate reuse
  const serverSecret = resolveServerSecret(env);
  let encryptedDek: string | null = null;
  if (serverSecret) {
    try {
      encryptedDek = await wrapSharedSecretForServer(sharedSecret, serverSecret);
    } catch (wrapErr) {
      console.warn("[DekManager] Failed to wrap sharedSecret for server reuse:", wrapErr);
    }
  }

  // 5. Persist to kem_keys table in D1
  try {
    if (encryptedDek) {
      try {
        await db
          .prepare(
            "INSERT INTO kem_keys (id, profile_id, kem_ct, encrypted_dek, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)"
          )
          .bind(kemKeyId, profileId, kemCtBase64, encryptedDek, nowSec, expiresAtSec)
          .run();
      } catch (colErr: unknown) {
        const msg = String((colErr as Error)?.message || colErr);
        if (msg.includes("no such column")) {
          await db
            .prepare(
              "INSERT INTO kem_keys (id, profile_id, kem_ct, created_at, expires_at) VALUES (?, ?, ?, ?, ?)"
            )
            .bind(kemKeyId, profileId, kemCtBase64, nowSec, expiresAtSec)
            .run();
        } else {
          throw colErr;
        }
      }
    } else {
      await db
        .prepare(
          "INSERT INTO kem_keys (id, profile_id, kem_ct, created_at, expires_at) VALUES (?, ?, ?, ?, ?)"
        )
        .bind(kemKeyId, profileId, kemCtBase64, nowSec, expiresAtSec)
        .run();
    }
  } catch (err) {
    console.error(`[DekManager] Failed to persist kem_key ${kemKeyId} to D1:`, err);
  }

  // 6. Publish to in-memory active pool
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
  inFlightDekPromises.delete(profileId);
}
