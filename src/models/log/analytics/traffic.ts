import { D1Database } from "@cloudflare/workers-types";
import { LogAggregationModel } from "../aggregation";
import { ActionCountResult, TimeSeriesTrendPoint } from "./types";

/**
 * Handles action volume summaries and time-series trend analytics.
 * Leverages `log_hourly_rollups` and hybrid UNION ALL queries to provide
 * sub-millisecond, full-dataset analytics over large log volumes.
 */
export class LogTrafficAnalytics {
  constructor(
    private readonly db: D1Database,
    private readonly aggregation?: LogAggregationModel
  ) {}

  /**
   * Retrieves action counts (PASS, BLOCK, REDIRECT, FAIL) for a given time range.
   *
   * @param profileId - Profile identifier.
   * @param since - Start timestamp in seconds.
   * @param until - End timestamp in seconds.
   * @param search - Optional domain search substring.
   * @param accessPointId - Optional device/access point ID.
   * @param destCountry - Optional destination country code.
   * @param isp - Optional ISP name filter.
   * @param status - Optional action status filter (e.g. PASS, BLOCK).
   * @returns Array of action counts.
   */
  async getSummary(
    profileId: string,
    since: number,
    until: number,
    search?: string,
    accessPointId?: string,
    destCountry?: string,
    isp?: string,
    status?: string
  ): Promise<ActionCountResult[]> {
    // If granular search, device, country, isp, or status filters are applied, query raw logs directly
    if (search || accessPointId || destCountry || isp || status || !this.aggregation) {
      let queryStr =
        "SELECT action, COUNT(*) as count FROM logs WHERE profile_id = ? AND timestamp >= ? AND timestamp <= ?";
      const params: (string | number)[] = [profileId, since, until];
      if (search) {
        queryStr += " AND domain LIKE ?";
        params.push(`%${search}%`);
      }
      if (accessPointId) {
        queryStr += " AND access_point_id = ?";
        params.push(accessPointId);
      }
      if (status) {
        queryStr += " AND action = ?";
        params.push(status);
      }
      if (destCountry) {
        queryStr += ` AND UPPER(CASE 
          WHEN dest_country_code IS NOT NULL AND dest_country_code != '' THEN dest_country_code
          WHEN dest_geoip IS NOT NULL AND dest_geoip != '' AND dest_geoip LIKE '{%' THEN json_extract(dest_geoip, '$.country_code')
          ELSE ''
        END) = ?`;
        params.push(destCountry.toUpperCase());
      }
      if (isp) {
        queryStr += ` AND (CASE 
          WHEN dest_isp IS NOT NULL AND dest_isp != '' THEN dest_isp
          WHEN dest_geoip IS NOT NULL AND dest_geoip != '' AND dest_geoip LIKE '{%' THEN json_extract(dest_geoip, '$.isp')
          ELSE ''
        END) = ?`;
        params.push(isp);
      }
      queryStr += " GROUP BY action";
      const { results } = await this.db
        .prepare(queryStr)
        .bind(...params)
        .all<ActionCountResult>();
      return results;
    }

    const latestRollupHour = await this.aggregation.getLatestRollupHour(profileId);
    const cutoff = latestRollupHour !== null ? latestRollupHour + 3600 : since;

    // Case 1: No rollups available or entire range is after cutoff -> query raw logs only
    if (cutoff <= since) {
      const { results } = await this.db
        .prepare(
          "SELECT action, COUNT(*) as count FROM logs WHERE profile_id = ? AND timestamp >= ? AND timestamp <= ? GROUP BY action"
        )
        .bind(profileId, since, until)
        .all<ActionCountResult>();
      return results;
    }

    // Case 2: Entire range is within completed rollups
    if (cutoff > until) {
      const sinceHour = Math.floor(since / 3600) * 3600;
      const { results } = await this.db
        .prepare(
          "SELECT action, SUM(count) as count FROM log_hourly_rollups WHERE profile_id = ? AND hour_timestamp >= ? AND hour_timestamp <= ? GROUP BY action"
        )
        .bind(profileId, sinceHour, until)
        .all<ActionCountResult>();
      return results;
    }

    // Case 3: Spans historical rollups and unaggregated logs -> Hybrid UNION ALL query
    const sinceHour = Math.floor(since / 3600) * 3600;
    const { results } = await this.db
      .prepare(
        `
      SELECT action, SUM(count) as count FROM (
        SELECT action, count
        FROM log_hourly_rollups
        WHERE profile_id = ? AND hour_timestamp >= ? AND hour_timestamp < ?
        UNION ALL
        SELECT action, COUNT(*) as count
        FROM logs
        WHERE profile_id = ? AND timestamp >= ? AND timestamp <= ?
        GROUP BY action
      ) GROUP BY action
    `
      )
      .bind(profileId, sinceHour, cutoff, profileId, cutoff, until)
      .all<ActionCountResult>();

    return results;
  }

