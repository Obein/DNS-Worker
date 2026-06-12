import { D1Database } from "@cloudflare/workers-types";
import { Profile, ProfileSettings, Rule, List } from "../types";
import { generateId } from "../lib/auth";

export interface ProfileWithBloom extends Profile {
  list_bloom?: string;
  list_updated_at?: number;
}

export class ProfileModel {
  constructor(private db: D1Database) {}

  async getById(id: string): Promise<ProfileWithBloom | null> {
    return await this.db.prepare("SELECT * FROM profiles WHERE id = ?")
      .bind(id)
      .first<ProfileWithBloom>();
  }

  async findByKey(profileKey: string): Promise<ProfileWithBloom | null> {
    return await this.db.prepare("SELECT * FROM profiles WHERE profile_key = ? OR id = ?")
      .bind(profileKey, profileKey)
      .first<ProfileWithBloom>();
  }

  async getRules(profileId: string): Promise<Rule[]> {
    const { results } = await this.db.prepare("SELECT * FROM rules WHERE profile_id = ? ORDER BY id DESC")
      .bind(profileId)
      .all<Rule>();
    return results;
  }

  async list(filterSql: string, params: any[]): Promise<Profile[]> {
    const { results } = await this.db.prepare(`SELECT * FROM profiles ${filterSql}`)
      .bind(...params).all<Profile>();
    return results;
  }

  async listByOwner(ownerId: string): Promise<Profile[]> {
    const { results } = await this.db.prepare("SELECT * FROM profiles WHERE owner_id = ? ORDER BY created_at DESC")
      .bind(ownerId).all<Profile>();
    return results;
  }

  async findByName(ownerId: string, name: string): Promise<Profile | null> {
    return await this.db.prepare("SELECT * FROM profiles WHERE owner_id = ? AND name = ?")
      .bind(ownerId, name).first<Profile | null>();
  }

