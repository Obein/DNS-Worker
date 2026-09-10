import { D1Database } from "@cloudflare/workers-types";
import { AccessPoint } from "../types";
import { generateId, generateZBase32Token } from "../lib/auth";

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
    const MAX_RETRIES = 5;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const token = generateZBase32Token(5);
      try {
        await this.db.prepare(
          "INSERT INTO access_points (id, profile_id, name, token, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
        ).bind(id, profileId, name, token, now, now).run();
        return { id, profile_id: profileId, name, token, created_at: now, updated_at: now };
      } catch (err: any) {
        if (attempt < MAX_RETRIES - 1 && (String(err).includes("UNIQUE constraint failed") || String(err).includes("SQLITE_CONSTRAINT"))) {
          continue;
        }
        throw err;
      }
    }
    throw new Error("Failed to generate a unique access point token");
  }

  async updateAccessPointName(id: string, profileId: string, name: string): Promise<boolean> {
    const now = Math.floor(Date.now() / 1000);
    const result = await this.db.prepare("UPDATE access_points SET name = ?, updated_at = ? WHERE id = ? AND profile_id = ?")
      .bind(name, now, id, profileId).run();
    return result.success;
  }

  async rotateAccessPointToken(id: string, profileId: string): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const MAX_RETRIES = 5;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const newToken = generateZBase32Token(5);
      try {
        const result = await this.db.prepare("UPDATE access_points SET token = ?, updated_at = ? WHERE id = ? AND profile_id = ?")
          .bind(newToken, now, id, profileId).run();
        if (!result.success) {
          throw new Error("Failed to update access point token");
        }
        return newToken;
      } catch (err: any) {
        if (attempt < MAX_RETRIES - 1 && (String(err).includes("UNIQUE constraint failed") || String(err).includes("SQLITE_CONSTRAINT"))) {
          continue;
        }
        throw err;
      }
    }
    throw new Error("Failed to generate a unique access point token");
  }

  async deleteAccessPoint(id: string, profileId: string): Promise<boolean> {
    const result = await this.db.prepare("DELETE FROM access_points WHERE id = ? AND profile_id = ?")
      .bind(id, profileId).run();
    return result.success;
  }
}
