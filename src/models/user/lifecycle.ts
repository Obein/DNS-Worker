import { D1Database } from "@cloudflare/workers-types";
import { InactivityPolicyResult } from "./types";

/**
 * Handles account activity timestamp tracking and automated data retention / inactivity cleanup policies.
 *
 * Single Responsibility: Account resolution activity tracking and periodic inactivity retention enforcement.
 */
export class UserLifecycleModel {
  constructor(private db: D1Database, private env?: unknown) {}

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
   * Applies the inactivity retention policies strictly based on DNS resolution activity:
   * 
   * 1. Inactivity Log Purge (INACTIVE_LOG_PURGE_DAYS, default 30 days):
   *    Cleans up all query logs and pre-aggregated hourly rollups for non-admin accounts that have had no DNS
   *    resolution traffic for consecutive days. All DNS profiles, custom lists, access points, and routing keys
   *    are completely preserved.
   * 
   * 2. Account Abandonment Cleanup (INACTIVITY_THRESHOLD_DAYS, default 180 days):
   *    Deletes abandoned non-admin user accounts that have had no DNS resolution activity for consecutive days.
   *    Judged strictly by resolution activity (last_active_at, or created_at if no queries ever resolved),
   *    NEVER by web login activity. Deleting the user cascades to all their profiles, access points, and metadata.
   *
   * @param now Current timestamp in seconds.
   * @param options Optional overrides for threshold days (useful for unit tests or customized triggers).
   * @returns Statistics on cleared profiles, deleted user accounts, and purged logs.
   */
  async applyInactivityPolicy(
    now: number,
    options?: { inactivityDays?: number; inactiveLogPurgeDays?: number }
  ): Promise<InactivityPolicyResult> {
    const envObj = (this.env || {}) as Record<string, unknown>;

    // 1. Resolve INACTIVITY_THRESHOLD_DAYS (Default: 180 days)
    const rawInactivityDays = options?.inactivityDays ?? envObj.INACTIVITY_THRESHOLD_DAYS;
    const parsedInactivityDays = rawInactivityDays !== undefined && rawInactivityDays !== ''
      ? Number(rawInactivityDays)
      : 180;
    const inactivityDays = Number.isFinite(parsedInactivityDays) && parsedInactivityDays > 0
      ? parsedInactivityDays
      : 180;

    // 2. Resolve INACTIVE_LOG_PURGE_DAYS (Default: 30 days, aliases: INACTIVE_LOG_CLEANUP_DAYS)
    const rawPurgeDays = options?.inactiveLogPurgeDays ?? envObj.INACTIVE_LOG_PURGE_DAYS ?? envObj.INACTIVE_LOG_CLEANUP_DAYS;
    const parsedPurgeDays = rawPurgeDays !== undefined && rawPurgeDays !== ''
      ? Number(rawPurgeDays)
      : 30;
    const inactiveLogPurgeDays = Number.isFinite(parsedPurgeDays) && parsedPurgeDays > 0
      ? parsedPurgeDays
      : 30;

    const purgeCutoff = now - inactiveLogPurgeDays * 24 * 3600;
    const abandonCutoff = now - inactivityDays * 24 * 3600;
    // Ensure all logs from accounts eligible for either log purge or abandonment are cleaned
    const logPurgeCutoff = Math.max(purgeCutoff, abandonCutoff);

    // 1. 清理闲置账号的历史查询日志与预聚合时序 (配置与规则完整保留)
    const deleteRollupsStmt = this.db.prepare(`
      DELETE FROM hourly_rollups
      WHERE profile_id IN (
        SELECT id FROM profiles
        WHERE owner_id IN (
          SELECT id FROM users
          WHERE role = 'user'
            AND (last_active_at < ? OR (last_active_at IS NULL AND created_at < ?))
        )
      )
    `).bind(logPurgeCutoff, logPurgeCutoff);

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
    `).bind(logPurgeCutoff, logPurgeCutoff);

    // 2. 判定长期废弃休眠账号 (根据解析活动判断，而非登录时间)：删除废弃账号的 Profile 及用户主体 (级联清理元数据)
    const deleteAbandonedProfilesStmt = this.db.prepare(`
      DELETE FROM profiles 
      WHERE owner_id IN (
        SELECT id FROM users 
        WHERE role = 'user' 
          AND (last_active_at < ? OR (last_active_at IS NULL AND created_at < ?))
      )
    `).bind(abandonCutoff, abandonCutoff);

    const deleteAbandonedUsersStmt = this.db.prepare(`
      DELETE FROM users
      WHERE role = 'user'
        AND (last_active_at < ? OR (last_active_at IS NULL AND created_at < ?))
    `).bind(abandonCutoff, abandonCutoff);

    const results = await this.db.batch([
      deleteRollupsStmt,
      deleteLogsStmt,
      deleteAbandonedProfilesStmt,
      deleteAbandonedUsersStmt
    ]);

    return {
      clearedProfiles: results[2].meta.changes || 0,
      deletedUsers: results[3].meta.changes || 0,
      purgedLogsCount: results[1].meta.changes || 0
    };
  }
}
