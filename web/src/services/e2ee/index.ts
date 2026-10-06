/**
 * @file index.ts
 * @description Master facade for Client-side End-to-End Encryption (E2EE) Service.
 * Unifies KeyStore, DecryptEngine, and E2eeApi under a backwards-compatible interface.
 */

import type { LogEntry } from "../../views/LogsView/types";
import type {
  ProfileE2eeStatus,
  EncryptedPayload,
  CompactEncryptedLogPayload,
  UnlockedPrivateKey,
  SensitiveLogData
} from "./types";
import { KeyStore } from "./keyStore";
import { DecryptEngine } from "./decryptEngine";
import { E2eeApi } from "./api";
import { derivePasskeyKek, type DerivedPasskeyKek } from "./passkeyKek";
import {
  deriveRecoveryKek,
  wrapPrivateKeyWithRecoveryKey,
  unwrapPrivateKeyWithRecoveryKey,
  type WrappedRecoveryKey
} from "./recoveryKek";

export type {
  ProfileE2eeStatus,
  EncryptedPayload,
  CompactEncryptedLogPayload,
  UnlockedPrivateKey,
  SensitiveLogData,
  DerivedPasskeyKek,
  WrappedRecoveryKey
};

export class E2eeService {
  private keyStore = new KeyStore();
  private decryptEngine = new DecryptEngine(this.keyStore);
  private api = new E2eeApi(this.keyStore);

  // ── Status & Capabilities ──

  async getUserStatus(): Promise<ProfileE2eeStatus> {
    return this.api.getUserStatus();
  }

  async getStatus(profileId: string): Promise<ProfileE2eeStatus> {
    return this.api.getStatus(profileId);
  }

  isUnlocked(): boolean {
    return this.keyStore.isUnlocked();
  }

  isProfileUnlocked(profileId: string): boolean {
    return this.keyStore.isProfileUnlocked(profileId);
  }

  isKeyCompatibleWithServer(sk: UnlockedPrivateKey, serverPublicKeyJson?: string | null): boolean {
    return this.keyStore.isKeyCompatibleWithServer(sk, serverPublicKeyJson);
  }

  clearStorage(): void {
    this.keyStore.clearStorage();
    this.decryptEngine.clearDekCache();
  }

  // ── Key Derivation & Wrapping ──

  async derivePasskeyKek(saltScope: string = "account"): Promise<DerivedPasskeyKek> {
    return derivePasskeyKek(saltScope);
  }

  async deriveRecoveryKek(plaintextRecoveryKey: string, salt: Uint8Array): Promise<CryptoKey> {
    return deriveRecoveryKek(plaintextRecoveryKey, salt);
  }

  async wrapPrivateKeyWithRecoveryKey(
    privateKey: UnlockedPrivateKey,
    plaintextRecoveryKey: string
  ): Promise<WrappedRecoveryKey> {
    return wrapPrivateKeyWithRecoveryKey(privateKey, plaintextRecoveryKey);
  }

  async unwrapPrivateKeyWithRecoveryKey(
    encryptedSkBase64: string,
    ivBase64: string,
    saltBase64: string,
    plaintextRecoveryKey: string
  ): Promise<UnlockedPrivateKey> {
    return unwrapPrivateKeyWithRecoveryKey(
      encryptedSkBase64,
      ivBase64,
      saltBase64,
      plaintextRecoveryKey
    );
  }

  // ── Key Lifecycle & Enable / Disable ──

  async enableUserE2ee(passkeyIdOverride?: string): Promise<boolean> {
    return this.api.enableUserE2ee(passkeyIdOverride);
  }

  async rotateUserE2eeKey(passkeyIdOverride?: string): Promise<boolean> {
    return this.api.rotateUserE2eeKey(passkeyIdOverride);
  }

  async enableE2ee(profileId: string, passkeyId: string): Promise<boolean> {
    return this.api.enableE2ee(profileId, passkeyId);
  }

  async disableUserE2ee(): Promise<boolean> {
    const res = await this.api.disableUserE2ee();
    this.decryptEngine.clearDekCache();
    return res;
  }

  async disableE2ee(profileId: string): Promise<boolean> {
    const res = await this.api.disableE2ee(profileId);
    this.decryptEngine.clearDekCache();
    return res;
  }

  // ── Unlocking & Enrollment ──

  async unlockUser(): Promise<boolean> {
    return this.api.unlockUser();
  }

  async unlockProfile(profileId: string): Promise<boolean> {
    return this.api.unlockProfile(profileId);
  }

  async unlockWithRecoveryKey(plaintextRecoveryKey: string): Promise<boolean> {
    return this.api.unlockWithRecoveryKey(plaintextRecoveryKey);
  }

  async initUserE2eeWithRecoveryKey(plaintextRecoveryKey: string): Promise<boolean> {
    return this.api.initUserE2eeWithRecoveryKey(plaintextRecoveryKey);
  }

  async wrapCurrentKeyForPasskey(passkeyId: string): Promise<boolean> {
    return this.api.wrapCurrentKeyForPasskey(passkeyId);
  }

  async wrapCurrentKeyForRecovery(newRecoveryKey: string): Promise<boolean> {
    return this.api.wrapCurrentKeyForRecovery(newRecoveryKey);
  }

  // ── Log Decryption ──

  async decryptLogEntry(profileId: string, log: LogEntry): Promise<LogEntry> {
    return this.decryptEngine.decryptLogEntry(profileId, log);
  }

  async decryptLogsBatch(profileId: string, logs: LogEntry[]): Promise<LogEntry[]> {
    return this.decryptEngine.decryptLogsBatch(profileId, logs);
  }
}

export const e2ee = new E2eeService();
