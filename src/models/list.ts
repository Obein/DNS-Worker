import { D1Database } from "@cloudflare/workers-types";
import { List } from "../types";

export class ListModel {
  constructor(private db: D1Database) {}

  async getLists(profileId: string): Promise<List[]> {
    const { results } = await this.db.prepare("SELECT * FROM lists WHERE profile_id = ?").bind(profileId).all<List>();
    return results;
  }

  async addList(profileId: string, url: string): Promise<{ success: boolean; id?: number }> {
    const result = await this.db.prepare("INSERT INTO lists (profile_id, url) VALUES (?, ?)").bind(profileId, url).run();
    const lastRowId = result.meta?.last_row_id;
    if (lastRowId && typeof lastRowId === 'number' && lastRowId > 0) {
      return { success: result.success, id: lastRowId };
    }
    const inserted = await this.getListByUrl(url, profileId);
    return { success: result.success, id: inserted?.id };
  }

  /** Fetches a list belonging to a profile by URL, or null when absent. */
  async getListByUrl(url: string, profileId: string): Promise<List | null> {
    return await this.db
      .prepare("SELECT * FROM lists WHERE url = ? AND profile_id = ? ORDER BY id DESC LIMIT 1")
      .bind(url, profileId)
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
      const url = typeof item === 'string' ? item.trim() : item.url.trim();
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
    return await this.db
      .prepare("SELECT * FROM lists WHERE id = ? AND profile_id = ?")
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
}
