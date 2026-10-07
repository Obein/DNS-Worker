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
   * @returns Array of action counts.
   */
  async getSummary(
    profileId: string,
    since: number,
    until: number,
    search?: string,
    accessPointId?: string
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
