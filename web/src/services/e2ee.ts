/**
 * @file e2ee.ts
 * @description Client-side End-to-End Encryption (E2EE) Service for DNS logs.
 * Provides Passkey hardware-backed envelope encryption, user/account-level key lifecycle management,
 * and zero-knowledge log decryption.
 */

import type { LogEntry } from "../views/LogsView/types";
import { profileFetch } from "./profiles";
import { getPasskeyAuthOptions } from "./account";

export interface ProfileE2eeStatus {
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

function toBase64(bytes: Uint8Array | ArrayBuffer): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (let i = 0; i < u8.length; i++) {
    binary += String.fromCharCode(u8[i]);
  }
  return btoa(binary);
}

function fromBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const u8 = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    u8[i] = binary.charCodeAt(i);
  }
  return u8;
}

// Convert base64url string to Uint8Array
function base64UrlToUint8Array(base64Url: string): Uint8Array {
  let base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4 !== 0) {
    base64 += "=";
  }
  return fromBase64(base64);
}

class E2eeService {
  /** In-memory store for unlocked private keys (profileId or "account" -> JsonWebKey) */
  private unlockedKeys = new Map<string, JsonWebKey>();

  /**
   * Retrieves account-level E2EE configuration and status.
   */
  async getUserStatus(): Promise<ProfileE2eeStatus> {
    try {
      const res = await fetch("/api/account/e2ee/status");
      if (res.ok) {
        return await res.json();
      }
    } catch {
      // Fallback
    }

    // Fallback: check profile list
    try {
      const profilesRes = await fetch("/api/profiles");
      if (profilesRes.ok) {
        const profiles = await profilesRes.json();
        if (profiles && profiles.length > 0) {
          return await this.getStatus(profiles[0].id);
        }
      }
    } catch (err) {
      console.warn("[E2EE] Fallback status check failed:", err);
    }

    return {
      enabled: false,
      publicKey: null,
      wrappedPasskeys: [],
      hasRecoveryKey: false,
      userPasskeyCount: 0,
      createdAt: null,
    };
  }

  /**
   * Retrieves E2EE configuration and status for a specific profile.
   */
  async getStatus(profileId: string): Promise<ProfileE2eeStatus> {
    const res = await profileFetch(`/api/profiles/${profileId}/e2ee/status`);
    if (!res.ok) {
      throw new Error(`Failed to fetch E2EE status: ${await res.text()}`);
    }
    return res.json();
  }

  /**
   * Checks whether the current session has unlocked the private key for the account.
   */
  isUnlocked(): boolean {
    if (this.unlockedKeys.size > 0) return true;
    for (let i = 0; i < sessionStorage.length; i++) {
      if (sessionStorage.key(i)?.startsWith("obex_e2ee_sk_")) return true;
    }
    return false;
  }

  /**
   * Checks whether the current session has unlocked the private key for this profile or account.
   */
  isProfileUnlocked(profileId: string): boolean {
    if (this.unlockedKeys.has(profileId) || !!sessionStorage.getItem(`obex_e2ee_sk_${profileId}`)) {
      return true;
    }
    return this.isUnlocked();
  }

