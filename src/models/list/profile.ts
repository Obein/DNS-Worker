import { D1Database } from "@cloudflare/workers-types";
import { List, AddListResult, BulkListItem, ToggleProfileListResult } from "./types";
import { normalizeListUrl, parseUnixTimestamp } from "./utils";

/**
 * ListProfileModel manages profile-scoped filter lists (`lists` table),
 * profile-level sync statuses, and effective list resolution combining
 * profile lists and inherited user-level/system-level lists with overrides.
 */
export class ListProfileModel {
  constructor(private readonly db: D1Database) {}

  /**
   * Retrieves all effective lists for a given profile:
   * 1. Profile-level lists (scope: 'profile')
   * 2. User-level and System-level lists (scope: 'user' | 'system') belonging to profile's owner
   *    with per-profile enabled overrides applied.
   *
   * @param profileId - Profile identifier.
   * @returns Array of effective lists.
   */
  async getLists(profileId: string): Promise<List[]> {
    // 1. Fetch Profile-level lists
    const { results: profileRaw } = await this.db.prepare(`
      SELECT 
        l.id, 
        l.profile_id, 
        l.url, 
        l.enabled, 
        COALESCE(l.is_system, 0) AS is_system,
        COALESCE(gm.last_synced_at, l.last_synced_at) AS last_synced_at,
        COALESCE(gm.sync_error, l.sync_error) AS sync_error,
        COALESCE(gm.etag, l.etag) AS etag,
        COALESCE(gm.last_modified, l.last_modified) AS last_modified
      FROM lists l
      LEFT JOIN global_list_metadata gm ON l.url = gm.url
      WHERE l.profile_id = ?
    `).bind(profileId).all<List>();

    const profileLists: List[] = (profileRaw || []).map((item) => ({
      ...item,
      enabled: Boolean(item.enabled),
      scope: "profile" as const,
      last_modified: parseUnixTimestamp(item.last_modified),
    }));

    // 2. Fetch User-level & System-level lists for this profile's owner
    const profileRow = await this.db.prepare(
      "SELECT owner_id FROM profiles WHERE id = ?"
    ).bind(profileId).first<{ owner_id: string }>();

    if (!profileRow?.owner_id) {
      return profileLists;
    }

    const { results: userRaw } = await this.db.prepare(`
      SELECT 
        ul.id AS user_list_id,
        ul.url,
        ul.is_system,
        COALESCE(pulo.enabled, ul.enabled) AS enabled,
        gm.last_synced_at,
        gm.sync_error,
        gm.etag,
        gm.last_modified
      FROM user_lists ul
      LEFT JOIN profile_user_list_overrides pulo 
        ON pulo.user_list_id = ul.id AND pulo.profile_id = ?
      LEFT JOIN global_list_metadata gm 
        ON ul.url = gm.url
      WHERE ul.user_id = ?
      ORDER BY ul.id ASC
    `).bind(profileId, profileRow.owner_id).all<{
      user_list_id: number;
      url: string;
      is_system: number;
      enabled: number;
      last_synced_at: number | null;
      sync_error: string | null;
      etag: string | null;
      last_modified: number | string | null;
    }>();

    const userLists: List[] = (userRaw || []).map((row) => ({
      // Use negative ID to prevent ID collision in UI while keeping unique React keys
      id: -row.user_list_id,
      profile_id: profileId,
      url: row.url,
      enabled: Boolean(row.enabled),
      is_system: row.is_system,
      scope: row.is_system ? ("system" as const) : ("user" as const),
      user_list_id: row.user_list_id,
      last_synced_at: row.last_synced_at ?? undefined,
      sync_error: row.sync_error,
      etag: row.etag,
      last_modified: parseUnixTimestamp(row.last_modified),
    }));

    return [...profileLists, ...userLists];
  }

  /**
   * Adds a profile-level filter list.
   *
   * @param profileId - Profile identifier.
   * @param url - Filter list subscription URL.
   * @param isSystem - True if marked as system list.
   * @returns AddListResult with success status and optional row ID.
   */
  async addList(profileId: string, url: string, isSystem = false): Promise<AddListResult> {
    const canonicalUrl = normalizeListUrl(url);
    const result = await this.db.prepare(
      "INSERT INTO lists (profile_id, url, is_system) VALUES (?, ?, ?)"
    ).bind(profileId, canonicalUrl, isSystem ? 1 : 0).run();
    const lastRowId = result.meta?.last_row_id;
    if (lastRowId && typeof lastRowId === "number" && lastRowId > 0) {
      return { success: result.success, id: lastRowId };
    }
    const inserted = await this.getListByUrl(canonicalUrl, profileId);
    return { success: result.success, id: inserted?.id };
  }

