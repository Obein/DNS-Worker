import { D1Database } from "@cloudflare/workers-types";

/**
 * @deprecated Hourly rollups have been superseded by client-side Local-First analytics (SQLite WASM)
 * and direct clustered-index queries on raw logs for server-side fallback.
 *
 * This class is maintained for facade backward compatibility.
 */
export class LogAggregationModel {
  constructor(private readonly db: D1Database) {}

  /**
   * @deprecated Rollup tables are dropped. Always returns null.
   */
  async getLatestRollupHour(_profileId: string): Promise<number | null> {
    return null;
  }

  /**
   * @deprecated Rollup tables are dropped. Always returns null.
   */
  async getLatestClientRollupHour(_profileId: string): Promise<number | null> {
    return null;
  }

  /**
   * @deprecated Rollup tables are dropped. Always returns null.
   */
  async getLatestDestinationRollupHour(_profileId: string): Promise<number | null> {
    return null;
  }

  /**
   * @deprecated Rollup tables are dropped. Background aggregation is no longer needed.
   * Always returns 0.
   */
  async aggregateHourlyRollups(
    _sinceSec?: number,
    _untilSec?: number,
    _minDomainCount = 2
  ): Promise<number> {
    return 0;
  }
}
