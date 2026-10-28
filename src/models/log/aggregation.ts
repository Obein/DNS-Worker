import { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import { SystemSettingsModel } from "../systemSettings";
import { ResolutionLog } from "../../types";

/**
 * Model responsible for maintaining and computing hourly rollups
 * across resolution logs, clients, destinations, and domains in a unified table.
 */
export class LogAggregationModel {
  private tablesEnsured = false;

  constructor(private readonly db: D1Database) {}

  /**
   * Automatically creates the unified hourly_rollups table if it does not exist yet.
   * Self-heals environments (such as Turso on Cloudflare Workers) where build-time D1 migrations
   * do not execute against the remote Turso database.
   */
  async ensureRollupTables(): Promise<void> {
    if (this.tablesEnsured) return;
    if (typeof this.db.exec !== 'function') return;
    try {
      await this.db.exec(`
        CREATE TABLE IF NOT EXISTS hourly_rollups (
            profile_id TEXT NOT NULL,
            metric_type TEXT NOT NULL,
            hour_timestamp INTEGER NOT NULL,
            key TEXT NOT NULL,
            sub_key TEXT NOT NULL DEFAULT '',
            access_point_id TEXT NOT NULL DEFAULT '',
            count INTEGER NOT NULL DEFAULT 1,
            PRIMARY KEY (
                profile_id,
                metric_type,
                hour_timestamp,
                key,
                sub_key,
                access_point_id
            )
        ) WITHOUT ROWID;
      `);
      this.tablesEnsured = true;
    } catch (e: any) {
      console.warn("[LogAggregationModel] ensureRollupTables notice:", e.message || e);
    }
  }

  /**
   * Generates atomic UPSERT statements for in-flight log micro-batches before sensitive data encryption.
   * Aggregates occurrences in-memory by (profile_id, metric_type, hour_timestamp, key, sub_key, access_point_id)
   * to drastically reduce database write row count.
   *
   * @param logs - Array of raw unencrypted resolution logs.
   * @returns Array of D1PreparedStatements to be committed atomically with log batch.
   */
  createRollupUpsertStatements(logs: ResolutionLog[]): D1PreparedStatement[] {
    if (!logs || logs.length === 0) return [];

    interface RollupItem {
      profileId: string;
      metricType: string;
      hourTimestamp: number;
      key: string;
      subKey: string;
      accessPointId: string;
      count: number;
    }

    const map = new Map<string, RollupItem>();

    for (const log of logs) {
      if (!log.profile_id) continue;
      const hourTs = Math.floor(log.timestamp / 3600) * 3600;
      const apId = log.access_point_id || '';

      // 1. Action metric (for traffic summary and trend)
      if (log.action) {
        const actionKey = `${log.profile_id}|action|${hourTs}|${log.action}||${apId}`;
        const existing = map.get(actionKey);
        if (existing) {
          existing.count++;
        } else {
          map.set(actionKey, {
            profileId: log.profile_id,
            metricType: 'action',
            hourTimestamp: hourTs,
            key: log.action,
            subKey: '',
            accessPointId: apId,
            count: 1
          });
        }
      }

      // 2. Domain metric (for top allowed and blocked domains)
      if (log.domain && log.domain !== '[Encrypted]') {
        const domainKey = `${log.profile_id}|domain|${hourTs}|${log.domain}|${log.action || ''}|${apId}`;
        const existing = map.get(domainKey);
        if (existing) {
          existing.count++;
        } else {
          map.set(domainKey, {
            profileId: log.profile_id,
            metricType: 'domain',
            hourTimestamp: hourTs,
            key: log.domain,
            subKey: log.action || '',
            accessPointId: apId,
            count: 1
          });
        }
      }

      // 3. Client IP & geo country metric (for client device analytics)
      if (log.client_ip && log.client_ip !== '[Encrypted]') {
        const geoCountry = log.geo_country || '';
        const clientKey = `${log.profile_id}|client|${hourTs}|${log.client_ip}|${geoCountry}|${apId}`;
        const existing = map.get(clientKey);
        if (existing) {
          existing.count++;
        } else {
          map.set(clientKey, {
            profileId: log.profile_id,
            metricType: 'client',
            hourTimestamp: hourTs,
            key: log.client_ip,
            subKey: geoCountry,
            accessPointId: apId,
            count: 1
          });
        }
      }

      // 4. Destination country metric (for geo destination analytics)
      let destCode = log.dest_country_code || '';
      let destCountry = log.dest_country || '';
      if (!destCode && log.dest_geoip && log.dest_geoip.startsWith('{')) {
        try {
          const parsed = JSON.parse(log.dest_geoip);
          destCode = parsed.country_code || '';
          destCountry = parsed.country || '';
        } catch {}
      }
      if (destCode) {
        const codeUpper = destCode.toUpperCase();
        const destKey = `${log.profile_id}|dest|${hourTs}|${codeUpper}|${destCountry}|${apId}`;
        const existing = map.get(destKey);
        if (existing) {
          existing.count++;
        } else {
          map.set(destKey, {
            profileId: log.profile_id,
            metricType: 'dest',
            hourTimestamp: hourTs,
            key: codeUpper,
            subKey: destCountry,
            accessPointId: apId,
            count: 1
          });
        }
      }
    }

    const statements: D1PreparedStatement[] = [];
    for (const item of map.values()) {
      statements.push(
        this.db.prepare(`
          INSERT INTO hourly_rollups (profile_id, metric_type, hour_timestamp, key, sub_key, access_point_id, count)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (profile_id, metric_type, hour_timestamp, key, sub_key, access_point_id)
          DO UPDATE SET count = count + excluded.count
        `).bind(
          item.profileId,
          item.metricType,
          item.hourTimestamp,
          item.key,
          item.subKey,
          item.accessPointId,
          item.count
        )
      );
    }

    return statements;
  }

  /**
   * Retrieves the latest completed hour timestamp aggregated in hourly_rollups for a profile and metric.
   *
   * @param profileId - Profile identifier.
   * @param metricType - Optional metric type ('action', 'domain', 'client', 'dest'). Defaults to 'action'.
   * @returns The latest hour timestamp, or null if no rollups exist.
   */
  async getLatestRollupHour(profileId: string, metricType = 'action'): Promise<number | null> {
    try {
      const row = await this.db.prepare(
        "SELECT MAX(hour_timestamp) as max_hour FROM hourly_rollups WHERE profile_id = ? AND metric_type = ?"
      ).bind(profileId, metricType).first<{ max_hour: number | null }>();
      return row?.max_hour ?? null;
    } catch {
      await this.ensureRollupTables();
      return null;
    }
  }

  /**
   * Retrieves the latest completed hour timestamp aggregated in hourly_rollups for clients.
   */
  async getLatestClientRollupHour(profileId: string): Promise<number | null> {
    return this.getLatestRollupHour(profileId, 'client');
  }

  /**
   * Retrieves the latest completed hour timestamp aggregated in hourly_rollups for destinations.
   */
  async getLatestDestinationRollupHour(profileId: string): Promise<number | null> {
    return this.getLatestRollupHour(profileId, 'dest');
  }

  /**
   * Retrieves the latest completed hour timestamp aggregated in hourly_rollups for domains.
   */
  async getLatestDomainRollupHour(profileId: string): Promise<number | null> {
    return this.getLatestRollupHour(profileId, 'domain');
  }

  /**
   * Aggregates completed hours of raw logs into the unified hourly_rollups table.
   * Runs in the background during hourly cron maintenance (or on-demand).
   *
   * @param sinceSec - Optional start timestamp. If omitted, bridges from system_settings or defaults to preceding hour.
   * @param untilSec - Optional end timestamp. Defaults to start of current hour (only completed hours).
   * @param minDomainCount - Minimum query count threshold for domain rollups (default 1).
   * @returns Total number of rollup records inserted or updated.
   */
  async aggregateHourlyRollups(
    sinceSec?: number,
    untilSec?: number,
    minDomainCount = 1
  ): Promise<number> {
    await this.ensureRollupTables();
    const now = Math.floor(Date.now() / 1000);
    const currentHourStart = Math.floor(now / 3600) * 3600;
    const effectiveUntil = untilSec !== undefined ? Math.min(untilSec, currentHourStart) : currentHourStart;

    let effectiveSince = sinceSec;
    const systemSettings = new SystemSettingsModel(this.db);

    if (effectiveSince === undefined) {
      let needsHistoricalBackfill = false;
      try {
        const row = await this.db.prepare("SELECT count(*) as cnt FROM hourly_rollups LIMIT 1").first<{ cnt: number }>();
        if ((row?.cnt ?? 0) === 0) {
          needsHistoricalBackfill = true;
        }
      } catch {
        // Table existence or query error fallback
      }

      if (!needsHistoricalBackfill) {
        const lastAggregatedStr = await systemSettings.get("last_hourly_rollup_timestamp");
        if (lastAggregatedStr) {
          const lastHour = parseInt(lastAggregatedStr, 10);
          if (!isNaN(lastHour) && lastHour > 0) {
            effectiveSince = Math.max(lastHour, effectiveUntil - (7 * 86400));
          }
        }
      }

      if (effectiveSince === undefined || needsHistoricalBackfill) {
        try {
          const minRow = await this.db.prepare("SELECT MIN(timestamp) as min_ts FROM logs").first<{ min_ts: number | null }>();
          if (minRow?.min_ts) {
            const minHour = Math.floor(minRow.min_ts / 3600) * 3600;
            effectiveSince = Math.max(minHour, effectiveUntil - (30 * 86400));
          }
        } catch {
          // Fallback
        }
        if (effectiveSince === undefined) {
          effectiveSince = Math.max(0, effectiveUntil - 86400);
        }
      }
    }

    if (effectiveSince >= effectiveUntil) {
      return 0;
    }

    try {
      const statements: D1PreparedStatement[] = [
        // 1. Action rollups
        this.db.prepare(`
          INSERT INTO hourly_rollups (profile_id, metric_type, hour_timestamp, key, sub_key, access_point_id, count)
          SELECT
              profile_id,
              'action',
              (timestamp / 3600) * 3600 AS hour_timestamp,
              action,
              '',
              COALESCE(access_point_id, ''),
              COUNT(*) AS count
          FROM logs
          WHERE timestamp >= ? AND timestamp < ?
          GROUP BY profile_id, (timestamp / 3600) * 3600, action, COALESCE(access_point_id, '')
          ON CONFLICT (profile_id, metric_type, hour_timestamp, key, sub_key, access_point_id)
          DO UPDATE SET count = count + excluded.count
        `).bind(effectiveSince, effectiveUntil),

        // 2. Client IP & Country rollups
        this.db.prepare(`
          INSERT INTO hourly_rollups (profile_id, metric_type, hour_timestamp, key, sub_key, access_point_id, count)
          SELECT
              profile_id,
              'client',
              (timestamp / 3600) * 3600 AS hour_timestamp,
              client_ip,
              COALESCE(geo_country, ''),
              COALESCE(access_point_id, ''),
              COUNT(*) AS count
          FROM logs
          WHERE timestamp >= ? AND timestamp < ?
            AND client_ip IS NOT NULL AND client_ip != '' AND client_ip != '[Encrypted]'
          GROUP BY profile_id, (timestamp / 3600) * 3600, client_ip, COALESCE(geo_country, ''), COALESCE(access_point_id, '')
          ON CONFLICT (profile_id, metric_type, hour_timestamp, key, sub_key, access_point_id)
          DO UPDATE SET count = count + excluded.count
        `).bind(effectiveSince, effectiveUntil),

        // 3. Destination Country rollups
        this.db.prepare(`
          INSERT INTO hourly_rollups (profile_id, metric_type, hour_timestamp, key, sub_key, access_point_id, count)
          SELECT
              profile_id,
              'dest',
              (timestamp / 3600) * 3600 AS hour_timestamp,
              UPPER(CASE 
                WHEN dest_country_code IS NOT NULL AND dest_country_code != '' THEN dest_country_code
                WHEN dest_geoip IS NOT NULL AND dest_geoip != '' AND dest_geoip LIKE '{%' THEN json_extract(dest_geoip, '$.country_code')
                ELSE ''
              END) AS key,
              MAX(CASE 
                WHEN dest_country IS NOT NULL AND dest_country != '' THEN dest_country
                WHEN dest_geoip IS NOT NULL AND dest_geoip != '' AND dest_geoip LIKE '{%' THEN json_extract(dest_geoip, '$.country')
                ELSE 'Unknown'
              END) AS sub_key,
              COALESCE(access_point_id, '') AS access_point_id,
              COUNT(*) AS count
          FROM logs
          WHERE timestamp >= ? AND timestamp < ?
            AND (
              (dest_country_code IS NOT NULL AND dest_country_code != '')
              OR
              (dest_geoip IS NOT NULL AND dest_geoip != '' AND dest_geoip LIKE '{%' AND json_extract(dest_geoip, '$.country_code') IS NOT NULL AND json_extract(dest_geoip, '$.country_code') != '')
            )
          GROUP BY profile_id, (timestamp / 3600) * 3600, 
                   UPPER(CASE 
                     WHEN dest_country_code IS NOT NULL AND dest_country_code != '' THEN dest_country_code
                     WHEN dest_geoip IS NOT NULL AND dest_geoip != '' AND dest_geoip LIKE '{%' THEN json_extract(dest_geoip, '$.country_code')
                     ELSE ''
                   END),
                   COALESCE(access_point_id, '')
          ON CONFLICT (profile_id, metric_type, hour_timestamp, key, sub_key, access_point_id)
          DO UPDATE SET count = count + excluded.count
        `).bind(effectiveSince, effectiveUntil),

        // 4. Domain rollups
        this.db.prepare(`
          INSERT INTO hourly_rollups (profile_id, metric_type, hour_timestamp, key, sub_key, access_point_id, count)
          SELECT
              profile_id,
              'domain',
              (timestamp / 3600) * 3600 AS hour_timestamp,
              domain,
              action,
              COALESCE(access_point_id, ''),
              COUNT(*) AS count
          FROM logs
          WHERE timestamp >= ? AND timestamp < ?
            AND domain IS NOT NULL AND domain != '' AND domain != '[Encrypted]'
          GROUP BY profile_id, (timestamp / 3600) * 3600, domain, action, COALESCE(access_point_id, '')
          HAVING COUNT(*) >= ?
          ON CONFLICT (profile_id, metric_type, hour_timestamp, key, sub_key, access_point_id)
          DO UPDATE SET count = count + excluded.count
        `).bind(effectiveSince, effectiveUntil, minDomainCount)
      ];

      const results = await this.db.batch(statements);
      let totalAggregatedRows = 0;
      for (const res of results) {
        totalAggregatedRows += res.meta.changes || 0;
      }

      await systemSettings.set("last_hourly_rollup_timestamp", String(effectiveUntil));
      return totalAggregatedRows;
    } catch (e: any) {
      console.error("[LogAggregationModel] aggregateHourlyRollups failed:", e.message || e);
      return 0;
    }
  }
}