  /**
   * Fetches a list belonging to a profile by URL, or null when absent.
   *
   * @param url - Filter list URL.
   * @param profileId - Profile identifier.
   * @returns List record or null.
   */
  async getListByUrl(url: string, profileId: string): Promise<List | null> {
    const canonicalUrl = normalizeListUrl(url);
    const item = await this.db.prepare(`
      SELECT 
        l.id, 
        l.profile_id, 
        l.url, 
        l.enabled, 
        COALESCE(l.is_system, 0) AS is_system,
        COALESCE(gm.last_synced_at, l.last_synced_at) AS last_synced_at,
        COALESCE(gm.sync_error, l.sync_error) AS sync_error,
        COALESCE(gm.etag, l.etag) AS etag,
        COALESCE(gm.last_modified, l.last_modified) AS last_modified
      FROM lists l
      LEFT JOIN global_list_metadata gm ON l.url = gm.url
      WHERE l.url = ? AND l.profile_id = ?
      ORDER BY l.id DESC LIMIT 1
    `)
      .bind(canonicalUrl, profileId)
      .first<List | null>();

    if (!item) return null;
    return {
      ...item,
      last_modified: parseUnixTimestamp(item.last_modified),
    };
  }

  /**
   * Batch inserts multiple filter list URLs for a profile using D1 batch operations.
   * Chunks execution into batches of up to 100 statements to respect D1 limits.
   *
   * @param profileId - Profile identifier.
   * @param items - Array of filter list URLs or objects with url & enabled status.
   * @returns Total number of lists successfully inserted.
   */
  async addListsBulk(profileId: string, items: BulkListItem[]): Promise<number> {
    if (!items || items.length === 0) return 0;
    const statements = items.map((item) => {
      const rawUrl = typeof item === "string" ? item : item.url;
      const url = normalizeListUrl(rawUrl);
      const enabled = typeof item === "object" && item.enabled !== undefined
        ? (item.enabled ? 1 : 0)
        : 1;
      return this.db.prepare("INSERT INTO lists (profile_id, url, enabled) VALUES (?, ?, ?)").bind(profileId, url, enabled);
    });

    let inserted = 0;
    for (let i = 0; i < statements.length; i += 100) {
      const chunk = statements.slice(i, i + 100);
      const results = await this.db.batch(chunk);
      for (const res of results) {
        if (res.success) inserted += res.meta.changes || 1;
      }
    }
    return inserted;
  }

  /**
   * Enables or disables a list for a profile.
   *
   * @param id - List identifier (negative for user/system list, positive for profile list).
   * @param profileId - Profile identifier.
   * @param enabled - Target enabled state.
   * @returns Promise resolving to boolean success status.
   */
  async setEnabled(id: number, profileId: string, enabled: boolean): Promise<boolean> {
    const res = await this.toggleProfileList(profileId, id, enabled);
    return res.success;
  }

  /**
   * Toggles a list's enabled state for a specific profile.
   * Toggling one will simultaneously toggle any matching URL (Profile-level and User/System-level)
   * for this profile.
   *
   * @param profileId - Profile identifier.
   * @param id - List identifier (negative for user/system list, positive for profile list).
   * @param enabled - Target enabled state.
   * @returns Object indicating success and affected canonical URL.
   */
  async toggleProfileList(
    profileId: string,
    id: number,
    enabled: boolean
  ): Promise<ToggleProfileListResult> {
    const now = Math.floor(Date.now() / 1000);
    let targetUrl: string | null = null;

    if (id < 0) {
      // User or system list ID (-user_list_id)
      const userListId = Math.abs(id);
      const ul = await this.db
        .prepare("SELECT url FROM user_lists WHERE id = ?")
        .bind(userListId)
        .first<{ url: string }>();
      targetUrl = ul?.url ?? null;
    } else {
      // Profile list ID
      const pl = await this.db
        .prepare("SELECT url FROM lists WHERE id = ? AND profile_id = ?")
        .bind(id, profileId)
        .first<{ url: string }>();
      targetUrl = pl?.url ?? null;
    }

    if (!targetUrl) {
      return { success: false };
    }

    const canonicalUrl = normalizeListUrl(targetUrl);
    const intEnabled = enabled ? 1 : 0;

    // 1. Update any Profile-level lists matching this URL
    await this.db
      .prepare("UPDATE lists SET enabled = ? WHERE profile_id = ? AND url = ?")
      .bind(intEnabled, profileId, canonicalUrl)
      .run();

    // 2. Update any User/System-level overrides matching this URL
    const profileRow = await this.db
      .prepare("SELECT owner_id FROM profiles WHERE id = ?")
      .bind(profileId)
      .first<{ owner_id: string }>();

    if (profileRow?.owner_id) {
      const { results: matchingUserLists } = await this.db
        .prepare("SELECT id FROM user_lists WHERE user_id = ? AND url = ?")
        .bind(profileRow.owner_id, canonicalUrl)
        .all<{ id: number }>();

      for (const mul of matchingUserLists || []) {
        await this.db
          .prepare(
            `INSERT INTO profile_user_list_overrides (profile_id, user_list_id, enabled, updated_at)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(profile_id, user_list_id) DO UPDATE SET
               enabled = excluded.enabled,
               updated_at = excluded.updated_at`
          )
          .bind(profileId, mul.id, intEnabled, now)
          .run();
      }
    }

    return { success: true, affectedUrl: canonicalUrl };
  }

