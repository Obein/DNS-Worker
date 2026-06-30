import { D1Database } from "@cloudflare/workers-types";
import { User } from "../types";
import { encryptEnvelope, decryptEnvelope, rotateEnvelopeDek } from "../utils/envelope";

export class UserModel {
  constructor(private db: D1Database, private env?: any) {}

  private async processUserSecrets(user: any): Promise<any> {
    if (!user) return null;

    let updatedFields: any = {};
    let shouldUpdateDb = false;

    // 1. Process totp_secret
    let totpSecret = user.totp_secret;
    if (user.totp_secret_encrypted && user.totp_secret_dek) {
      try {
        totpSecret = await decryptEnvelope(user.totp_secret_encrypted, user.totp_secret_dek, this.env);
        
        // Check for DEK rotation (vN -> vN+1)
        const rotatedDek = await rotateEnvelopeDek(user.totp_secret_dek, this.env);
        if (rotatedDek) {
          updatedFields.totp_secret_dek = rotatedDek;
          shouldUpdateDb = true;
        }
      } catch (e: any) {
        console.error(`[Envelope Encryption] Failed to decrypt/rotate totp_secret for user ${user.id}:`, e.stack || e.message || e);
      }
    } else if (user.totp_secret) {
      // Legacy plain-text secret found. If KEK is active, migrate to envelope encryption!
      try {
        const encrypted = await encryptEnvelope(user.totp_secret, this.env);
        if (encrypted) {
          updatedFields.totp_secret_encrypted = encrypted.dataEncrypted;
          updatedFields.totp_secret_dek = encrypted.dekEncrypted;
          updatedFields.totp_secret = null; // Clear plain-text column
          shouldUpdateDb = true;
        }
      } catch (e) {
        console.error(`[Envelope Encryption] Migration failed for totp_secret of user ${user.id}:`, e);
      }
    }

    // 2. Process totp_recovery_keys
    let totpRecoveryKeys = user.totp_recovery_keys;
    if (user.totp_recovery_keys_encrypted && user.totp_recovery_keys_dek) {
      try {
        totpRecoveryKeys = await decryptEnvelope(user.totp_recovery_keys_encrypted, user.totp_recovery_keys_dek, this.env);

        // Check for DEK rotation (vN -> vN+1)
        const rotatedDek = await rotateEnvelopeDek(user.totp_recovery_keys_dek, this.env);
        if (rotatedDek) {
          updatedFields.totp_recovery_keys_dek = rotatedDek;
          shouldUpdateDb = true;
        }
      } catch (e: any) {
        console.error(`[Envelope Encryption] Failed to decrypt/rotate totp_recovery_keys for user ${user.id}:`, e.stack || e.message || e);
      }
    } else if (user.totp_recovery_keys) {
      // Legacy plain-text recovery keys found. If KEK is active, migrate to envelope encryption!
      try {
        const encrypted = await encryptEnvelope(user.totp_recovery_keys, this.env);
        if (encrypted) {
          updatedFields.totp_recovery_keys_encrypted = encrypted.dataEncrypted;
          updatedFields.totp_recovery_keys_dek = encrypted.dekEncrypted;
          updatedFields.totp_recovery_keys = null; // Clear plain-text column
          shouldUpdateDb = true;
        }
      } catch (e) {
        console.error(`[Envelope Encryption] Migration failed for totp_recovery_keys of user ${user.id}:`, e);
      }
    }

    // Update D1 database if migration or rotation occurred
    if (shouldUpdateDb) {
      try {
        const updateParts: string[] = [];
        const bindings: any[] = [];
        for (const [key, val] of Object.entries(updatedFields)) {
          updateParts.push(`${key} = ?`);
          bindings.push(val);
        }
        bindings.push(user.id);

        await this.db
          .prepare(`UPDATE users SET ${updateParts.join(", ")} WHERE id = ?`)
          .bind(...bindings)
          .run();
        
        // Merge the newly updated/encrypted values to the returned user object
        Object.assign(user, updatedFields);
      } catch (e) {
        console.error(`[Envelope Encryption] Failed to save rotated/migrated secrets for user ${user.id}:`, e);
      }
    }

    // Return the user object with decrypted totp_secret and totp_recovery_keys
    return {
      ...user,
      totp_secret: totpSecret,
      totp_recovery_keys: totpRecoveryKeys
    };
  }

  async getById(id: string): Promise<any | null> {
    const user = await this.db.prepare("SELECT * FROM users WHERE id = ?").bind(id).first();
    return await this.processUserSecrets(user);
  }

  async getByUsername(username: string): Promise<any | null> {
    const user = await this.db.prepare("SELECT * FROM users WHERE username = ?").bind(username).first();
    return await this.processUserSecrets(user);
  }

  async listAll(): Promise<User[]> {
    const { results } = await this.db.prepare(`
      SELECT 
        u.id, 
        u.username, 
        u.role, 
        u.created_at, 
        u.totp_enabled,
        u.timezone,
        u.locale,
        u.last_active_at as last_resolve_at
      FROM users u
      ORDER BY u.created_at DESC
    `).all<User>();
    return results;
  }

