/**
 * @file keyOperations.ts
 * @description Local cryptographic key generation, wrapping, and unwrapping operations for Web Client E2EE.
 */

import { ml_kem768_p256 } from "@noble/post-quantum/hybrid.js";
import { toBase64 } from "./crypto";
import type { UnlockedPrivateKey } from "./types";

export interface GeneratedPqcPayload {
  publicKeyPayload: {
    alg: "P256-MLKEM768";
    pqc_pk: string;
  };
  privateKeyObj: UnlockedPrivateKey;
}

/**
 * Generates a post-quantum P256-MLKEM768 keypair and constructs public/private key structures.
 */
export function generatePqcKeyPairPayload(legacyKey?: JsonWebKey): GeneratedPqcPayload {
  const pqcKeys = ml_kem768_p256.keygen();
  const publicKeyPayload = {
    alg: "P256-MLKEM768" as const,
    pqc_pk: toBase64(pqcKeys.publicKey),
  };
  const privateKeyObj: UnlockedPrivateKey = {
    alg: "P256-MLKEM768",
    seedBase64: toBase64(pqcKeys.secretKey),
    ...(legacyKey ? { legacyKey } : {}),
  };

  return { publicKeyPayload, privateKeyObj };
}

/**
 * Encrypts and wraps an UnlockedPrivateKey with a Passkey-derived KEK via AES-GCM.
 */
export async function wrapPrivateKeyWithKek(
  kek: Uint8Array | ArrayBuffer,
  privateKeyObj: UnlockedPrivateKey
): Promise<{ encryptedSk: string; iv: string }> {
  const kekKey = await crypto.subtle.importKey(
    "raw",
    kek as BufferSource,
    { name: "AES-GCM" },
    false,
    ["encrypt"]
  );

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(privateKeyObj));
  const encryptedBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    kekKey,
    plaintext
  );

  return {
    encryptedSk: toBase64(encryptedBuf),
    iv: toBase64(iv),
  };
}

/**
 * Decrypts and unwraps an UnlockedPrivateKey with a primary and optional fallback KEK via AES-GCM.
 */
export async function unwrapPrivateKeyWithKek(
  kek: Uint8Array | ArrayBuffer,
  altKek: Uint8Array | ArrayBuffer | undefined,
  ciphertextBuf: Uint8Array,
  ivBuf: Uint8Array
): Promise<UnlockedPrivateKey> {
  let decryptedBuf: ArrayBuffer | null = null;

  try {
    const kekKey = await crypto.subtle.importKey(
      "raw",
      kek as BufferSource,
      { name: "AES-GCM" },
      false,
      ["decrypt"]
    );
    decryptedBuf = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: ivBuf as BufferSource },
      kekKey,
      ciphertextBuf as BufferSource
    );
  } catch {
    if (altKek) {
      try {
        const altKekKey = await crypto.subtle.importKey(
          "raw",
          altKek as BufferSource,
          { name: "AES-GCM" },
          false,
          ["decrypt"]
        );
        decryptedBuf = await crypto.subtle.decrypt(
          { name: "AES-GCM", iv: ivBuf as BufferSource },
          altKekKey,
          ciphertextBuf as BufferSource
        );
      } catch {}
    }
    if (!decryptedBuf) {
      throw new Error("Failed to decrypt private key with this Passkey. Please unlock using your Recovery Key.");
    }
  }

  return JSON.parse(new TextDecoder().decode(decryptedBuf)) as UnlockedPrivateKey;
}
