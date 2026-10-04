/**
 * @file e2ee.ts
 * @description Zero-Knowledge End-to-End Encryption (E2EE) cryptographic primitives.
 * Implements Web Crypto ECDH P-256 and Post-Quantum P256-MLKEM768 (NIST FIPS 203) hybrid encryption.
 */

import { ml_kem768_p256 } from "@noble/post-quantum/hybrid.js";

export interface EncryptedPayload {
  ephem_pk: JsonWebKey;
  iv: string;
  ciphertext: string;
}

/** Minimal compact payload for periodic envelope encryption (no redundant version field) */
export interface CompactEncryptedLogPayload {
  iv: string;         // Base64 (12-byte AES-GCM IV)
  ciphertext: string; // Base64 (AES-256-GCM ciphertext + 16-byte tag)
}

export interface PqcKeyPair {
  publicKeyBase64: string;  // 1,249 bytes Base64
  secretKeyBase64: string;  // 32 bytes seed Base64
}

export interface PqcProfilePublicKey {
  alg: "P256-MLKEM768";
  pqc_pk: string; // Base64 1,249 bytes
}


export interface SensitiveLogData {
  domain: string;
  client_ip: string;
  geo_country?: string | null;
  answer?: string | null;
  dest_geoip?: string | null;
  dest_country_code?: string | null;
  dest_country?: string | null;
  dest_isp?: string | null;
  ecs?: string | null;
  upstream?: string | null;
  reason?: string | null;
}

export interface WrappedKeyData {
  encryptedSk: string;
  iv: string;
}

/**
 * Universal base64 encoder supporting Web Workers, Cloudflare Workers, Node.js, and Browsers.
 */
export function toBase64(bytes: Uint8Array | ArrayBuffer): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (typeof Buffer !== "undefined") {
    return Buffer.from(u8).toString("base64");
  }
  let binary = "";
  for (let i = 0; i < u8.length; i++) {
    binary += String.fromCharCode(u8[i]);
  }
  return btoa(binary);
}

/**
 * Universal base64 decoder supporting Web Workers, Cloudflare Workers, Node.js, and Browsers.
 */
export function fromBase64(base64: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(base64, "base64"));
  }
  const binary = atob(base64);
  const u8 = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    u8[i] = binary.charCodeAt(i);
  }
  return u8;
}

/**
 * Generates an ECDH P-256 keypair for log encryption and decryption.
 */
export async function generateLogKeyPair(): Promise<{
  publicKeyJwk: JsonWebKey;
  privateKeyJwk: JsonWebKey;
}> {
  const subtle = crypto.subtle;
  const keyPair = (await subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveKey", "deriveBits"]
  )) as CryptoKeyPair;

  const publicKeyJwk = (await subtle.exportKey("jwk", keyPair.publicKey)) as JsonWebKey;
  const privateKeyJwk = (await subtle.exportKey("jwk", keyPair.privateKey)) as JsonWebKey;

  return { publicKeyJwk, privateKeyJwk };
}

/**
 * Encrypts sensitive DNS log data using recipient's ECDH P-256 public key.
 *
 * @param recipientPublicKeyJwk The recipient's ECDH P-256 public key.
 * @param sensitiveData The sensitive fields of the DNS query log.
 * @returns JSON-stringified EncryptedPayload containing ephem_pk, iv, and ciphertext.
 */
export async function encryptSensitiveLogData(
  recipientPublicKeyJwk: JsonWebKey,
  sensitiveData: SensitiveLogData
): Promise<string> {
  const subtle = crypto.subtle;

  // 1. Generate ephemeral ECDH P-256 key pair
  const ephemKeyPair = (await subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveKey"]
  )) as CryptoKeyPair;

  // 2. Import recipient public key
  const importedRecipientPub = await subtle.importKey(
    "jwk",
    recipientPublicKeyJwk,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );

  // 3. Derive 256-bit AES-GCM shared key
  const aesKey = await subtle.deriveKey(
    { name: "ECDH", public: importedRecipientPub, $public: importedRecipientPub } as any,
    ephemKeyPair.privateKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"]
  );

  // 4. Encrypt sensitive payload
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintextBytes = new TextEncoder().encode(JSON.stringify(sensitiveData));
  const ciphertextBuffer = await subtle.encrypt(
    { name: "AES-GCM", iv },
    aesKey,
    plaintextBytes
  );

  // 5. Export ephemeral public key
  const ephemPkJwk = (await subtle.exportKey("jwk", ephemKeyPair.publicKey)) as JsonWebKey;

  const payload: EncryptedPayload = {
    ephem_pk: ephemPkJwk,
    iv: toBase64(iv),
    ciphertext: toBase64(ciphertextBuffer),
  };

  return JSON.stringify(payload);
}

/**
 * Decrypts sensitive DNS log data using the user's ECDH P-256 private key.
 *
 * @param recipientPrivateKeyJwk The user's ECDH P-256 private key.
 * @param encryptedPayloadStr The JSON-stringified EncryptedPayload.
 * @returns Decrypted SensitiveLogData.
 */
