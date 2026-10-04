import { D1Database } from "@cloudflare/workers-types";
import { DomainCountResult } from "./types";

/**
 * Handles top allowed and top blocked domain analytics.
 * Queries raw resolution logs directly using the (profile_id, timestamp) clustered index
 * as a server-side fallback for client-side Local-First SQLite analytics.
 */
export class LogDomainAnalytics {
  constructor(private readonly db: D1Database) {}

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
    let queryStr =
      "SELECT domain, COUNT(*) as count FROM logs WHERE profile_id = ? AND timestamp >= ? AND timestamp <= ? AND action = 'PASS'";
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
    let queryStr =
      "SELECT domain, COUNT(*) as count FROM logs WHERE profile_id = ? AND timestamp >= ? AND timestamp <= ? AND action IN ('BLOCK', 'REDIRECT')";
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
}
