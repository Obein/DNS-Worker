/**
 * @file api.ts
 * @description HTTP network layer and key enrollment flows for E2EE account/profile endpoints.
 */

import { ml_kem768_p256 } from "@noble/post-quantum/hybrid.js";
import { profileFetch } from "../profiles";
import type { ProfileE2eeStatus, UnlockedPrivateKey } from "./types";
import { toBase64, fromBase64 } from "./crypto";
import { derivePasskeyKek } from "./passkeyKek";
import { wrapPrivateKeyWithRecoveryKey, unwrapPrivateKeyWithRecoveryKey } from "./recoveryKek";
import type { KeyStore } from "./keyStore";

export class E2eeApi {
  private keyStore: KeyStore;

  constructor(keyStore: KeyStore) {
    this.keyStore = keyStore;
  }

  /**
   * Retrieves account-level E2EE configuration and status.
   */
  async getUserStatus(): Promise<ProfileE2eeStatus> {
    try {
      const res = await fetch("/api/account/e2ee/status");
      if (res.ok) {
        const data = (await res.json()) as ProfileE2eeStatus;
        this.keyStore.validateCachedKeyAgainstStatus(data);
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
          this.keyStore.validateCachedKeyAgainstStatus(profileStatus);
          return profileStatus;
        }
      }
    } catch (err) {
      console.warn("[E2EE API] Fallback status check failed:", err);
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
    this.keyStore.validateCachedKeyAgainstStatus(data);
    return data;
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

    const { kek, passkeyId } = await derivePasskeyKek("account");
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
    this.keyStore.setPrivateKey("account", privateKeyObj);
    return true;
  }

  /**
   * Generates a new P256-MLKEM768 keypair and wraps it with the user's Passkey,
   * upgrading from legacy ECDH P-256 or rotating the active post-quantum keypair.
   */
  async rotateUserE2eeKey(passkeyIdOverride?: string): Promise<boolean> {
    const { kek, passkeyId } = await derivePasskeyKek("account");
    const chosenPasskeyId = passkeyIdOverride || passkeyId || "primary";

    // Preserve existing legacy key if present so historical Gen 1 logs remain decryptable
    const currentKey = this.keyStore.getPrivateKey("account");
    let legacyKey: JsonWebKey | undefined = undefined;
    if (currentKey && "kty" in currentKey) {
      legacyKey = currentKey as JsonWebKey;
    } else if (currentKey && "legacyKey" in currentKey) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    this.keyStore.setPrivateKey("account", privateKeyObj);
    return true;
  }

  /**
   * Initializes and enables E2EE for a profile (legacy wrapper).
   */
  async enableE2ee(profileId: string, passkeyId: string): Promise<boolean> {
    const { kek } = await derivePasskeyKek(profileId);

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
    this.keyStore.setPrivateKey(profileId, privateKeyObj);
    this.keyStore.setPrivateKey("account", privateKeyObj);
    return true;
  }

  /**
   * Unlocks the account's log private key using the device's Passkey with a single prompt.
   */
  async unlockUser(): Promise<boolean> {
    const status = await this.getUserStatus();
    if (!status.hasKeys && !status.enabled && status.wrappedPasskeys.length === 0) return false;

    // Only skip if already unlocked with a key compatible with the server's active algorithm
    const cachedKey = this.keyStore.getPrivateKey("account");
    if (cachedKey && this.keyStore.isKeyCompatibleWithServer(cachedKey, status.publicKey)) {
      return true;
    }

    if (!status.wrappedPasskeys || status.wrappedPasskeys.length === 0) {
      throw new Error("No passkeys have been enrolled in E2EE yet. Please unlock with Recovery Key or reset the keypair.");
    }

    const { kek, altKek, passkeyId } = await derivePasskeyKek("account");

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
    this.keyStore.setPrivateKey("account", privateKeyObj);
    return true;
  }

  /**
   * Unlocks the profile's log private key using the device's Passkey.
   */
  async unlockProfile(profileId: string): Promise<boolean> {
    const status = await this.getStatus(profileId);
    if (!status.hasKeys && !status.enabled && status.wrappedPasskeys.length === 0) return false;

    // Only skip if already unlocked with a key compatible with the server's active algorithm
    const cachedKey = this.keyStore.getPrivateKey(profileId);
    if (cachedKey && this.keyStore.isKeyCompatibleWithServer(cachedKey, status.publicKey)) {
      return true;
    }

    // Use dual-salt derivation (account + profileId)
    const { kek, altKek, passkeyId } = await derivePasskeyKek(profileId);

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
    this.keyStore.setPrivateKey(profileId, privateKeyObj);
    this.keyStore.setPrivateKey("account", privateKeyObj);
    return true;
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
    const recoveryWrapped = await wrapPrivateKeyWithRecoveryKey(privateKeyObj, plaintextRecoveryKey);

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
    this.keyStore.setPrivateKey("account", privateKeyObj);
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
      privateKeyObj = await unwrapPrivateKeyWithRecoveryKey(
        encryptedSk,
        iv,
        salt,
        plaintextRecoveryKey
      );
    } catch {
      throw new Error("Invalid Recovery Key or corrupted data");
    }

    this.keyStore.setPrivateKey("account", privateKeyObj);
    return true;
  }

  /**
   * Wraps the currently unlocked private key for a newly registered Passkey.
   */
  async wrapCurrentKeyForPasskey(passkeyId: string): Promise<boolean> {
    const sk = this.keyStore.getPrivateKey("account");
    if (!sk) {
      console.warn("[E2EE API] Cannot wrap passkey: private key is not unlocked in this session");
      return false;
    }

    try {
      const { kek } = await derivePasskeyKek("account");
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
      console.warn("[E2EE API] Failed to wrap passkey KEK:", err);
      return false;
    }
  }

  /**
   * Re-wraps the currently unlocked private key with a newly rotated Recovery Key.
   */
  async wrapCurrentKeyForRecovery(newRecoveryKey: string): Promise<boolean> {
    const sk = this.keyStore.getPrivateKey("account");
    if (!sk) {
      console.warn("[E2EE API] Cannot wrap recovery: private key is not unlocked in this session");
      return false;
    }

    const recoveryWrapped = await wrapPrivateKeyWithRecoveryKey(sk, newRecoveryKey);
    const res = await fetch("/api/account/e2ee/wrap-recovery", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(recoveryWrapped),
    });

    return res.ok;
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
    this.keyStore.clearStorage();
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
    this.keyStore.deleteProfileKey(profileId);
    return true;
  }
}
