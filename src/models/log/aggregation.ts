import { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import { SystemSettingsModel } from "../systemSettings";

/**
 * Model responsible for maintaining and computing hourly rollups
 * across resolution logs, clients, destinations, and domains.
 */
export class LogAggregationModel {
  private tablesEnsured = false;

  constructor(private readonly db: D1Database) {}

  /**
   * Automatically creates rollup tables if they do not exist yet.
   * Self-heals environments (such as Turso on Cloudflare Workers) where build-time D1 migrations
   * do not execute against the remote Turso database.
   */
  async ensureRollupTables(): Promise<void> {
    if (this.tablesEnsured) return;
    if (typeof this.db.exec !== 'function') return;
    try {
      await this.db.exec(`
        CREATE TABLE IF NOT EXISTS log_hourly_rollups (
            profile_id TEXT NOT NULL,
            hour_timestamp INTEGER NOT NULL,
            action TEXT NOT NULL,
            count INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (profile_id, hour_timestamp, action)
        );
        CREATE TABLE IF NOT EXISTS client_hourly_rollups (
            profile_id TEXT NOT NULL,
            hour_timestamp INTEGER NOT NULL,
            client_ip TEXT NOT NULL,
            geo_country TEXT NOT NULL DEFAULT '',
            access_point_id TEXT NOT NULL DEFAULT '',
            count INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (profile_id, hour_timestamp, client_ip, geo_country, access_point_id)
        );
        CREATE TABLE IF NOT EXISTS destination_hourly_rollups (
            profile_id TEXT NOT NULL,
            hour_timestamp INTEGER NOT NULL,
            country_code TEXT NOT NULL,
            country TEXT NOT NULL DEFAULT '',
            access_point_id TEXT NOT NULL DEFAULT '',
            count INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (profile_id, hour_timestamp, country_code, country, access_point_id)
        );
        CREATE TABLE IF NOT EXISTS domain_hourly_rollups (
            profile_id TEXT NOT NULL,
            action TEXT NOT NULL,
            hour_timestamp INTEGER NOT NULL,
            domain TEXT NOT NULL,
            count INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (profile_id, action, hour_timestamp, domain)
        ) WITHOUT ROWID;
      `);
      this.tablesEnsured = true;
    } catch (e: any) {
      console.warn("[LogAggregationModel] ensureRollupTables notice:", e.message || e);
    }
  }

  /**
   * Retrieves the latest completed hour timestamp aggregated in log_hourly_rollups for a profile.
   *
   * @param profileId - Profile identifier.
   * @returns The latest hour timestamp, or null if no rollups exist.
   */
  async getLatestRollupHour(profileId: string): Promise<number | null> {
    try {
      const row = await this.db.prepare(
        "SELECT MAX(hour_timestamp) as max_hour FROM log_hourly_rollups WHERE profile_id = ?"
      ).bind(profileId).first<{ max_hour: number | null }>();
      return row?.max_hour ?? null;
    } catch {
      await this.ensureRollupTables();
      return null;
    }
  }

  /**
   * Retrieves the latest completed hour timestamp aggregated in client_hourly_rollups for a profile.
   *
   * @param profileId - Profile identifier.
   * @returns The latest hour timestamp, or null if no rollups exist.
   */
  async getLatestClientRollupHour(profileId: string): Promise<number | null> {
    try {
      const row = await this.db.prepare(
        "SELECT MAX(hour_timestamp) as max_hour FROM client_hourly_rollups WHERE profile_id = ?"
      ).bind(profileId).first<{ max_hour: number | null }>();
      return row?.max_hour ?? null;
    } catch {
      await this.ensureRollupTables();
      return null;
    }
  }

  /**
   * Retrieves the latest completed hour timestamp aggregated in destination_hourly_rollups for a profile.
   *
   * @param profileId - Profile identifier.
   * @returns The latest hour timestamp, or null if no rollups exist.
   */
  async getLatestDestinationRollupHour(profileId: string): Promise<number | null> {
    try {
      const row = await this.db.prepare(
        "SELECT MAX(hour_timestamp) as max_hour FROM destination_hourly_rollups WHERE profile_id = ?"
      ).bind(profileId).first<{ max_hour: number | null }>();
      return row?.max_hour ?? null;
    } catch {
      await this.ensureRollupTables();
      return null;
    }
  }

  /**
   * Retrieves the latest completed hour timestamp aggregated in domain_hourly_rollups for a profile.
   *
   * @param profileId - Profile identifier.
   * @returns The latest hour timestamp, or null if no rollups exist.
   */
  async getLatestDomainRollupHour(profileId: string): Promise<number | null> {
    try {
      const row = await this.db.prepare(
        "SELECT MAX(hour_timestamp) as max_hour FROM domain_hourly_rollups WHERE profile_id = ?"
      ).bind(profileId).first<{ max_hour: number | null }>();
      return row?.max_hour ?? null;
    } catch {
      await this.ensureRollupTables();
      return null;
    }
  }

  /**
   * Aggregates completed hours of raw logs into log_hourly_rollups, client_hourly_rollups,
   * destination_hourly_rollups, and domain_hourly_rollups.
   * Runs in the background during hourly cron maintenance (or on-demand).
   *
   * Uses set-based SQL queries grouped by (timestamp / 3600) * 3600 to process the entire window
   * across all profiles in exactly 4 atomic statements in a single batch, avoiding Cloudflare Workers
   * subrequest exhaustion and per-hour iteration timeouts.
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
      // Self-healing check: verify if any rollup table has 0 rows (e.g. recently restored or migrated).
      // If any table is completely empty, ignore stale system_settings watermark to allow full historical backfill.
      let needsHistoricalBackfill = false;
      try {
        const clientRow = await this.db.prepare("SELECT count(*) as cnt FROM client_hourly_rollups LIMIT 1").first<{ cnt: number }>();
        const destRow = await this.db.prepare("SELECT count(*) as cnt FROM destination_hourly_rollups LIMIT 1").first<{ cnt: number }>();
        const domainRow = await this.db.prepare("SELECT count(*) as cnt FROM domain_hourly_rollups LIMIT 1").first<{ cnt: number }>();
        if ((clientRow?.cnt ?? 0) === 0 || (destRow?.cnt ?? 0) === 0 || (domainRow?.cnt ?? 0) === 0) {
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
            // Look back from last aggregated hour, capped at 7 days max lookback
            effectiveSince = Math.max(lastHour, effectiveUntil - (7 * 86400));
          }
        }
      }

      if (effectiveSince === undefined || needsHistoricalBackfill) {
        try {
          const minRow = await this.db.prepare("SELECT MIN(timestamp) as min_ts FROM logs").first<{ min_ts: number | null }>();
          if (minRow?.min_ts) {
            const minHour = Math.floor(minRow.min_ts / 3600) * 3600;
            // Cap at 30 days max lookback to prevent unbounded iteration
            effectiveSince = Math.max(minHour, effectiveUntil - (30 * 86400));
          }
        } catch {
          // Fallback
        }
        if (effectiveSince === undefined) {
          // First run initialization fallback: look back 24 hours
          effectiveSince = Math.max(0, effectiveUntil - 86400);
        }
      }
    }

    if (effectiveSince >= effectiveUntil) {
      return 0;
    }

    try {
      // 4 Set-based SQL aggregation statements executed atomically in a single batch
      const statements: D1PreparedStatement[] = [
        // 1. Log action hourly rollups
        this.db.prepare(`
          INSERT OR REPLACE INTO log_hourly_rollups (profile_id, hour_timestamp, action, count)
          SELECT
              profile_id,
              (timestamp / 3600) * 3600 AS hour_timestamp,
              action,
              COUNT(*) AS count
          FROM logs
          WHERE timestamp >= ? AND timestamp < ?
          GROUP BY profile_id, (timestamp / 3600) * 3600, action
        `).bind(effectiveSince, effectiveUntil),

        // 2. Client IP & Country hourly rollups
        this.db.prepare(`
          INSERT OR REPLACE INTO client_hourly_rollups (profile_id, hour_timestamp, client_ip, geo_country, access_point_id, count)
          SELECT
              profile_id,
              (timestamp / 3600) * 3600 AS hour_timestamp,
              client_ip,
              COALESCE(geo_country, '') AS geo_country,
              COALESCE(access_point_id, '') AS access_point_id,
              COUNT(*) AS count
          FROM logs
          WHERE timestamp >= ? AND timestamp < ?
            AND client_ip IS NOT NULL AND client_ip != '' AND client_ip != '[Encrypted]'
          GROUP BY profile_id, (timestamp / 3600) * 3600, client_ip, COALESCE(geo_country, ''), COALESCE(access_point_id, '')
        `).bind(effectiveSince, effectiveUntil),

        // 3. Destination Country hourly rollups
        this.db.prepare(`
          INSERT OR REPLACE INTO destination_hourly_rollups (profile_id, hour_timestamp, country_code, country, access_point_id, count)
          SELECT
              profile_id,
              (timestamp / 3600) * 3600 AS hour_timestamp,
              UPPER(CASE 
                WHEN dest_country_code IS NOT NULL AND dest_country_code != '' THEN dest_country_code
                WHEN dest_geoip IS NOT NULL AND dest_geoip != '' AND dest_geoip LIKE '{%' THEN json_extract(dest_geoip, '$.country_code')
                ELSE ''
              END) AS country_code,
              MAX(CASE 
                WHEN dest_country IS NOT NULL AND dest_country != '' THEN dest_country
                WHEN dest_geoip IS NOT NULL AND dest_geoip != '' AND dest_geoip LIKE '{%' THEN json_extract(dest_geoip, '$.country')
                ELSE 'Unknown'
              END) AS country,
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
        `).bind(effectiveSince, effectiveUntil),

        // 4. Domain hourly rollups
        this.db.prepare(`
          INSERT OR REPLACE INTO domain_hourly_rollups (profile_id, action, hour_timestamp, domain, count)
          SELECT
              profile_id,
              action,
              (timestamp / 3600) * 3600 AS hour_timestamp,
              domain,
              COUNT(*) AS count
          FROM logs
          WHERE timestamp >= ? AND timestamp < ?
            AND domain IS NOT NULL AND domain != '' AND domain != '[Encrypted]'
          GROUP BY profile_id, action, (timestamp / 3600) * 3600, domain
          HAVING COUNT(*) >= ?
        `).bind(effectiveSince, effectiveUntil, minDomainCount)
      ];

      const results = await this.db.batch(statements);
      let totalAggregatedRows = 0;
      for (const res of results) {
        totalAggregatedRows += res.meta.changes || 0;
      }

      // Persist the latest completed hour timestamp in system_settings
      await systemSettings.set("last_hourly_rollup_timestamp", String(effectiveUntil));

      return totalAggregatedRows;
    } catch (e: any) {
      console.error("[LogAggregationModel] aggregateHourlyRollups failed:", e.message || e);
      return 0;
    }
  }
}
