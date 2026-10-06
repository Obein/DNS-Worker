/**
 * @file keyStore.ts
 * @description In-memory and browser storage (sessionStorage/localStorage) key store for unlocked E2EE private keys.
 */

import type { UnlockedPrivateKey, ProfileE2eeStatus } from "./types";

export class KeyStore {
  /** In-memory store for unlocked private keys (profileId or "account" -> UnlockedPrivateKey) */
  private unlockedKeys = new Map<string, UnlockedPrivateKey>();

  /**
   * Checks whether an unlocked private key is structurally compatible with the server's active public key.
   */
  isKeyCompatibleWithServer(sk: UnlockedPrivateKey, serverPublicKeyJson?: string | null): boolean {
    if (!serverPublicKeyJson) return true;
    try {
      const parsed = typeof serverPublicKeyJson === "string" ? JSON.parse(serverPublicKeyJson) : serverPublicKeyJson;
      const serverIsPqc = parsed.alg === "P256-MLKEM768" || Boolean(parsed.pqc_pk);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  validateCachedKeyAgainstStatus(status: ProfileE2eeStatus): void {
    if (!status.publicKey) return;
    const cachedKey = this.getPrivateKey("account");
    if (cachedKey && !this.isKeyCompatibleWithServer(cachedKey, status.publicKey)) {
      console.warn("[E2EE KeyStore] Cached private key does not match server algorithm. Purging stale key.");
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
  purgeProfileStorageKeys(): void {
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
  getPrivateKey(profileId?: string): UnlockedPrivateKey | null {
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
  setPrivateKey(profileOrAccountKey: string, sk: UnlockedPrivateKey): void {
    this.unlockedKeys.clear();
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
      console.warn("[E2EE KeyStore] Could not persist key to storage:", e);
    }
  }

  /**
   * Deletes a profile-specific in-memory key and storage entries.
   */
  deleteProfileKey(profileId: string): void {
    this.unlockedKeys.delete(profileId);
    sessionStorage.removeItem(`obex_e2ee_sk_${profileId}`);
    localStorage.removeItem(`obex_e2ee_sk_${profileId}`);
  }

  /**
   * Clears unlocked keys from memory and local/session storage.
   */
  clearStorage(): void {
    this.unlockedKeys.clear();
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
}
