/**
 * @file decryptEngine.ts
 * @description Log entry and batch decryption engine for Classical ECDH and Post-Quantum P256-MLKEM768.
 */

import { ml_kem768_p256 } from "@noble/post-quantum/hybrid.js";
import type { LogEntry } from "../../views/LogsView/types";
import type { EncryptedPayload, SensitiveLogData } from "./types";
import { fromBase64, deriveDekFromSharedSecret, decryptSensitiveLogDataWithDek } from "./crypto";
import type { KeyStore } from "./keyStore";

export class DecryptEngine {
  /** In-memory DEK cache: kem_key_id -> CryptoKey */
  private dekCache = new Map<string, CryptoKey>();
  private keyStore: KeyStore;

  constructor(keyStore: KeyStore) {
    this.keyStore = keyStore;
  }

  /**
   * Clears in-memory DEK cache.
   */
  clearDekCache(): void {
    this.dekCache.clear();
  }

  /**
   * Decrypts a single log entry if encrypted and if the private key is unlocked.
   */
  async decryptLogEntry(profileId: string, log: LogEntry): Promise<LogEntry> {
    const version = log.encrypt_version ?? (log.encrypted_payload ? 1 : 0);
    if (version === 0 || !log.encrypted_payload) {
      return log;
    }

    const privKey = this.keyStore.getPrivateKey(profileId);
    if (!privKey) {
      // Not unlocked yet, keep placeholder
      return {
        ...log,
        domain: log.domain || "[Encrypted]",
        client_ip: log.client_ip || "[Encrypted]",
      };
    }

    try {
      if (version === 2) {
        // Generation 2: P256-MLKEM768 Periodic Envelope Encryption
        let dek: CryptoKey | undefined;
        if (log.kem_key_id) {
          dek = this.dekCache.get(log.kem_key_id);
          if (!dek && log.kem_ct && "seedBase64" in privKey) {
            const seed = fromBase64(privKey.seedBase64);
            const kemCt = fromBase64(log.kem_ct);
            const sharedSecret = ml_kem768_p256.decapsulate(kemCt, seed);
            dek = await deriveDekFromSharedSecret(sharedSecret);
            this.dekCache.set(log.kem_key_id, dek);
          }
        }

        if (!dek) {
          return {
            ...log,
            domain: log.domain || "[Encrypted]",
            client_ip: log.client_ip || "[Encrypted]",
          };
        }

        const data = await decryptSensitiveLogDataWithDek(dek, log.encrypted_payload);
        let destCountryCode = data.dest_country_code ?? log.dest_country_code;
        let destCountry = data.dest_country ?? log.dest_country;
        let destIsp = data.dest_isp ?? log.dest_isp;
        const rawGeoJson = data.dest_geoip ?? log.dest_geoip;
        if ((!destCountryCode || !destCountry) && rawGeoJson) {
          try {
            const parsed = JSON.parse(rawGeoJson);
            if (!destCountryCode && parsed.country_code) destCountryCode = parsed.country_code.toUpperCase();
            if (!destCountry && parsed.country) destCountry = parsed.country;
            if (!destIsp && parsed.isp) destIsp = parsed.isp;
          } catch {}
        }

        return {
          ...log,
          domain: data.domain || log.domain,
          client_ip: data.client_ip || log.client_ip,
          geo_country: data.geo_country ?? log.geo_country,
          answer: data.answer ?? log.answer,
          dest_geoip: rawGeoJson,
          dest_country_code: destCountryCode,
          dest_country: destCountry,
          dest_isp: destIsp,
          ecs: data.ecs ?? log.ecs,
          upstream: data.upstream ?? log.upstream,
          reason: data.reason ?? log.reason,
          encrypt_version: 0,
        };
      }

      if (version === 1) {
        // Generation 1: Legacy P-256 ECDH
        const payload: EncryptedPayload = JSON.parse(log.encrypted_payload);
        const privKeyJwk = (
          "kty" in privKey
            ? privKey
            : "legacyKey" in privKey && privKey.legacyKey
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ? (privKey as any).legacyKey
            : null
        ) as JsonWebKey | null;
        if (!privKeyJwk) {
          return {
            ...log,
            domain: "[Decryption Failed: Legacy Key Mismatch]",
          };
        }

        const importedPriv = await crypto.subtle.importKey(
          "jwk",
          privKeyJwk,
          { name: "ECDH", namedCurve: "P-256" },
          false,
          ["deriveKey"]
        );

        const importedEphem = await crypto.subtle.importKey(
          "jwk",
          payload.ephem_pk,
          { name: "ECDH", namedCurve: "P-256" },
          false,
          []
        );

        const aesKey = await crypto.subtle.deriveKey(
          { name: "ECDH", public: importedEphem },
          importedPriv,
          { name: "AES-GCM", length: 256 },
          false,
          ["decrypt"]
        );

        const decryptedBytes = await crypto.subtle.decrypt(
          { name: "AES-GCM", iv: fromBase64(payload.iv) as BufferSource },
          aesKey,
          fromBase64(payload.ciphertext) as BufferSource
        );

        const data: SensitiveLogData = JSON.parse(new TextDecoder().decode(decryptedBytes));
        let destCountryCode = data.dest_country_code ?? log.dest_country_code;
        let destCountry = data.dest_country ?? log.dest_country;
        let destIsp = data.dest_isp ?? log.dest_isp;
        const rawGeoJson = data.dest_geoip ?? log.dest_geoip;
        if ((!destCountryCode || !destCountry) && rawGeoJson) {
          try {
            const parsed = JSON.parse(rawGeoJson);
            if (!destCountryCode && parsed.country_code) destCountryCode = parsed.country_code.toUpperCase();
            if (!destCountry && parsed.country) destCountry = parsed.country;
            if (!destIsp && parsed.isp) destIsp = parsed.isp;
          } catch {}
        }

        return {
          ...log,
          domain: data.domain || log.domain,
          client_ip: data.client_ip || log.client_ip,
          geo_country: data.geo_country ?? log.geo_country,
          answer: data.answer ?? log.answer,
          dest_geoip: rawGeoJson,
          dest_country_code: destCountryCode,
          dest_country: destCountry,
          dest_isp: destIsp,
          ecs: data.ecs ?? log.ecs,
          upstream: data.upstream ?? log.upstream,
          reason: data.reason ?? log.reason,
          encrypt_version: 0,
        };
      }

      return log;
    } catch (err) {
      console.warn("[E2EE DecryptEngine] Failed to decrypt log #%s:", String(log.id), err);
      return {
        ...log,
        domain: "[Decryption Failed]",
      };
    }
  }

