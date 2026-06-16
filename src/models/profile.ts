import { D1Database } from "@cloudflare/workers-types";
import { Profile, ProfileSettings } from "../types";
import { generateId } from "../lib/auth";

export interface ProfileWithBloom extends Profile {
  list_bloom?: string;
  list_updated_at?: number;
}

export class ProfileModel {
  constructor(private db: D1Database) {}

  // --- Core Profile Methods ---
  async getById(id: string): Promise<ProfileWithBloom | null> {
    return await this.db.prepare("SELECT * FROM profiles WHERE id = ?")
      .bind(id)
      .first<ProfileWithBloom>();
  }

  async findByKey(profileKey: string): Promise<ProfileWithBloom & { access_point_id?: string, access_point_name?: string } | null> {
    return await this.db.prepare(`
      SELECT p.*, ap.id as access_point_id, ap.name as access_point_name 
      FROM profiles p 
      LEFT JOIN access_points ap ON p.id = ap.profile_id 
      WHERE ap.token = ? OR p.profile_key = ? OR p.id = ?
    `)
      .bind(profileKey, profileKey, profileKey)
      .first<ProfileWithBloom & { access_point_id?: string, access_point_name?: string }>();
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
    const apId = generateId(12);
    
    const statements = [
      this.db.prepare(
        "INSERT INTO profiles (id, profile_key, owner_id, name, settings, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).bind(profile.id, profileKey, profile.owner_id, profile.name, JSON.stringify(profile.settings), now, now),
      this.db.prepare(
        "INSERT INTO access_points (id, profile_id, name, token, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
      ).bind(apId, profile.id, "Device-1", profileKey, now, now)
    ];

    const results = await this.db.batch(statements);
    return results.every(r => r.success);
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

  async updateLastActive(id: string, now: number): Promise<boolean> {
    const result = await this.db.prepare("UPDATE profiles SET last_active_at = ? WHERE id = ?").bind(now, id).run();
    return result.success;
  }

  async getSyncTargets(threshold: number, limit: number): Promise<{id: string}[]> {
    const { results } = await this.db.prepare(
      "SELECT id FROM profiles WHERE (list_updated_at IS NULL OR list_updated_at <= ?) AND EXISTS (SELECT 1 FROM lists WHERE lists.profile_id = profiles.id) ORDER BY list_updated_at ASC LIMIT ?"
    ).bind(threshold, limit).all<{ id: string }>();
    return results;
  }

  async updateListUpdatedAt(profileId: string, now: number): Promise<boolean> {
    const result = await this.db.prepare("UPDATE profiles SET list_updated_at = ? WHERE id = ?").bind(now, profileId).run();
    return result.success;
  }
}
