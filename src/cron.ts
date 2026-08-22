import { ScheduledEvent } from '@cloudflare/workers-types';
import { Env, ExecutionContext } from './types';
import { LogModel } from './models/log';
import { UserModel } from './models/user';
import { ProfileModel } from './models/profile';
import { syncNextListForProfile } from './utils/sync';
import { syncCloudflareIpRanges } from './utils/ech';

/**
 * Handles cron-scheduled events to run background cleanup and list synchronization.
 *
 * Each trigger performs tasks in sequence:
 *   1. Cleanup         — delete stale logs and inactive users (lightweight, D1-bound)
 *   2. Cloudflare IPs  — sync official Cloudflare IP ranges once daily
 *   3. Sync            — process ONE pending list for a profile (CPU-bound, incremental)
 */
export async function handleScheduled(
  _event: ScheduledEvent,
  env: Env,
  ctx: ExecutionContext
): Promise<void> {
  try {
    // ── CLEANUP ───────────────────────────────────────────────────────────────
    // Lightweight D1 deletes — runs every trigger, negligible CPU cost.
    const now = Math.floor(Date.now() / 1000);

    try {
      const userModel = new UserModel(env.DB, env);
      const { clearedProfiles, deletedUsers } = await userModel.applyInactivityPolicy(now);
      if (clearedProfiles > 0 || deletedUsers > 0) {
        console.log(`[Cron] Inactivity cleanup: cleared ${clearedProfiles} profile(s), deleted ${deletedUsers} user(s).`);
      }
    } catch (e) {
      console.error("[Cron] Inactivity policy execution failed:", e);
    }

    try {
      const logModel = new LogModel(env.DB);
      const maxRetentionDays = Number(env.MAX_LOG_RETENTION_DAYS) || 90;
      const maxLogsPerProfile = Number(env.MAX_LOGS_PER_PROFILE) || 500_000;
      await logModel.cleanupGlobal(maxRetentionDays, maxLogsPerProfile);
      console.log("[Cron] Cleanup phase completed at", new Date().toISOString());
    } catch (e) {
      console.error("[Cron] Global log cleanup failed:", e);
    }

    // ── CLOUDFLARE IPS SYNC ───────────────────────────────────────────────────
    // Syncs official Cloudflare IP ranges daily from https://www.cloudflare.com/ips-v4 / v6
    try {
      await syncCloudflareIpRanges(env.DB);
    } catch (e) {
      console.error("[Cron] Cloudflare IP range sync failed:", e);
    }

    // ── SYNC ──────────────────────────────────────────────────────────────────
    // Processes ONE list for a single stale profile per trigger.
    // The profile's active Bloom Filter is NOT updated until all its lists are
    // done (A/B pattern): staging accumulates incrementally, active stays intact.
    try {
      const syncIntervalSec = Number(env.SYNC_PROFILE_INTERVAL_SEC) || 86400;
      const cutoffTime = now - syncIntervalSec;
      const profileModel = new ProfileModel(env.DB);
      const batchSize = Number(env.SYNC_BATCH_SIZE) || 1;
      const syncTargets = await profileModel.getSyncTargets(cutoffTime, batchSize);

      if (syncTargets.length > 0) {
        for (const target of syncTargets) {
          try {
            // Each call processes ONE list; the profile stays in getSyncTargets
            // until its full cycle completes (list_updated_at gets refreshed).
            await syncNextListForProfile(target.id, env, ctx);
          } catch (err: any) {
            console.error(`[Cron] Sync failed for profile ${target.id}:`, err.message || err);
          }
        }
        console.log(`[Cron] Sync: processed ${syncTargets.length} profile(s).`);
      }
    } catch (e) {
      console.error("[Cron] Sync phase failed:", e);
    }
  } catch (e: any) {
    console.error("[Cron] Critical Failure:", e.message);
  }
}
