import { D1Database } from "@cloudflare/workers-types";

export class SessionModel {
  constructor(private db: D1Database) {}

  async getSessionUserId(sessionId: string): Promise<string | null> {
    const session = await this.db.prepare("SELECT user_id, expires_at FROM sessions WHERE id = ?").bind(sessionId).first<{ user_id: string; expires_at: number }>();
    if (!session) return null;
    if (session.expires_at <= Math.floor(Date.now() / 1000)) {
      await this.deleteSession(sessionId);
      return null;
    }
    return session.user_id;
  }

  async getSession(sessionId: string): Promise<any> {
    const session = await this.db.prepare("SELECT * FROM sessions WHERE id = ?").bind(sessionId).first<any>();
    if (!session) return null;
    if (session.expires_at <= Math.floor(Date.now() / 1000)) {
      await this.deleteSession(sessionId);
      return null;
    }
    return session;
  }

  async getSessionWithUser(sessionId: string): Promise<any> {
    const session = await this.db.prepare(`
      SELECT sessions.id as session_id, sessions.user_id, sessions.created_at, sessions.expires_at, sessions.ip_address, sessions.user_agent, sessions.latitude, sessions.longitude, sessions.rotation_counter, sessions.last_active_at, sessions.is_paused,
             users.id as u_id, users.username, users.role, users.pin_hash, users.session_lock_timeout
      FROM sessions
      INNER JOIN users ON sessions.user_id = users.id
      WHERE sessions.id = ?
    `).bind(sessionId).first<any>();

    if (!session) return null;
    if (session.expires_at <= Math.floor(Date.now() / 1000)) {
      await this.deleteSession(sessionId);
      return null;
    }
    return session;
  }

  async createSession(
    id: string,
    userId: string,
    createdAt: number,
    expiresAt: number,
    ipAddress: string | null = null,
    userAgent: string | null = null,
    latitude: number | null = null,
    longitude: number | null = null,
    lastActiveAt: number | null = null
  ): Promise<boolean> {
    const result = await this.db
      .prepare(
        "INSERT INTO sessions (id, user_id, created_at, expires_at, ip_address, user_agent, latitude, longitude, rotation_counter, last_active_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)"
      )
      .bind(id, userId, createdAt, expiresAt, ipAddress, userAgent, latitude, longitude, lastActiveAt || createdAt)
      .run();
    return result.success;
  }

  async updateLastActive(id: string, lastActiveAt: number): Promise<boolean> {
    const result = await this.db.prepare("UPDATE sessions SET last_active_at = ? WHERE id = ?").bind(lastActiveAt, id).run();
    return result.success;
  }

  async pauseSession(id: string): Promise<boolean> {
    const result = await this.db.prepare("UPDATE sessions SET is_paused = 1 WHERE id = ?").bind(id).run();
    return result.success;
  }

  async resumeSession(id: string, lastActiveAt: number): Promise<boolean> {
    const result = await this.db.prepare("UPDATE sessions SET is_paused = 0, last_active_at = ? WHERE id = ?").bind(lastActiveAt, id).run();
    return result.success;
  }

  async getSessionsByUser(userId: string, now: number = Math.floor(Date.now() / 1000)): Promise<any[]> {
    // Proactively delete expired sessions for this user
    await this.db.prepare("DELETE FROM sessions WHERE user_id = ? AND expires_at <= ?").bind(userId, now).run();

    const { results } = await this.db.prepare(`
      SELECT id, ip_address, user_agent, created_at, expires_at, latitude, longitude
      FROM sessions
      WHERE user_id = ? AND expires_at > ?
      ORDER BY expires_at DESC
    `).bind(userId, now).all();
    return results;
  }

  async deleteExpiredSessions(now: number = Math.floor(Date.now() / 1000)): Promise<{ deletedSessions: number; deletedPending: number }> {
    const res1 = await this.db.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(now).run();
    const res2 = await this.db.prepare("DELETE FROM pending_totp_sessions WHERE expires_at <= ?").bind(now).run();
    return {
      deletedSessions: res1.meta?.changes || 0,
      deletedPending: res2.meta?.changes || 0,
    };
  }

  async extendSession(id: string, expiresAt: number): Promise<boolean> {
    const result = await this.db.prepare("UPDATE sessions SET expires_at = ? WHERE id = ?").bind(expiresAt, id).run();
    return result.success;
  }

  async incrementRotationCounter(id: string): Promise<boolean> {
    const result = await this.db.prepare("UPDATE sessions SET rotation_counter = rotation_counter + 1 WHERE id = ?").bind(id).run();
    return result.success;
  }

  async deleteSession(id: string): Promise<boolean> {
    const result = await this.db.prepare("DELETE FROM sessions WHERE id = ?").bind(id).run();
    return result.success;
  }

  async createPendingTotpSession(id: string, userId: string, expiresAt: number): Promise<boolean> {
    const result = await this.db.prepare("INSERT INTO pending_totp_sessions (id, user_id, expires_at) VALUES (?, ?, ?)").bind(id, userId, expiresAt).run();
    return result.success;
  }

  async getPendingTotpSession(id: string): Promise<{ user_id: string; expires_at: number } | null> {
    const row = await this.db.prepare("SELECT * FROM pending_totp_sessions WHERE id = ?").bind(id).first<{ user_id: string; expires_at: number }>();
    if (!row) return null;
    if (row.expires_at <= Math.floor(Date.now() / 1000)) {
      await this.deletePendingTotpSession(id);
      return null;
    }
    return row;
  }

  async deletePendingTotpSession(id: string): Promise<boolean> {
    const result = await this.db.prepare("DELETE FROM pending_totp_sessions WHERE id = ?").bind(id).run();
    return result.success;
  }
}