  /**
   * Fetches a single list belonging to a profile or inherited from user_lists, or null when absent.
   *
   * @param id - List identifier (negative for user/system list, positive for profile list).
   * @param profileId - Profile identifier.
   * @returns List record or null.
   */
  async getListById(id: number, profileId: string): Promise<List | null> {
    if (id < 0) {
      const userListId = Math.abs(id);
      const profileRow = await this.db
        .prepare("SELECT owner_id FROM profiles WHERE id = ?")
        .bind(profileId)
        .first<{ owner_id: string }>();
      if (!profileRow?.owner_id) return null;

      const row = await this.db
        .prepare(
          `SELECT 
            ul.id AS user_list_id,
            ul.url,
            ul.is_system,
            COALESCE(pulo.enabled, ul.enabled) AS enabled,
            gm.last_synced_at,
            gm.sync_error,
            gm.etag,
            gm.last_modified
          FROM user_lists ul
          LEFT JOIN profile_user_list_overrides pulo 
            ON pulo.user_list_id = ul.id AND pulo.profile_id = ?
          LEFT JOIN global_list_metadata gm 
            ON ul.url = gm.url
          WHERE ul.id = ? AND ul.user_id = ?`
        )
        .bind(profileId, userListId, profileRow.owner_id)
        .first<{
          user_list_id: number;
          url: string;
          is_system: number;
          enabled: number;
          last_synced_at: number | null;
          sync_error: string | null;
          etag: string | null;
          last_modified: number | string | null;
        }>();

      if (!row) return null;
      return {
        id: -row.user_list_id,
        profile_id: profileId,
        url: row.url,
        enabled: Boolean(row.enabled),
        is_system: row.is_system,
        scope: row.is_system ? ("system" as const) : ("user" as const),
        user_list_id: row.user_list_id,
        last_synced_at: row.last_synced_at ?? undefined,
        sync_error: row.sync_error,
        etag: row.etag,
        last_modified: parseUnixTimestamp(row.last_modified),
      };
    }

    return await this.db
      .prepare(
        `SELECT 
          l.id, 
          l.profile_id, 
          l.url, 
          l.enabled, 
          COALESCE(l.is_system, 0) AS is_system,
          COALESCE(gm.last_synced_at, l.last_synced_at) AS last_synced_at,
          COALESCE(gm.sync_error, l.sync_error) AS sync_error,
          COALESCE(gm.etag, l.etag) AS etag,
          COALESCE(gm.last_modified, l.last_modified) AS last_modified
        FROM lists l
        LEFT JOIN global_list_metadata gm ON l.url = gm.url
        WHERE l.id = ? AND l.profile_id = ?`
      )
      .bind(id, profileId)
      .first<List | null>();
  }

  /**
   * Deletes a profile-level filter list by ID.
   *
   * @param id - Profile list ID.
   * @param profileId - Profile identifier.
   * @returns Boolean indicating deletion success.
   */
  async deleteList(id: number, profileId: string): Promise<boolean> {
    const result = await this.db
      .prepare("DELETE FROM lists WHERE id = ? AND profile_id = ?")
      .bind(id, profileId)
      .run();
    return result.success;
  }

  /**
   * Updates list sync status, including optional ETag and Last-Modified caching headers.
   * If enabled is null or undefined, the current enabled status in the database is preserved.
   *
   * @param id - Profile list ID.
   * @param now - Sync timestamp.
   * @param enabled - Optional enabled override.
   * @param syncError - Optional sync error message.
   * @param etag - Optional ETag header.
   * @param lastModified - Optional Last-Modified header.
   * @returns Boolean indicating success.
   */
  async updateListSyncStatus(
    id: number,
    now: number | null,
    enabled?: number | null,
    syncError: string | null = null,
    etag?: string | null,
    lastModified?: number | string | null
  ): Promise<boolean> {
    const fields: string[] = ["last_synced_at = ?", "sync_error = ?"];
    const params: unknown[] = [now, syncError];

    if (enabled !== undefined && enabled !== null) {
      fields.push("enabled = ?");
      params.push(enabled);
    }
    if (etag !== undefined) {
      fields.push("etag = ?");
      params.push(etag);
    }
    if (lastModified !== undefined) {
      fields.push("last_modified = ?");
      params.push(parseUnixTimestamp(lastModified));
    }

    params.push(id);
    const sql = `UPDATE lists SET ${fields.join(", ")} WHERE id = ?`;
    const result = await this.db.prepare(sql).bind(...params).run();
    return result.success;
  }

  /**
   * Resets the sync timestamp for all lists belonging to a profile to 0.
   *
   * @param profileId - Profile identifier.
   * @returns Boolean indicating success.
   */
  async resetListSyncStatus(profileId: string): Promise<boolean> {
    const result = await this.db
      .prepare("UPDATE lists SET last_synced_at = 0 WHERE profile_id = ?")
      .bind(profileId)
      .run();
    return result.success;
  }
}
