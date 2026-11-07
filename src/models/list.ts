import { D1Database } from "@cloudflare/workers-types";
import { List } from "../types";

export class ListModel {
  constructor(private db: D1Database) {}

  /**
   * Normalizes a blocklist URL for canonical indexing.
   */
  static normalizeUrl(url: string): string {
    return url.trim().replace(/\/+$/, "");
  }

  async getLists(profileId: string): Promise<List[]> {
    const { results } = await this.db.prepare(`
      SELECT 
        l.id, 
        l.profile_id, 
        l.url, 
        l.enabled, 
        COALESCE(gm.last_synced_at, l.last_synced_at) AS last_synced_at,
        COALESCE(gm.sync_error, l.sync_error) AS sync_error,
        COALESCE(gm.etag, l.etag) AS etag,
        COALESCE(gm.last_modified, l.last_modified) AS last_modified
      FROM lists l
      LEFT JOIN global_list_metadata gm ON l.url = gm.url
      WHERE l.profile_id = ?
    `).bind(profileId).all<List>();
    return results;
  }

  async addList(profileId: string, url: string): Promise<{ success: boolean; id?: number }> {
    const canonicalUrl = ListModel.normalizeUrl(url);
    const result = await this.db.prepare("INSERT INTO lists (profile_id, url) VALUES (?, ?)").bind(profileId, canonicalUrl).run();
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
    return await this.db.prepare(`
      SELECT 
        l.id, 
        l.profile_id, 
        l.url, 
        l.enabled, 
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
  async setEnabled(id: number, profileId: string, enabled: boolean): Promise<boolean> {
    const result = await this.db
      .prepare("UPDATE lists SET enabled = ? WHERE id = ? AND profile_id = ?")
      .bind(enabled ? 1 : 0, id, profileId)
      .run();
    return result.success;
  }

  /** Fetches a single list belonging to a profile, or null when absent. */
  async getListById(id: number, profileId: string): Promise<List | null> {
    return await this.db.prepare(`
      SELECT 
        l.id, 
        l.profile_id, 
        l.url, 
        l.enabled, 
        COALESCE(gm.last_synced_at, l.last_synced_at) AS last_synced_at,
        COALESCE(gm.sync_error, l.sync_error) AS sync_error,
        COALESCE(gm.etag, l.etag) AS etag,
        COALESCE(gm.last_modified, l.last_modified) AS last_modified
      FROM lists l
      LEFT JOIN global_list_metadata gm ON l.url = gm.url
      WHERE l.id = ? AND l.profile_id = ?
    `)
      .bind(id, profileId)
      .first<List | null>();
  }

  async deleteList(id: number, profileId: string): Promise<boolean> {
    const result = await this.db.prepare("DELETE FROM lists WHERE id = ? AND profile_id = ?").bind(id, profileId).run();
    return result.success;
  }

  /**
   * Updates list sync status, including optional ETag and Last-Modified caching headers.
   * If enabled is null or undefined, the current enabled status in the database is preserved.
   */
  async updateListSyncStatus(
    id: number,
    now: number | null,
    enabled?: number | null,
    syncError: string | null = null,
    etag?: string | null,
    lastModified?: string | null
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
      fields.push("last_modified = ?");
      params.push(lastModified);
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
   */
  async getGlobalListMetadata(url: string): Promise<{
    url: string;
    etag: string | null;
    last_modified: string | null;
    last_synced_at: number | null;
    sync_error: string | null;
  } | null> {
    const canonicalUrl = ListModel.normalizeUrl(url);
    return await this.db
      .prepare("SELECT * FROM global_list_metadata WHERE url = ?")
      .bind(canonicalUrl)
      .first();
  }

  /**
   * Upserts global metadata for a given canonical blocklist URL.
   */
  async updateGlobalListMetadata(
    url: string,
    now: number,
    etag?: string | null,
    lastModified?: string | null,
    syncError: string | null = null
  ): Promise<boolean> {
    const canonicalUrl = ListModel.normalizeUrl(url);
    const result = await this.db.prepare(`
      INSERT INTO global_list_metadata (url, etag, last_modified, last_synced_at, sync_error, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(url) DO UPDATE SET
        etag = COALESCE(excluded.etag, global_list_metadata.etag),
        last_modified = COALESCE(excluded.last_modified, global_list_metadata.last_modified),
        last_synced_at = excluded.last_synced_at,
        sync_error = excluded.sync_error
    `).bind(canonicalUrl, etag || null, lastModified || null, now, syncError || null, now).run();
    return result.success;
  }

  /**
   * Returns distinct active URLs across all profiles that need synchronization.
   */
  async getDistinctActiveUrls(cutoffTime?: number, limit: number = 10): Promise<string[]> {
    let query = `
      SELECT DISTINCT l.url
      FROM lists l
      LEFT JOIN global_list_metadata gm ON l.url = gm.url
      WHERE l.enabled = 1
    `;
    const params: (number | null)[] = [];
    if (cutoffTime !== undefined) {
      query += ` AND (gm.last_synced_at IS NULL OR gm.last_synced_at < ?)`;
      params.push(cutoffTime);
    }
    query += ` ORDER BY COALESCE(gm.last_synced_at, 0) ASC LIMIT ?`;
    params.push(limit);

    const { results } = await this.db.prepare(query).bind(...params).all<{ url: string }>();
    return (results || []).map(r => r.url);
  }

  /**
   * Retrieves all profile IDs that subscribe to a given list URL and have it enabled.
   */
  async getProfilesSubscribingToUrl(url: string): Promise<string[]> {
    const canonicalUrl = ListModel.normalizeUrl(url);
    const { results } = await this.db.prepare(
      "SELECT DISTINCT profile_id FROM lists WHERE url = ? AND enabled = 1"
    ).bind(canonicalUrl).all<{ profile_id: string }>();
    return (results || []).map(r => r.profile_id);
  }
}
