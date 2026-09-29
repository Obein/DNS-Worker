import { D1Database } from "@cloudflare/workers-types";
import { ClientCountResult } from "./types";

/**
 * Handles client device and IP-level analytics.
 * Queries raw resolution logs directly using the (profile_id, timestamp) clustered index
 * as a server-side fallback for client-side Local-First SQLite analytics.
 */
export class LogClientAnalytics {
  constructor(private readonly db: D1Database) {}

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
    let queryStr =
      "SELECT client_ip, geo_country, COUNT(*) as count FROM logs WHERE profile_id = ? AND timestamp >= ? AND timestamp <= ?";
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
}
