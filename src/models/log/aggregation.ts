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
      return null;
    }
  }

  /**
   * Aggregates completed hours of raw logs into log_hourly_rollups, client_hourly_rollups,
   * destination_hourly_rollups, and domain_hourly_rollups.
   * Runs in the background during hourly cron maintenance (or on-demand).
   *
   * @param sinceSec - Optional start timestamp. If omitted, bridges from system_settings or defaults to preceding hour.
   * @param untilSec - Optional end timestamp. Defaults to start of current hour (only completed hours).
   * @param minDomainCount - Minimum query count threshold for domain rollups (default 2).
   * @returns Total number of rollup records inserted or updated.
   */
  async aggregateHourlyRollups(
    sinceSec?: number,
    untilSec?: number,
    minDomainCount = 2
  ): Promise<number> {
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
      // Find all profiles with activity in or around the aggregation window
      const activityThreshold = effectiveSince - 7200;
      const { results: profiles } = await this.db.prepare(
        "SELECT id FROM profiles WHERE last_active_at >= ? OR (last_active_at IS NULL AND created_at >= ?)"
      ).bind(activityThreshold, activityThreshold).all<{ id: string }>();

      if (!profiles || profiles.length === 0) {
        await systemSettings.set("last_hourly_rollup_timestamp", String(effectiveUntil));
        return 0;
      }

      const statements: D1PreparedStatement[] = [];

      // Iterate hour by hour so hour_timestamp is a fixed parameter
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
                AND client_ip IS NOT NULL AND client_ip != '' AND client_ip != '[Encrypted]'
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
              WHERE profile_id = ? AND timestamp >= ? AND timestamp < ?
                AND (
                  (dest_country_code IS NOT NULL AND dest_country_code != '')
                  OR
                  (dest_geoip IS NOT NULL AND dest_geoip != '' AND dest_geoip LIKE '{%' AND json_extract(dest_geoip, '$.country_code') IS NOT NULL AND json_extract(dest_geoip, '$.country_code') != '')
                )
              GROUP BY UPPER(CASE 
                WHEN dest_country_code IS NOT NULL AND dest_country_code != '' THEN dest_country_code
                WHEN dest_geoip IS NOT NULL AND dest_geoip != '' AND dest_geoip LIKE '{%' THEN json_extract(dest_geoip, '$.country_code')
                ELSE ''
              END),
              COALESCE(access_point_id, '')
            `).bind(profile.id, hourStart, profile.id, hourStart, hourEnd)
          );

          // 4. Domain hourly rollups
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
                AND domain IS NOT NULL AND domain != '' AND domain != '[Encrypted]'
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
