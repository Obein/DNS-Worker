import { D1Database } from "@cloudflare/workers-types";

export type ActivityAction =
  | 'signup'
  | 'login_success'
  | 'login_fail'
  | 'logout'
  | 'password_change_success'
  | 'password_change_fail'
  | 'totp_verify_success'
  | 'totp_verify_fail'
  | 'totp_setup'
  | 'totp_removed'
  | 'recovery_key_used'
  | 'session_revoked'
  | 'pin_verify_success'
  | 'pin_verify_fail';

export interface UserActivityEntry {
  id: number;
  user_id: string;
  action: ActivityAction;
  ip_address: string | null;
  user_agent: string | null;
  timestamp: number;
  extra: string | null;
  session_id_hash: string | null;
}

export class ActivityLogModel {
  constructor(private db: D1Database) {}

  /**
   * Records a user security event to the activity log.
   * @param userId - The user's ID
   * @param action - The type of security event
   * @param ip - Client IP address from CF-Connecting-IP header
   * @param userAgent - Optional User-Agent string
   * @param extra - Optional JSON-serializable extra metadata
   */
  async record(
    userId: string,
    action: ActivityAction,
    ip: string,
    userAgent?: string | null,
    extra?: Record<string, unknown>,
    sessionIdHash?: string | null
  ): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    await this.db
      .prepare(
        'INSERT INTO user_activity_log (user_id, action, ip_address, user_agent, timestamp, extra, session_id_hash) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .bind(
        userId,
        action,
        ip,
        userAgent ?? null,
        now,
        extra ? JSON.stringify(extra) : null,
        sessionIdHash ?? null
      )
      .run();
  }

  /**
   * Returns paginated activity log entries for a specific user.
   * @param userId - The user's ID
   * @param limit - Max records to return (default 20, max 50)
   * @param before - Cursor: only return entries with timestamp < before
   */
  async listByUser(
    userId: string,
    limit: number = 20,
    before?: number
  ): Promise<UserActivityEntry[]> {
    const clampedLimit = Math.min(limit, 50);

    if (before) {
      const { results } = await this.db
        .prepare(
          'SELECT * FROM user_activity_log WHERE user_id = ? AND timestamp < ? ORDER BY timestamp DESC LIMIT ?'
        )
        .bind(userId, before, clampedLimit)
        .all<UserActivityEntry>();
      return results;
    }

    const { results } = await this.db
      .prepare(
        'SELECT * FROM user_activity_log WHERE user_id = ? ORDER BY timestamp DESC LIMIT ?'
      )
      .bind(userId, clampedLimit)
      .all<UserActivityEntry>();
    return results;
  }
}
