import { D1Database } from "@cloudflare/workers-types";
import { ActionCountResult, TimeSeriesTrendPoint } from "./types";

/**
 * Handles action volume summaries and time-series trend analytics.
 * Queries raw resolution logs directly using the (profile_id, timestamp) clustered index
 * as a server-side fallback for client-side Local-First SQLite analytics.
 */
export class LogTrafficAnalytics {
  constructor(private readonly db: D1Database) {}

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
    // Defensively sanitize SQL interval expression against an explicit allowlist
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
}
