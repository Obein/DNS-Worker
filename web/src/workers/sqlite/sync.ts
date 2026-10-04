/**
 * @file sync.ts
 * @description Synchronization, batch ingestion, E2EE decryption batch updates,
 * and sync watermark tracking for local-first SQLite logging.
 */

import { getDatabase } from './database';
import type {
  SyncBatchPayload,
  UpdateLogsBatchPayload,
  GetEncryptedLogsPayload,
  GetWatermarkPayload,
  SyncWatermarkRow,
  WorkerLogEntry,
} from './types';

/**
 * Inserts or replaces a batch of logs in a single atomic transaction and advances
 * the profile's synchronization watermark.
 *
 * @param payload - Batch ingestion details containing profileId and log entries.
 * @returns Object with the number of inserted records.
 */
export function handleSyncBatch(payload: SyncBatchPayload): { inserted: number } {
  const db = getDatabase();
  const { profileId, logs } = payload;
  if (!logs || logs.length === 0) return { inserted: 0 };

  let insertedCount = 0;
  let batchMinTime = Infinity;
  let batchMaxTime = -Infinity;

  db.exec('BEGIN TRANSACTION;');
  try {
    const insertStmt = db.prepare(`
      INSERT OR REPLACE INTO local_logs (
        profile_id, timestamp, id, domain, record_type, action, reason,
        client_ip, geo_country, answer, dest_geoip, ecs, upstream, latency,
        access_point_id, access_point_name, dest_country_code, dest_country, dest_isp,
        encrypt_version, kem_key_id, kem_ct, encrypted_payload
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `);

    try {
      for (const log of logs) {
        if (log.timestamp < batchMinTime) batchMinTime = log.timestamp;
        if (log.timestamp > batchMaxTime) batchMaxTime = log.timestamp;

        insertStmt.bind([
          profileId,
          log.timestamp,
          log.id !== undefined && log.id !== null ? log.id : (log.timestamp * 1000 + Math.floor(Math.random() * 1000)),
          log.domain || '',
          log.record_type || 'A',
          log.action || 'PASS',
          log.reason || null,
          log.client_ip || '',
          log.geo_country || null,
          log.answer || null,
          log.dest_geoip || null,
          log.ecs || null,
          log.upstream || null,
          log.latency !== undefined ? log.latency : null,
          log.access_point_id || null,
          log.access_point_name || null,
          log.dest_country_code || null,
          log.dest_country || null,
          log.dest_isp || null,
          log.encrypt_version ?? 0,
          log.kem_key_id || null,
          log.kem_ct || null,
          log.encrypted_payload || null
        ]);
        insertStmt.step();
        insertStmt.reset();
        insertedCount++;
      }
    } finally {
      insertStmt.finalize();
    }

    // Update watermark for this profile
    const now = Math.floor(Date.now() / 1000);
    const existing = db.selectObject(
      'SELECT latest_timestamp, earliest_timestamp, total_synced_count FROM sync_watermarks WHERE profile_id = ?;',
      [profileId]
    ) as Partial<SyncWatermarkRow> | undefined;

    if (existing && existing.latest_timestamp !== undefined && existing.earliest_timestamp !== undefined) {
      const newLatest = Math.max(Number(existing.latest_timestamp), batchMaxTime);
      const newEarliest = Math.min(Number(existing.earliest_timestamp), batchMinTime);
      const newCount = Number(existing.total_synced_count || 0) + insertedCount;

      db.exec({
        sql: `
          UPDATE sync_watermarks 
          SET latest_timestamp = ?, earliest_timestamp = ?, last_synced_at = ?, total_synced_count = ?
          WHERE profile_id = ?;
        `,
        bind: [newLatest, newEarliest, now, newCount, profileId]
      });
    } else {
      db.exec({
        sql: `
          INSERT INTO sync_watermarks (profile_id, latest_timestamp, earliest_timestamp, last_synced_at, total_synced_count)
          VALUES (?, ?, ?, ?, ?);
        `,
        bind: [profileId, batchMaxTime, batchMinTime, now, insertedCount]
      });
    }

    db.exec('COMMIT;');
    return { inserted: insertedCount };
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }
}

/**
 * Retrieves the current watermark boundaries and statistics for a given profile.
 *
 * @param payload - Profile identification payload.
 * @returns SyncWatermarkRow if found, or null.
 */
export function handleGetWatermark(payload: GetWatermarkPayload): SyncWatermarkRow | null {
  const db = getDatabase();
  const row = db.selectObject(
    'SELECT latest_timestamp, earliest_timestamp, last_synced_at, total_synced_count FROM sync_watermarks WHERE profile_id = ?;',
    [payload.profileId]
  ) as unknown as SyncWatermarkRow | undefined;

  return row || null;
}

/**
 * Updates decrypted log fields in a single atomic transaction for End-to-End Encryption.
 *
 * @param payload - Batch containing decrypted log entries to persist.
 * @returns Object with the count of updated records.
 */
export function handleUpdateLogsBatch(payload: UpdateLogsBatchPayload): { updated: number } {
  const db = getDatabase();
  const { profileId, logs } = payload;
  if (!logs || logs.length === 0) return { updated: 0 };

  db.exec('BEGIN TRANSACTION;');
  try {
    const updateStmt = db.prepare(`
      UPDATE local_logs SET
        domain = ?, client_ip = ?, geo_country = ?, answer = ?,
        dest_geoip = ?, dest_country_code = ?, dest_country = ?, dest_isp = ?,
        ecs = ?, upstream = ?, reason = ?, encrypt_version = 0, encrypted_payload = NULL
      WHERE profile_id = ? AND timestamp = ? AND id = ?;
    `);

    try {
      for (const log of logs) {
        updateStmt.bind([
          log.domain || '',
          log.client_ip || '',
          log.geo_country || null,
          log.answer || null,
          log.dest_geoip || null,
          log.dest_country_code || null,
          log.dest_country || null,
          log.dest_isp || null,
          log.ecs || null,
          log.upstream || null,
          log.reason || null,
          profileId,
          log.timestamp,
          log.id
        ]);
        updateStmt.step();
        updateStmt.reset();
      }
    } finally {
      updateStmt.finalize();
    }

    db.exec('COMMIT;');
    return { updated: logs.length };
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }
}

/**
 * Retrieves records that remain encrypted so the main thread can orchestrate decryption with Passkey.
 *
 * @param payload - Query options containing profileId and maximum limit.
 * @returns Array of encrypted WorkerLogEntry records.
 */
export function handleGetEncryptedLogs(payload: GetEncryptedLogsPayload): { rows: WorkerLogEntry[] } {
  const db = getDatabase();
  const limit = payload.limit || 500;
  const rows: WorkerLogEntry[] = [];
  const stmt = db.prepare(`
    SELECT * FROM local_logs 
    WHERE profile_id = ? AND (encrypt_version > 0 OR (is_encrypted = 1 AND encrypt_version IS NULL))
    LIMIT ?;
  `);

  try {
    stmt.bind([payload.profileId, limit]);
    while (stmt.step()) {
      rows.push(stmt.get<WorkerLogEntry>({}));
    }
  } finally {
    stmt.finalize();
  }

  return { rows };
}
