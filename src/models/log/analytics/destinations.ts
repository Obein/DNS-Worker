import { D1Database } from "@cloudflare/workers-types";
import { DestinationCountResult, ISPCountResult } from "./types";

/**
 * Handles geographic destination country and ISP distribution analytics.
 * Queries raw resolution logs directly using the (profile_id, timestamp) clustered index
 * as a server-side fallback for client-side Local-First SQLite analytics.
 */
export class LogDestinationAnalytics {
  constructor(private readonly db: D1Database) {}

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
    let queryStr = `
      SELECT 
        COALESCE(dest_country_code, json_extract(dest_geoip, '$.country_code')) as country_code,
        COALESCE(dest_country, json_extract(dest_geoip, '$.country')) as country,
        COUNT(*) as count
      FROM logs 
      WHERE profile_id = ? AND timestamp >= ? AND timestamp <= ? AND (dest_country_code IS NOT NULL OR dest_geoip IS NOT NULL)
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
        COALESCE(dest_isp, json_extract(dest_geoip, '$.isp')) as name, 
        COUNT(*) as count 
      FROM logs 
      WHERE profile_id = ? 
        AND timestamp >= ? 
        AND timestamp <= ? 
        AND (dest_country_code IS NOT NULL OR dest_geoip IS NOT NULL)
        AND COALESCE(dest_isp, json_extract(dest_geoip, '$.isp')) IS NOT NULL
        AND COALESCE(dest_isp, json_extract(dest_geoip, '$.isp')) != ''
    `;
    const params: (string | number)[] = [profileId, since, until];
    if (countryCode) {
      queryStr += " AND UPPER(COALESCE(dest_country_code, json_extract(dest_geoip, '$.country_code'))) = ?";
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
