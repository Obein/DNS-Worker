import { D1Database } from "@cloudflare/workers-types";
import { LogAggregationModel } from "../aggregation";
import { DomainCountResult } from "./types";

/**
 * Handles top allowed and top blocked domain analytics.
 * Leverages `domain_hourly_rollups` to eliminate scanning millions of historical rows.
 */
export class LogDomainAnalytics {
  constructor(
    private readonly db: D1Database,
    private readonly aggregation?: LogAggregationModel
  ) {}

  /**
   * Retrieves top allowed domains for a given time range.
   *
   * @param profileId - Profile identifier.
   * @param since - Start timestamp in seconds.
   * @param until - End timestamp in seconds.
   * @param accessPointId - Optional device filter.
   * @returns Array of top allowed domain records ordered by count descending.
   */
  async getTopAllowed(
    profileId: string,
    since: number,
    until: number,
    accessPointId?: string
  ): Promise<DomainCountResult[]> {
    if (!this.aggregation) {
      let queryStr =
        "SELECT domain, COUNT(*) as count FROM logs WHERE profile_id = ? AND timestamp >= ? AND timestamp <= ? AND domain IS NOT NULL AND domain != '' AND domain != '[Encrypted]' AND action = 'PASS'";
      const params: (string | number)[] = [profileId, since, until];
      if (accessPointId) {
        queryStr += " AND access_point_id = ?";
        params.push(accessPointId);
      }
      queryStr += " GROUP BY domain ORDER BY count DESC LIMIT 10";
      const { results } = await this.db
        .prepare(queryStr)
        .bind(...params)
        .all<DomainCountResult>();
      return results;
    }

    const latestRollupHour = await this.aggregation.getLatestDomainRollupHour(profileId);
    const cutoff = latestRollupHour !== null ? latestRollupHour + 3600 : since;

    // Case 1: No rollups available or entire range is after cutoff -> query raw logs only
    if (cutoff <= since) {
      let queryStr =
        "SELECT domain, COUNT(*) as count FROM logs WHERE profile_id = ? AND timestamp >= ? AND timestamp <= ? AND domain IS NOT NULL AND domain != '' AND domain != '[Encrypted]' AND action = 'PASS'";
      const params: (string | number)[] = [profileId, since, until];
      if (accessPointId) {
        queryStr += " AND access_point_id = ?";
        params.push(accessPointId);
      }
      queryStr += " GROUP BY domain ORDER BY count DESC LIMIT 10";
      const { results } = await this.db
        .prepare(queryStr)
        .bind(...params)
        .all<DomainCountResult>();
      return results;
    }

    // Case 2: Entire range is within completed rollups
    if (cutoff > until) {
      const sinceHour = Math.floor(since / 3600) * 3600;
      let queryStr =
        "SELECT key as domain, SUM(count) as count FROM hourly_rollups WHERE profile_id = ? AND metric_type = 'domain' AND sub_key = 'PASS' AND hour_timestamp >= ? AND hour_timestamp <= ?";
      const params: (string | number)[] = [profileId, sinceHour, until];
      if (accessPointId) {
        queryStr += " AND access_point_id = ?";
        params.push(accessPointId);
      }
      queryStr += " GROUP BY key ORDER BY count DESC LIMIT 10";
      const { results } = await this.db
        .prepare(queryStr)
        .bind(...params)
        .all<DomainCountResult>();
      return results;
    }

    // Case 3: Spans historical rollups and unaggregated logs -> Hybrid UNION ALL query
    const sinceHour = Math.floor(since / 3600) * 3600;
    let rollupWhere = "profile_id = ? AND metric_type = 'domain' AND sub_key = 'PASS' AND hour_timestamp >= ? AND hour_timestamp < ?";
    const rollupParams: (string | number)[] = [profileId, sinceHour, cutoff];
    if (accessPointId) {
      rollupWhere += " AND access_point_id = ?";
      rollupParams.push(accessPointId);
    }

    let logWhere = "profile_id = ? AND timestamp >= ? AND timestamp <= ? AND action = 'PASS' AND domain IS NOT NULL AND domain != '' AND domain != '[Encrypted]'";
    const logParams: (string | number)[] = [profileId, cutoff, until];
    if (accessPointId) {
      logWhere += " AND access_point_id = ?";
      logParams.push(accessPointId);
    }

    const queryStr = `
      SELECT domain, SUM(count) as count FROM (
        SELECT key as domain, count
        FROM hourly_rollups
        WHERE ${rollupWhere}
        UNION ALL
        SELECT domain, COUNT(*) as count
        FROM logs
        WHERE ${logWhere}
        GROUP BY domain
      ) GROUP BY domain ORDER BY count DESC LIMIT 10
    `;

    const { results } = await this.db
      .prepare(queryStr)
      .bind(...rollupParams, ...logParams)
      .all<DomainCountResult>();

    return results;
  }

