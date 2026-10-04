/**
 * @file e2ee.ts
 * @description Client-side End-to-End Encryption (E2EE) Service for DNS logs.
 * Provides Passkey hardware-backed envelope encryption, user/account-level key lifecycle management,
 * and zero-knowledge log decryption supporting classical P-256 and post-quantum P256-MLKEM768.
 */

import { ml_kem768_p256 } from "@noble/post-quantum/hybrid.js";
import type { LogEntry } from "../views/LogsView/types";
import { profileFetch } from "./profiles";
import { getPasskeyAuthOptions } from "./account";

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
  | { alg: "P256-MLKEM768"; seedBase64: string }
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

async function deriveDekFromSharedSecret(sharedSecret: Uint8Array): Promise<CryptoKey> {
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

async function decryptSensitiveLogDataWithDek(
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

class E2eeService {
  /** In-memory store for unlocked private keys (profileId or "account" -> UnlockedPrivateKey) */
  private unlockedKeys = new Map<string, UnlockedPrivateKey>();

  /** In-memory DEK cache: kem_key_id -> CryptoKey */
  private dekCache = new Map<string, CryptoKey>();

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
  private getPrivateKey(profileId: string): UnlockedPrivateKey | null {
    if (this.unlockedKeys.has(profileId)) {
      return this.unlockedKeys.get(profileId)!;
    }
    const stored = sessionStorage.getItem(`obex_e2ee_sk_${profileId}`);
    if (stored) {
      try {
        const key = JSON.parse(stored) as UnlockedPrivateKey;
        this.unlockedKeys.set(profileId, key);
        return key;
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
          const parsed = JSON.parse(sessionStorage.getItem(key) || "") as UnlockedPrivateKey;
          this.unlockedKeys.set(profileId, parsed);
          return parsed;
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
  private setPrivateKey(profileOrAccountKey: string, sk: UnlockedPrivateKey): void {
    this.unlockedKeys.set(profileOrAccountKey, sk);
    sessionStorage.setItem(`obex_e2ee_sk_${profileOrAccountKey}`, JSON.stringify(sk));
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
      throw new Error(
        "Passkey authenticator does not support WebAuthn PRF extension. Please unlock using your Recovery Key."
      );
    }

    // Match credential ID to registered passkey if possible
    let passkeyId = credential.id;
    const normalizeB64 = (s: string) => (s || "").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
    const credIdNorm = normalizeB64(credential.id);

    if (authOptions.allowCredentials && authOptions.allowCredentials.length > 0) {
      const match = authOptions.allowCredentials.find((c: any) => normalizeB64(c.id) === credIdNorm);
      if (match?.passkey_id) passkeyId = match.passkey_id;
    }

    if (!passkeyId || passkeyId === credential.id) {
      try {
        const { getPasskeys } = await import("./account");
        const passkeys = await getPasskeys();
        const match = passkeys.find((p) => normalizeB64(p.credential_id) === credIdNorm);
        if (match?.id) {
          passkeyId = match.id;
        } else if (passkeys.length > 0) {
          passkeyId = passkeys[0].id;
        }
      } catch (err) {
        console.warn("[E2EE] Could not load passkeys to match credential:", err);
      }
    }

    return { kek: kekBytes, passkeyId };
  }

  /**
   * Derives a 256-bit Key Encryption Key (KEK) from a normalized plaintext Recovery Key using PBKDF2-HMAC-SHA256.
   */
  async deriveRecoveryKek(plaintextRecoveryKey: string, salt: Uint8Array): Promise<CryptoKey> {
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
  async wrapPrivateKeyWithRecoveryKey(
    privateKey: UnlockedPrivateKey,
    plaintextRecoveryKey: string
  ): Promise<{ encryptedSk: string; iv: string; salt: string }> {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const kek = await this.deriveRecoveryKek(plaintextRecoveryKey, salt);

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
  async unwrapPrivateKeyWithRecoveryKey(
    encryptedSkBase64: string,
    ivBase64: string,
    saltBase64: string,
    plaintextRecoveryKey: string
  ): Promise<UnlockedPrivateKey> {
    const salt = fromBase64(saltBase64);
    const iv = fromBase64(ivBase64);
    const ciphertext = fromBase64(encryptedSkBase64);
    const kek = await this.deriveRecoveryKek(plaintextRecoveryKey, salt);

    const decryptedBuffer = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv as BufferSource },
      kek,
      ciphertext as BufferSource
    );

    return JSON.parse(new TextDecoder().decode(decryptedBuffer)) as UnlockedPrivateKey;
  }

  /**
   * Initializes account-level E2EE using a fresh Recovery Key and P256-MLKEM768 key pair.
   */
  async initUserE2eeWithRecoveryKey(plaintextRecoveryKey: string): Promise<boolean> {
    // 1. Generate Post-Quantum P256-MLKEM768 KeyPair
    const pqcKeys = ml_kem768_p256.keygen();
    const publicKeyPayload = {
      alg: "P256-MLKEM768",
      pqc_pk: toBase64(pqcKeys.publicKey),
    };
    const privateKeyObj: UnlockedPrivateKey = {
      alg: "P256-MLKEM768",
      seedBase64: toBase64(pqcKeys.secretKey),
    };

    // 2. Wrap SK with Recovery Key KEK
    const recoveryWrapped = await this.wrapPrivateKeyWithRecoveryKey(privateKeyObj, plaintextRecoveryKey);

    // 3. Upload to server
    const res = await fetch("/api/account/e2ee/init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        publicKey: publicKeyPayload,
        recovery: recoveryWrapped,
      }),
    });

    if (!res.ok) {
      throw new Error(`Failed to initialize E2EE with recovery key: ${await res.text()}`);
    }

    // 4. Save in session for account
    this.setPrivateKey("account", privateKeyObj);
    return true;
  }

  /**
   * Unlocks the account's log private key using the plaintext 30-digit Recovery Key.
   */
  async unlockWithRecoveryKey(plaintextRecoveryKey: string): Promise<boolean> {
    const res = await fetch("/api/account/e2ee/recovery-wrapped-key");
    if (!res.ok) {
      throw new Error(`Failed to fetch recovery wrapped key: ${await res.text()}`);
    }

    const { encryptedSk, iv, salt } = (await res.json()) as {
      encryptedSk: string;
      iv: string;
      salt: string;
    };

    let privateKeyObj: UnlockedPrivateKey;
    try {
      privateKeyObj = await this.unwrapPrivateKeyWithRecoveryKey(
        encryptedSk,
        iv,
        salt,
        plaintextRecoveryKey
      );
    } catch {
      throw new Error("Invalid Recovery Key or corrupted data");
    }

    this.setPrivateKey("account", privateKeyObj);
    return true;
  }

  /**
   * Wraps the currently unlocked private key for a newly registered Passkey.
   */
  async wrapCurrentKeyForPasskey(passkeyId: string): Promise<boolean> {
    const sk = this.getPrivateKey("account");
    if (!sk) {
      console.warn("[E2EE] Cannot wrap passkey: private key is not unlocked in this session");
      return false;
    }

    try {
      const { kek } = await this.derivePasskeyKek("account");
      const kekKey = await crypto.subtle.importKey(
        "raw",
        kek as BufferSource,
        { name: "AES-GCM" },
        false,
        ["encrypt"]
      );

      const iv = crypto.getRandomValues(new Uint8Array(12));
      const plaintext = new TextEncoder().encode(JSON.stringify(sk));
      const encryptedBuf = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        kekKey,
        plaintext
      );

      const res = await fetch("/api/account/e2ee/wrap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          passkeyId,
          encryptedSk: toBase64(encryptedBuf),
          iv: toBase64(iv),
        }),
      });

      return res.ok;
    } catch (err) {
      console.warn("[E2EE] Failed to wrap passkey KEK:", err);
      return false;
    }
  }

  /**
   * Re-wraps the currently unlocked private key with a newly rotated Recovery Key.
   */
  async wrapCurrentKeyForRecovery(newRecoveryKey: string): Promise<boolean> {
    const sk = this.getPrivateKey("account");
    if (!sk) {
      console.warn("[E2EE] Cannot wrap recovery: private key is not unlocked in this session");
      return false;
    }

    const recoveryWrapped = await this.wrapPrivateKeyWithRecoveryKey(sk, newRecoveryKey);
    const res = await fetch("/api/account/e2ee/wrap-recovery", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(recoveryWrapped),
    });

    return res.ok;
  }

  /**
   * Initializes and enables E2EE at the user/account level using P256-MLKEM768.
   */
  async enableUserE2ee(passkeyIdOverride?: string): Promise<boolean> {
    const status = await this.getUserStatus();
    if (status.hasKeys) {
      const res = await fetch("/api/account/e2ee/enable", { method: "POST" });
      if (!res.ok) {
        throw new Error(`Failed to enable user E2EE: ${await res.text()}`);
      }
      return true;
    }

    const { kek, passkeyId } = await this.derivePasskeyKek("account");
    const chosenPasskeyId = passkeyIdOverride || passkeyId || "primary";

    // 1. Generate Post-Quantum P256-MLKEM768 KeyPair
    const pqcKeys = ml_kem768_p256.keygen();
    const publicKeyPayload = {
      alg: "P256-MLKEM768",
      pqc_pk: toBase64(pqcKeys.publicKey),
    };
    const privateKeyObj: UnlockedPrivateKey = {
      alg: "P256-MLKEM768",
      seedBase64: toBase64(pqcKeys.secretKey),
    };

    // 2. Wrap SK with Passkey KEK
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

    const encryptedSk = toBase64(encryptedBuf);
    const ivStr = toBase64(iv);

    // 3. Upload to server
    const res = await fetch("/api/account/e2ee/init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        publicKey: publicKeyPayload,
        passkeyId: chosenPasskeyId,
        encryptedSk,
        iv: ivStr,
      }),
    });

    if (!res.ok) {
      throw new Error(`Failed to enable user E2EE: ${await res.text()}`);
    }

    // Save in session for account
    this.setPrivateKey("account", privateKeyObj);
    return true;
  }

  /**
   * Initializes and enables E2EE for a profile (legacy wrapper).
   */
  async enableE2ee(profileId: string, passkeyId: string): Promise<boolean> {
    const { kek } = await this.derivePasskeyKek(profileId);

    // 1. Generate Post-Quantum P256-MLKEM768 KeyPair
    const pqcKeys = ml_kem768_p256.keygen();
    const publicKeyPayload = {
      alg: "P256-MLKEM768",
      pqc_pk: toBase64(pqcKeys.publicKey),
    };
    const privateKeyObj: UnlockedPrivateKey = {
      alg: "P256-MLKEM768",
      seedBase64: toBase64(pqcKeys.secretKey),
    };

    // 2. Wrap SK with Passkey KEK
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

    const encryptedSk = toBase64(encryptedBuf);
    const ivStr = toBase64(iv);

    // 3. Upload to server
    const res = await profileFetch(`/api/profiles/${profileId}/e2ee/init`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        publicKey: publicKeyPayload,
        passkeyId,
        encryptedSk,
        iv: ivStr,
      }),
    });

    if (!res.ok) {
      throw new Error(`Failed to enable E2EE: ${await res.text()}`);
    }

    // Save in session
    this.setPrivateKey(profileId, privateKeyObj);
    this.setPrivateKey("account", privateKeyObj);
    return true;
  }

  /**
   * Unlocks the account's log private key using the device's Passkey with a single prompt.
   */
  async unlockUser(): Promise<boolean> {
    const status = await this.getUserStatus();
    if (!status.hasKeys && !status.enabled && status.wrappedPasskeys.length === 0) return false;

    const { kek, passkeyId } = await this.derivePasskeyKek("account");

    const targetPasskeyId = passkeyId || status.wrappedPasskeys[0];
    if (!targetPasskeyId) {
      throw new Error("No wrapped key found for this passkey. Please unlock using your Recovery Key.");
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

    // Unwrap SK
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

    const privateKeyObj = JSON.parse(new TextDecoder().decode(decryptedBuf)) as UnlockedPrivateKey;
    this.setPrivateKey("account", privateKeyObj);
    return true;
  }

  /**
   * Unlocks the profile's log private key using the device's Passkey.
   */
  async unlockProfile(profileId: string): Promise<boolean> {
    const status = await this.getStatus(profileId);
    if (!status.hasKeys && !status.enabled && status.wrappedPasskeys.length === 0) return false;

    const { kek, passkeyId } = await this.derivePasskeyKek(profileId);

    const targetPasskeyId = passkeyId || status.wrappedPasskeys[0];
    if (!targetPasskeyId) {
      throw new Error("No wrapped key found for this passkey. Please unlock using your Recovery Key.");
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

    // Unwrap SK
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

    const privateKeyObj = JSON.parse(new TextDecoder().decode(decryptedBuf)) as UnlockedPrivateKey;
    this.setPrivateKey(profileId, privateKeyObj);
    this.setPrivateKey("account", privateKeyObj);
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
    this.dekCache.clear();
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
    this.dekCache.clear();
    sessionStorage.removeItem(`obex_e2ee_sk_${profileId}`);
    return true;
  }

  /**
   * Decrypts a single log entry if encrypted and if the private key is unlocked.
   */
  async decryptLogEntry(profileId: string, log: LogEntry): Promise<LogEntry> {
    const version = log.encrypt_version ?? (log.encrypted_payload ? 1 : 0);
    if (version === 0 || !log.encrypted_payload) {
      return log;
    }

    const privKey = this.getPrivateKey(profileId);
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
          encrypt_version: 0,
        };
      }

      if (version === 1) {
        // Generation 1: Legacy P-256 ECDH
        const payload: EncryptedPayload = JSON.parse(log.encrypted_payload);
        const privKeyJwk = ("kty" in privKey ? privKey : null) as JsonWebKey | null;
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
          encrypt_version: 0,
        };
      }

      return log;
    } catch (err) {
      console.warn(`[E2EE] Failed to decrypt log #${log.id}:`, err);
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

    const privKey = this.getPrivateKey(profileId);
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
          console.warn(`[E2EE] Failed to decapsulate DEK for ${kemKeyId}:`, decapsErr);
        }
      }
    }

    return Promise.all(logs.map((log) => this.decryptLogEntry(profileId, log)));
  }
}

export const e2ee = new E2eeService();
