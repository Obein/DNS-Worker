/**
 * @file e2ee.ts
 * @description Zero-Knowledge End-to-End Encryption (E2EE) cryptographic primitives.
 * Implements Web Crypto ECDH P-256 hybrid encryption with AES-256-GCM and Passkey envelope wrapping.
 */

export interface EncryptedPayload {
  ephem_pk: JsonWebKey;
  iv: string;
  ciphertext: string;
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

