/**
 * @file pqc.ts
 * @description Post-Quantum Cryptography (P256-MLKEM768 / NIST FIPS 203) hybrid encryption primitives.
 */

import { ml_kem768_p256 } from "@noble/post-quantum/hybrid.js";
import {
  CompactEncryptedLogPayload,
  PqcKeyPair,
  SensitiveLogData,
  WrappedKeyData,
  RecoveryWrappedKeyData
} from './types';
import { toBase64, fromBase64 } from './base64';
import { deriveRecoveryKek } from './recovery';

/**
 * Generates a post-quantum hybrid P256-MLKEM768 key pair.
 *
 * @returns Object with base64-encoded 1249-byte public key and 32-byte seed secret key.
 */
export function generatePqcLogKeyPair(): PqcKeyPair {
  const keys = ml_kem768_p256.keygen();
  return {
    publicKeyBase64: toBase64(keys.publicKey),
    secretKeyBase64: toBase64(keys.secretKey),
  };
}

/**
 * Encapsulates a shared secret using recipient's P256-MLKEM768 public key.
 *
 * @param publicKeyBytes 1249-byte hybrid public key
 * @returns 1153-byte KEM ciphertext (Base64) and 32-byte high-entropy shared secret
 */
export function encapsulatePqcDek(publicKeyBytes: Uint8Array): {
  kemCtBase64: string;
  sharedSecret: Uint8Array;
} {
  const res = ml_kem768_p256.encapsulate(publicKeyBytes);
  return {
    kemCtBase64: toBase64(res.cipherText),
    sharedSecret: res.sharedSecret,
  };
}

/**
 * Decapsulates a shared secret using recipient's P256-MLKEM768 secret key.
 *
 * @param kemCtBytes 1153-byte KEM ciphertext
 * @param secretKeyBytes 32-byte seed secret key
 * @returns 32-byte shared secret
 */
export function decapsulatePqcDek(
  kemCtBytes: Uint8Array,
  secretKeyBytes: Uint8Array
): Uint8Array {
  return ml_kem768_p256.decapsulate(kemCtBytes, secretKeyBytes);
}

/**
 * Derives a 256-bit AES-GCM DEK from a 32-byte KEM shared secret via HKDF-SHA256.
 *
 * @param sharedSecret 32-byte high-entropy shared secret
 * @returns CryptoKey handle for AES-GCM encrypt/decrypt
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
 * Encrypts sensitive DNS log data using a pre-derived AES-256-GCM DEK.
 * Produces a minimal compact payload containing only iv and ciphertext.
 *
 * @param dek 256-bit AES-GCM CryptoKey
 * @param sensitiveData Plaintext sensitive DNS log fields
 * @returns JSON-serialized CompactEncryptedLogPayload ({ iv, ciphertext })
 */
export async function encryptSensitiveLogDataWithDek(
  dek: CryptoKey,
  sensitiveData: SensitiveLogData
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintextBytes = new TextEncoder().encode(JSON.stringify(sensitiveData));
  const ciphertextBuffer = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    dek,
    plaintextBytes
  );

  const payload: CompactEncryptedLogPayload = {
    iv: toBase64(iv),
    ciphertext: toBase64(ciphertextBuffer),
  };

  return JSON.stringify(payload);
}

/**
 * Decrypts sensitive DNS log data using a pre-derived AES-256-GCM DEK.
 *
 * @param dek 256-bit AES-GCM CryptoKey
 * @param encryptedPayloadStr JSON-serialized CompactEncryptedLogPayload ({ iv, ciphertext })
 * @returns Plaintext SensitiveLogData
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

/**
 * Wraps (encrypts) the user's 32-byte PQC secret key seed with a Passkey-derived Key Encryption Key (KEK).
 *
 * @param secretKeyBytes 32-byte PQC secret key seed
 * @param kekRaw 256-bit raw key derived from Passkey assertion / PRF
 * @returns Base64-encoded encrypted secret key and IV
 */
export async function wrapPqcPrivateKeyWithKek(
  secretKeyBytes: Uint8Array,
  kekRaw: Uint8Array
): Promise<WrappedKeyData> {
  const subtle = crypto.subtle;
  const kek = await subtle.importKey(
    "raw",
    kekRaw as BufferSource,
    { name: "AES-GCM" },
    false,
    ["encrypt"]
  );

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encryptedBuffer = await subtle.encrypt(
    { name: "AES-GCM", iv },
    kek,
    secretKeyBytes as BufferSource
  );

  return {
    encryptedSk: toBase64(encryptedBuffer),
    iv: toBase64(iv),
  };
}

/**
 * Unwraps (decrypts) the user's 32-byte PQC secret key seed using a Passkey-derived Key Encryption Key (KEK).
 *
 * @param encryptedSkBase64 Base64-encoded encrypted secret key
 * @param ivBase64 Base64-encoded IV
 * @param kekRaw 256-bit raw key derived from Passkey assertion / PRF
 * @returns 32-byte PQC secret key seed
 */
export async function unwrapPqcPrivateKeyWithKek(
  encryptedSkBase64: string,
  ivBase64: string,
  kekRaw: Uint8Array
): Promise<Uint8Array> {
  const subtle = crypto.subtle;
  const kek = await subtle.importKey(
    "raw",
    kekRaw as BufferSource,
    { name: "AES-GCM" },
    false,
    ["decrypt"]
  );

  const iv = fromBase64(ivBase64);
  const ciphertext = fromBase64(encryptedSkBase64);

  const decryptedBuffer = await subtle.decrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    kek,
    ciphertext as BufferSource
  );

  return new Uint8Array(decryptedBuffer);
}

/**
 * Wraps (encrypts) the user's 32-byte PQC secret key seed using a Recovery Key KEK.
 *
 * @param secretKeyBytes 32-byte PQC secret key seed
 * @param plaintextRecoveryKey Plaintext recovery key
 * @returns Base64 encoded encryptedSk, iv, and salt
 */
export async function wrapPqcPrivateKeyWithRecoveryKey(
  secretKeyBytes: Uint8Array,
  plaintextRecoveryKey: string
): Promise<RecoveryWrappedKeyData> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const kek = await deriveRecoveryKek(plaintextRecoveryKey, salt);

  const ciphertextBuffer = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    kek,
    secretKeyBytes as BufferSource
  );

  return {
    encryptedSk: toBase64(ciphertextBuffer),
    iv: toBase64(iv),
    salt: toBase64(salt),
  };
}

/**
 * Unwraps (decrypts) the user's 32-byte PQC secret key seed using their Recovery Key.
 *
 * @param encryptedSkBase64 Base64 encoded encrypted secret key
 * @param ivBase64 Base64 encoded IV
 * @param saltBase64 Base64 encoded salt
 * @param plaintextRecoveryKey Plaintext recovery key entered by user
 * @returns 32-byte PQC secret key seed
 */
export async function unwrapPqcPrivateKeyWithRecoveryKey(
  encryptedSkBase64: string,
  ivBase64: string,
  saltBase64: string,
  plaintextRecoveryKey: string
): Promise<Uint8Array> {
  const salt = fromBase64(saltBase64);
  const iv = fromBase64(ivBase64);
  const ciphertext = fromBase64(encryptedSkBase64);
  const kek = await deriveRecoveryKek(plaintextRecoveryKey, salt);

  const decryptedBuffer = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    kek,
    ciphertext as BufferSource
  );

  return new Uint8Array(decryptedBuffer);
}
