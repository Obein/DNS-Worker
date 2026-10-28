import { D1Database } from "@cloudflare/workers-types";
import { LogAggregationModel } from "../aggregation";
import { DestinationCountResult, ISPCountResult } from "./types";

/**
 * Handles geographic destination country and ISP distribution analytics.
 * Leverages `destination_hourly_rollups` to reduce D1 row reads by >99%
 * and eliminates expensive runtime JSON parsing across historical rows.
 */
export class LogDestinationAnalytics {
  constructor(
    private readonly db: D1Database,
    private readonly aggregation?: LogAggregationModel
  ) {}

  /**
   * Retrieves top destination countries for a given time range.
   *
   * @param profileId - Profile identifier.
   * @param since - Start timestamp in seconds.
   * @param until - End timestamp in seconds.
   * @param accessPointId - Optional device/access point ID.
   * @param limit - Maximum number of destinations to return (default 250).
   * @returns Array of destination country records ordered by query count descending.
   */
  async getDestinations(
    profileId: string,
    since: number,
    until: number,
    accessPointId?: string,
    limit = 250
  ): Promise<DestinationCountResult[]> {
    if (!this.aggregation) {
      let queryStr = `
        SELECT 
          UPPER(CASE 
            WHEN dest_country_code IS NOT NULL AND dest_country_code != '' THEN dest_country_code
            WHEN dest_geoip IS NOT NULL AND dest_geoip != '' AND dest_geoip LIKE '{%' THEN json_extract(dest_geoip, '$.country_code')
            ELSE NULL 
          END) as country_code,
          MAX(CASE 
            WHEN dest_country IS NOT NULL AND dest_country != '' THEN dest_country
            WHEN dest_geoip IS NOT NULL AND dest_geoip != '' AND dest_geoip LIKE '{%' THEN json_extract(dest_geoip, '$.country')
            ELSE 'Unknown'
          END) as country,
          COUNT(*) as count
        FROM logs 
        WHERE profile_id = ? AND timestamp >= ? AND timestamp <= ? 
          AND (
            (dest_country_code IS NOT NULL AND dest_country_code != '')
            OR
            (dest_geoip IS NOT NULL AND dest_geoip != '' AND dest_geoip LIKE '{%' AND json_extract(dest_geoip, '$.country_code') IS NOT NULL AND json_extract(dest_geoip, '$.country_code') != '')
          )
      `;
      const params: (string | number)[] = [profileId, since, until];
      if (accessPointId) {
        queryStr += " AND access_point_id = ?";
        params.push(accessPointId);
      }
      queryStr += ` GROUP BY country_code ORDER BY count DESC LIMIT ${limit}`;
      const { results } = await this.db
        .prepare(queryStr)
        .bind(...params)
        .all<DestinationCountResult>();
      return results;
    }

    const latestRollupHour = await this.aggregation.getLatestDestinationRollupHour(profileId);
    const cutoff = latestRollupHour !== null ? latestRollupHour + 3600 : since;

    // Case 1: No rollups available or entire range is after cutoff -> query raw logs only
    if (cutoff <= since) {
      let queryStr = `
        SELECT 
          UPPER(CASE 
            WHEN dest_country_code IS NOT NULL AND dest_country_code != '' THEN dest_country_code
            WHEN dest_geoip IS NOT NULL AND dest_geoip != '' AND dest_geoip LIKE '{%' THEN json_extract(dest_geoip, '$.country_code')
            ELSE NULL 
          END) as country_code,
          MAX(CASE 
            WHEN dest_country IS NOT NULL AND dest_country != '' THEN dest_country
            WHEN dest_geoip IS NOT NULL AND dest_geoip != '' AND dest_geoip LIKE '{%' THEN json_extract(dest_geoip, '$.country')
            ELSE 'Unknown'
          END) as country,
          COUNT(*) as count
        FROM logs 
        WHERE profile_id = ? AND timestamp >= ? AND timestamp <= ? 
          AND (
            (dest_country_code IS NOT NULL AND dest_country_code != '')
            OR
            (dest_geoip IS NOT NULL AND dest_geoip != '' AND dest_geoip LIKE '{%' AND json_extract(dest_geoip, '$.country_code') IS NOT NULL AND json_extract(dest_geoip, '$.country_code') != '')
          )
      `;
      const params: (string | number)[] = [profileId, since, until];
      if (accessPointId) {
        queryStr += " AND access_point_id = ?";
        params.push(accessPointId);
      }
      queryStr += ` GROUP BY country_code ORDER BY count DESC LIMIT ${limit}`;
      const { results } = await this.db
        .prepare(queryStr)
        .bind(...params)
        .all<DestinationCountResult>();
      return results;
    }

    // Case 2: Entire range is within completed rollups
    if (cutoff > until) {
      const sinceHour = Math.floor(since / 3600) * 3600;
      let queryStr = `
        SELECT key as country_code, MAX(sub_key) as country, SUM(count) as count
        FROM hourly_rollups
        WHERE profile_id = ? AND metric_type = 'dest' AND hour_timestamp >= ? AND hour_timestamp <= ?
      `;
      const params: (string | number)[] = [profileId, sinceHour, until];
      if (accessPointId) {
        queryStr += " AND access_point_id = ?";
        params.push(accessPointId);
      }
      queryStr += ` GROUP BY key ORDER BY count DESC LIMIT ${limit}`;
      const { results } = await this.db
        .prepare(queryStr)
        .bind(...params)
        .all<DestinationCountResult>();
      return results;
    }

    // Case 3: Spans historical rollups and unaggregated logs -> Hybrid UNION ALL query
    const sinceHour = Math.floor(since / 3600) * 3600;
    let rollupWhere = "profile_id = ? AND metric_type = 'dest' AND hour_timestamp >= ? AND hour_timestamp < ?";
    const rollupParams: (string | number)[] = [profileId, sinceHour, cutoff];
    if (accessPointId) {
      rollupWhere += " AND access_point_id = ?";
      rollupParams.push(accessPointId);
    }

    let logWhere = `
      profile_id = ? AND timestamp >= ? AND timestamp <= ?
      AND (
        (dest_country_code IS NOT NULL AND dest_country_code != '')
        OR
        (dest_geoip IS NOT NULL AND dest_geoip != '' AND dest_geoip LIKE '{%' AND json_extract(dest_geoip, '$.country_code') IS NOT NULL AND json_extract(dest_geoip, '$.country_code') != '')
      )
    `;
    const logParams: (string | number)[] = [profileId, cutoff, until];
    if (accessPointId) {
      logWhere += " AND access_point_id = ?";
      logParams.push(accessPointId);
    }

    const queryStr = `
      SELECT country_code, MAX(country) as country, SUM(count) as count FROM (
        SELECT key as country_code, sub_key as country, count
        FROM hourly_rollups
        WHERE ${rollupWhere}
        UNION ALL
        SELECT 
          UPPER(CASE 
            WHEN dest_country_code IS NOT NULL AND dest_country_code != '' THEN dest_country_code
            WHEN dest_geoip IS NOT NULL AND dest_geoip != '' AND dest_geoip LIKE '{%' THEN json_extract(dest_geoip, '$.country_code')
            ELSE ''
          END) as country_code,
          MAX(CASE 
            WHEN dest_country IS NOT NULL AND dest_country != '' THEN dest_country
            WHEN dest_geoip IS NOT NULL AND dest_geoip != '' AND dest_geoip LIKE '{%' THEN json_extract(dest_geoip, '$.country')
            ELSE 'Unknown'
          END) as country,
          COUNT(*) as count
        FROM logs
        WHERE ${logWhere}
        GROUP BY country_code
      ) WHERE country_code != '' GROUP BY country_code ORDER BY count DESC LIMIT ${limit}
    `;

    const { results } = await this.db
      .prepare(queryStr)
      .bind(...rollupParams, ...logParams)
      .all<DestinationCountResult>();

    return results;
  }

