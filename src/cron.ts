import { ScheduledEvent } from '@cloudflare/workers-types';
import { Env, ExecutionContext } from './types';
import { LogModel } from './models/log';
import { UserModel } from './models/user';
import { SessionModel } from './models/session';
import { ProfileModel } from './models/profile';
import { syncProfileLists } from './utils/sync';

/**
 * Handles cron-scheduled events to run background cleanups and list synchronization.
 */
export async function handleScheduled(
  event: ScheduledEvent,
  env: Env,
  ctx: ExecutionContext
): Promise<void> {
  try {
    const logModel = new LogModel(env.DB);
    const now = Math.floor(Date.now() / 1000);
    const inactivityDays = Number(env.INACTIVITY_THRESHOLD_DAYS) || 180;
    const inactivityThreshold = now - (inactivityDays * 24 * 3600);

    // Clean up inactive users (cascading delete) after 180 days of inactivity
    try {
      const userModel = new UserModel(env.DB);
      await userModel.cleanupInactiveUsers(inactivityThreshold);
    } catch (e) {
      console.error("[Cron] Inactive users cleanup failed:", e);
    }

    // Clean up expired sessions and temporary TOTP pre-auth sessions
    try {
      const sessionModel = new SessionModel(env.DB);
      await sessionModel.cleanupExpired(now);
    } catch (e) {
      console.error("[Cron] Expired sessions cleanup failed:", e);
    }

    // Clean up global resolution logs based on retention settings
    try {
      await logModel.cleanupGlobal();
    } catch (e) {
      console.error("[Cron] Global log cleanup failed:", e);
    }

    // Synchronize external filter blocklists for profiles
    try {
      const syncIntervalSec = Number(env.SYNC_PROFILE_INTERVAL_SEC) || 86400;
      const cutoffTime = now - syncIntervalSec;
      const profileModel = new ProfileModel(env.DB);
      const syncTargets = await profileModel.getSyncTargets(cutoffTime, 10);

      for (const target of syncTargets) {
        ctx.waitUntil(syncProfileLists(target.id, env, ctx));
      }
      if (syncTargets.length > 0) {
        console.log(`[Cron] Scheduled sync for ${syncTargets.length} profiles.`);
      }
    } catch (e) {
      console.error("[Cron] List sync scheduling failed:", e);
    }

    console.log(`[Cron] Scheduled tasks completed at ${new Date().toISOString()}`);
  } catch (e: any) {
    console.error("[Cron] Critical Failure:", e.message);
  }
}
