import { D1Database } from "@cloudflare/workers-types";
import { List } from "../types";

export class ListModel {
  constructor(private db: D1Database) {}

  async getLists(profileId: string): Promise<List[]> {
    const { results } = await this.db.prepare("SELECT * FROM lists WHERE profile_id = ?").bind(profileId).all<List>();
    return results;
  }

  async addList(profileId: string, url: string): Promise<boolean> {
    const result = await this.db.prepare("INSERT INTO lists (profile_id, url) VALUES (?, ?)").bind(profileId, url).run();
    return result.success;
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

  async updateListSyncStatus(id: number, now: number | null, enabled: number, syncError: string | null = null): Promise<boolean> {
    const result = await this.db.prepare(
      "UPDATE lists SET last_synced_at = ?, enabled = ?, sync_error = ? WHERE id = ?"
    )
      .bind(now, enabled, syncError, id)
      .run();
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
