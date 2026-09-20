import { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import { SystemSettingsModel } from "../systemSettings";

/**
 * Model responsible for maintaining and computing hourly rollups
 * across resolution logs, clients, destinations, and domains.
 */
export class LogAggregationModel {
  constructor(private readonly db: D1Database) {}

  /**
   * Retrieves the latest completed hour timestamp aggregated in log_hourly_rollups for a profile.
   * Uses the primary key index (profile_id, hour_timestamp, action) for a sub-millisecond lookup.
   *
   * @param profileId - Profile identifier.
   * @returns The latest hour timestamp, or null if no rollups exist.
   */
  async getLatestRollupHour(profileId: string): Promise<number | null> {
    const row = await this.db.prepare(
      "SELECT MAX(hour_timestamp) as max_hour FROM log_hourly_rollups WHERE profile_id = ?"
    ).bind(profileId).first<{ max_hour: number | null }>();
    return row?.max_hour ?? null;
  }

  /**
   * Retrieves the latest completed hour timestamp aggregated in client_hourly_rollups for a profile.
   * Uses the primary key index (profile_id, hour_timestamp, client_ip, geo_country, access_point_id) for a sub-millisecond lookup.
   *
   * @param profileId - Profile identifier.
   * @returns The latest hour timestamp, or null if no rollups exist.
   */
  async getLatestClientRollupHour(profileId: string): Promise<number | null> {
    const row = await this.db.prepare(
      "SELECT MAX(hour_timestamp) as max_hour FROM client_hourly_rollups WHERE profile_id = ?"
    ).bind(profileId).first<{ max_hour: number | null }>();
    return row?.max_hour ?? null;
  }

  /**
   * Retrieves the latest completed hour timestamp aggregated in destination_hourly_rollups for a profile.
   * Uses the primary key index (profile_id, hour_timestamp, country_code, country, access_point_id) for a sub-millisecond lookup.
   *
   * @param profileId - Profile identifier.
   * @returns The latest hour timestamp, or null if no rollups exist.
   */
  async getLatestDestinationRollupHour(profileId: string): Promise<number | null> {
    const row = await this.db.prepare(
      "SELECT MAX(hour_timestamp) as max_hour FROM destination_hourly_rollups WHERE profile_id = ?"
    ).bind(profileId).first<{ max_hour: number | null }>();
    return row?.max_hour ?? null;
  }

  /**
   * Aggregates completed hours of raw logs into log_hourly_rollups, client_hourly_rollups,
   * destination_hourly_rollups, and domain_hourly_rollups.
   * Runs in the background during hourly cron maintenance (or can be called explicitly).
   *
   * Performance optimization:
   * Uses `system_settings` key `last_hourly_rollup_timestamp` to track the last completed rollup hour.
   * This completely eliminates the full-table scans previously caused by `SELECT MAX(hour_timestamp)`
   * on secondary-index-less rollup tables without requiring write-amplifying secondary indexes.
   *
   * @param sinceSec - Optional start timestamp. If omitted, bridges from system_settings or defaults to preceding hour.
   * @param untilSec - Optional end timestamp. Defaults to start of current hour (only completed hours).
   * @param minDomainCount - Minimum query count threshold for domain rollups (default 2).
   * @returns Total number of rollup records inserted or updated.
   */
  async aggregateHourlyRollups(sinceSec?: number, untilSec?: number, minDomainCount = 2): Promise<number> {
    const now = Math.floor(Date.now() / 1000);
    const currentHourStart = Math.floor(now / 3600) * 3600;
    const effectiveUntil = untilSec !== undefined ? Math.min(untilSec, currentHourStart) : currentHourStart;

    let effectiveSince = sinceSec;
    const systemSettings = new SystemSettingsModel(this.db);

    if (effectiveSince === undefined) {
      const lastAggregatedStr = await systemSettings.get("last_hourly_rollup_timestamp");
      if (lastAggregatedStr) {
        const lastHour = parseInt(lastAggregatedStr, 10);
        if (!isNaN(lastHour) && lastHour > 0) {
          // Look back from last aggregated hour, capped at 7 days max lookback
          effectiveSince = Math.max(lastHour, effectiveUntil - (7 * 86400));
        }
      }
      if (effectiveSince === undefined) {
        // First run initialization: aggregate the preceding completed hour only
        effectiveSince = effectiveUntil - 3600;
      }
    }

    if (effectiveSince >= effectiveUntil) {
      return 0;
    }

    try {
      // Filter only profiles active in the aggregation window (with 2-hour buffer for cache throttling)
      const activityThreshold = effectiveSince - 7200;
      const { results: profiles } = await this.db.prepare(
        "SELECT id FROM profiles WHERE last_active_at >= ? OR (last_active_at IS NULL AND created_at >= ?)"
      ).bind(activityThreshold, activityThreshold).all<{ id: string }>();

      if (!profiles || profiles.length === 0) {
        await systemSettings.set("last_hourly_rollup_timestamp", String(effectiveUntil));
        return 0;
      }

      const statements: D1PreparedStatement[] = [];

      // Iterate hour by hour so hour_timestamp is a fixed parameter, avoiding runtime arithmetic and simplifying GROUP BY
      for (let hourStart = effectiveSince; hourStart < effectiveUntil; hourStart += 3600) {
        const hourEnd = hourStart + 3600;

        for (const profile of profiles) {
          // 1. Log action hourly rollups
          statements.push(
            this.db.prepare(`
              INSERT OR REPLACE INTO log_hourly_rollups (profile_id, hour_timestamp, action, count)
              SELECT ?, ?, action, COUNT(*) AS count
              FROM logs
              WHERE profile_id = ? AND timestamp >= ? AND timestamp < ?
              GROUP BY action
            `).bind(profile.id, hourStart, profile.id, hourStart, hourEnd)
          );

          // 2. Client IP & Country hourly rollups
          statements.push(
            this.db.prepare(`
              INSERT OR REPLACE INTO client_hourly_rollups (profile_id, hour_timestamp, client_ip, geo_country, access_point_id, count)
              SELECT
                ?,
                ?,
                client_ip,
                COALESCE(geo_country, '') AS geo_country,
                COALESCE(access_point_id, '') AS access_point_id,
                COUNT(*) AS count
              FROM logs
              WHERE profile_id = ? AND timestamp >= ? AND timestamp < ?
              GROUP BY client_ip, COALESCE(geo_country, ''), COALESCE(access_point_id, '')
            `).bind(profile.id, hourStart, profile.id, hourStart, hourEnd)
          );

          // 3. Destination Country hourly rollups
          statements.push(
            this.db.prepare(`
              INSERT OR REPLACE INTO destination_hourly_rollups (profile_id, hour_timestamp, country_code, country, access_point_id, count)
              SELECT
                ?,
                ?,
                COALESCE(dest_country_code, json_extract(dest_geoip, '$.country_code'), '') AS country_code,
                COALESCE(dest_country, json_extract(dest_geoip, '$.country'), '') AS country,
                COALESCE(access_point_id, '') AS access_point_id,
                COUNT(*) AS count
              FROM logs
              WHERE profile_id = ? AND timestamp >= ? AND timestamp < ?
                AND (dest_country_code IS NOT NULL OR dest_geoip IS NOT NULL)
                AND COALESCE(dest_country_code, json_extract(dest_geoip, '$.country_code'), '') != ''
              GROUP BY COALESCE(dest_country_code, json_extract(dest_geoip, '$.country_code'), ''), COALESCE(dest_country, json_extract(dest_geoip, '$.country'), ''), COALESCE(access_point_id, '')
            `).bind(profile.id, hourStart, profile.id, hourStart, hourEnd)
          );

          // 4. Domain hourly rollups (aggregated offline per hour to save real-time D1 write quotas)
          // Filters out noise domains with query count < minDomainCount to save write quotas
          statements.push(
            this.db.prepare(`
              INSERT OR REPLACE INTO domain_hourly_rollups (profile_id, action, hour_timestamp, domain, count)
              SELECT
                ?,
                action,
                ?,
                domain,
                COUNT(*) AS count
              FROM logs
              WHERE profile_id = ? AND timestamp >= ? AND timestamp < ?
              GROUP BY action, domain
              HAVING COUNT(*) >= ?
            `).bind(profile.id, hourStart, profile.id, hourStart, hourEnd, minDomainCount)
          );
        }
      }

      if (statements.length === 0) {
        return 0;
      }

      let totalAggregatedRows = 0;
      // Execute in chunks of 50 to strictly comply with Cloudflare D1 batch transaction limits
      const CHUNK_SIZE = 50;
      for (let i = 0; i < statements.length; i += CHUNK_SIZE) {
        const chunk = statements.slice(i, i + CHUNK_SIZE);
        const results = await this.db.batch(chunk);
        for (const res of results) {
          totalAggregatedRows += res.meta.changes || 0;
        }
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
