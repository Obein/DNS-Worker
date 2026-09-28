/**
 * @file sqlite.worker.ts
 * @description Dedicated Web Worker running official SQLite WASM with OPFS persistence.
 * Provides zero-latency, local-first logging, full-text search, and analytical aggregations.
 */

import sqlite3InitModule from '@sqlite.org/sqlite-wasm';

export interface WorkerLogEntry {
  id: number;
  timestamp: number;
  domain: string;
  record_type: string;
  action: 'PASS' | 'BLOCK' | 'REDIRECT' | 'FAIL';
  reason?: string;
  client_ip: string;
  geo_country?: string;
  answer?: string;
  dest_geoip?: string;
  ecs?: string;
  profile_name?: string;
  access_point_id?: string;
  access_point_name?: string;
  upstream?: string;
  latency?: number;
  dest_country_code?: string;
  dest_country?: string;
  dest_isp?: string;
  is_encrypted?: number;
  encrypted_payload?: string | null;
}

export interface WorkerQueryLogsParams {
  profileId: string;
  search?: string;
  action?: string;
  accessPointId?: string;
  destCountry?: string;
  isp?: string;
  since?: number;
  until?: number;
  before?: number;
  limit: number;
  offset?: number;
}

export interface WorkerAnalyticsParams {
  profileId: string;
  since: number;
  until: number;
  bucketSec: number;
  accessPointId?: string;
}

export interface WorkerMessageRequest {
  id: string;
  type:
    | 'INIT'
    | 'SYNC_BATCH'
    | 'UPDATE_LOGS_BATCH'
    | 'GET_ENCRYPTED_LOGS'
    | 'GET_WATERMARK'
    | 'QUERY_LOGS'
    | 'QUERY_ANALYTICS'
    | 'CLEANUP'
    | 'GET_STORAGE_INFO'
    | 'CLEAR_PROFILE';
  payload?: any;
}

export interface WorkerMessageResponse {
  id: string;
  success: boolean;
  data?: any;
  error?: string;
}

let db: any = null;
let isOpfs = false;
let initPromise: Promise<boolean> | null = null;

async function initDatabase(): Promise<boolean> {
  if (db) return isOpfs;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      const sqlite3 = await sqlite3InitModule();

      // 1. Try to initialize persistent OPFS database
      if ('opfs' in sqlite3) {
        try {
          db = new sqlite3.oo1.OpfsDb('/obex_local_logs.sqlite3', 'c');
          isOpfs = true;
          console.log('[SQLite Worker] Successfully opened OPFS persistent database');
        } catch (opfsErr) {
          console.warn('[SQLite Worker] OPFS initialization failed, falling back to in-memory:', opfsErr);
          db = new sqlite3.oo1.DB('/obex_local_logs_mem.sqlite3', 'c');
          isOpfs = false;
        }
      } else {
        console.warn('[SQLite Worker] OPFS not supported in this browser, using in-memory SQLite');
        db = new sqlite3.oo1.DB('/obex_local_logs_mem.sqlite3', 'c');
        isOpfs = false;
      }

      // 2. Performance tuning & Schema creation
      db.exec(`
        PRAGMA synchronous = NORMAL;
        
        CREATE TABLE IF NOT EXISTS local_logs (
          profile_id TEXT NOT NULL,
          timestamp INTEGER NOT NULL,
          id INTEGER NOT NULL,
          domain TEXT NOT NULL,
          record_type TEXT NOT NULL,
          action TEXT NOT NULL,
          reason TEXT,
          client_ip TEXT NOT NULL,
          geo_country TEXT,
          answer TEXT,
          dest_geoip TEXT,
          ecs TEXT,
          upstream TEXT,
          latency INTEGER,
          access_point_id TEXT,
          dest_country_code TEXT,
          dest_country TEXT,
          dest_isp TEXT,
          is_encrypted INTEGER DEFAULT 0,
          encrypted_payload TEXT,
          PRIMARY KEY (profile_id, timestamp, id)
        );

        CREATE INDEX IF NOT EXISTS idx_local_logs_time ON local_logs (profile_id, timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_local_logs_domain ON local_logs (profile_id, domain);
        CREATE INDEX IF NOT EXISTS idx_local_logs_action ON local_logs (profile_id, action);
        CREATE INDEX IF NOT EXISTS idx_local_logs_client ON local_logs (profile_id, client_ip);

        CREATE TABLE IF NOT EXISTS sync_watermarks (
          profile_id TEXT PRIMARY KEY,
          latest_timestamp INTEGER NOT NULL,
          earliest_timestamp INTEGER NOT NULL,
          last_synced_at INTEGER NOT NULL,
          total_synced_count INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS local_settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
      `);

      return isOpfs;
    } catch (err: any) {
      console.error('[SQLite Worker] Fatal initialization error:', err);
      throw err;
    }
  })();

  return initPromise;
}

