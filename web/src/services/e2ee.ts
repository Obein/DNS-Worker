/**
 * @file e2ee.ts
 * @description Client-side End-to-End Encryption (E2EE) Service for DNS logs.
 * Provides Passkey hardware-backed envelope encryption, user/account-level key lifecycle management,
 * and zero-knowledge log decryption supporting classical P-256 and post-quantum P256-MLKEM768.
 */

import { ml_kem768_p256 } from "@noble/post-quantum/hybrid.js";
import type { LogEntry } from "../views/LogsView/types";
import { profileFetch } from "./profiles";
import { getPasskeyAuthOptions, getPasskeys } from "./account";
import { bufferToBase64Url } from "../utils/webauthn";

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
        const data = (await res.json()) as ProfileE2eeStatus;
        this.validateCachedKeyAgainstStatus(data);
        return data;
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
          const profileStatus = await this.getStatus(profiles[0].id);
          this.validateCachedKeyAgainstStatus(profileStatus);
          return profileStatus;
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
    const data = (await res.json()) as ProfileE2eeStatus;
    this.validateCachedKeyAgainstStatus(data);
    return data;
  }

  /**
   * Checks whether an unlocked private key is structurally compatible with the server's active public key.
   */
  isKeyCompatibleWithServer(sk: UnlockedPrivateKey, serverPublicKeyJson?: string | null): boolean {
    if (!serverPublicKeyJson) return true;
    try {
      const parsed = typeof serverPublicKeyJson === "string" ? JSON.parse(serverPublicKeyJson) : serverPublicKeyJson;
      const serverIsPqc = parsed.alg === "P256-MLKEM768" || Boolean(parsed.pqc_pk);
      const keyIsPqc = "seedBase64" in sk || (sk as any).alg === "P256-MLKEM768";
      if (serverIsPqc && !keyIsPqc) {
        return false;
      }
      return true;
    } catch {
      return true;
    }
  }

  /**
   * Validates cached private key against server public key and cleans up stale keys if incompatible.
   */
  private validateCachedKeyAgainstStatus(status: ProfileE2eeStatus): void {
    if (!status.publicKey) return;
    const cachedKey = this.getPrivateKey("account");
    if (cachedKey && !this.isKeyCompatibleWithServer(cachedKey, status.publicKey)) {
      console.warn("[E2EE] Cached private key does not match server algorithm. Purging stale key.");
      this.clearStorage();
    }
  }

  /**
   * Checks whether the current session has unlocked the private key for the account.
   */
  isUnlocked(): boolean {
    return this.getPrivateKey("account") !== null;
  }

  /**
   * Checks whether the current session has unlocked the private key for this profile or account.
   */
  isProfileUnlocked(profileId: string): boolean {
    return this.getPrivateKey(profileId) !== null;
  }

  /**
   * Purges legacy profile-specific storage keys (e.g. obex_e2ee_sk_<profileId>)
   * while keeping the authoritative account key obex_e2ee_sk_account.
   */
  private purgeProfileStorageKeys(): void {
    const sessionKeys: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k?.startsWith("obex_e2ee_sk_") && k !== "obex_e2ee_sk_account") {
        sessionKeys.push(k);
      }
    }
    sessionKeys.forEach((k) => sessionStorage.removeItem(k));

    const localKeys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith("obex_e2ee_sk_") && k !== "obex_e2ee_sk_account") {
        localKeys.push(k);
      }
    }
    localKeys.forEach((k) => localStorage.removeItem(k));
  }

  /**
   * Gets the unlocked private key from memory, session storage, or local storage.
   */
  private getPrivateKey(profileId?: string): UnlockedPrivateKey | null {
    // 1. Account key in memory is authoritative
    if (this.unlockedKeys.has("account")) {
      return this.unlockedKeys.get("account")!;
    }
    if (profileId && this.unlockedKeys.has(profileId)) {
      return this.unlockedKeys.get(profileId)!;
    }

    // 2. Check sessionStorage account key
    const sessionAccount = sessionStorage.getItem("obex_e2ee_sk_account");
    if (sessionAccount) {
      try {
        const key = JSON.parse(sessionAccount) as UnlockedPrivateKey;
        this.unlockedKeys.set("account", key);
        if (profileId) this.unlockedKeys.set(profileId, key);
        return key;
      } catch {
        sessionStorage.removeItem("obex_e2ee_sk_account");
      }
    }

    // 3. Check localStorage account key
    const localAccount = localStorage.getItem("obex_e2ee_sk_account");
    if (localAccount) {
      try {
        const key = JSON.parse(localAccount) as UnlockedPrivateKey;
        this.unlockedKeys.set("account", key);
        if (profileId) this.unlockedKeys.set(profileId, key);
        return key;
      } catch {
        localStorage.removeItem("obex_e2ee_sk_account");
      }
    }

    // 4. Legacy profile key migration (if obex_e2ee_sk_account is missing but profile key exists)
    if (profileId) {
      const legacySession = sessionStorage.getItem(`obex_e2ee_sk_${profileId}`);
      if (legacySession) {
        try {
          const key = JSON.parse(legacySession) as UnlockedPrivateKey;
          this.setPrivateKey("account", key);
          return key;
        } catch {
          sessionStorage.removeItem(`obex_e2ee_sk_${profileId}`);
        }
      }
      const legacyLocal = localStorage.getItem(`obex_e2ee_sk_${profileId}`);
      if (legacyLocal) {
        try {
          const key = JSON.parse(legacyLocal) as UnlockedPrivateKey;
          this.setPrivateKey("account", key);
          return key;
        } catch {
          localStorage.removeItem(`obex_e2ee_sk_${profileId}`);
        }
      }
    }

    return null;
  }

  /**
   * Stores the unlocked private key in memory, session storage, and local storage.
   */
  private setPrivateKey(profileOrAccountKey: string, sk: UnlockedPrivateKey): void {
    this.unlockedKeys.clear();
    this.dekCache.clear();
    this.unlockedKeys.set("account", sk);
    if (profileOrAccountKey && profileOrAccountKey !== "account") {
      this.unlockedKeys.set(profileOrAccountKey, sk);
    }
    try {
      this.purgeProfileStorageKeys();
      const serialized = JSON.stringify(sk);
      sessionStorage.setItem("obex_e2ee_sk_account", serialized);
      localStorage.setItem("obex_e2ee_sk_account", serialized);
    } catch (e) {
      console.warn("[E2EE] Could not persist key to storage:", e);
    }
  }

  /**
   * Clears unlocked keys from memory and local/session storage.
   */
  clearStorage(): void {
    this.unlockedKeys.clear();
    this.dekCache.clear();
    const sessionKeys: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k?.startsWith("obex_e2ee_sk_")) sessionKeys.push(k);
    }
    sessionKeys.forEach((k) => sessionStorage.removeItem(k));

    const localKeys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith("obex_e2ee_sk_")) localKeys.push(k);
    }
    localKeys.forEach((k) => localStorage.removeItem(k));
  }

  /**
   * Derives a 256-bit Key Encryption Key (KEK) using WebAuthn Passkey assertion.
   * Leverages WebAuthn PRF extension with dual salt evaluation (account + profileId)
   * to guarantee seamless decryption regardless of key wrap scope.
   */
  async derivePasskeyKek(saltScope: string = "account"): Promise<{ kek: Uint8Array; altKek?: Uint8Array; passkeyId?: string }> {
    const authOptions = await getPasskeyAuthOptions();

    // Primary salt is always "account"
    const saltAccount = new Uint8Array(32);
    const encAccount = new TextEncoder().encode("obex-dns-log-e2ee-salt:account");
    saltAccount.set(encAccount.subarray(0, 32));

    // Secondary salt if saltScope is provided and distinct from "account"
    let saltProfile: Uint8Array | undefined;
    if (saltScope && saltScope !== "account") {
      saltProfile = new Uint8Array(32);
      const encProfile = new TextEncoder().encode(`obex-dns-log-e2ee-salt:${saltScope}`);
      saltProfile.set(encProfile.subarray(0, 32));
    }

    const prfEval: any = {
      first: saltAccount,
    };
    if (saltProfile) {
      prfEval.second = saltProfile;
    }

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
            eval: prfEval,
          },
        } as any,
      },
    })) as PublicKeyCredential;

    if (!credential) {
      throw new Error("Passkey assertion was cancelled or failed");
    }

    const extResults = credential.getClientExtensionResults() as any;
    let kekBytes: Uint8Array;
    let altKekBytes: Uint8Array | undefined;

    if (extResults?.prf?.results?.first) {
      kekBytes = new Uint8Array(extResults.prf.results.first);
      if (extResults?.prf?.results?.second) {
        altKekBytes = new Uint8Array(extResults.prf.results.second);
      }
    } else {
      throw new Error(
        "Passkey authenticator does not support WebAuthn PRF extension. Please unlock using your Recovery Key."
      );
    }

    // Match credential ID to registered passkey if possible
    let passkeyId = credential.id;
    const normalizeB64 = (s: string) => (s || "").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
    const rawIdB64Url = credential.rawId ? bufferToBase64Url(credential.rawId) : "";
    const credIdNorm = normalizeB64(credential.id);
    const rawIdNorm = normalizeB64(rawIdB64Url);

    if (authOptions.allowCredentials && authOptions.allowCredentials.length > 0) {
      const match = authOptions.allowCredentials.find((c: any) => {
        const cNorm = normalizeB64(c.id);
        return cNorm === credIdNorm || cNorm === rawIdNorm || c.passkey_id === credential.id;
      });
      if (match?.passkey_id) passkeyId = match.passkey_id;
    }

    if (!passkeyId || passkeyId === credential.id) {
      try {
        const passkeys = await getPasskeys();
        const match = passkeys.find((p) => {
          const pNorm = normalizeB64(p.credential_id);
          return pNorm === credIdNorm || pNorm === rawIdNorm || p.id === credential.id;
        });
        if (match?.id) {
          passkeyId = match.id;
        } else if (passkeys.length > 0) {
          passkeyId = passkeys[0].id;
        }
      } catch (err) {
        console.warn("[E2EE] Could not load passkeys to match credential:", err);
      }
    }

    return { kek: kekBytes, altKek: altKekBytes, passkeyId };
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
   * Generates a new P256-MLKEM768 keypair and wraps it with the user's Passkey,
   * upgrading from legacy ECDH P-256 or rotating the active post-quantum keypair.
   */
  async rotateUserE2eeKey(passkeyIdOverride?: string): Promise<boolean> {
    const { kek, passkeyId } = await this.derivePasskeyKek("account");
    const chosenPasskeyId = passkeyIdOverride || passkeyId || "primary";

    // Preserve existing legacy key if present so historical Gen 1 logs remain decryptable
    const currentKey = this.getPrivateKey("account");
    let legacyKey: JsonWebKey | undefined = undefined;
    if (currentKey && "kty" in currentKey) {
      legacyKey = currentKey as JsonWebKey;
    } else if (currentKey && "legacyKey" in currentKey) {
      legacyKey = (currentKey as any).legacyKey;
    }

    // 1. Generate Post-Quantum P256-MLKEM768 KeyPair
    const pqcKeys = ml_kem768_p256.keygen();
    const publicKeyPayload = {
      alg: "P256-MLKEM768",
      pqc_pk: toBase64(pqcKeys.publicKey),
    };
    const privateKeyObj: UnlockedPrivateKey = {
      alg: "P256-MLKEM768",
      seedBase64: toBase64(pqcKeys.secretKey),
      ...(legacyKey ? { legacyKey } : {}),
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
      throw new Error(`Failed to upgrade user E2EE key: ${await res.text()}`);
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

    // Only skip if already unlocked with a key compatible with the server's active algorithm
    const cachedKey = this.getPrivateKey("account");
    if (cachedKey && this.isKeyCompatibleWithServer(cachedKey, status.publicKey)) {
      return true;
    }

    const { kek, altKek, passkeyId } = await this.derivePasskeyKek("account");

    const targetPasskeyId = passkeyId || status.wrappedPasskeys[0];
    let res = await fetch(
      `/api/account/e2ee/wrapped-key${targetPasskeyId ? `?passkey_id=${encodeURIComponent(targetPasskeyId)}` : ""}`
    );
    if (!res.ok) {
      const profilesRes = await fetch("/api/profiles");
      if (profilesRes.ok) {
        const profiles = await profilesRes.json();
        if (profiles && profiles.length > 0) {
          res = await fetch(
            `/api/profiles/${profiles[0].id}/e2ee/wrapped-key${targetPasskeyId ? `?passkey_id=${encodeURIComponent(targetPasskeyId)}` : ""}`
          );
        }
      }
    }

    if (!res.ok) {
      throw new Error(`Failed to fetch wrapped key: ${await res.text()}`);
    }

    const { encryptedSk, iv } = (await res.json()) as { encryptedSk: string; iv: string };
    const ciphertextBuf = fromBase64(encryptedSk);
    const ivBuf = fromBase64(iv);

    // Unwrap SK: Try primary KEK (account), then altKek (profile)
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

    // Only skip if already unlocked with a key compatible with the server's active algorithm
    const cachedKey = this.getPrivateKey(profileId);
    if (cachedKey && this.isKeyCompatibleWithServer(cachedKey, status.publicKey)) {
      return true;
    }

    // Use dual-salt derivation (account + profileId)
    const { kek, altKek, passkeyId } = await this.derivePasskeyKek(profileId);

    const targetPasskeyId = passkeyId || status.wrappedPasskeys[0];
    let res = await fetch(
      `/api/profiles/${profileId}/e2ee/wrapped-key${targetPasskeyId ? `?passkey_id=${encodeURIComponent(targetPasskeyId)}` : ""}`
    );
    if (!res.ok) {
      res = await fetch(
        `/api/account/e2ee/wrapped-key${targetPasskeyId ? `?passkey_id=${encodeURIComponent(targetPasskeyId)}` : ""}`
      );
    }
    if (!res.ok) {
      throw new Error(`Failed to fetch wrapped key: ${await res.text()}`);
    }

    const { encryptedSk, iv } = (await res.json()) as { encryptedSk: string; iv: string };
    const ciphertextBuf = fromBase64(encryptedSk);
    const ivBuf = fromBase64(iv);

    // Unwrap SK: Try primary KEK (account), then altKek (profile)
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
    this.clearStorage();
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
    localStorage.removeItem(`obex_e2ee_sk_${profileId}`);
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
            ? privKey.legacyKey
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
      console.warn("[E2EE] Failed to decrypt log #%s:", String(log.id), err);
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
