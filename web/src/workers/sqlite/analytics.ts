/**
 * @file analytics.ts
 * @description Analytical aggregation service extracting time-bucketed trends,
 * top allowed/blocked domain rankings, active clients, and geographic destinations from local SQLite.
 */

import { getDatabase } from './database';
import type { WorkerAnalyticsParams, WorkerAnalyticsResult } from './types';

/**
 * Computes multi-dimensional analytics for a specific time range and profile.
 *
 * @param params - Analytics boundaries, bucket size, and optional access point filter.
 * @returns WorkerAnalyticsResult with summary, trend, top domains, clients, and destinations.
 */
export function handleQueryAnalytics(params: WorkerAnalyticsParams): WorkerAnalyticsResult {
  const db = getDatabase();
  const { profileId, since, until, bucketSec, accessPointId } = params;

  let baseWhere = 'profile_id = ? AND timestamp BETWEEN ? AND ?';
  const baseBinds: (string | number)[] = [profileId, since, until];
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
      summaryRows.push(summaryStmt.get<{ action: string; count: number }>({}));
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
      trendRows.push(trendStmt.get<{ timestamp: number; action: string; count: number }>({}));
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
      topAllowed.push(allowedStmt.get<{ domain: string; count: number }>({}));
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
      topBlocked.push(blockedStmt.get<{ domain: string; count: number }>({}));
    }
  } finally {
    blockedStmt.finalize();
  }

  // 5. Client IPs
  const clients: { client_ip: string; geo_country: string; count: number }[] = [];
  const clientStmt = db.prepare(`
    SELECT client_ip, COALESCE(geo_country, 'Unknown') as geo_country, count(*) as count 
    FROM local_logs 
    WHERE ${baseWhere} AND client_ip IS NOT NULL AND client_ip != ''
    GROUP BY client_ip 
    ORDER BY count DESC 
    LIMIT 10;
  `);
  try {
    clientStmt.bind(baseBinds);
    while (clientStmt.step()) {
      clients.push(clientStmt.get<{ client_ip: string; geo_country: string; count: number }>({}));
    }
  } finally {
    clientStmt.finalize();
  }

  // 6. Destinations
  const destinations: { country_code: string; country: string; count: number }[] = [];
  const destStmt = db.prepare(`
    SELECT 
      COALESCE(dest_country_code, json_extract(dest_geoip, '$.country_code')) as country_code,
      COALESCE(dest_country, json_extract(dest_geoip, '$.country'), 'Unknown') as country,
      count(*) as count 
    FROM local_logs 
    WHERE ${baseWhere} 
      AND (
        (dest_country_code IS NOT NULL AND dest_country_code != '')
        OR
        (dest_geoip IS NOT NULL AND json_extract(dest_geoip, '$.country_code') IS NOT NULL AND json_extract(dest_geoip, '$.country_code') != '')
      )
    GROUP BY country_code, country 
    ORDER BY count DESC 
    LIMIT 15;
  `);
  try {
    destStmt.bind(baseBinds);
    while (destStmt.step()) {
      destinations.push(destStmt.get<{ country_code: string; country: string; count: number }>({}));
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