  /**
   * Gets the unlocked private key from memory or session storage.
   */
  private getPrivateKey(profileId: string): JsonWebKey | null {
    if (this.unlockedKeys.has(profileId)) {
      return this.unlockedKeys.get(profileId)!;
    }
    const stored = sessionStorage.getItem(`obex_e2ee_sk_${profileId}`);
    if (stored) {
      try {
        const jwk = JSON.parse(stored) as JsonWebKey;
        this.unlockedKeys.set(profileId, jwk);
        return jwk;
      } catch {
        sessionStorage.removeItem(`obex_e2ee_sk_${profileId}`);
      }
    }
    // Account-wide fallback if any key was unlocked in session
    if (this.unlockedKeys.size > 0) {
      return this.unlockedKeys.values().next().value || null;
    }
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (key?.startsWith("obex_e2ee_sk_")) {
        try {
          const jwk = JSON.parse(sessionStorage.getItem(key) || "");
          this.unlockedKeys.set(profileId, jwk);
          return jwk;
        } catch {
          // ignore
        }
      }
    }
    return null;
  }

  /**
   * Stores the unlocked private key in session memory.
   */
  private setPrivateKey(profileOrAccountKey: string, skJwk: JsonWebKey): void {
    this.unlockedKeys.set(profileOrAccountKey, skJwk);
    sessionStorage.setItem(`obex_e2ee_sk_${profileOrAccountKey}`, JSON.stringify(skJwk));
  }

  /**
   * Derives a 256-bit Key Encryption Key (KEK) using WebAuthn Passkey assertion.
   * Leverages WebAuthn PRF extension where available, with assertion signature hash fallback.
   */
  async derivePasskeyKek(saltScope: string = "account"): Promise<{ kek: Uint8Array; passkeyId?: string }> {
    const authOptions = await getPasskeyAuthOptions();

    // Prepare 32-byte salt for PRF extension
    const saltBytes = new Uint8Array(32);
    const enc = new TextEncoder().encode(`obex-dns-log-e2ee-salt:${saltScope}`);
    saltBytes.set(enc.subarray(0, 32));

    const challengeBytes = base64UrlToUint8Array(authOptions.challenge);

    const credential = (await navigator.credentials.get({
      publicKey: {
        challenge: challengeBytes as BufferSource,
        timeout: 60000,
        userVerification: "preferred",
        rpId: authOptions.rpId || window.location.hostname,
        allowCredentials: (authOptions.allowCredentials || []).map((c: any) => ({
          ...c,
          id: base64UrlToUint8Array(c.id) as BufferSource,
        })),
        extensions: {
          prf: {
            eval: {
              first: saltBytes,
            },
          },
        } as any,
      },
    })) as PublicKeyCredential;

    if (!credential) {
      throw new Error("Passkey assertion was cancelled or failed");
    }

    const extResults = credential.getClientExtensionResults() as any;
    let kekBytes: Uint8Array;

    if (extResults?.prf?.results?.first) {
      // 1. Hardware PRF secret
      kekBytes = new Uint8Array(extResults.prf.results.first);
    } else {
      // 2. Deterministic hash fallback
      const response = credential.response as AuthenticatorAssertionResponse;
      const sig = new Uint8Array(response.signature);
      const rawId = new Uint8Array(credential.rawId);
      const combined = new Uint8Array(sig.length + rawId.length);
      combined.set(sig, 0);
      combined.set(rawId, sig.length);

      const digest = await crypto.subtle.digest("SHA-256", combined);
      kekBytes = new Uint8Array(digest);
    }

    // Match credential ID to registered passkey if possible
    let passkeyId = credential.id;
    if (authOptions.allowCredentials && authOptions.allowCredentials.length > 0) {
      const match = authOptions.allowCredentials.find((c: any) => c.id === credential.id);
      if (match?.passkey_id) passkeyId = match.passkey_id;
    }

    return { kek: kekBytes, passkeyId };
  }

  /**
   * Initializes and enables E2EE at the user/account level for all profiles:
   * 1. Derives KEK from the user's Passkey with a single biometric prompt.
   * 2. Generates canonical Log KeyPair (PK_log, SK_log).
   * 3. Wraps SK_log with KEK using AES-256-GCM.
   * 4. Uploads PK_log and wrapped SK_log to server (/api/account/e2ee/init).
   * 5. Caches unlocked SK in session storage.
   */
  async enableUserE2ee(passkeyIdOverride?: string): Promise<boolean> {
    const { kek, passkeyId } = await this.derivePasskeyKek("account");
    const chosenPasskeyId = passkeyIdOverride || passkeyId || "primary";

    // 1. Generate Log KeyPair
    const keyPair = await crypto.subtle.generateKey(
      { name: "ECDH", namedCurve: "P-256" },
      true,
      ["deriveKey", "deriveBits"]
    );

    const publicKeyJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
    const privateKeyJwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey);

    // 2. Wrap SK_log with Passkey KEK
    const kekKey = await crypto.subtle.importKey(
      "raw",
      kek as BufferSource,
      { name: "AES-GCM" },
      false,
      ["encrypt"]
    );

    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plaintext = new TextEncoder().encode(JSON.stringify(privateKeyJwk));
    const encryptedBuf = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      kekKey,
      plaintext
    );

    const encryptedSk = toBase64(encryptedBuf);
    const ivStr = toBase64(iv);

    // 3. Upload to server
    const res = await fetch("/api/account/e2ee/init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        publicKey: publicKeyJwk,
        passkeyId: chosenPasskeyId,
        encryptedSk,
        iv: ivStr,
      }),
    });

    if (!res.ok) {
      throw new Error(`Failed to enable user E2EE: ${await res.text()}`);
    }

    // Save in session for account
    this.setPrivateKey("account", privateKeyJwk);
    return true;
  }

  /**
   * Initializes and enables E2EE for a profile (legacy wrapper).
   */
  async enableE2ee(profileId: string, passkeyId: string): Promise<boolean> {
    const { kek } = await this.derivePasskeyKek(profileId);

    // 1. Generate Log KeyPair
    const keyPair = await crypto.subtle.generateKey(
      { name: "ECDH", namedCurve: "P-256" },
      true,
      ["deriveKey", "deriveBits"]
    );

    const publicKeyJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
    const privateKeyJwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey);

    // 2. Wrap SK_log with Passkey KEK
    const kekKey = await crypto.subtle.importKey(
      "raw",
      kek as BufferSource,
      { name: "AES-GCM" },
      false,
      ["encrypt"]
    );

    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plaintext = new TextEncoder().encode(JSON.stringify(privateKeyJwk));
    const encryptedBuf = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      kekKey,
      plaintext
    );

    const encryptedSk = toBase64(encryptedBuf);
    const ivStr = toBase64(iv);

    // 3. Upload to server
    const res = await profileFetch(`/api/profiles/${profileId}/e2ee/init`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        publicKey: publicKeyJwk,
        passkeyId,
        encryptedSk,
        iv: ivStr,
      }),
    });

    if (!res.ok) {
      throw new Error(`Failed to enable E2EE: ${await res.text()}`);
    }

    // Save in session
    this.setPrivateKey(profileId, privateKeyJwk);
    this.setPrivateKey("account", privateKeyJwk);
    return true;
  }

  /**
   * Unlocks the account's log private key using the device's Passkey with a single prompt.
   */
  async unlockUser(): Promise<boolean> {
    const status = await this.getUserStatus();
    if (!status.enabled) return false;

    const { kek, passkeyId } = await this.derivePasskeyKek("account");

    const targetPasskeyId = passkeyId || status.wrappedPasskeys[0];
    if (!targetPasskeyId) {
      throw new Error("No wrapped key found for this passkey");
    }

    let res = await fetch(`/api/account/e2ee/wrapped-key?passkey_id=${targetPasskeyId}`);
    if (!res.ok) {
      const profilesRes = await fetch("/api/profiles");
      if (profilesRes.ok) {
        const profiles = await profilesRes.json();
        if (profiles && profiles.length > 0) {
          res = await fetch(`/api/profiles/${profiles[0].id}/e2ee/wrapped-key?passkey_id=${targetPasskeyId}`);
        }
      }
    }

    if (!res.ok) {
      throw new Error(`Failed to fetch wrapped key: ${await res.text()}`);
    }

    const { encryptedSk, iv } = (await res.json()) as { encryptedSk: string; iv: string };

    // Unwrap SK_log
    const kekKey = await crypto.subtle.importKey(
      "raw",
      kek as BufferSource,
      { name: "AES-GCM" },
      false,
      ["decrypt"]
    );

    const decryptedBuf = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(iv) as BufferSource },
      kekKey,
      fromBase64(encryptedSk) as BufferSource
    );

    const privateKeyJwk = JSON.parse(new TextDecoder().decode(decryptedBuf)) as JsonWebKey;
    this.setPrivateKey("account", privateKeyJwk);
    return true;
  }

  /**
   * Unlocks the profile's log private key using the device's Passkey.
   */
  async unlockProfile(profileId: string): Promise<boolean> {
    const status = await this.getStatus(profileId);
    if (!status.enabled) return false;

    const { kek, passkeyId } = await this.derivePasskeyKek(profileId);

    const targetPasskeyId = passkeyId || status.wrappedPasskeys[0];
    if (!targetPasskeyId) {
      throw new Error("No wrapped key found for this passkey");
    }

    let res = await fetch(
      `/api/profiles/${profileId}/e2ee/wrapped-key?passkey_id=${targetPasskeyId}`
    );
    if (!res.ok) {
      res = await fetch(`/api/account/e2ee/wrapped-key?passkey_id=${targetPasskeyId}`);
    }
    if (!res.ok) {
      throw new Error(`Failed to fetch wrapped key: ${await res.text()}`);
    }

    const { encryptedSk, iv } = (await res.json()) as { encryptedSk: string; iv: string };

    // Unwrap SK_log
    const kekKey = await crypto.subtle.importKey(
      "raw",
      kek as BufferSource,
      { name: "AES-GCM" },
      false,
      ["decrypt"]
    );

    const decryptedBuf = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(iv) as BufferSource },
      kekKey,
      fromBase64(encryptedSk) as BufferSource
    );

    const privateKeyJwk = JSON.parse(new TextDecoder().decode(decryptedBuf)) as JsonWebKey;
    this.setPrivateKey(profileId, privateKeyJwk);
    this.setPrivateKey("account", privateKeyJwk);
    return true;
  }

  /**
   * Disables E2EE across the entire user account.
   */
  async disableUserE2ee(): Promise<boolean> {
    const res = await fetch("/api/account/e2ee", {
      method: "DELETE",
    });
    if (!res.ok) {
      throw new Error(`Failed to disable E2EE: ${await res.text()}`);
    }
    this.unlockedKeys.clear();
    const toRemove: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k?.startsWith("obex_e2ee_sk_")) toRemove.push(k);
    }
    toRemove.forEach((k) => sessionStorage.removeItem(k));
    return true;
  }

  /**
   * Disables E2EE for a profile.
   */
  async disableE2ee(profileId: string): Promise<boolean> {
    const res = await profileFetch(`/api/profiles/${profileId}/e2ee`, {
      method: "DELETE",
    });
    if (!res.ok) {
      throw new Error(`Failed to disable E2EE: ${await res.text()}`);
    }
    this.unlockedKeys.delete(profileId);
    sessionStorage.removeItem(`obex_e2ee_sk_${profileId}`);
    return true;
  }

  /**
   * Decrypts a single log entry if encrypted and if the private key is unlocked.
   */
  async decryptLogEntry(profileId: string, log: LogEntry): Promise<LogEntry> {
    if (!log.is_encrypted || !log.encrypted_payload) {
      return log;
    }

    const privKeyJwk = this.getPrivateKey(profileId);
    if (!privKeyJwk) {
      // Not unlocked yet, keep placeholder
      return {
        ...log,
        domain: log.domain || "[Encrypted]",
        client_ip: log.client_ip || "[Encrypted]",
      };
    }

    try {
      const payload: EncryptedPayload = JSON.parse(log.encrypted_payload);

      // Import recipient private key
      const importedPriv = await crypto.subtle.importKey(
        "jwk",
        privKeyJwk,
        { name: "ECDH", namedCurve: "P-256" },
        false,
        ["deriveKey"]
      );

      // Import ephemeral public key
      const importedEphem = await crypto.subtle.importKey(
        "jwk",
        payload.ephem_pk,
        { name: "ECDH", namedCurve: "P-256" },
        false,
        []
      );

      // Derive shared AES-GCM key
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

      return {
        ...log,
        domain: data.domain || log.domain,
        client_ip: data.client_ip || log.client_ip,
        geo_country: data.geo_country ?? log.geo_country,
        answer: data.answer ?? log.answer,
        dest_geoip: data.dest_geoip ?? log.dest_geoip,
        dest_country_code: data.dest_country_code ?? log.dest_country_code,
        dest_country: data.dest_country ?? log.dest_country,
        dest_isp: data.dest_isp ?? log.dest_isp,
        ecs: data.ecs ?? log.ecs,
        upstream: data.upstream ?? log.upstream,
        reason: data.reason ?? log.reason,
        is_encrypted: 0,
      };
    } catch (err) {
      console.warn(`[E2EE] Failed to decrypt log #${log.id}:`, err);
      return {
        ...log,
        domain: "[Decryption Failed]",
      };
    }
  }

  /**
   * Decrypts a batch of logs concurrently.
   */
  async decryptLogsBatch(profileId: string, logs: LogEntry[]): Promise<LogEntry[]> {
    if (!logs || logs.length === 0) return logs;
    const hasEncrypted = logs.some((l) => l.is_encrypted === 1);
    if (!hasEncrypted) return logs;

    return Promise.all(logs.map((log) => this.decryptLogEntry(profileId, log)));
  }
}

export const e2ee = new E2eeService();
