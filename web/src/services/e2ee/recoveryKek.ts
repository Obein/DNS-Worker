/**
 * @file recoveryKek.ts
 * @description Key Encryption Key (KEK) derivation and private key wrapping / unwrapping
 * using 30-digit emergency recovery keys via PBKDF2-HMAC-SHA256.
 */

import type { UnlockedPrivateKey } from "./types";
import { toBase64, fromBase64 } from "./crypto";

export interface WrappedRecoveryKey {
  encryptedSk: string;
  iv: string;
  salt: string;
}

/**
 * Derives a 256-bit Key Encryption Key (KEK) from a normalized plaintext Recovery Key using PBKDF2-HMAC-SHA256.
 */
export async function deriveRecoveryKek(plaintextRecoveryKey: string, salt: Uint8Array): Promise<CryptoKey> {
  const normalized = plaintextRecoveryKey.replace(/[-\s]/g, "").toUpperCase().trim();
  const data = new TextEncoder().encode(normalized);

  const baseKey = await crypto.subtle.importKey(
    "raw",
    data,
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt as BufferSource,
      iterations: 100000,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * Wraps (encrypts) the private key using a Recovery Key KEK.
 */
export async function wrapPrivateKeyWithRecoveryKey(
  privateKey: UnlockedPrivateKey,
  plaintextRecoveryKey: string
): Promise<WrappedRecoveryKey> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const kek = await deriveRecoveryKek(plaintextRecoveryKey, salt);

  const plaintext = new TextEncoder().encode(JSON.stringify(privateKey));
  const ciphertextBuffer = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    kek,
    plaintext
  );

  return {
    encryptedSk: toBase64(ciphertextBuffer),
    iv: toBase64(iv),
    salt: toBase64(salt),
  };
}

/**
 * Unwraps (decrypts) the private key using a Recovery Key KEK.
 */
export async function unwrapPrivateKeyWithRecoveryKey(
  encryptedSkBase64: string,
  ivBase64: string,
  saltBase64: string,
  plaintextRecoveryKey: string
): Promise<UnlockedPrivateKey> {
  const salt = fromBase64(saltBase64);
  const iv = fromBase64(ivBase64);
  const ciphertext = fromBase64(encryptedSkBase64);
  const kek = await deriveRecoveryKek(plaintextRecoveryKey, salt);

  const decryptedBuffer = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    kek,
    ciphertext as BufferSource
  );

  return JSON.parse(new TextDecoder().decode(decryptedBuffer)) as UnlockedPrivateKey;
}
