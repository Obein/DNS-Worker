import { D1Database } from "@cloudflare/workers-types";
import { UserList, AddListResult } from "./types";
import { normalizeListUrl, parseUnixTimestamp } from "./utils";

/**
 * ListUserModel manages user-level filter lists (`user_lists` table),
 * scoped to individual user accounts and inherited across their profiles.
 */
export class ListUserModel {
  constructor(private readonly db: D1Database) {}

  /**
   * Retrieves all user-level and system-level lists for a user.
   *
   * @param userId - User identifier.
   * @returns Array of UserList items.
   */
  async getUserLists(userId: string): Promise<UserList[]> {
    const { results } = await this.db
      .prepare(
        `SELECT 
          ul.id,
          ul.user_id,
          ul.url,
          ul.is_system,
          ul.enabled,
          ul.created_at,
          gm.last_synced_at,
          gm.sync_error,
          gm.etag,
          gm.last_modified
        FROM user_lists ul
        LEFT JOIN global_list_metadata gm ON ul.url = gm.url
        WHERE ul.user_id = ?
        ORDER BY ul.created_at ASC, ul.id ASC`
      )
      .bind(userId)
      .all<{
        id: number;
        user_id: string;
        url: string;
        is_system: number;
        enabled: number;
        created_at: number;
        last_synced_at: number | null;
        sync_error: string | null;
        etag: string | null;
        last_modified: number | string | null;
      }>();

    return (results || []).map((row) => ({
      id: row.id,
      user_id: row.user_id,
      url: row.url,
      is_system: row.is_system,
      enabled: Boolean(row.enabled),
      created_at: row.created_at,
      last_synced_at: row.last_synced_at ?? null,
      sync_error: row.sync_error ?? null,
      etag: row.etag ?? null,
      last_modified: parseUnixTimestamp(row.last_modified),
    }));
  }

  /**
   * Adds a new user-level or system-level list for a user.
   *
   * @param userId - User identifier.
   * @param url - Filter list URL.
   * @param isSystem - True if marked as system list.
   * @returns AddListResult with success status and optional row ID.
   */
  async addUserList(
    userId: string,
    url: string,
    isSystem = false
  ): Promise<AddListResult> {
    const canonicalUrl = normalizeListUrl(url);
    const now = Math.floor(Date.now() / 1000);
    const result = await this.db
      .prepare(
        `INSERT INTO user_lists (user_id, url, is_system, enabled, created_at)
         VALUES (?, ?, ?, 1, ?)`
      )
      .bind(userId, canonicalUrl, isSystem ? 1 : 0, now)
      .run();

    const lastRowId = result.meta?.last_row_id;
    if (lastRowId && typeof lastRowId === "number" && lastRowId > 0) {
      return { success: result.success, id: lastRowId };
    }
    const inserted = await this.getUserListByUrl(canonicalUrl, userId);
    return { success: result.success, id: inserted?.id };
  }

  /**
   * Fetches a user list by URL and user ID.
   *
   * @param url - Filter list URL.
   * @param userId - User identifier.
   * @returns UserList record or null.
   */
  async getUserListByUrl(url: string, userId: string): Promise<UserList | null> {
    const canonicalUrl = normalizeListUrl(url);
    const row = await this.db
      .prepare(
        `SELECT 
          ul.id,
          ul.user_id,
          ul.url,
          ul.is_system,
          ul.enabled,
          ul.created_at,
          gm.last_synced_at,
          gm.sync_error,
          gm.etag,
          gm.last_modified
        FROM user_lists ul
        LEFT JOIN global_list_metadata gm ON ul.url = gm.url
        WHERE ul.user_id = ? AND ul.url = ?
        LIMIT 1`
      )
      .bind(userId, canonicalUrl)
      .first<{
        id: number;
        user_id: string;
        url: string;
        is_system: number;
        enabled: number;
        created_at: number;
        last_synced_at: number | null;
        sync_error: string | null;
        etag: string | null;
        last_modified: number | string | null;
      }>();

    if (!row) return null;
    return {
      id: row.id,
      user_id: row.user_id,
      url: row.url,
      is_system: row.is_system,
      enabled: Boolean(row.enabled),
      created_at: row.created_at,
      last_synced_at: row.last_synced_at ?? null,
      sync_error: row.sync_error ?? null,
      etag: row.etag ?? null,
      last_modified: parseUnixTimestamp(row.last_modified),
    };
  }

  /**
   * Fetches a user list by ID and user ID.
   *
   * @param id - User list ID.
   * @param userId - User identifier.
   * @returns UserList record or null.
   */
  async getUserListById(id: number, userId: string): Promise<UserList | null> {
    const row = await this.db
      .prepare(
        `SELECT 
          ul.id,
          ul.user_id,
          ul.url,
          ul.is_system,
          ul.enabled,
          ul.created_at,
          gm.last_synced_at,
          gm.sync_error,
          gm.etag,
          gm.last_modified
        FROM user_lists ul
        LEFT JOIN global_list_metadata gm ON ul.url = gm.url
        WHERE ul.id = ? AND ul.user_id = ?
        LIMIT 1`
      )
      .bind(id, userId)
      .first<{
        id: number;
        user_id: string;
        url: string;
        is_system: number;
        enabled: number;
        created_at: number;
        last_synced_at: number | null;
        sync_error: string | null;
        etag: string | null;
        last_modified: number | string | null;
      }>();

    if (!row) return null;
    return {
      id: row.id,
      user_id: row.user_id,
      url: row.url,
      is_system: row.is_system,
      enabled: Boolean(row.enabled),
      created_at: row.created_at,
      last_synced_at: row.last_synced_at ?? null,
      sync_error: row.sync_error ?? null,
      etag: row.etag ?? null,
      last_modified: parseUnixTimestamp(row.last_modified),
    };
  }

  /**
   * Deletes a user-created filter list (is_system = 0).
   * System lists cannot be deleted by individual users.
   *
   * @param id - User list ID.
   * @param userId - User identifier.
   * @returns Boolean indicating deletion success.
   */
  async deleteUserList(id: number, userId: string): Promise<boolean> {
    const result = await this.db
      .prepare("DELETE FROM user_lists WHERE id = ? AND user_id = ? AND is_system = 0")
      .bind(id, userId)
      .run();
    return result.success;
  }

  /**
   * Toggles the global enabled state of a user-level list.
   *
   * @param id - User list ID.
   * @param userId - User identifier.
   * @param enabled - Target enabled state.
   * @returns Boolean indicating update success.
   */
  async toggleUserList(id: number, userId: string, enabled: boolean): Promise<boolean> {
    const result = await this.db
      .prepare("UPDATE user_lists SET enabled = ? WHERE id = ? AND user_id = ?")
      .bind(enabled ? 1 : 0, id, userId)
      .run();
    return result.success;
  }

  /**
   * Checks if a user already has a specific list URL in user_lists.
   *
   * @param userId - User identifier.
   * @param url - Filter list URL.
   * @returns Boolean indicating existence.
   */
  async hasListForUser(userId: string, url: string): Promise<boolean> {
    const canonicalUrl = normalizeListUrl(url);
    const row = await this.db
      .prepare("SELECT 1 FROM user_lists WHERE user_id = ? AND url = ? LIMIT 1")
      .bind(userId, canonicalUrl)
      .first<{ 1: number }>();
    return row !== null;
  }
}
