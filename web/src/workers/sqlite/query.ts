/**
 * @file query.ts
 * @description Dynamic query compilation, parameter binding, multi-column search,
 * action categorization stats, and paginated log retrieval for local SQLite storage.
 */

import { getDatabase } from './database';
import type {
  WorkerQueryLogsParams,
  WorkerQueryResult,
  WorkerLogEntry,
  ActionSummaryStats,
} from './types';

/**
 * Executes a filtered, paginated query against local_logs with total counts and action breakdown.
 *
 * @param params - Search, filter, boundary, and pagination options.
 * @returns WorkerQueryResult containing matched log records, total count, and action summary stats.
 */
export function handleQueryLogs(params: WorkerQueryLogsParams): WorkerQueryResult {
  const db = getDatabase();
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
  const binds: (string | number)[] = [profileId];

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

  // 1. Get total count
  const countObj = db.selectObject(
    `SELECT count(*) as total FROM local_logs WHERE ${whereClause};`,
    binds
  ) as { total?: number } | undefined;
  const total = countObj?.total ? Number(countObj.total) : 0;

  // 2. Calculate action summary stats (PASS, BLOCK, REDIRECT)
  const stats: ActionSummaryStats = { total: 0, pass: 0, block: 0, redirect: 0 };
  const statStmt = db.prepare(
    `SELECT action, count(*) as count FROM local_logs WHERE ${whereClause} GROUP BY action;`
  );
  try {
    statStmt.bind(binds);
    while (statStmt.step()) {
      const row = statStmt.get<{ action: string; count: number }>({});
      const cnt = Number(row.count) || 0;
      stats.total += cnt;
      if (row.action === 'PASS') stats.pass = cnt;
      else if (row.action === 'BLOCK') stats.block = cnt;
      else if (row.action === 'REDIRECT') stats.redirect = cnt;
    }
  } finally {
    statStmt.finalize();
  }

  // 3. Get paginated rows
  const queryBinds: (string | number)[] = [...binds, limit, offset];
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
      rows.push(stmt.get<WorkerLogEntry>({}));
    }
  } finally {
    stmt.finalize();
  }

  return { rows, total, stats };
}
