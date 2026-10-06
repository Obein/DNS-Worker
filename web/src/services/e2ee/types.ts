/**
 * @file types.ts
 * @description Type and interface definitions for Client-side End-to-End Encryption (E2EE).
 */

export interface ProfileE2eeStatus {
  hasKeys?: boolean;
  enabled: boolean;
  publicKey: string | null;
  wrappedPasskeys: string[];
  hasRecoveryKey: boolean;
  userPasskeyCount: number;
  createdAt: number | null;
}

export interface EncryptedPayload {
  ephem_pk: JsonWebKey;
  iv: string;
  ciphertext: string;
}

export interface CompactEncryptedLogPayload {
  iv: string;
  ciphertext: string;
}

export type UnlockedPrivateKey =
  | { alg: "P256-MLKEM768"; seedBase64: string; legacyKey?: JsonWebKey }
  | JsonWebKey;

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