  async create(user: { id: string, username: string, passwordHash: string, role: string, timezone?: string | null, locale?: string | null, passwordVersion?: number }): Promise<boolean> {
    const now = Math.floor(Date.now() / 1000);
    const result = await this.db.prepare(
      "INSERT INTO users (id, username, hashed_password, role, created_at, timezone, locale, password_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(user.id, user.username, user.passwordHash, user.role, now, user.timezone || null, user.locale || 'en-US', user.passwordVersion ?? 2).run();
    return result.success;
  }

  async updateUsername(id: string, username: string): Promise<boolean> {
    const result = await this.db.prepare("UPDATE users SET username = ? WHERE id = ?").bind(username, id).run();
    return result.success;
  }

  async updateTimezone(id: string, timezone: string | null): Promise<boolean> {
    const result = await this.db.prepare("UPDATE users SET timezone = ? WHERE id = ?").bind(timezone, id).run();
    return result.success;
  }

  async updateLocale(id: string, locale: string | null): Promise<boolean> {
    const result = await this.db.prepare("UPDATE users SET locale = ? WHERE id = ?").bind(locale || 'en-US', id).run();
    return result.success;
  }

  async updatePassword(id: string, passwordHash: string, passwordVersion: number = 2): Promise<boolean> {
    const result = await this.db.prepare("UPDATE users SET hashed_password = ?, password_version = ? WHERE id = ?").bind(passwordHash, passwordVersion, id).run();
    return result.success;
  }

  async updatePinHash(id: string, pinHash: string | null): Promise<boolean> {
    const result = await this.db.prepare("UPDATE users SET pin_hash = ? WHERE id = ?").bind(pinHash, id).run();
    return result.success;
  }

  async updateSessionLockTimeout(id: string, timeout: number): Promise<boolean> {
    const result = await this.db.prepare(
      "UPDATE users SET session_lock_timeout = ? WHERE id = ?"
    ).bind(timeout, id).run();
    return result.success;
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.db.prepare("DELETE FROM users WHERE id = ?").bind(id).run();
    return result.success;
  }

  async isEmpty(): Promise<boolean> {
    const count = await this.db.prepare("SELECT COUNT(*) as count FROM users").first<number>('count');
    return count === 0;
  }

  /**
   * Activates TOTP for a user by storing the envelope encrypted secret and recovery keys.
   */
  async updateTOTP(id: string, secret: string, recoveryKeysHashed: string[]): Promise<boolean> {
    const recoveryKeysStr = JSON.stringify(recoveryKeysHashed);
    const encryptedSecret = await encryptEnvelope(secret, this.env);
    const encryptedKeys = await encryptEnvelope(recoveryKeysStr, this.env);

    if (encryptedSecret && encryptedKeys) {
      const result = await this.db
        .prepare(
          'UPDATE users SET totp_secret = NULL, totp_secret_encrypted = ?, totp_secret_dek = ?, totp_enabled = 1, totp_skip_password = 1, totp_recovery_keys = NULL, totp_recovery_keys_encrypted = ?, totp_recovery_keys_dek = ? WHERE id = ?'
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
          'UPDATE users SET totp_secret = ?, totp_secret_encrypted = NULL, totp_secret_dek = NULL, totp_enabled = 1, totp_skip_password = 1, totp_recovery_keys = ?, totp_recovery_keys_encrypted = NULL, totp_recovery_keys_dek = NULL WHERE id = ?'
        )
        .bind(secret, recoveryKeysStr, id)
        .run();
      return result.success;
    }
  }

  /**
   * Disables TOTP and clears all TOTP-related data for a user.
   */
  async removeTOTP(id: string): Promise<boolean> {
    const result = await this.db
      .prepare('UPDATE users SET totp_secret = NULL, totp_secret_encrypted = NULL, totp_secret_dek = NULL, totp_enabled = 0, totp_skip_password = 0, totp_recovery_keys = NULL, totp_recovery_keys_encrypted = NULL, totp_recovery_keys_dek = NULL WHERE id = ?')
      .bind(id)
      .run();
    return result.success;
  }

  /**
   * Updates the skip-password setting for a user's TOTP configuration.
   */
  async updateTOTPSettings(id: string, skipPassword: boolean): Promise<boolean> {
    const result = await this.db
      .prepare('UPDATE users SET totp_skip_password = ? WHERE id = ?')
      .bind(skipPassword ? 1 : 0, id)
      .run();
    return result.success;
  }

  /**
   * Removes a single used recovery key from the stored hash array.
   */
  async consumeRecoveryKey(id: string, usedIndex: number, currentHashes: string[]): Promise<boolean> {
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

  async updateLastActiveByProfile(profileId: string, now: number): Promise<boolean> {
    const result = await this.db.prepare("UPDATE users SET last_active_at = ? WHERE id = (SELECT owner_id FROM profiles WHERE id = ?)")
      .bind(now, profileId).run();
    return result.success;
  }

  async applyInactivityPolicy(now: number): Promise<{ clearedProfiles: number; deletedUsers: number }> {
    const thirtyDaysAgo = now - (30 * 24 * 3600);
    const ninetyDaysAgo = now - (90 * 24 * 3600);

    // 1. 超过 30 天无解析记录的账户，其所有关联查询日志及 DNS 配置将被自动清理
    const deleteProfilesStmt = this.db.prepare(`
      DELETE FROM profiles 
      WHERE owner_id IN (
        SELECT id FROM users 
        WHERE role = 'user' 
          AND (last_active_at < ? OR (last_active_at IS NULL AND created_at < ?))
      )
    `).bind(thirtyDaysAgo, thirtyDaysAgo);

    // 2. 账户本身在 90 天无登录后将予移除
    const deleteUsersStmt = this.db.prepare(`
      DELETE FROM users
      WHERE role = 'user'
        AND (
          SELECT COALESCE(MAX(timestamp), created_at) 
          FROM user_activity_log 
          WHERE user_id = users.id
        ) < ?
    `).bind(ninetyDaysAgo);

    const results = await this.db.batch([deleteProfilesStmt, deleteUsersStmt]);
    return {
      clearedProfiles: results[0].meta.changes || 0,
      deletedUsers: results[1].meta.changes || 0
    };
  }
}
