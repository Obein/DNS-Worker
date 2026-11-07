import { D1Database } from "@cloudflare/workers-types";
import { User } from "../../types";
import { UserRecord, CreateUserOptions, InactivityPolicyResult, StoredRecoveryKey } from "./types";
import { UserSecretProcessor } from "./secrets";
import { UserCoreModel } from "./core";
import { UserSecurityModel } from "./security";
import { UserMfaModel } from "./mfa";
import { UserLifecycleModel } from "./lifecycle";

export * from "./types";
export * from "./secrets";
export * from "./core";
export * from "./security";
export * from "./mfa";
export * from "./lifecycle";

/**
 * Unified UserModel Facade.
 *
 * Single Responsibility: Assembles and delegates to specialized sub-models
 * (Core, Security, MFA, Lifecycle, and Secrets), providing full backward compatibility.
 */
export class UserModel {
  public readonly secrets: UserSecretProcessor;
  public readonly core: UserCoreModel;
  public readonly security: UserSecurityModel;
  public readonly mfa: UserMfaModel;
  public readonly lifecycle: UserLifecycleModel;

  constructor(db: D1Database, env?: unknown) {
    this.secrets = new UserSecretProcessor(db, env);
    this.core = new UserCoreModel(db, this.secrets);
    this.security = new UserSecurityModel(db);
    this.mfa = new UserMfaModel(db, env);
    this.lifecycle = new UserLifecycleModel(db);
  }

  /**
   * Retrieves a user by their unique identifier.
   */
  async getById(id: string): Promise<UserRecord | null> {
    return this.core.getById(id);
  }

  /**
   * Retrieves a user by their username.
   */
  async getByUsername(username: string): Promise<UserRecord | null> {
    return this.core.getByUsername(username);
  }

  /**
   * Lists all users in the database.
   */
  async listAll(): Promise<User[]> {
    return this.core.listAll();
  }

  /**
   * Creates a new user record.
   */
  async create(user: CreateUserOptions): Promise<boolean> {
    return this.core.create(user);
  }

  /**
   * Updates a user's username.
   */
  async updateUsername(id: string, username: string): Promise<boolean> {
    return this.core.updateUsername(id, username);
  }

  /**
   * Updates a user's timezone preference.
   */
  async updateTimezone(id: string, timezone: string | null): Promise<boolean> {
    return this.core.updateTimezone(id, timezone);
  }

  /**
   * Updates a user's UI locale preference.
   */
  async updateLocale(id: string, locale: string | null): Promise<boolean> {
    return this.core.updateLocale(id, locale);
  }

  /**
   * Deletes a user by their ID.
   */
  async delete(id: string): Promise<boolean> {
    return this.core.delete(id);
  }

  /**
   * Retrieves the total count of registered users.
   */
  async count(): Promise<number> {
    return this.core.count();
  }

  /**
   * Checks if the user database is empty.
   */
  async isEmpty(): Promise<boolean> {
    return this.core.isEmpty();
  }

  /**
   * Updates a user's hashed password and password version.
   */
  async updatePassword(id: string, passwordHash: string, passwordVersion: number = 2): Promise<boolean> {
    return this.security.updatePassword(id, passwordHash, passwordVersion);
  }

  /**
   * Updates or clears a user's PIN hash.
   */
  async updatePinHash(id: string, pinHash: string | null): Promise<boolean> {
    return this.security.updatePinHash(id, pinHash);
  }

  /**
   * Updates a user's session lock timeout.
   */
  async updateSessionLockTimeout(id: string, timeout: number): Promise<boolean> {
    return this.security.updateSessionLockTimeout(id, timeout);
  }

  /**
   * Activates TOTP for a user.
   */
  async updateTOTP(id: string, secret: string, recoveryKeys: StoredRecoveryKey[]): Promise<boolean> {
    return this.mfa.updateTOTP(id, secret, recoveryKeys);
  }

  /**
   * Disables TOTP for a user.
   */
  async removeTOTP(id: string, keepMfaState: boolean = false): Promise<boolean> {
    return this.mfa.removeTOTP(id, keepMfaState);
  }

  /**
   * Saves or updates recovery keys for a user.
   */
  async updateRecoveryKeys(id: string, recoveryKeys: StoredRecoveryKey[]): Promise<boolean> {
    return this.mfa.updateRecoveryKeys(id, recoveryKeys);
  }

  /**
   * Updates skip-password setting for TOTP.
   */
  async updateTOTPSettings(id: string, skipPassword: boolean): Promise<boolean> {
    return this.mfa.updateTOTPSettings(id, skipPassword);
  }

  /**
   * Consumes a single used recovery key.
   */
  async consumeRecoveryKey(id: string, usedIndex: number, currentHashes: StoredRecoveryKey[]): Promise<boolean> {
    return this.mfa.consumeRecoveryKey(id, usedIndex, currentHashes);
  }

  /**
   * Updates last active timestamp by profile ID.
   */
  async updateLastActiveByProfile(profileId: string, now: number): Promise<boolean> {
    return this.lifecycle.updateLastActiveByProfile(profileId, now);
  }

  /**
   * Executes the periodic inactivity cleanup policy.
   */
  async applyInactivityPolicy(now: number): Promise<InactivityPolicyResult> {
    return this.lifecycle.applyInactivityPolicy(now);
  }
}
