/**
 * @file maintenance.ts
 * @description Storage lifecycle maintenance: log retention cleanup, automatic database
 * vacuuming, storage statistics inspection, and profile cache purging.
 */

import { getDatabase, isOpfsStorage } from './database';
import type {
  CleanupPayload,
  ClearProfilePayload,
  WorkerStorageInfo,
} from './types';

/**
 * Enforces log retention policy by deleting rows older than retention threshold and vacuuming if necessary.
 *
 * @param payload - Retention configuration with retentionDays.
 * @returns Object with the number of deleted records.
 */
export function handleCleanup(payload: CleanupPayload): { deleted: number } {
  const db = getDatabase();
  const { retentionDays } = payload;
  if (!retentionDays || retentionDays <= 0) return { deleted: 0 };

  const cutoff = Math.floor(Date.now() / 1000) - retentionDays * 86400;
  const beforeCountObj = db.selectObject('SELECT count(*) as count FROM local_logs;') as { count?: number } | undefined;
  const beforeCount = beforeCountObj?.count ? Number(beforeCountObj.count) : 0;

  db.exec({
    sql: 'DELETE FROM local_logs WHERE timestamp < ?;',
    bind: [cutoff]
  });

  const afterCountObj = db.selectObject('SELECT count(*) as count FROM local_logs;') as { count?: number } | undefined;
  const afterCount = afterCountObj?.count ? Number(afterCountObj.count) : 0;
  const deleted = beforeCount - afterCount;

  if (deleted > 1000) {
    try {
      db.exec('VACUUM;');
    } catch (e: unknown) {
      console.warn('[SQLite Worker] VACUUM skipped:', e);
    }
  }

  return { deleted };
}

/**
 * Inspects physical SQLite storage metrics, total row count, and per-profile distribution.
 *
 * @returns WorkerStorageInfo with telemetry data.
 */
export function handleGetStorageInfo(): WorkerStorageInfo {
  const db = getDatabase();
  const countObj = db.selectObject('SELECT count(*) as count FROM local_logs;') as { count?: number } | undefined;
  const totalRows = countObj?.count ? Number(countObj.count) : 0;

  const profileStats: {
    profile_id: string;
    count: number;
    earliest: number;
    latest: number;
  }[] = [];

  const stmt = db.prepare(`
    SELECT profile_id, count(*) as count, min(timestamp) as earliest, max(timestamp) as latest 
    FROM local_logs 
    GROUP BY profile_id;
  `);

  try {
    while (stmt.step()) {
      const row = stmt.get<{
        profile_id: string;
        count: number;
        earliest: number;
        latest: number;
      }>({});
      profileStats.push({
        profile_id: String(row.profile_id),
        count: Number(row.count) || 0,
        earliest: Number(row.earliest) || 0,
        latest: Number(row.latest) || 0
      });
    }
  } finally {
    stmt.finalize();
  }

  return {
    totalRows,
    isOpfs: isOpfsStorage(),
    profileStats
  };
}

/**
 * Purges all cached query logs and synchronization watermarks for a specific profile.
 *
 * @param payload - Profile identification payload.
 * @returns Object indicating successful deletion.
 */
export function handleClearProfile(payload: ClearProfilePayload): { success: boolean } {
  const db = getDatabase();
  db.exec({
    sql: 'DELETE FROM local_logs WHERE profile_id = ?;',
    bind: [payload.profileId]
  });
  db.exec({
    sql: 'DELETE FROM sync_watermarks WHERE profile_id = ?;',
    bind: [payload.profileId]
  });

  return { success: true };
}
