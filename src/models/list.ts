import { D1Database } from "@cloudflare/workers-types";
import { List, UserList } from "../types";

export class ListModel {
  constructor(private db: D1Database) {}

  /**
   * Normalizes a blocklist URL for canonical indexing.
   */
  static normalizeUrl(url: string): string {
    return url.trim().replace(/\/+$/, "");
  }

  /**
   * Retrieves all effective lists for a given profile:
   * 1. Profile-level lists (scope: 'profile')
   * 2. User-level and System-level lists (scope: 'user' | 'system') belonging to profile's owner
   *    with per-profile enabled overrides applied.
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
      last_modified:
        typeof item.last_modified === "number"
          ? Math.floor(item.last_modified)
          : typeof item.last_modified === "string" && !isNaN(Date.parse(item.last_modified))
          ? Math.floor(Date.parse(item.last_modified) / 1000)
          : null,
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
      last_modified:
        typeof row.last_modified === "number"
          ? Math.floor(row.last_modified)
          : typeof row.last_modified === "string" && !isNaN(Date.parse(row.last_modified))
          ? Math.floor(Date.parse(row.last_modified) / 1000)
          : null,
    }));

    return [...profileLists, ...userLists];
  }

  async addList(profileId: string, url: string, isSystem = false): Promise<{ success: boolean; id?: number }> {
    const canonicalUrl = ListModel.normalizeUrl(url);
    const result = await this.db.prepare(
      "INSERT INTO lists (profile_id, url, is_system) VALUES (?, ?, ?)"
    ).bind(profileId, canonicalUrl, isSystem ? 1 : 0).run();
    const lastRowId = result.meta?.last_row_id;
    if (lastRowId && typeof lastRowId === 'number' && lastRowId > 0) {
      return { success: result.success, id: lastRowId };
    }
    const inserted = await this.getListByUrl(canonicalUrl, profileId);
    return { success: result.success, id: inserted?.id };
  }

  /** Fetches a list belonging to a profile by URL, or null when absent. */
  async getListByUrl(url: string, profileId: string): Promise<List | null> {
    const canonicalUrl = ListModel.normalizeUrl(url);
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
      last_modified: typeof item.last_modified === 'number'
        ? Math.floor(item.last_modified)
        : (typeof item.last_modified === 'string' && !isNaN(Date.parse(item.last_modified))
          ? Math.floor(Date.parse(item.last_modified) / 1000)
          : null)
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
  async addListsBulk(profileId: string, items: (string | { url: string; enabled?: number | boolean })[]): Promise<number> {
    if (!items || items.length === 0) return 0;
    const statements = items.map(item => {
      const rawUrl = typeof item === 'string' ? item : item.url;
      const url = ListModel.normalizeUrl(rawUrl);
      const enabled = (typeof item === 'object' && item.enabled !== undefined)
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
   * Enables or disables a list without deleting it. Disabled lists are skipped
   * by the sync orchestrator and excluded when the merged profile bloom is
   * rebuilt, so toggling one off removes its domains from filtering while
   * keeping the subscription and its sync history.
   */
  /**
   * Toggles a list's enabled state for a specific profile.
   * Requirement: "Profile (配置) 级列表和用户/系统级列表允许重复，Profile 中停用时同时停用 Profile 级列表和用户/系统级列表。"
   * Toggling one will simultaneously toggle any matching URL (Profile-level and User/System-level)
   * for this profile.
   */
  async setEnabled(id: number, profileId: string, enabled: boolean): Promise<boolean> {
    const res = await this.toggleProfileList(profileId, id, enabled);
    return res.success;
  }

  async toggleProfileList(
    profileId: string,
    id: number,
    enabled: boolean
  ): Promise<{ success: boolean; affectedUrl?: string }> {
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

    const canonicalUrl = ListModel.normalizeUrl(targetUrl);
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

  /** Fetches a single list belonging to a profile or inherited from user_lists, or null when absent. */
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
        last_modified:
          typeof row.last_modified === "number"
            ? Math.floor(row.last_modified)
            : typeof row.last_modified === "string" && !isNaN(Date.parse(row.last_modified))
            ? Math.floor(Date.parse(row.last_modified) / 1000)
            : null,
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
   * Retrieves all user-level and system-level lists for a user.
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
      .all<any>();

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
      last_modified:
        typeof row.last_modified === "number"
          ? Math.floor(row.last_modified)
          : typeof row.last_modified === "string" && !isNaN(Date.parse(row.last_modified))
          ? Math.floor(Date.parse(row.last_modified) / 1000)
          : null,
    }));
  }

  async addUserList(
    userId: string,
    url: string,
    isSystem = false
  ): Promise<{ success: boolean; id?: number }> {
    const canonicalUrl = ListModel.normalizeUrl(url);
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

  async getUserListByUrl(url: string, userId: string): Promise<UserList | null> {
    const canonicalUrl = ListModel.normalizeUrl(url);
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
      .first<any>();

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
      last_modified:
        typeof row.last_modified === "number"
          ? Math.floor(row.last_modified)
          : typeof row.last_modified === "string" && !isNaN(Date.parse(row.last_modified))
          ? Math.floor(Date.parse(row.last_modified) / 1000)
          : null,
    };
  }

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
      .first<any>();

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
      last_modified:
        typeof row.last_modified === "number"
          ? Math.floor(row.last_modified)
          : typeof row.last_modified === "string" && !isNaN(Date.parse(row.last_modified))
          ? Math.floor(Date.parse(row.last_modified) / 1000)
          : null,
    };
  }

  async deleteUserList(id: number, userId: string): Promise<boolean> {
    // Only user-created lists (is_system = 0) can be deleted by users
    const result = await this.db
      .prepare("DELETE FROM user_lists WHERE id = ? AND user_id = ? AND is_system = 0")
      .bind(id, userId)
      .run();
    return result.success;
  }

  async toggleUserList(id: number, userId: string, enabled: boolean): Promise<boolean> {
    const result = await this.db
      .prepare("UPDATE user_lists SET enabled = ? WHERE id = ? AND user_id = ?")
      .bind(enabled ? 1 : 0, id, userId)
      .run();
    return result.success;
  }

  /**
   * Checks if a user already has a specific list URL in user_lists.
   */
  async hasListForUser(userId: string, url: string): Promise<boolean> {
    const canonicalUrl = ListModel.normalizeUrl(url);
    const row = await this.db
      .prepare("SELECT 1 FROM user_lists WHERE user_id = ? AND url = ? LIMIT 1")
      .bind(userId, canonicalUrl)
      .first<{ 1: number }>();
    return row !== null;
  }

  /**
   * Distributes a system-level filter list to all users in the system as a user-level list.
   * If a user already has this list URL in user_lists, they are skipped.
   * Even users with 0 profiles are successfully added!
   */
  async distributeListToAllUsers(url: string): Promise<{
    canonicalUrl: string;
    totalUsers: number;
    addedCount: number;
    skippedCount: number;
    failedCount: number;
    addedUsernames: string[];
    skippedUsernames: string[];
    failedUsernames: string[];
    affectedProfileIds: string[];
  }> {
    const canonicalUrl = ListModel.normalizeUrl(url);
    const now = Math.floor(Date.now() / 1000);
    const { results: users } = await this.db
      .prepare("SELECT id, username FROM users ORDER BY created_at ASC")
      .all<{ id: string; username: string }>();

    let addedCount = 0;
    let skippedCount = 0;
    const addedUsernames: string[] = [];
    const skippedUsernames: string[] = [];
    const affectedProfileIds: string[] = [];

    for (const user of users) {
      const alreadyHas = await this.hasListForUser(user.id, canonicalUrl);
      if (alreadyHas) {
        skippedCount++;
        skippedUsernames.push(user.username);
        continue;
      }

      await this.db
        .prepare(
          `INSERT INTO user_lists (user_id, url, is_system, enabled, created_at)
           VALUES (?, ?, 1, 1, ?)`
        )
        .bind(user.id, canonicalUrl, now)
        .run();

      const { results: profiles } = await this.db
        .prepare("SELECT id FROM profiles WHERE owner_id = ?")
        .bind(user.id)
        .all<{ id: string }>();

      for (const profile of profiles || []) {
        affectedProfileIds.push(profile.id);
      }

      addedCount++;
      addedUsernames.push(user.username);
    }

    return {
      canonicalUrl,
      totalUsers: users.length,
      addedCount,
      skippedCount,
      failedCount: 0,
      addedUsernames,
      skippedUsernames,
      failedUsernames: [],
      affectedProfileIds,
    };
  }

  async deleteList(id: number, profileId: string): Promise<boolean> {
    const result = await this.db
      .prepare("DELETE FROM lists WHERE id = ? AND profile_id = ?")
      .bind(id, profileId)
      .run();
    return result.success;
  }

  /**
   * Returns all filter list URLs currently active with is_system = 1 in user_lists,
   * along with the counts of affected profiles and users.
   */
  async getDistributedSystemLists(): Promise<{
    url: string;
    profileCount: number;
    userCount: number;
    usernames: string[];
  }[]> {
    const { results } = await this.db
      .prepare(
        `SELECT 
          ul.url,
          COUNT(DISTINCT p.id) AS profile_count,
          COUNT(DISTINCT ul.user_id) AS user_count,
          GROUP_CONCAT(DISTINCT u.username) AS usernames
        FROM user_lists ul
        JOIN users u ON ul.user_id = u.id
        LEFT JOIN profiles p ON p.owner_id = ul.user_id
        WHERE ul.is_system = 1
        GROUP BY ul.url
        ORDER BY ul.url ASC`
      )
      .all<{
        url: string;
        profile_count: number;
        user_count: number;
        usernames: string | null;
      }>();

    return (results || []).map((row) => ({
      url: row.url,
      profileCount: Number(row.profile_count) || 0,
      userCount: Number(row.user_count) || 0,
      usernames: row.usernames ? row.usernames.split(",").filter(Boolean) : [],
    }));
  }

  /**
   * Revokes a system-distributed filter list across all users where is_system = 1.
   * Does NOT touch lists where is_system = 0 (user-created lists).
   */
  async revokeSystemList(url: string): Promise<{
    canonicalUrl: string;
    revokedCount: number;
    revokedProfilesCount: number;
    affectedProfilesCount: number;
    affectedUserCount: number;
    affectedProfileIds: string[];
    affectedUsernames: string[];
  }> {
    const canonicalUrl = ListModel.normalizeUrl(url);

    // 1. Identify all profiles and users where this list has is_system = 1
    const { results } = await this.db
      .prepare(
        `SELECT DISTINCT p.id AS profile_id, u.username
        FROM user_lists ul
        JOIN users u ON ul.user_id = u.id
        LEFT JOIN profiles p ON p.owner_id = ul.user_id
        WHERE ul.url = ? AND ul.is_system = 1`
      )
      .bind(canonicalUrl)
      .all<{ profile_id: string | null; username: string }>();

    const affectedProfileIds = Array.from(
      new Set(
        (results || [])
          .map((r) => r.profile_id)
          .filter((id): id is string => Boolean(id))
      )
    );
    const affectedUsernames = Array.from(new Set((results || []).map((r) => r.username)));

    // 2. Delete the system-distributed list records (strictly where is_system = 1)
    const deleteResult = await this.db
      .prepare("DELETE FROM user_lists WHERE url = ? AND is_system = 1")
      .bind(canonicalUrl)
      .run();

    return {
      canonicalUrl,
      revokedCount: deleteResult.meta?.changes || affectedUsernames.length,
      revokedProfilesCount: affectedProfileIds.length,
      affectedProfilesCount: affectedProfileIds.length,
      affectedUserCount: affectedUsernames.length,
      affectedProfileIds,
      affectedUsernames,
    };
  }

  /**
   * Updates list sync status, including optional ETag and Last-Modified caching headers.
   * If enabled is null or undefined, the current enabled status in the database is preserved.
   * lastModified is normalized to an integer Unix timestamp in seconds.
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
    const params: any[] = [now, syncError];

    if (enabled !== undefined && enabled !== null) {
      fields.push("enabled = ?");
      params.push(enabled);
    }
    if (etag !== undefined) {
      fields.push("etag = ?");
      params.push(etag);
    }
    if (lastModified !== undefined) {
      let normalizedLastModified: number | null = null;
      if (lastModified !== null) {
        if (typeof lastModified === "number") {
          normalizedLastModified = Math.floor(lastModified);
        } else {
          const parsed = Date.parse(lastModified);
          normalizedLastModified = isNaN(parsed) ? null : Math.floor(parsed / 1000);
        }
      }
      fields.push("last_modified = ?");
      params.push(normalizedLastModified);
    }

    params.push(id);
    const sql = `UPDATE lists SET ${fields.join(", ")} WHERE id = ?`;
    const result = await this.db.prepare(sql).bind(...params).run();
    return result.success;
  }

  async resetListSyncStatus(profileId: string): Promise<boolean> {
    const result = await this.db.prepare(
      "UPDATE lists SET last_synced_at = 0 WHERE profile_id = ?"
    )
      .bind(profileId)
      .run();
    return result.success;
  }

  /**
   * Retrieves global metadata for a given canonical blocklist URL.
   * Ensures last_modified is returned as an integer Unix timestamp in seconds.
   */
  async getGlobalListMetadata(url: string): Promise<{
    url: string;
    etag: string | null;
    last_modified: number | null;
    last_synced_at: number | null;
    sync_error: string | null;
  } | null> {
    const canonicalUrl = ListModel.normalizeUrl(url);
    const row = await this.db
      .prepare("SELECT * FROM global_list_metadata WHERE url = ?")
      .bind(canonicalUrl)
      .first<{
        url: string;
        etag: string | null;
        last_modified: number | string | null;
        last_synced_at: number | null;
        sync_error: string | null;
      }>();
    if (!row) return null;

    let lm: number | null = null;
    if (row.last_modified !== null && row.last_modified !== undefined) {
      if (typeof row.last_modified === "number") {
        lm = Math.floor(row.last_modified);
      } else {
        const parsed = Date.parse(row.last_modified);
        lm = isNaN(parsed) ? null : Math.floor(parsed / 1000);
      }
    }

    return {
      url: row.url,
      etag: row.etag,
      last_modified: lm,
      last_synced_at: row.last_synced_at,
      sync_error: row.sync_error,
    };
  }

  /**
   * Upserts global metadata for a given canonical blocklist URL.
   * Strictly normalizes lastModified to an integer Unix timestamp in seconds.
   */
  async updateGlobalListMetadata(
    url: string,
    now: number,
    etag?: string | null,
    lastModified?: number | string | null,
    syncError: string | null = null
  ): Promise<boolean> {
    const canonicalUrl = ListModel.normalizeUrl(url);
    let normalizedLastModified: number | null = null;
    if (lastModified !== undefined && lastModified !== null) {
      if (typeof lastModified === "number") {
        normalizedLastModified = Math.floor(lastModified);
      } else {
        const parsed = Date.parse(lastModified);
        normalizedLastModified = isNaN(parsed) ? null : Math.floor(parsed / 1000);
      }
    }

    const result = await this.db.prepare(`
      INSERT INTO global_list_metadata (url, etag, last_modified, last_synced_at, sync_error, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(url) DO UPDATE SET
        etag = COALESCE(excluded.etag, global_list_metadata.etag),
        last_modified = COALESCE(excluded.last_modified, global_list_metadata.last_modified),
        last_synced_at = excluded.last_synced_at,
        sync_error = excluded.sync_error
    `).bind(canonicalUrl, etag || null, normalizedLastModified, now, syncError || null, now).run();
    return result.success;
  }

  /**
   * Returns distinct active URLs across all profiles and users that need synchronization.
   */
  async getDistinctActiveUrls(cutoffTime?: number, limit: number = 10): Promise<string[]> {
    let query = `
      SELECT DISTINCT active_urls.url
      FROM (
        SELECT url FROM lists WHERE enabled = 1
        UNION
        SELECT url FROM user_lists WHERE enabled = 1
      ) active_urls
      LEFT JOIN global_list_metadata gm ON active_urls.url = gm.url
    `;
    const params: (number | null)[] = [];
    if (cutoffTime !== undefined) {
      query += ` WHERE (gm.last_synced_at IS NULL OR gm.last_synced_at < ?)`;
      params.push(cutoffTime);
    }
    query += ` ORDER BY COALESCE(gm.last_synced_at, 0) ASC LIMIT ?`;
    params.push(limit);

    const { results } = await this.db.prepare(query).bind(...params).all<{ url: string }>();
    return (results || []).map((r) => r.url);
  }

  /**
   * Retrieves all profile IDs that subscribe to a given list URL and have it enabled.
   */
  async getProfilesSubscribingToUrl(url: string): Promise<string[]> {
    const canonicalUrl = ListModel.normalizeUrl(url);

    // 1. Direct profile lists
    const { results: r1 } = await this.db
      .prepare("SELECT DISTINCT profile_id FROM lists WHERE url = ? AND enabled = 1")
      .bind(canonicalUrl)
      .all<{ profile_id: string }>();

    // 2. User lists effective for profiles
    const { results: r2 } = await this.db
      .prepare(
        `SELECT DISTINCT p.id AS profile_id
        FROM profiles p
        JOIN user_lists ul ON ul.user_id = p.owner_id
        LEFT JOIN profile_user_list_overrides pulo 
          ON pulo.user_list_id = ul.id AND pulo.profile_id = p.id
        WHERE ul.url = ? 
          AND COALESCE(pulo.enabled, ul.enabled) = 1`
      )
      .bind(canonicalUrl)
      .all<{ profile_id: string }>();

    const set = new Set<string>();
    for (const row of r1 || []) set.add(row.profile_id);
    for (const row of r2 || []) set.add(row.profile_id);
    return Array.from(set);
  }
}