function handleSyncBatch(payload: {
  profileId: string;
  logs: WorkerLogEntry[];
  minTimestamp?: number;
  maxTimestamp?: number;
}): { inserted: number } {
  if (!db) throw new Error('Database not initialized');
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
        access_point_id, dest_country_code, dest_country, dest_isp,
        is_encrypted, encrypted_payload
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `);

    try {
      for (const log of logs) {
        if (log.timestamp < batchMinTime) batchMinTime = log.timestamp;
        if (log.timestamp > batchMaxTime) batchMaxTime = log.timestamp;

        insertStmt.bind([
          profileId,
          log.timestamp,
          log.id,
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
          log.dest_country_code || null,
          log.dest_country || null,
          log.dest_isp || null,
          log.is_encrypted ? 1 : 0,
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
    );

    if (existing) {
      const newLatest = Math.max(existing.latest_timestamp as number, batchMaxTime);
      const newEarliest = Math.min(existing.earliest_timestamp as number, batchMinTime);
      const newCount = (existing.total_synced_count as number) + insertedCount;

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

function handleGetWatermark(payload: { profileId: string }) {
  if (!db) throw new Error('Database not initialized');
  return (
    db.selectObject(
      'SELECT latest_timestamp, earliest_timestamp, last_synced_at, total_synced_count FROM sync_watermarks WHERE profile_id = ?;',
      [payload.profileId]
    ) || null
  );
}

function handleQueryLogs(params: WorkerQueryLogsParams) {
  if (!db) throw new Error('Database not initialized');
  const {
    profileId,
    search,
    action,
    accessPointId,
    destCountry,
    isp,
    since,
    until,
    before,
    limit,
    offset = 0
  } = params;

  const conditions: string[] = ['profile_id = ?'];
  const binds: any[] = [profileId];

  if (since !== undefined) {
    conditions.push('timestamp >= ?');
    binds.push(since);
  }
  if (until !== undefined) {
    conditions.push('timestamp <= ?');
    binds.push(until);
  }
  if (before !== undefined) {
    conditions.push('timestamp < ?');
    binds.push(before);
  }
  if (action && action !== 'ALL') {
    conditions.push('action = ?');
    binds.push(action);
  }
  if (accessPointId) {
    conditions.push('access_point_id = ?');
    binds.push(accessPointId);
  }
  if (destCountry) {
    conditions.push('dest_country = ?');
    binds.push(destCountry);
  }
  if (isp) {
    conditions.push('dest_isp = ?');
    binds.push(isp);
  }
  if (search && search.trim()) {
    conditions.push('(domain LIKE ? OR client_ip LIKE ? OR reason LIKE ?)');
    const likePattern = `%${search.trim()}%`;
    binds.push(likePattern, likePattern, likePattern);
  }

  const whereClause = conditions.join(' AND ');

  // Get total count
  const countObj = db.selectObject(`SELECT count(*) as total FROM local_logs WHERE ${whereClause};`, binds);
  const total = countObj ? (countObj.total as number) : 0;

  // Calculate action summary stats (PASS, BLOCK, REDIRECT)
  const stats = { total: 0, pass: 0, block: 0, redirect: 0 };
  const statStmt = db.prepare(`SELECT action, count(*) as count FROM local_logs WHERE ${whereClause} GROUP BY action;`);
  try {
    statStmt.bind(binds);
    while (statStmt.step()) {
      const row = statStmt.get({});
      const cnt = (row.count as number) || 0;
      stats.total += cnt;
      if (row.action === 'PASS') stats.pass = cnt;
      else if (row.action === 'BLOCK') stats.block = cnt;
      else if (row.action === 'REDIRECT') stats.redirect = cnt;
    }
  } finally {
    statStmt.finalize();
  }

  // Get paginated rows
  const queryBinds = [...binds, limit, offset];
  const rows: WorkerLogEntry[] = [];

  const stmt = db.prepare(`
    SELECT * FROM local_logs 
    WHERE ${whereClause} 
    ORDER BY timestamp DESC, id DESC 
    LIMIT ? OFFSET ?;
  `);

  try {
    stmt.bind(queryBinds);
    while (stmt.step()) {
      rows.push(stmt.get({}));
    }
  } finally {
    stmt.finalize();
  }

  return { rows, total, stats };
}

function handleQueryAnalytics(params: WorkerAnalyticsParams) {
  if (!db) throw new Error('Database not initialized');
  const { profileId, since, until, bucketSec, accessPointId } = params;

  let baseWhere = 'profile_id = ? AND timestamp BETWEEN ? AND ?';
  const baseBinds: any[] = [profileId, since, until];
  if (accessPointId) {
    baseWhere += ' AND access_point_id = ?';
    baseBinds.push(accessPointId);
  }

  // 1. Summary by Action
  const summaryRows: { action: string; count: number }[] = [];
  const summaryStmt = db.prepare(`
    SELECT action, count(*) as count 
    FROM local_logs 
    WHERE ${baseWhere} 
    GROUP BY action;
  `);
  try {
    summaryStmt.bind(baseBinds);
    while (summaryStmt.step()) {
      summaryRows.push(summaryStmt.get({}));
    }
  } finally {
    summaryStmt.finalize();
  }

  // 2. Timeline Trend
  const trendRows: { timestamp: number; action: string; count: number }[] = [];
  const trendStmt = db.prepare(`
    SELECT (timestamp / ?) * ? as timestamp, action, count(*) as count 
    FROM local_logs 
    WHERE ${baseWhere} 
    GROUP BY timestamp, action 
    ORDER BY timestamp ASC;
  `);
  try {
    trendStmt.bind([bucketSec, bucketSec, ...baseBinds]);
    while (trendStmt.step()) {
      trendRows.push(trendStmt.get({}));
    }
  } finally {
    trendStmt.finalize();
  }

  // 3. Top Allowed Domains
  const topAllowed: { domain: string; count: number }[] = [];
  const allowedStmt = db.prepare(`
    SELECT domain, count(*) as count 
    FROM local_logs 
    WHERE ${baseWhere} AND action IN ('PASS', 'REDIRECT') 
    GROUP BY domain 
    ORDER BY count DESC 
    LIMIT 10;
  `);
  try {
    allowedStmt.bind(baseBinds);
    while (allowedStmt.step()) {
      topAllowed.push(allowedStmt.get({}));
    }
  } finally {
    allowedStmt.finalize();
  }

  // 4. Top Blocked Domains
  const topBlocked: { domain: string; count: number }[] = [];
  const blockedStmt = db.prepare(`
    SELECT domain, count(*) as count 
    FROM local_logs 
    WHERE ${baseWhere} AND action = 'BLOCK' 
    GROUP BY domain 
    ORDER BY count DESC 
    LIMIT 10;
  `);
  try {
    blockedStmt.bind(baseBinds);
    while (blockedStmt.step()) {
      topBlocked.push(blockedStmt.get({}));
    }
  } finally {
    blockedStmt.finalize();
  }

  // 5. Client IPs
  const clients: { client_ip: string; geo_country: string; count: number }[] = [];
  const clientStmt = db.prepare(`
    SELECT client_ip, COALESCE(geo_country, 'Unknown') as geo_country, count(*) as count 
    FROM local_logs 
    WHERE ${baseWhere} 
    GROUP BY client_ip 
    ORDER BY count DESC 
    LIMIT 10;
  `);
  try {
    clientStmt.bind(baseBinds);
    while (clientStmt.step()) {
      clients.push(clientStmt.get({}));
    }
  } finally {
    clientStmt.finalize();
  }

  // 6. Destinations
  const destinations: { country_code: string; country: string; count: number }[] = [];
  const destStmt = db.prepare(`
    SELECT dest_country_code as country_code, COALESCE(dest_country, 'Unknown') as country, count(*) as count 
    FROM local_logs 
    WHERE ${baseWhere} AND dest_country_code IS NOT NULL AND dest_country_code != ''
    GROUP BY dest_country_code, dest_country 
    ORDER BY count DESC 
    LIMIT 15;
  `);
  try {
    destStmt.bind(baseBinds);
    while (destStmt.step()) {
      destinations.push(destStmt.get({}));
    }
  } finally {
    destStmt.finalize();
  }

  return {
    summary: summaryRows,
    trend: trendRows,
    top_allowed: topAllowed,
    top_blocked: topBlocked,
    clients,
    destinations
  };
}

function handleCleanup(payload: { retentionDays: number }): { deleted: number } {
  if (!db) throw new Error('Database not initialized');
  const { retentionDays } = payload;
  if (!retentionDays || retentionDays <= 0) return { deleted: 0 };

  const cutoff = Math.floor(Date.now() / 1000) - retentionDays * 86400;
  const beforeCount = (db.selectObject('SELECT count(*) as count FROM local_logs;') as any).count;

  db.exec({
    sql: 'DELETE FROM local_logs WHERE timestamp < ?;',
    bind: [cutoff]
  });

  const afterCount = (db.selectObject('SELECT count(*) as count FROM local_logs;') as any).count;
  const deleted = beforeCount - afterCount;

  if (deleted > 1000) {
    try {
      db.exec('VACUUM;');
    } catch (e) {
      console.warn('[SQLite Worker] VACUUM skipped:', e);
    }
  }

  return { deleted };
}

function handleGetStorageInfo() {
  if (!db) throw new Error('Database not initialized');
  const countObj = db.selectObject('SELECT count(*) as count FROM local_logs;') as any;
  const totalRows = countObj ? countObj.count : 0;

  const profileStats: any[] = [];
  const stmt = db.prepare(`
    SELECT profile_id, count(*) as count, min(timestamp) as earliest, max(timestamp) as latest 
    FROM local_logs 
    GROUP BY profile_id;
  `);
  try {
    while (stmt.step()) {
      profileStats.push(stmt.get({}));
    }
  } finally {
    stmt.finalize();
  }

  return {
    totalRows,
    isOpfs,
    profileStats
  };
}

function handleClearProfile(payload: { profileId: string }) {
  if (!db) throw new Error('Database not initialized');
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

function handleUpdateLogsBatch(payload: { profileId: string; logs: WorkerLogEntry[] }) {
  if (!db) throw new Error('Database not initialized');
  const { profileId, logs } = payload;
  if (!logs || logs.length === 0) return { updated: 0 };

  db.exec('BEGIN TRANSACTION;');
  try {
    const updateStmt = db.prepare(`
      UPDATE local_logs SET
        domain = ?, client_ip = ?, geo_country = ?, answer = ?,
        dest_geoip = ?, dest_country_code = ?, dest_country = ?, dest_isp = ?,
        ecs = ?, upstream = ?, reason = ?, is_encrypted = 0, encrypted_payload = NULL
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

function handleGetEncryptedLogs(payload: { profileId: string; limit?: number }) {
  if (!db) throw new Error('Database not initialized');
  const limit = payload.limit || 500;
  const rows: WorkerLogEntry[] = [];
  const stmt = db.prepare(`
    SELECT * FROM local_logs WHERE profile_id = ? AND is_encrypted = 1 LIMIT ?;
  `);
  try {
    stmt.bind([payload.profileId, limit]);
    while (stmt.step()) {
      rows.push(stmt.get({}));
    }
  } finally {
    stmt.finalize();
  }
  return { rows };
}

// ── Web Worker Message Dispatcher ──
self.onmessage = async (e: MessageEvent<WorkerMessageRequest>) => {
  const { id, type, payload } = e.data;

  try {
    let result: any = null;

    switch (type) {
      case 'INIT': {
        const opfsReady = await initDatabase();
        result = { ready: true, isOpfs: opfsReady };
        break;
      }
      case 'SYNC_BATCH':
        result = handleSyncBatch(payload);
        break;
      case 'UPDATE_LOGS_BATCH':
        result = handleUpdateLogsBatch(payload);
        break;
      case 'GET_ENCRYPTED_LOGS':
        result = handleGetEncryptedLogs(payload);
        break;
      case 'GET_WATERMARK':
        result = handleGetWatermark(payload);
        break;
      case 'QUERY_LOGS':
        result = handleQueryLogs(payload);
        break;
      case 'QUERY_ANALYTICS':
        result = handleQueryAnalytics(payload);
        break;
      case 'CLEANUP':
        result = handleCleanup(payload);
        break;
      case 'GET_STORAGE_INFO':
        result = handleGetStorageInfo();
        break;
      case 'CLEAR_PROFILE':
        result = handleClearProfile(payload);
        break;
      default:
        throw new Error(`Unknown worker message type: ${type}`);
    }

    self.postMessage({ id, success: true, data: result } as WorkerMessageResponse);
  } catch (err: any) {
    console.error(`[SQLite Worker] Error executing ${type}:`, err);
    self.postMessage({
      id,
      success: false,
      error: err.message || String(err)
    } as WorkerMessageResponse);
  }
};