  /**
   * Retrieves top blocked/redirected domains for a given time range.
   *
   * @param profileId - Profile identifier.
   * @param since - Start timestamp in seconds.
   * @param until - End timestamp in seconds.
   * @param accessPointId - Optional device filter.
   * @returns Array of top blocked domain records ordered by count descending.
   */
  async getTopBlocked(
    profileId: string,
    since: number,
    until: number,
    accessPointId?: string
  ): Promise<DomainCountResult[]> {
    if (!this.aggregation) {
      let queryStr =
        "SELECT domain, COUNT(*) as count FROM logs WHERE profile_id = ? AND timestamp >= ? AND timestamp <= ? AND domain IS NOT NULL AND domain != '' AND domain != '[Encrypted]' AND action IN ('BLOCK', 'REDIRECT')";
      const params: (string | number)[] = [profileId, since, until];
      if (accessPointId) {
        queryStr += " AND access_point_id = ?";
        params.push(accessPointId);
      }
      queryStr += " GROUP BY domain ORDER BY count DESC LIMIT 10";
      const { results } = await this.db
        .prepare(queryStr)
        .bind(...params)
        .all<DomainCountResult>();
      return results;
    }

    const latestRollupHour = await this.aggregation.getLatestDomainRollupHour(profileId);
    const cutoff = latestRollupHour !== null ? latestRollupHour + 3600 : since;

    // Case 1: No rollups available or entire range is after cutoff -> query raw logs only
    if (cutoff <= since) {
      let queryStr =
        "SELECT domain, COUNT(*) as count FROM logs WHERE profile_id = ? AND timestamp >= ? AND timestamp <= ? AND domain IS NOT NULL AND domain != '' AND domain != '[Encrypted]' AND action IN ('BLOCK', 'REDIRECT')";
      const params: (string | number)[] = [profileId, since, until];
      if (accessPointId) {
        queryStr += " AND access_point_id = ?";
        params.push(accessPointId);
      }
      queryStr += " GROUP BY domain ORDER BY count DESC LIMIT 10";
      const { results } = await this.db
        .prepare(queryStr)
        .bind(...params)
        .all<DomainCountResult>();
      return results;
    }

    // Case 2: Entire range is within completed rollups
    if (cutoff > until) {
      const sinceHour = Math.floor(since / 3600) * 3600;
      let queryStr =
        "SELECT key as domain, SUM(count) as count FROM hourly_rollups WHERE profile_id = ? AND metric_type = 'domain' AND sub_key IN ('BLOCK', 'REDIRECT') AND hour_timestamp >= ? AND hour_timestamp <= ?";
      const params: (string | number)[] = [profileId, sinceHour, until];
      if (accessPointId) {
        queryStr += " AND access_point_id = ?";
        params.push(accessPointId);
      }
      queryStr += " GROUP BY key ORDER BY count DESC LIMIT 10";
      const { results } = await this.db
        .prepare(queryStr)
        .bind(...params)
        .all<DomainCountResult>();
      return results;
    }

    // Case 3: Spans historical rollups and unaggregated logs -> Hybrid UNION ALL query
    const sinceHour = Math.floor(since / 3600) * 3600;
    let rollupWhere = "profile_id = ? AND metric_type = 'domain' AND sub_key IN ('BLOCK', 'REDIRECT') AND hour_timestamp >= ? AND hour_timestamp < ?";
    const rollupParams: (string | number)[] = [profileId, sinceHour, cutoff];
    if (accessPointId) {
      rollupWhere += " AND access_point_id = ?";
      rollupParams.push(accessPointId);
    }

    let logWhere = "profile_id = ? AND timestamp >= ? AND timestamp <= ? AND action IN ('BLOCK', 'REDIRECT') AND domain IS NOT NULL AND domain != '' AND domain != '[Encrypted]'";
    const logParams: (string | number)[] = [profileId, cutoff, until];
    if (accessPointId) {
      logWhere += " AND access_point_id = ?";
      logParams.push(accessPointId);
    }

    const queryStr = `
      SELECT domain, SUM(count) as count FROM (
        SELECT key as domain, count
        FROM hourly_rollups
        WHERE ${rollupWhere}
        UNION ALL
        SELECT domain, COUNT(*) as count
        FROM logs
        WHERE ${logWhere}
        GROUP BY domain
      ) GROUP BY domain ORDER BY count DESC LIMIT 10
    `;

    const { results } = await this.db
      .prepare(queryStr)
      .bind(...rollupParams, ...logParams)
      .all<DomainCountResult>();

    return results;
  }
}