  /**
   * Decrypts a batch of logs concurrently with DEK pre-caching.
   */
  async decryptLogsBatch(profileId: string, logs: LogEntry[]): Promise<LogEntry[]> {
    if (!logs || logs.length === 0) return logs;
    const hasEncrypted = logs.some((l) => (l.encrypt_version ?? (l.encrypted_payload ? 1 : 0)) > 0);
    if (!hasEncrypted) return logs;

    const privKey = this.keyStore.getPrivateKey(profileId);
    if (privKey && "seedBase64" in privKey) {
      const seed = fromBase64(privKey.seedBase64);
      // Pre-decapsulate any uncached DEKs in the batch
      const missingKeyMap = new Map<string, string>(); // kemKeyId -> kemCt
      for (const log of logs) {
        if (log.encrypt_version === 2 && log.kem_key_id && log.kem_ct && !this.dekCache.has(log.kem_key_id)) {
          missingKeyMap.set(log.kem_key_id, log.kem_ct);
        }
      }

      for (const [kemKeyId, kemCtBase64] of missingKeyMap.entries()) {
        try {
          const kemCt = fromBase64(kemCtBase64);
          const sharedSecret = ml_kem768_p256.decapsulate(kemCt, seed);
          const dek = await deriveDekFromSharedSecret(sharedSecret);
          this.dekCache.set(kemKeyId, dek);
        } catch (decapsErr) {
          console.warn(`[E2EE DecryptEngine] Failed to decapsulate DEK for ${kemKeyId}:`, decapsErr);
        }
      }
    }

    return Promise.all(logs.map((log) => this.decryptLogEntry(profileId, log)));
  }
}