  /**
   * Retrieves timeseries trend data aggregated by interval.
   *
   * @param profileId - Profile identifier.
   * @param since - Start timestamp in seconds.
   * @param until - End timestamp in seconds.
   * @param interval - SQL group by expression (e.g. `(timestamp/3600)*3600` or `(timestamp/86400)*86400`).
   * @param accessPointId - Optional device filter.
   * @returns Array of timeseries points ordered by timestamp ascending.
   */
  async getTrend(
    profileId: string,
    since: number,
    until: number,
    interval: string,
    accessPointId?: string
  ): Promise<TimeSeriesTrendPoint[]> {
    const isHourly = interval.includes("3600");
    const isDaily = interval.includes("86400");

    // If device-specific, non-standard interval, or rollups disabled, query raw logs directly
    if (accessPointId || (!isHourly && !isDaily) || !this.aggregation) {
      const SAFE_INTERVALS = new Set([
        "(timestamp/60)*60",
        "(timestamp/300)*300",
        "(timestamp/900)*900",
        "(timestamp/3600)*3600",
        "(timestamp/86400)*86400"
      ]);
      const safeInterval = SAFE_INTERVALS.has(interval.trim()) ? interval.trim() : "(timestamp/3600)*3600";

      let queryStr = `SELECT ${safeInterval} as timestamp, action, COUNT(*) as count FROM logs WHERE profile_id = ? AND timestamp >= ? AND timestamp <= ?`;
      const params: (string | number)[] = [profileId, since, until];
      if (accessPointId) {
        queryStr += " AND access_point_id = ?";
        params.push(accessPointId);
      }
      queryStr += ` GROUP BY ${safeInterval}, action ORDER BY timestamp ASC`;
      const { results } = await this.db
        .prepare(queryStr)
        .bind(...params)
        .all<TimeSeriesTrendPoint>();
      return results;
    }

    const latestRollupHour = await this.aggregation.getLatestRollupHour(profileId);
    const cutoff = latestRollupHour !== null ? latestRollupHour + 3600 : since;
    const rollupInterval = isDaily ? "(hour_timestamp / 86400) * 86400" : "hour_timestamp";
    const logsInterval = isDaily ? "(timestamp / 86400) * 86400" : "(timestamp / 3600) * 3600";

    // Case 1: No rollups available or entire range is after cutoff -> query raw logs only
    if (cutoff <= since) {
      const queryStr = `SELECT ${logsInterval} as timestamp, action, COUNT(*) as count FROM logs WHERE profile_id = ? AND timestamp >= ? AND timestamp <= ? GROUP BY ${logsInterval}, action ORDER BY timestamp ASC`;
      const { results } = await this.db
        .prepare(queryStr)
        .bind(profileId, since, until)
        .all<TimeSeriesTrendPoint>();
      return results;
    }

    // Case 2: Entire range is within completed rollups
    if (cutoff > until) {
      const sinceHour = Math.floor(since / 3600) * 3600;
      const queryStr = `SELECT ${rollupInterval} as timestamp, action, SUM(count) as count FROM log_hourly_rollups WHERE profile_id = ? AND hour_timestamp >= ? AND hour_timestamp <= ? GROUP BY ${rollupInterval}, action ORDER BY timestamp ASC`;
      const { results } = await this.db
        .prepare(queryStr)
        .bind(profileId, sinceHour, until)
        .all<TimeSeriesTrendPoint>();
      return results;
    }

    // Case 3: Hybrid query spanning historical rollups and unaggregated logs
    const sinceHour = Math.floor(since / 3600) * 3600;
    const queryStr = `
      SELECT timestamp, action, SUM(count) as count FROM (
        SELECT ${rollupInterval} as timestamp, action, count
        FROM log_hourly_rollups
        WHERE profile_id = ? AND hour_timestamp >= ? AND hour_timestamp < ?
        UNION ALL
        SELECT ${logsInterval} as timestamp, action, COUNT(*) as count
        FROM logs
        WHERE profile_id = ? AND timestamp >= ? AND timestamp <= ?
        GROUP BY ${logsInterval}, action
      ) GROUP BY timestamp, action ORDER BY timestamp ASC
    `;
    const { results } = await this.db
      .prepare(queryStr)
      .bind(profileId, sinceHour, cutoff, profileId, cutoff, until)
      .all<TimeSeriesTrendPoint>();

    return results;
  }
}
