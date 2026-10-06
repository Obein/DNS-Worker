import { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import { SystemSettingsModel } from "../systemSettings";
import { KemKeyModel } from "../kemKey";

/**
 * Model responsible for enforcing log retention policies and purging
 * expired raw resolution logs and rollup records.
 */
export class LogRetentionModel {
  private readonly settingsModel: SystemSettingsModel;

  constructor(
    private readonly db: D1Database,
    settingsModel?: SystemSettingsModel
  ) {
    this.settingsModel = settingsModel ?? new SystemSettingsModel(db);
  }

  /**
   * Global log cleanup: runs on every cron trigger.
   *
   * Applies three independent safety caps:
   *   1. Time-based: deletes logs older than min(user_setting, MAX_LOG_RETENTION_DAYS).
   *      The global cap prevents users from setting arbitrarily long retention periods
   *      (e.g. 360 days) that would cause D1 to overflow.
   *   2. Batch limiting: deletes bounded rows per profile per run based on batchLimit
   *      to prevent write spikes.
   *   3. Daily quota budget: tracks deleted rows today via SystemSettingsModel,
   *      capping total deletions at dailyBudget per UTC day to prevent exhausting
   *      Cloudflare D1 daily write quota (100k writes/day).
   *
   * @param maxRetentionDays - Hard cap on log retention days (default 30).
   * @param batchLimit - Maximum total log rows deleted across all profiles in this run (default 1000).
   * @param dailyBudget - Maximum total log rows deleted across all profiles per day (default 20000).
   */
  async cleanupGlobal(
    maxRetentionDays = 30,
    batchLimit = 1000,
    dailyBudget = 20000
  ): Promise<void> {
    try {
      const { results: profiles } = await this.db.prepare(
        "SELECT id, settings FROM profiles"
      ).all<{ id: string; settings: string }>();

      if (!profiles || profiles.length === 0) {
        return;
      }

      // ── Daily Cleanup Budget Check ──────────────────────────────────────────
      const todayDate = new Date().toISOString().slice(0, 10);
      let deletedToday = 0;

      if (dailyBudget > 0) {
        try {
          const savedDate = await this.settingsModel.get("log_cleanup_daily_date");
          const savedCount = await this.settingsModel.get("log_cleanup_daily_count");
          if (savedDate === todayDate && savedCount) {
            deletedToday = parseInt(savedCount, 10) || 0;
          }
        } catch (err) {
          console.warn("[LogRetentionModel] Failed to read daily cleanup settings:", err);
        }
      }

      const remainingBudget = dailyBudget > 0 ? Math.max(0, dailyBudget - deletedToday) : batchLimit;
      const canDeleteLogs = dailyBudget <= 0 || remainingBudget > 0;

      if (dailyBudget > 0 && remainingBudget <= 0) {
        console.log(
          `[LogRetentionModel] cleanupGlobal: daily budget reached (${deletedToday}/${dailyBudget}), skipping raw log deletion for today (${todayDate})`
        );
      }

      // Distribute batchLimit evenly across profiles, bounded by remaining daily budget
      const effectiveBatchLimit = dailyBudget > 0 ? Math.min(batchLimit, remainingBudget) : batchLimit;
      const perProfileLimit = Math.max(1, Math.floor(effectiveBatchLimit / profiles.length));

      const logDeleteStatements: D1PreparedStatement[] = [];

      for (const profile of profiles) {
        // ── 1. Time-based retention calculation ─────────────────────────────────
        let days = 30;
        try {
          const settings = JSON.parse(profile.settings);
          if (settings?.log_retention_days != null) {
            days = Number(settings.log_retention_days);
          }
        } catch {
          // Use default on parse error
        }

        // Enforce global hard cap: user setting cannot exceed maxRetentionDays
        const effectiveDays = Math.min(days, maxRetentionDays);
        const threshold = Math.floor(Date.now() / 1000 - effectiveDays * 24 * 3600);

        // Delete bounded number of rows per profile per hourly cron run if budget remains
        if (canDeleteLogs && effectiveBatchLimit > 0) {
          logDeleteStatements.push(
            this.db.prepare(`
              DELETE FROM logs WHERE (profile_id, timestamp, id) IN (
                SELECT profile_id, timestamp, id FROM logs WHERE profile_id = ? AND timestamp < ? LIMIT ?
              )
            `).bind(profile.id, threshold, perProfileLimit)
          );
        }
      }

      // Execute log deletions in chunks and track affected rows
      const CHUNK_SIZE = 50;
      let newlyDeletedLogs = 0;
      if (logDeleteStatements.length > 0) {
        for (let i = 0; i < logDeleteStatements.length; i += CHUNK_SIZE) {
          const chunk = logDeleteStatements.slice(i, i + CHUNK_SIZE);
          const results = await this.db.batch(chunk);
          if (Array.isArray(results)) {
            for (const res of results) {
              if (res?.meta?.changes !== undefined) {
                newlyDeletedLogs += res.meta.changes;
              } else if (res?.meta?.rows_written !== undefined) {
                newlyDeletedLogs += res.meta.rows_written;
              }
            }
          }
        }

        // Persist daily cleanup counter to system_settings
        if (dailyBudget > 0) {
          const updatedTotal = deletedToday + newlyDeletedLogs;
          try {
            await this.settingsModel.setMany({
              log_cleanup_daily_date: todayDate,
              log_cleanup_daily_count: String(updatedTotal)
            });
          } catch (err) {
            console.warn("[LogRetentionModel] Failed to persist daily cleanup count:", err);
          }
        }
      }

      // ── Orphan kem_keys cleanup (Zero Dependents) ───────────────────────────
      // Automatically purges kem_keys that have zero referencing logs in D1,
      // strictly ensuring keys with active dependent logs are preserved regardless of age.
      try {
        const kemKeyModel = new KemKeyModel(this.db);
        const deletedOrphanKeys = await kemKeyModel.cleanupOrphans();
        if (deletedOrphanKeys > 0) {
          console.log(
            `[LogRetentionModel] Cleaned up ${deletedOrphanKeys} orphaned kem_keys with zero referencing logs.`
          );
        }
      } catch (kemErr) {
        console.warn("[LogRetentionModel] Failed to cleanup orphaned kem_keys:", kemErr);
      }

      console.log(
        `[LogRetentionModel] cleanupGlobal: processed ${profiles.length} profile(s), maxRetentionDays=${maxRetentionDays}d, batchLimit=${batchLimit} (effective=${effectiveBatchLimit}, perProfile=${perProfileLimit}), dailyBudget=${dailyBudget} (today: ${deletedToday + newlyDeletedLogs}/${dailyBudget})`
      );
    } catch (e: any) {
      console.error("[LogRetentionModel] cleanupGlobal failed:", e.message || e);
    }
  }
}
