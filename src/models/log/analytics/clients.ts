import { D1Database } from "@cloudflare/workers-types";
import { LogAggregationModel } from "../aggregation";
import { ClientCountResult } from "./types";

/**
 * Handles client device and IP-level analytics.
 * Leverages `client_hourly_rollups` to reduce D1 row reads by >98%
 * while capturing live active devices for the current hour.
 */
export class LogClientAnalytics {
  constructor(
    private readonly db: D1Database,
    private readonly aggregation?: LogAggregationModel
  ) {}

  /**
   * Retrieves top client IPs and locations for a given time range.
   *
   * @param profileId - Profile identifier.
   * @param since - Start timestamp in seconds.
   * @param until - End timestamp in seconds.
   * @param accessPointId - Optional device/access point ID.
   * @returns Array of top client records ordered by query count descending.
   */
  async getClients(
    profileId: string,
    since: number,
    until: number,
    accessPointId?: string
  ): Promise<ClientCountResult[]> {
    if (!this.aggregation) {
      let queryStr =
        "SELECT client_ip, geo_country, COUNT(*) as count FROM logs WHERE profile_id = ? AND timestamp >= ? AND timestamp <= ? AND client_ip IS NOT NULL AND client_ip != '' AND client_ip != '[Encrypted]'";
      const params: (string | number)[] = [profileId, since, until];
      if (accessPointId) {
        queryStr += " AND access_point_id = ?";
        params.push(accessPointId);
      }
      queryStr += " GROUP BY client_ip, geo_country ORDER BY count DESC LIMIT 20";
      const { results } = await this.db
        .prepare(queryStr)
        .bind(...params)
        .all<ClientCountResult>();
      return results;
    }

    const latestRollupHour = await this.aggregation.getLatestClientRollupHour(profileId);
    const cutoff = latestRollupHour !== null ? latestRollupHour + 3600 : since;

    // Case 1: No rollups available or entire range is after cutoff -> query raw logs only
    if (cutoff <= since) {
      let queryStr =
        "SELECT client_ip, geo_country, COUNT(*) as count FROM logs WHERE profile_id = ? AND timestamp >= ? AND timestamp <= ? AND client_ip IS NOT NULL AND client_ip != '' AND client_ip != '[Encrypted]'";
      const params: (string | number)[] = [profileId, since, until];
      if (accessPointId) {
        queryStr += " AND access_point_id = ?";
        params.push(accessPointId);
      }
      queryStr += " GROUP BY client_ip, geo_country ORDER BY count DESC LIMIT 20";
      const { results } = await this.db
        .prepare(queryStr)
        .bind(...params)
        .all<ClientCountResult>();
      return results;
    }

    // Case 2: Entire range is within completed rollups
    if (cutoff > until) {
      const sinceHour = Math.floor(since / 3600) * 3600;
      let queryStr = `
        SELECT client_ip, NULLIF(geo_country, '') as geo_country, SUM(count) as count
        FROM client_hourly_rollups
        WHERE profile_id = ? AND hour_timestamp >= ? AND hour_timestamp <= ?
      `;
      const params: (string | number)[] = [profileId, sinceHour, until];
      if (accessPointId) {
        queryStr += " AND access_point_id = ?";
        params.push(accessPointId);
      }
      queryStr += " GROUP BY client_ip, geo_country ORDER BY count DESC LIMIT 20";
      const { results } = await this.db
        .prepare(queryStr)
        .bind(...params)
        .all<ClientCountResult>();
      return results;
    }

    // Case 3: Spans historical rollups and unaggregated logs -> Hybrid UNION ALL query
    const sinceHour = Math.floor(since / 3600) * 3600;
    let rollupWhere = "profile_id = ? AND hour_timestamp >= ? AND hour_timestamp < ?";
    const rollupParams: (string | number)[] = [profileId, sinceHour, cutoff];
    if (accessPointId) {
      rollupWhere += " AND access_point_id = ?";
      rollupParams.push(accessPointId);
    }

    let logWhere = "profile_id = ? AND timestamp >= ? AND timestamp <= ? AND client_ip IS NOT NULL AND client_ip != '' AND client_ip != '[Encrypted]'";
    const logParams: (string | number)[] = [profileId, cutoff, until];
    if (accessPointId) {
      logWhere += " AND access_point_id = ?";
      logParams.push(accessPointId);
    }

    const queryStr = `
      SELECT client_ip, NULLIF(geo_country, '') as geo_country, SUM(count) as count FROM (
        SELECT client_ip, geo_country, count
        FROM client_hourly_rollups
        WHERE ${rollupWhere}
        UNION ALL
        SELECT client_ip, COALESCE(geo_country, '') as geo_country, COUNT(*) as count
        FROM logs
        WHERE ${logWhere}
        GROUP BY client_ip, COALESCE(geo_country, '')
      ) GROUP BY client_ip, geo_country ORDER BY count DESC LIMIT 20
    `;

    const { results } = await this.db
      .prepare(queryStr)
      .bind(...rollupParams, ...logParams)
      .all<ClientCountResult>();

    return results;
  }
}
