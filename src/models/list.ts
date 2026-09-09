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
   * @param urls - Array of filter list URLs to insert.
   * @returns Total number of lists successfully inserted.
   */
  async addListsBulk(profileId: string, urls: string[]): Promise<number> {
    if (!urls || urls.length === 0) return 0;
    const statements = urls.map(url =>
      this.db.prepare("INSERT INTO lists (profile_id, url) VALUES (?, ?)").bind(profileId, url.trim())
    );

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
