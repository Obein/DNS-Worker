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

  async deleteList(id: number, profileId: string): Promise<boolean> {
    const result = await this.db.prepare("DELETE FROM lists WHERE id = ? AND profile_id = ?").bind(id, profileId).run();
    return result.success;
  }

  async updateListSyncStatus(id: number, now: number | null, enabled: number, syncError: string | null = null): Promise<boolean> {
    let result;
    if (enabled === 1) {
      result = await this.db.prepare("UPDATE lists SET last_synced_at = ?, enabled = ?, sync_error = NULL WHERE id = ?").bind(now, enabled, id).run();
    } else {
      result = await this.db.prepare("UPDATE lists SET enabled = ?, sync_error = ? WHERE id = ?").bind(enabled, syncError, id).run();
    }
    return result.success;
  }
}
