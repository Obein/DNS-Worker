import { D1Database } from "@cloudflare/workers-types";
import { InactivityPolicyResult } from "./types";

/**
 * Handles account activity timestamp tracking and automated data retention / inactivity cleanup policies.
 *
 * Single Responsibility: Account resolution activity tracking and periodic inactivity retention enforcement.
 */
export class UserLifecycleModel {
  constructor(private db: D1Database) {}

  /**
   * Updates the `last_active_at` timestamp of the user who owns the specified profile.
   * Called on incoming DNS queries to keep the user active.
   *
   * @param profileId Profile identifier.
   * @param now Current timestamp in seconds.
   * @returns True if the update succeeded.
   */
  async updateLastActiveByProfile(profileId: string, now: number): Promise<boolean> {
    const result = await this.db
      .prepare("UPDATE users SET last_active_at = ? WHERE id = (SELECT owner_id FROM profiles WHERE id = ?)")
      .bind(now, profileId)
      .run();
    return result.success;
  }

  /**
   * Applies the inactivity retention policies:
   * 1. 30 days of no DNS resolution activity: cleans up all query logs, pre-aggregated hourly rollups, and DNS profiles.
   * 2. 90 days of no login activity: deletes the zombie user account and all remaining metadata.
   *
   * @param now Current timestamp in seconds.
   * @returns Statistics on cleared profiles and deleted user accounts.
   */
  async applyInactivityPolicy(now: number): Promise<InactivityPolicyResult> {
    const thirtyDaysAgo = now - 30 * 24 * 3600;
    const ninetyDaysAgo = now - 90 * 24 * 3600;

    // 1. 超过 30 天无解析记录的账户，其所有关联查询日志及 DNS 配置将被自动清理
    const deleteLogsStmt = this.db.prepare(`
      DELETE FROM logs
      WHERE profile_id IN (
        SELECT id FROM profiles
        WHERE owner_id IN (
          SELECT id FROM users
          WHERE role = 'user'
            AND (last_active_at < ? OR (last_active_at IS NULL AND created_at < ?))
        )
      )
    `).bind(thirtyDaysAgo, thirtyDaysAgo);

    const deleteProfilesStmt = this.db.prepare(`
      DELETE FROM profiles 
      WHERE owner_id IN (
        SELECT id FROM users 
        WHERE role = 'user' 
          AND (last_active_at < ? OR (last_active_at IS NULL AND created_at < ?))
      )
    `).bind(thirtyDaysAgo, thirtyDaysAgo);

    // 2. 账户本身在 90 天无登录后将予移除
    const deleteUsersStmt = this.db.prepare(`
      DELETE FROM users
      WHERE role = 'user'
        AND (
          SELECT COALESCE(MAX(timestamp), created_at) 
          FROM user_activity_log 
          WHERE user_id = users.id
        ) < ?
    `).bind(ninetyDaysAgo);

    const results = await this.db.batch([
      deleteLogsStmt,
      deleteProfilesStmt,
      deleteUsersStmt
    ]);

    return {
      clearedProfiles: results[1].meta.changes || 0,
      deletedUsers: results[2].meta.changes || 0
    };
  }
}