export async function decryptSensitiveLogData(
  recipientPrivateKeyJwk: JsonWebKey,
  encryptedPayloadStr: string
): Promise<SensitiveLogData> {
  const subtle = crypto.subtle;
  const payload: EncryptedPayload = JSON.parse(encryptedPayloadStr);

  // 1. Import recipient private key
  const importedRecipientPriv = await subtle.importKey(
    "jwk",
    recipientPrivateKeyJwk,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveKey"]
  );

  // 2. Import ephemeral public key
  const importedEphemPub = await subtle.importKey(
    "jwk",
    payload.ephem_pk,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );

  // 3. Derive 256-bit AES-GCM shared key
  const aesKey = await subtle.deriveKey(
    { name: "ECDH", public: importedEphemPub, $public: importedEphemPub } as any,
    importedRecipientPriv,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"]
  );

  // 4. Decrypt ciphertext
  const iv = fromBase64(payload.iv);
  const ciphertext = fromBase64(payload.ciphertext);

  const decryptedBytes = await subtle.decrypt(
    { name: "AES-GCM", iv },
    aesKey,
    ciphertext
  );

  return JSON.parse(new TextDecoder().decode(decryptedBytes)) as SensitiveLogData;
}

/**
 * Wraps (encrypts) the user's log private key with a Passkey-derived Key Encryption Key (KEK).
 *
 * @param privateKeyJwk The user's ECDH P-256 private key in JWK format.
 * @param kekRaw 256-bit raw key derived from Passkey assertion / PRF.
 * @returns Base64-encoded encrypted private key and IV.
 */
export async function wrapPrivateKeyWithKek(
  privateKeyJwk: JsonWebKey,
  kekRaw: Uint8Array
): Promise<WrappedKeyData> {
  const subtle = crypto.subtle;
  const kek = await subtle.importKey(
    "raw",
    kekRaw,
    { name: "AES-GCM" },
    false,
    ["encrypt"]
  );

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(privateKeyJwk));

  const encryptedBuffer = await subtle.encrypt(
    { name: "AES-GCM", iv },
    kek,
    plaintext
  );

  return {
    encryptedSk: toBase64(encryptedBuffer),
    iv: toBase64(iv),
  };
}

/**
 * Unwraps (decrypts) the user's log private key using a Passkey-derived Key Encryption Key (KEK).
 *
 * @param encryptedSkBase64 Base64-encoded encrypted private key.
 * @param ivBase64 Base64-encoded IV.
 * @param kekRaw 256-bit raw key derived from Passkey assertion / PRF.
 * @returns Decrypted ECDH P-256 private key in JWK format.
 */
export async function unwrapPrivateKeyWithKek(
  encryptedSkBase64: string,
  ivBase64: string,
  kekRaw: Uint8Array
): Promise<JsonWebKey> {
  const subtle = crypto.subtle;
  const kek = await subtle.importKey(
    "raw",
    kekRaw,
    { name: "AES-GCM" },
    false,
    ["decrypt"]
  );

  const iv = fromBase64(ivBase64);
  const ciphertext = fromBase64(encryptedSkBase64);

  const decryptedBuffer = await subtle.decrypt(
    { name: "AES-GCM", iv },
    kek,
    ciphertext
  );

  return JSON.parse(new TextDecoder().decode(decryptedBuffer)) as JsonWebKey;
}

export interface RecoveryWrappedKeyData {
  encryptedSk: string;
  iv: string;
  salt: string;
}

/**
 * Derives a 256-bit Key Encryption Key (KEK) from a normalized plaintext Recovery Key using PBKDF2-HMAC-SHA256.
 *
 * @param plaintextRecoveryKey - Plaintext 30-digit or raw recovery key
 * @param salt - 16-byte random salt
 * @returns CryptoKey for AES-GCM
 */
export async function deriveRecoveryKek(
  plaintextRecoveryKey: string,
  salt: Uint8Array
): Promise<CryptoKey> {
  const subtle = crypto.subtle;
  const normalized = plaintextRecoveryKey.replace(/[-\s]/g, "").toUpperCase().trim();
  const data = new TextEncoder().encode(normalized);

  const baseKey = await subtle.importKey(
    "raw",
    data,
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );

  return subtle.deriveKey(
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
 * Wraps (encrypts) the user's ECDH P-256 private key using a Recovery Key KEK.
 *
 * @param privateKeyJwk - User's private key in JWK format
 * @param plaintextRecoveryKey - Plaintext recovery key
 * @returns Base64 encoded encryptedSk, iv, and salt
 */
export async function wrapPrivateKeyWithRecoveryKey(
  privateKeyJwk: JsonWebKey,
  plaintextRecoveryKey: string
): Promise<RecoveryWrappedKeyData> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const kek = await deriveRecoveryKek(plaintextRecoveryKey, salt);

  const plaintext = new TextEncoder().encode(JSON.stringify(privateKeyJwk));
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
 * Unwraps (decrypts) the user's ECDH P-256 private key using their Recovery Key.
 *
 * @param encryptedSkBase64 - Base64 encoded encrypted private key
 * @param ivBase64 - Base64 encoded IV
 * @param saltBase64 - Base64 encoded salt
 * @param plaintextRecoveryKey - Plaintext recovery key entered by user
 * @returns Decrypted JsonWebKey
 */
export async function unwrapPrivateKeyWithRecoveryKey(
  encryptedSkBase64: string,
  ivBase64: string,
  saltBase64: string,
  plaintextRecoveryKey: string
): Promise<JsonWebKey> {
  const salt = fromBase64(saltBase64);
  const iv = fromBase64(ivBase64);
  const ciphertext = fromBase64(encryptedSkBase64);
  const kek = await deriveRecoveryKek(plaintextRecoveryKey, salt);

  const decryptedBuffer = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    kek,
    ciphertext
  );

  return JSON.parse(new TextDecoder().decode(decryptedBuffer)) as JsonWebKey;
}

/* ========================================================================== */
/*           Post-Quantum Cryptography (P256-MLKEM768 / NIST FIPS 203)        */
/* ========================================================================== */

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