  async create(profile: { id: string, profile_key?: string, owner_id: string, name: string, settings: ProfileSettings }): Promise<boolean> {
    const now = Math.floor(Date.now() / 1000);
    // Use provided profile_key or generate a 12-char secure string
    const profileKey = profile.profile_key || generateId(12);
    const result = await this.db.prepare(
      "INSERT INTO profiles (id, profile_key, owner_id, name, settings, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    )
      .bind(profile.id, profileKey, profile.owner_id, profile.name, JSON.stringify(profile.settings), now, now)
      .run();
    return result.success;
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.db.prepare("DELETE FROM profiles WHERE id = ?").bind(id).run();
    return result.success;
  }

  async deleteByOwner(ownerId: string): Promise<boolean> {
    const result = await this.db.prepare("DELETE FROM profiles WHERE owner_id = ?").bind(ownerId).run();
    return result.success;
  }

  async updateName(id: string, name: string): Promise<boolean> {
    const now = Math.floor(Date.now() / 1000);
    const result = await this.db.prepare("UPDATE profiles SET name = ?, updated_at = ? WHERE id = ?")
      .bind(name, now, id).run();
    return result.success;
  }

  async updateSettings(id: string, settings: ProfileSettings): Promise<boolean> {
    const now = Math.floor(Date.now() / 1000);
    const result = await this.db.prepare(
      "UPDATE profiles SET settings = ?, updated_at = ? WHERE id = ?"
    )
      .bind(JSON.stringify(settings), now, id)
      .run();
    return result.success;
  }

  async rotateKey(id: string, newKey: string): Promise<boolean> {
    const now = Math.floor(Date.now() / 1000);
    const result = await this.db.prepare("UPDATE profiles SET profile_key = ?, updated_at = ? WHERE id = ?")
      .bind(newKey, now, id).run();
    return result.success;
  }

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

  async addRule(profileId: string, rule: Partial<Rule>): Promise<boolean> {
    const normalizedPattern = rule.pattern ? rule.pattern.trim().toLowerCase() : "";
    const result = await this.db.prepare(
      "INSERT INTO rules (profile_id, type, pattern, v_a, v_aaaa, v_txt, v_cname) VALUES (?, ?, ?, ?, ?, ?, ?)"
    )
      .bind(profileId, rule.type, normalizedPattern, rule.v_a || null, rule.v_aaaa || null, rule.v_txt || null, rule.v_cname || null)
      .run();
    return result.success;
  }

  async updateRule(id: number, profileId: string, rule: Partial<Rule>): Promise<boolean> {
    const normalizedPattern = rule.pattern ? rule.pattern.trim().toLowerCase() : "";
    const result = await this.db.prepare(
      "UPDATE rules SET type = ?, pattern = ?, v_a = ?, v_aaaa = ?, v_txt = ?, v_cname = ? WHERE id = ? AND profile_id = ?"
    )
      .bind(rule.type, normalizedPattern, rule.v_a || null, rule.v_aaaa || null, rule.v_txt || null, rule.v_cname || null, id, profileId)
      .run();
    return result.success;
  }

  async getRuleByPattern(profileId: string, pattern: string): Promise<Rule | null> {
    return await this.db.prepare("SELECT * FROM rules WHERE profile_id = ? AND LOWER(pattern) = ?")
      .bind(profileId, pattern.trim().toLowerCase())
      .first<Rule | null>();
  }

  async getRuleByPatternExcludeId(profileId: string, pattern: string, id: number): Promise<Rule | null> {
    return await this.db.prepare("SELECT * FROM rules WHERE profile_id = ? AND LOWER(pattern) = ? AND id != ?")
      .bind(profileId, pattern.trim().toLowerCase(), id)
      .first<Rule | null>();
  }

  async deleteRule(id: number, profileId: string): Promise<boolean> {
    const result = await this.db.prepare("DELETE FROM rules WHERE id = ? AND profile_id = ?").bind(id, profileId).run();
    return result.success;
  }

  async updateLastActive(id: string, now: number): Promise<boolean> {
    const result = await this.db.prepare("UPDATE profiles SET last_active_at = ? WHERE id = ?").bind(now, id).run();
    return result.success;
  }

  async getSyncTargets(threshold: number, limit: number): Promise<{id: string}[]> {
    const { results } = await this.db.prepare(
      "SELECT id FROM profiles WHERE (list_updated_at IS NULL OR list_updated_at < ?) AND EXISTS (SELECT 1 FROM lists WHERE lists.profile_id = profiles.id) ORDER BY list_updated_at ASC LIMIT ?"
    ).bind(threshold, limit).all<{ id: string }>();
    return results;
  }

  async clearProfileBlooms(profileId: string): Promise<boolean> {
    const result = await this.db.prepare("DELETE FROM profile_blooms WHERE profile_id = ?").bind(profileId).run();
    return result.success;
  }

  async updateListUpdatedAt(profileId: string, now: number): Promise<boolean> {
    const result = await this.db.prepare("UPDATE profiles SET list_updated_at = ? WHERE id = ?").bind(now, profileId).run();
    return result.success;
  }

  async updateListSyncStatus(id: number, now: number | null, enabled: number): Promise<boolean> {
    let result;
    if (enabled === 1) {
      result = await this.db.prepare("UPDATE lists SET last_synced_at = ?, enabled = ? WHERE id = ?").bind(now, enabled, id).run();
    } else {
      result = await this.db.prepare("UPDATE lists SET enabled = ? WHERE id = ?").bind(enabled, id).run();
    }
    return result.success;
  }

  async upsertProfileBloom(profileId: string, bloomFilter: ArrayBuffer, now: number): Promise<boolean> {
    const CHUNK_SIZE = 512 * 1024; // 512KB per chunk
    const uint8Array = new Uint8Array(bloomFilter);
    const statements = [];
    
    // Delete existing chunks to replace them entirely
    statements.push(
      this.db.prepare("DELETE FROM profile_blooms WHERE profile_id = ?").bind(profileId)
    );

    // Insert new chunks
    let chunkIndex = 0;
    for (let offset = 0; offset < uint8Array.length; offset += CHUNK_SIZE) {
      // Use slice() to create a copy of the chunk, ensuring a clean ArrayBuffer of the exact size
      const chunkData = uint8Array.slice(offset, offset + CHUNK_SIZE).buffer as ArrayBuffer;
      statements.push(
        this.db.prepare(
          "INSERT INTO profile_blooms (profile_id, chunk_index, bloom_filter_chunk, updated_at) VALUES (?, ?, ?, ?)"
        ).bind(profileId, chunkIndex, chunkData, now)
      );
      chunkIndex++;
    }

    const results = await this.db.batch(statements);
    return results.every(r => r.success);
  }

  async getProfileBloom(profileId: string): Promise<ArrayBuffer | null> {
    const { results } = await this.db.prepare(
      "SELECT bloom_filter_chunk FROM profile_blooms WHERE profile_id = ? ORDER BY chunk_index ASC"
    ).bind(profileId).all<{ bloom_filter_chunk: ArrayBuffer }>();

    if (!results || results.length === 0) return null;

    // Calculate total length
    const totalLength = results.reduce((acc, row) => {
      const len = row.bloom_filter_chunk.byteLength ?? (row.bloom_filter_chunk as any).length;
      return acc + len;
    }, 0);
    const combined = new Uint8Array(totalLength);

    // Reconstruct the array buffer
    let offset = 0;
    for (const row of results) {
      // new Uint8Array accepts both ArrayBuffer and Array<number>
      const chunk = new Uint8Array(row.bloom_filter_chunk);
      combined.set(chunk, offset);
      offset += chunk.length;
    }

    return combined.buffer as ArrayBuffer;
  }
}
