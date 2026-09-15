import { D1Database } from "@cloudflare/workers-types";
import { User } from "../../types";
import { UserRecord, CreateUserOptions } from "./types";
import { UserSecretProcessor } from "./secrets";

/**
 * Handles core user entity lifecycle, querying, profile attributes, and CRUD operations.
 *
 * Single Responsibility: User identity entity persistence and profile metadata management.
 */
export class UserCoreModel {
  constructor(
    private db: D1Database,
    private secretProcessor: UserSecretProcessor
  ) {}

  /**
   * Retrieves a user by their unique identifier.
   * Transparently decrypts/migrates envelope-encrypted secrets if present.
   *
   * @param id The user ID.
   * @returns The user record with decrypted secrets, or null if not found.
   */
  async getById(id: string): Promise<UserRecord | null> {
    const user = await this.db.prepare("SELECT * FROM users WHERE id = ?").bind(id).first<UserRecord>();
    return await this.secretProcessor.processUserSecrets(user);
  }

  /**
   * Retrieves a user by their username.
   * Transparently decrypts/migrates envelope-encrypted secrets if present.
   *
   * @param username The username.
   * @returns The user record with decrypted secrets, or null if not found or table doesn't exist.
   */
  async getByUsername(username: string): Promise<UserRecord | null> {
    try {
      const user = await this.db.prepare("SELECT * FROM users WHERE username = ?").bind(username).first<UserRecord>();
      return await this.secretProcessor.processUserSecrets(user);
    } catch (e: unknown) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      if (errorMsg.includes("no such table")) {
        return null;
      }
      throw e;
    }
  }

  /**
   * Lists all users in the system, ordered by creation date descending.
   *
   * @returns Array of user summary entities.
   */
  async listAll(): Promise<User[]> {
    const { results } = await this.db.prepare(`
      SELECT 
        u.id, 
        u.username, 
        u.role, 
        u.created_at, 
        u.totp_enabled,
        (SELECT COUNT(1) FROM passkeys p WHERE p.user_id = u.id) as passkeys_count,
        u.timezone,
        u.locale,
        u.last_active_at as last_resolve_at
      FROM users u
      ORDER BY u.created_at DESC
    `).all<User>();
    return results;
  }

  /**
   * Registers a new user in the database.
   *
   * @param user Options containing ID, username, password hash, role, timezone, etc.
   * @returns True if insertion succeeded.
   */
  async create(user: CreateUserOptions): Promise<boolean> {
    const now = Math.floor(Date.now() / 1000);
    const result = await this.db.prepare(
      "INSERT INTO users (id, username, hashed_password, role, created_at, timezone, locale, password_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(
      user.id,
      user.username,
      user.passwordHash,
      user.role,
      now,
      user.timezone || null,
      user.locale || 'en-US',
      user.passwordVersion ?? 2
    ).run();
    return result.success;
  }

  /**
   * Updates the username of a specified user.
   *
   * @param id The user ID.
   * @param username The new username.
   * @returns True if update succeeded.
   */
  async updateUsername(id: string, username: string): Promise<boolean> {
    const result = await this.db.prepare("UPDATE users SET username = ? WHERE id = ?").bind(username, id).run();
    return result.success;
  }

  /**
   * Updates the preferred timezone of a user.
   *
   * @param id The user ID.
   * @param timezone The timezone string (e.g. 'Asia/Shanghai') or null.
   * @returns True if update succeeded.
   */
  async updateTimezone(id: string, timezone: string | null): Promise<boolean> {
    const result = await this.db.prepare("UPDATE users SET timezone = ? WHERE id = ?").bind(timezone, id).run();
    return result.success;
  }

  /**
   * Updates the preferred UI locale of a user.
   *
   * @param id The user ID.
   * @param locale The locale code (e.g. 'zh-CN', 'en-US') or null.
   * @returns True if update succeeded.
   */
  async updateLocale(id: string, locale: string | null): Promise<boolean> {
    const result = await this.db.prepare("UPDATE users SET locale = ? WHERE id = ?").bind(locale || 'en-US', id).run();
    return result.success;
  }

  /**
   * Deletes a user account by their ID.
   *
   * @param id The user ID.
   * @returns True if deletion succeeded.
   */
  async delete(id: string): Promise<boolean> {
    const result = await this.db.prepare("DELETE FROM users WHERE id = ?").bind(id).run();
    return result.success;
  }

  /**
   * Checks whether the users table is completely empty (no users registered).
   *
   * Security consideration (CWE-636 Fail-Closed):
   * When the query fails, we must NEVER assume the database is empty, as that
   * could lead to privilege escalation (e.g. assigning 'admin' role to new signups).
   *
   * @returns True if there are confirmed 0 users in the database, false otherwise.
   */
  async isEmpty(): Promise<boolean> {
    try {
      const count = await this.db.prepare("SELECT COUNT(*) as count FROM users").first<number>('count');
      return (count ?? 0) === 0;
    } catch (err) {
      console.error("[UserModel] isEmpty: query failed, failing closed (assuming users exist):", err);
      return false;
    }
  }
}
