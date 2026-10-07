import { D1Database } from "@cloudflare/workers-types";
import { StoredRecoveryKey } from "./types";
import { encryptEnvelope } from "../../utils/envelope";

/**
 * Handles Multi-Factor Authentication (MFA) factors, including TOTP and emergency recovery keys.
 *
 * Single Responsibility: Second-factor credentials lifecycle, storage, and recovery key consumption.
 */
export class UserMfaModel {
  constructor(private db: D1Database, private env?: unknown) {}

  /**
   * Activates TOTP for a user by storing the envelope-encrypted secret and recovery keys.
   * If envelope encryption (KEK) is not configured in the environment, falls back to plaintext.
   *
   * @param id The user ID.
   * @param secret Plaintext base32 TOTP secret.
   * @param recoveryKeys Array of recovery key hashes or objects.
   * @returns True if the update succeeded.
   */
  async updateTOTP(id: string, secret: string, recoveryKeys: StoredRecoveryKey[]): Promise<boolean> {
    const recoveryKeysStr = JSON.stringify(recoveryKeys);
    const encryptedSecret = await encryptEnvelope(secret, this.env);
    const encryptedKeys = await encryptEnvelope(recoveryKeysStr, this.env);

    if (encryptedSecret && encryptedKeys) {
      const result = await this.db
        .prepare(
          'UPDATE users SET totp_secret = NULL, totp_secret_encrypted = ?, totp_secret_dek = ?, totp_enabled = 1, totp_skip_password = 0, totp_recovery_keys = NULL, totp_recovery_keys_encrypted = ?, totp_recovery_keys_dek = ? WHERE id = ?'
        )
        .bind(
          encryptedSecret.dataEncrypted,
          encryptedSecret.dekEncrypted,
          encryptedKeys.dataEncrypted,
          encryptedKeys.dekEncrypted,
          id
        )
        .run();
      return result.success;
    } else {
      // Fallback: plaintext storage if KEK is not configured
      const result = await this.db
        .prepare(
          'UPDATE users SET totp_secret = ?, totp_secret_encrypted = NULL, totp_secret_dek = NULL, totp_enabled = 1, totp_skip_password = 0, totp_recovery_keys = ?, totp_recovery_keys_encrypted = NULL, totp_recovery_keys_dek = NULL WHERE id = ?'
        )
        .bind(secret, recoveryKeysStr, id)
        .run();
      return result.success;
    }
  }

  /**
   * Disables TOTP. If `keepMfaState` is true (e.g. user still has registered Passkeys),
   * recovery keys and passwordless settings are retained.
   *
   * @param id The user ID.
   * @param keepMfaState Whether to keep recovery keys and skip-password status intact.
   * @returns True if the update succeeded.
   */
  async removeTOTP(id: string, keepMfaState: boolean = false): Promise<boolean> {
    if (keepMfaState) {
      const result = await this.db
        .prepare('UPDATE users SET totp_secret = NULL, totp_secret_encrypted = NULL, totp_secret_dek = NULL, totp_enabled = 0 WHERE id = ?')
        .bind(id)
        .run();
      return result.success;
    }
    const result = await this.db
      .prepare('UPDATE users SET totp_secret = NULL, totp_secret_encrypted = NULL, totp_secret_dek = NULL, totp_enabled = 0, totp_skip_password = 0, totp_recovery_keys = NULL, totp_recovery_keys_encrypted = NULL, totp_recovery_keys_dek = NULL WHERE id = ?')
      .bind(id)
      .run();
    return result.success;
  }

  /**
   * Saves or updates recovery keys for a user (used by Passkeys or TOTP).
   *
   * @param id The user ID.
   * @param recoveryKeys Array of recovery key items.
   * @returns True if the update succeeded.
   */
  async updateRecoveryKeys(id: string, recoveryKeys: StoredRecoveryKey[]): Promise<boolean> {
    const recoveryKeysStr = JSON.stringify(recoveryKeys);
    const encryptedKeys = await encryptEnvelope(recoveryKeysStr, this.env);

    if (encryptedKeys) {
      const result = await this.db
        .prepare(
          'UPDATE users SET totp_recovery_keys = NULL, totp_recovery_keys_encrypted = ?, totp_recovery_keys_dek = ? WHERE id = ?'
        )
        .bind(
          encryptedKeys.dataEncrypted,
          encryptedKeys.dekEncrypted,
          id
        )
        .run();
      return result.success;
    } else {
      const result = await this.db
        .prepare(
          'UPDATE users SET totp_recovery_keys = ?, totp_recovery_keys_encrypted = NULL, totp_recovery_keys_dek = NULL WHERE id = ?'
        )
        .bind(recoveryKeysStr, id)
        .run();
      return result.success;
    }
  }

  /**
   * Updates the skip-password setting for a user's MFA configuration.
   *
   * @param id The user ID.
   * @param skipPassword Whether password verification can be bypassed in favor of MFA.
   * @returns True if the update succeeded.
   */
  async updateTOTPSettings(id: string, skipPassword: boolean): Promise<boolean> {
    const result = await this.db
      .prepare('UPDATE users SET totp_skip_password = ? WHERE id = ?')
      .bind(skipPassword ? 1 : 0, id)
      .run();
    return result.success;
  }

  /**
   * Consumes and burns a single used recovery key by filtering it out from the stored array.
   *
   * @param id The user ID.
   * @param usedIndex The index of the consumed recovery key.
   * @param currentHashes The existing array of recovery key hashes.
   * @returns True if the update succeeded.
   */
  async consumeRecoveryKey(id: string, usedIndex: number, currentHashes: StoredRecoveryKey[]): Promise<boolean> {
    const updated = currentHashes.filter((_, i) => i !== usedIndex);
    const updatedStr = JSON.stringify(updated);

    const encryptedKeys = await encryptEnvelope(updatedStr, this.env);
    if (encryptedKeys) {
      const result = await this.db
        .prepare('UPDATE users SET totp_recovery_keys = NULL, totp_recovery_keys_encrypted = ?, totp_recovery_keys_dek = ? WHERE id = ?')
        .bind(encryptedKeys.dataEncrypted, encryptedKeys.dekEncrypted, id)
        .run();
      return result.success;
    } else {
      const result = await this.db
        .prepare('UPDATE users SET totp_recovery_keys = ?, totp_recovery_keys_encrypted = NULL, totp_recovery_keys_dek = NULL WHERE id = ?')
        .bind(updatedStr, id)
        .run();
      return result.success;
    }
  }
}
