import { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import { ResolutionLog } from "../../types";

let logSeqCounter = 0;

/**
 * Generates a unique, monotonically increasing 64-bit safe integer ID for log records.
 * Fits within JavaScript Number.MAX_SAFE_INTEGER (9,007,199,254,740,991) and is valid until year 2255.
 *
 * Combines milliseconds timestamp with local sequence counter to guarantee uniqueness
 * across micro-batches and concurrent resolutions.
 *
 * @returns Monotonically increasing 64-bit safe integer ID.
 */
export function generateLogId(): number {
  const seq = (logSeqCounter++) % 1000;
  return Date.now() * 1000 + seq;
}

/**
 * Filter and pagination options for retrieving raw resolution logs.
 */
export interface GetLogsOptions {
  since: number;
  until: number;
  status?: string;
  search?: string;
  before?: number;
  limit?: number;
  access_point_id?: string;
  dest_country?: string;
  isp?: string;
  export?: boolean;
  domain?: string;
  geo_country?: string;
  reason?: string;
  record_type?: string;
}

/**
 * Core model handling raw resolution log persistence, point lookups,
 * filtered pagination, and profile-scoped deletions.
 */
export class LogCoreModel {
  constructor(private readonly db: D1Database) {}

  /**
   * Generates a prepared D1 INSERT statement for a single resolution log entry.
   *
   * @param log - Resolution log entry to insert.
   * @returns D1PreparedStatement ready for single or batch execution.
   */
  createInsertStatement(log: ResolutionLog): D1PreparedStatement {
    const logId = log.id ?? generateLogId();
    return this.db.prepare(
      "INSERT INTO logs (profile_id, timestamp, id, access_point_id, client_ip, geo_country, domain, record_type, action, reason, answer, dest_geoip, ecs, upstream, latency, dest_country_code, dest_country, dest_isp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(
      log.profile_id,
      log.timestamp,
      logId,
      log.access_point_id || null,
      log.client_ip,
      log.geo_country || null,
      log.domain,
      log.record_type,
      log.action,
      log.reason || null,
      log.answer || null,
      log.dest_geoip || null,
      log.ecs || null,
      log.upstream || null,
      log.latency || null,
      log.dest_country_code || null,
      log.dest_country || null,
      log.dest_isp || null
    );
  }

  /**
   * Inserts a single resolution log synchronously into D1.
   *
   * @param log - Resolution log to insert.
   * @returns Promise resolving to true if inserted successfully.
   */
  async insert(log: ResolutionLog): Promise<boolean> {
    const result = await this.createInsertStatement(log).run();
    return result.success;
  }

  /**
   * Retrieves a paginated list of resolution logs based on provided query filters.
   *
   * @param profileId - Profile identifier.
   * @param options - Filtering and pagination options.
   * @returns Array of resolution log records.
   */
  async getLogs(profileId: string, options: GetLogsOptions): Promise<ResolutionLog[]> {
    let baseSelect = "";
    if (options.export) {
      baseSelect = `
        SELECT l.profile_id, l.access_point_id, l.timestamp, l.client_ip, l.geo_country, l.domain, l.record_type, l.action, l.reason, l.answer, l.dest_geoip, l.ecs, l.upstream, l.latency, l.dest_country_code, l.dest_country, l.dest_isp
        FROM logs l
      `;
    } else {
      baseSelect = `
        SELECT l.id, l.timestamp, l.domain, l.action, l.record_type, l.latency, l.answer, l.geo_country, l.reason, l.access_point_id, l.dest_country_code, l.dest_country, l.dest_isp, ap.name as access_point_name 
        FROM logs l
        LEFT JOIN access_points ap ON l.access_point_id = ap.id
      `;
    }

    const whereClauses: string[] = ["l.profile_id = ?"];
    const params: (string | number)[] = [profileId];

    // Place equality filters first so SQLite query planner matches composite indexes prefix
    if (options.access_point_id) {
      whereClauses.push("l.access_point_id = ?");
      params.push(options.access_point_id);
    }
    if (options.status) {
      whereClauses.push("l.action = ?");
      params.push(options.status);
    }
    if (options.geo_country) {
      whereClauses.push("l.geo_country = ?");
      params.push(options.geo_country.toUpperCase());
    }
    if (options.reason) {
      whereClauses.push("l.reason = ?");
      params.push(options.reason);
    }
    if (options.domain) {
      whereClauses.push("l.domain = ?");
      params.push(options.domain);
    }
    if (options.record_type) {
      whereClauses.push("l.record_type = ?");
      params.push(options.record_type);
    }
    if (options.search) {
      whereClauses.push("l.domain LIKE ?");
      params.push(`%${options.search}%`);
    }
    if (options.before) {
      whereClauses.push("l.timestamp < ?");
      params.push(options.before);
    }

    whereClauses.push("l.timestamp >= ?");
    params.push(options.since);
    whereClauses.push("l.timestamp <= ?");
    params.push(options.until);

    if (options.dest_country) {
      whereClauses.push("COALESCE(l.dest_country_code, json_extract(l.dest_geoip, '$.country_code')) = ?");
      params.push(options.dest_country.toUpperCase());
    }
    if (options.isp) {
      whereClauses.push("COALESCE(l.dest_isp, json_extract(l.dest_geoip, '$.isp')) = ?");
      params.push(options.isp);
    }

    let queryStr = baseSelect + " WHERE " + whereClauses.join(" AND ");

    if (options.export) {
      queryStr += " ORDER BY l.timestamp DESC LIMIT 5000";
    } else {
      let limit = options.limit !== undefined && !isNaN(options.limit) && options.limit > 0 ? options.limit : 50;
      if (limit > 100) {
        limit = 100;
      }
      queryStr += ` ORDER BY l.timestamp DESC LIMIT ${limit}`;
    }

    const { results } = await this.db.prepare(queryStr).bind(...params).all<ResolutionLog>();
    return results;
  }

  /**
   * Retrieves a single resolution log by ID and optional timestamp for fast indexed lookup.
   *
   * @param profileId - Profile identifier.
   * @param logId - Unique log integer ID.
   * @param timestamp - Optional timestamp to hit primary key index prefix.
   * @returns Detailed log entry or null if not found.
   */
  async getLog(profileId: string, logId: number, timestamp?: number): Promise<ResolutionLog | null> {
    if (timestamp !== undefined && !isNaN(timestamp)) {
      return await this.db.prepare(`
        SELECT l.*, p.name as profile_name, ap.name as access_point_name 
        FROM logs l 
        JOIN profiles p ON l.profile_id = p.id 
        LEFT JOIN access_points ap ON l.access_point_id = ap.id
        WHERE l.profile_id = ? AND l.timestamp = ? AND l.id = ?
      `)
        .bind(profileId, timestamp, logId)
        .first<ResolutionLog | null>();
    }

    return await this.db.prepare(`
      SELECT l.*, p.name as profile_name, ap.name as access_point_name 
      FROM logs l 
      JOIN profiles p ON l.profile_id = p.id 
      LEFT JOIN access_points ap ON l.access_point_id = ap.id
      WHERE l.profile_id = ? AND l.id = ?
      LIMIT 1
    `)
      .bind(profileId, logId)
      .first<ResolutionLog | null>();
  }

  /**
   * Deletes all logs and associated hourly rollups belonging to all profiles of an owner.
   *
   * @param ownerId - User identifier.
   * @returns Promise resolving to true if all delete batches succeeded.
   */
  async deleteByOwner(ownerId: string): Promise<boolean> {
    const results = await this.db.batch([
      this.db.prepare("DELETE FROM domain_hourly_rollups WHERE profile_id IN (SELECT id FROM profiles WHERE owner_id = ?)").bind(ownerId),
      this.db.prepare("DELETE FROM log_hourly_rollups WHERE profile_id IN (SELECT id FROM profiles WHERE owner_id = ?)").bind(ownerId),
      this.db.prepare("DELETE FROM client_hourly_rollups WHERE profile_id IN (SELECT id FROM profiles WHERE owner_id = ?)").bind(ownerId),
      this.db.prepare("DELETE FROM destination_hourly_rollups WHERE profile_id IN (SELECT id FROM profiles WHERE owner_id = ?)").bind(ownerId),
      this.db.prepare("DELETE FROM logs WHERE profile_id IN (SELECT id FROM profiles WHERE owner_id = ?)").bind(ownerId)
    ]);
    return results.every((r) => r.success);
  }

  /**
   * Manually cleans up logs older than a given timestamp for a specific profile in bounded batches.
   *
   * @param profileId - Profile identifier.
   * @param olderThanTimestamp - Unix epoch timestamp threshold in seconds.
   * @param maxRows - Maximum number of raw log rows to delete (default 20,000).
   * @returns Total number of rows deleted.
   */
  async cleanup(profileId: string, olderThanTimestamp: number, maxRows = 1000): Promise<number> {
    // Purge expired rollups first (small tables, sub-millisecond execution)
    await this.db.batch([
      this.db.prepare("DELETE FROM domain_hourly_rollups WHERE profile_id = ? AND hour_timestamp < ?").bind(profileId, olderThanTimestamp),
      this.db.prepare("DELETE FROM log_hourly_rollups WHERE profile_id = ? AND hour_timestamp < ?").bind(profileId, olderThanTimestamp),
      this.db.prepare("DELETE FROM client_hourly_rollups WHERE profile_id = ? AND hour_timestamp < ?").bind(profileId, olderThanTimestamp),
      this.db.prepare("DELETE FROM destination_hourly_rollups WHERE profile_id = ? AND hour_timestamp < ?").bind(profileId, olderThanTimestamp)
    ]);

    let totalDeleted = 0;
    const batchSize = Math.min(1000, maxRows);
    while (totalDeleted < maxRows) {
      const currentBatch = Math.min(batchSize, maxRows - totalDeleted);
      const result = await this.db.prepare(`
        DELETE FROM logs WHERE (profile_id, timestamp, id) IN (
          SELECT profile_id, timestamp, id FROM logs WHERE profile_id = ? AND timestamp < ? LIMIT ?
        )
      `)
        .bind(profileId, olderThanTimestamp, currentBatch)
        .run();
      const count = result.meta.changes || 0;
      totalDeleted += count;
      if (count < currentBatch) {
        break;
      }
    }
    return totalDeleted;
  }
}
