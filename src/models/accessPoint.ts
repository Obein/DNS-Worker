import { D1Database } from "@cloudflare/workers-types";
import { AccessPoint } from "../types";
import { generateId } from "../lib/auth";

export class AccessPointModel {
  constructor(private db: D1Database) {}

  async getAccessPoints(profileId: string): Promise<AccessPoint[]> {
    const { results } = await this.db.prepare("SELECT * FROM access_points WHERE profile_id = ? ORDER BY created_at ASC")
      .bind(profileId).all<AccessPoint>();
    return results;
  }

  async addAccessPoint(profileId: string, name: string): Promise<AccessPoint> {
    const now = Math.floor(Date.now() / 1000);
    const id = generateId(12);
    const token = generateId(12);
    await this.db.prepare(
      "INSERT INTO access_points (id, profile_id, name, token, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind(id, profileId, name, token, now, now).run();
    return { id, profile_id: profileId, name, token, created_at: now, updated_at: now };
  }

  async updateAccessPointName(id: string, profileId: string, name: string): Promise<boolean> {
    const now = Math.floor(Date.now() / 1000);
    const result = await this.db.prepare("UPDATE access_points SET name = ?, updated_at = ? WHERE id = ? AND profile_id = ?")
      .bind(name, now, id, profileId).run();
    return result.success;
  }

  async rotateAccessPointToken(id: string, profileId: string): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const newToken = generateId(12);
    await this.db.prepare("UPDATE access_points SET token = ?, updated_at = ? WHERE id = ? AND profile_id = ?")
      .bind(newToken, now, id, profileId).run();
    return newToken;
  }

  async deleteAccessPoint(id: string, profileId: string): Promise<boolean> {
    const result = await this.db.prepare("DELETE FROM access_points WHERE id = ? AND profile_id = ?")
      .bind(id, profileId).run();
    return result.success;
  }
}
