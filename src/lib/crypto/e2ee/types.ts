/**
 * @file types.ts
 * @description Type definitions for Zero-Knowledge End-to-End Encryption (E2EE).
 */

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

export interface RecoveryWrappedKeyData {
  encryptedSk: string;
  iv: string;
  salt: string;
}
