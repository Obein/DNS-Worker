import { D1Database } from "@cloudflare/workers-types";
import { User } from "../types";

export class UserModel {
  constructor(private db: D1Database) {}

  async getById(id: string): Promise<any | null> {
    return await this.db.prepare("SELECT * FROM users WHERE id = ?").bind(id).first();
  }

  async getByUsername(username: string): Promise<any | null> {
    return await this.db.prepare("SELECT * FROM users WHERE username = ?").bind(username).first();
  }

  async listAll(): Promise<User[]> {
    const { results } = await this.db.prepare("SELECT id, username, role, created_at FROM users ORDER BY created_at DESC").all<User>();
    return results;
  }

  async create(user: { id: string, username: string, passwordHash: string, role: string }): Promise<boolean> {
    const now = Math.floor(Date.now() / 1000);
    const result = await this.db.prepare(
      "INSERT INTO users (id, username, hashed_password, role, created_at) VALUES (?, ?, ?, ?, ?)"
    ).bind(user.id, user.username, user.passwordHash, user.role, now).run();
    return result.success;
  }

  async updateUsername(id: string, username: string): Promise<boolean> {
    const result = await this.db.prepare("UPDATE users SET username = ? WHERE id = ?").bind(username, id).run();
    return result.success;
  }

  async updatePassword(id: string, passwordHash: string): Promise<boolean> {
    const result = await this.db.prepare("UPDATE users SET hashed_password = ? WHERE id = ?").bind(passwordHash, id).run();
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
   * Activates TOTP for a user by storing the encrypted secret and hashed recovery keys.
   * @param id - User ID
   * @param secret - Base32 TOTP secret
   * @param recoveryKeysHashed - JSON array of SHA-256-hashed recovery keys
   */
  async updateTOTP(id: string, secret: string, recoveryKeysHashed: string[]): Promise<boolean> {
    const result = await this.db
      .prepare('UPDATE users SET totp_secret = ?, totp_enabled = 1, totp_skip_password = 1, totp_recovery_keys = ? WHERE id = ?')
      .bind(secret, JSON.stringify(recoveryKeysHashed), id)
      .run();
    return result.success;
  }

  /**
   * Disables TOTP and clears all TOTP-related data for a user.
   * @param id - User ID
   */
  async removeTOTP(id: string): Promise<boolean> {
    const result = await this.db
      .prepare('UPDATE users SET totp_secret = NULL, totp_enabled = 0, totp_skip_password = 0, totp_recovery_keys = NULL WHERE id = ?')
      .bind(id)
      .run();
    return result.success;
  }

  /**
   * Updates the skip-password setting for a user's TOTP configuration.
   * @param id - User ID
   * @param skipPassword - Whether to skip password during login
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
   * @param id - User ID
   * @param usedIndex - Index of the consumed key to remove
   * @param currentHashes - Current full array of hashed recovery keys
   */
  async consumeRecoveryKey(id: string, usedIndex: number, currentHashes: string[]): Promise<boolean> {
    const updated = currentHashes.filter((_, i) => i !== usedIndex);
    const result = await this.db
      .prepare('UPDATE users SET totp_recovery_keys = ? WHERE id = ?')
      .bind(JSON.stringify(updated), id)
      .run();
    return result.success;
  }

  async updateLastActiveByProfile(profileId: string, now: number): Promise<boolean> {
    const result = await this.db.prepare("UPDATE users SET last_active_at = ? WHERE id = (SELECT owner_id FROM profiles WHERE id = ?)")
      .bind(now, profileId).run();
    return result.success;
  }

  async cleanupInactiveUsers(threshold: number): Promise<boolean> {
    const result = await this.db.prepare("DELETE FROM users WHERE role = 'user' AND last_active_at < ?").bind(threshold).run();
    return result.success;
  }
}
