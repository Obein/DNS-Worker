import { D1Database } from "@cloudflare/workers-types";

export class SessionModel {
  constructor(private db: D1Database) {}

  async getSessionUserId(sessionId: string): Promise<string | null> {
    const session = await this.db.prepare("SELECT user_id FROM sessions WHERE id = ?").bind(sessionId).first<{ user_id: string }>();
    return session ? session.user_id : null;
  }

  async getSession(sessionId: string): Promise<any> {
    const session = await this.db.prepare("SELECT * FROM sessions WHERE id = ?").bind(sessionId).first<any>();
    return session || null;
  }

  async getSessionWithUser(sessionId: string): Promise<any> {
    return await this.db.prepare(`
      SELECT sessions.id as session_id, sessions.user_id, sessions.created_at, sessions.expires_at, sessions.ip_address, sessions.user_agent, sessions.latitude, sessions.longitude, sessions.rotation_counter, sessions.last_active_at, sessions.is_paused,
             users.id as u_id, users.username, users.role, users.pin_hash, users.session_lock_timeout
      FROM sessions
      INNER JOIN users ON sessions.user_id = users.id
      WHERE sessions.id = ?
    `).bind(sessionId).first<any>();
  }

  async createSession(id: string, userId: string, createdAt: number, expiresAt: number, ipAddress: string | null = null, userAgent: string | null = null, latitude: number | null = null, longitude: number | null = null, lastActiveAt: number | null = null): Promise<boolean> {
    const result = await this.db.prepare("INSERT INTO sessions (id, user_id, created_at, expires_at, ip_address, user_agent, latitude, longitude, rotation_counter, last_active_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)")
      .bind(id, userId, createdAt, expiresAt, ipAddress, userAgent, latitude, longitude, lastActiveAt || createdAt).run();
    return result.success;
  }

  async updateLastActive(id: string, lastActiveAt: number): Promise<boolean> {
    const result = await this.db.prepare("UPDATE sessions SET last_active_at = ? WHERE id = ?")
      .bind(lastActiveAt, id).run();
    return result.success;
  }

  async pauseSession(id: string): Promise<boolean> {
    const result = await this.db.prepare("UPDATE sessions SET is_paused = 1 WHERE id = ?")
      .bind(id).run();
    return result.success;
  }

  async resumeSession(id: string, lastActiveAt: number): Promise<boolean> {
    const result = await this.db.prepare("UPDATE sessions SET is_paused = 0, last_active_at = ? WHERE id = ?")
      .bind(lastActiveAt, id).run();
    return result.success;
  }

  async getSessionsByUser(userId: string): Promise<any[]> {
    const { results } = await this.db.prepare(`
      SELECT id, ip_address, user_agent, created_at, expires_at, latitude, longitude
      FROM sessions
      WHERE user_id = ?
      ORDER BY expires_at DESC
    `).bind(userId).all();
    return results;
  }

  async extendSession(id: string, expiresAt: number): Promise<boolean> {
    const result = await this.db.prepare("UPDATE sessions SET expires_at = ? WHERE id = ?")
      .bind(expiresAt, id).run();
    return result.success;
  }

  async incrementRotationCounter(id: string): Promise<boolean> {
    const result = await this.db.prepare("UPDATE sessions SET rotation_counter = rotation_counter + 1 WHERE id = ?")
      .bind(id).run();
    return result.success;
  }

  async deleteSession(id: string): Promise<boolean> {
    const result = await this.db.prepare("DELETE FROM sessions WHERE id = ?").bind(id).run();
    return result.success;
  }

  async createPendingTotpSession(id: string, userId: string, expiresAt: number): Promise<boolean> {
    const result = await this.db.prepare('INSERT INTO pending_totp_sessions (id, user_id, expires_at) VALUES (?, ?, ?)')
      .bind(id, userId, expiresAt).run();
    return result.success;
  }

  async getPendingTotpSession(id: string): Promise<{user_id: string, expires_at: number} | null> {
    const row = await this.db.prepare("SELECT * FROM pending_totp_sessions WHERE id = ?").bind(id).first<{user_id: string, expires_at: number}>();
    return row || null;
  }

  async deletePendingTotpSession(id: string): Promise<boolean> {
    const result = await this.db.prepare('DELETE FROM pending_totp_sessions WHERE id = ?').bind(id).run();
    return result.success;
  }

}