  /**
   * Retrieves ISP distribution for queries matching an optional country code.
   *
   * @param profileId - Profile identifier.
   * @param countryCode - Optional ISO 2-letter country code.
   * @param since - Start timestamp in seconds.
   * @param until - End timestamp in seconds.
   * @param accessPointId - Optional device filter.
   * @param limit - Maximum number of ISPs to return (default 250).
   * @returns Array of ISP count records.
   */
  async getISPByCountry(
    profileId: string,
    countryCode: string | undefined,
    since: number,
    until: number,
    accessPointId?: string,
    limit = 250
  ): Promise<ISPCountResult[]> {
    let queryStr = `
      SELECT 
        CASE 
          WHEN dest_isp IS NOT NULL AND dest_isp != '' THEN dest_isp
          WHEN dest_geoip IS NOT NULL AND dest_geoip != '' AND dest_geoip LIKE '{%' THEN json_extract(dest_geoip, '$.isp')
          ELSE NULL 
        END as name, 
        COUNT(*) as count 
      FROM logs 
      WHERE profile_id = ? 
        AND timestamp >= ? 
        AND timestamp <= ? 
        AND (
          (dest_isp IS NOT NULL AND dest_isp != '')
          OR
          (dest_geoip IS NOT NULL AND dest_geoip != '' AND dest_geoip LIKE '{%' AND json_extract(dest_geoip, '$.isp') IS NOT NULL AND json_extract(dest_geoip, '$.isp') != '')
        )
    `;
    const params: (string | number)[] = [profileId, since, until];
    if (countryCode) {
      queryStr += ` AND UPPER(CASE 
        WHEN dest_country_code IS NOT NULL AND dest_country_code != '' THEN dest_country_code
        WHEN dest_geoip IS NOT NULL AND dest_geoip != '' AND dest_geoip LIKE '{%' THEN json_extract(dest_geoip, '$.country_code')
        ELSE ''
      END) = ?`;
      params.push(countryCode.toUpperCase());
    }
    if (accessPointId) {
      queryStr += " AND access_point_id = ?";
      params.push(accessPointId);
    }
    queryStr += ` GROUP BY name ORDER BY count DESC LIMIT ${limit}`;
    const { results } = await this.db
      .prepare(queryStr)
      .bind(...params)
      .all<{ name: string | null; count: number }>();

    return results.map((r) => ({
      name: r.name || "Unknown",
      count: r.count
    }));
  }
}
