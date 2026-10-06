/**
 * @file crypto.ts
 * @description Cryptographic primitives and helper functions for E2EE operations:
 * Base64 encoding/decoding, HKDF-SHA256 DEK derivation, and AES-GCM data payload decryption.
 */

import type { CompactEncryptedLogPayload, SensitiveLogData } from "./types";

export function toBase64(bytes: Uint8Array | ArrayBuffer): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (let i = 0; i < u8.length; i++) {
    binary += String.fromCharCode(u8[i]);
  }
  return btoa(binary);
}

export function fromBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const u8 = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    u8[i] = binary.charCodeAt(i);
  }
  return u8;
}

/**
 * Converts a base64url string to Uint8Array.
 */
export function base64UrlToUint8Array(base64Url: string): Uint8Array {
  let base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4 !== 0) {
    base64 += "=";
  }
  return fromBase64(base64);
}

/**
 * Derives a 256-bit AES-GCM Data Encryption Key (DEK) from a post-quantum shared secret via HKDF-SHA256.
 */
export async function deriveDekFromSharedSecret(sharedSecret: Uint8Array): Promise<CryptoKey> {
  const subtle = crypto.subtle;
  const hkdfKey = await subtle.importKey(
    "raw",
    sharedSecret as BufferSource,
    { name: "HKDF" },
    false,
    ["deriveKey"]
  );

  return await subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(0),
      info: new TextEncoder().encode("obex-pqc-dek-v2"),
    },
    hkdfKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * Decrypts compact serialized log payload using a pre-derived AES-GCM DEK.
 */
export async function decryptSensitiveLogDataWithDek(
  dek: CryptoKey,
  encryptedPayloadStr: string
): Promise<SensitiveLogData> {
  const payload: CompactEncryptedLogPayload = JSON.parse(encryptedPayloadStr);
  const iv = fromBase64(payload.iv);
  const ciphertext = fromBase64(payload.ciphertext);

  const decryptedBytes = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    dek,
    ciphertext as BufferSource
  );

  return JSON.parse(new TextDecoder().decode(decryptedBytes)) as SensitiveLogData;
}
