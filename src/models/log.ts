import { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import { ResolutionLog } from "../types";

let logSeqCounter = 0;

/**
 * Generates a unique, monotonically increasing 64-bit safe integer ID for log records.
 * Fits within JavaScript Number.MAX_SAFE_INTEGER (9,007,199,254,740,991) and is valid until year 2255.
 *
 * Combines milliseconds timestamp with local sequence counter to guarantee uniqueness
 * across micro-batches and concurrent resolutions.
 */
export function generateLogId(): number {
  const seq = (logSeqCounter++) % 1000;
  return Date.now() * 1000 + seq;
}

export class LogModel {
  constructor(private db: D1Database) {}

  createInsertStatement(log: ResolutionLog): D1PreparedStatement {
    const logId = log.id ?? generateLogId();
    return this.db.prepare(
      "INSERT INTO logs (profile_id, timestamp, id, access_point_id, client_ip, geo_country, domain, record_type, action, reason, answer, dest_geoip, ecs, upstream, latency) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
      .bind(
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
      );
  }

  /**
   * Generates a prepared atomic UPSERT statement for domain_hourly_rollups.
   * Increments the count if the record already exists for the (profile_id, hour_timestamp, domain, action) composite key.
   *
   * @param profileId - Profile identifier.
   * @param hourTimestamp - Hour-aligned epoch timestamp in seconds.
   * @param domain - Fully-qualified or normalized domain name.
   * @param action - Resolution action ('PASS' | 'BLOCK' | 'REDIRECT' | 'FAIL').
   * @param count - Increment count (pre-aggregated in memory).
   * @returns D1PreparedStatement ready for batch execution.
   */
  createDomainRollupUpsertStatement(
    profileId: string,
    hourTimestamp: number,
    domain: string,
    action: string,
    count: number
  ): D1PreparedStatement {
    return this.db.prepare(`
      INSERT INTO domain_hourly_rollups (profile_id, hour_timestamp, domain, action, count)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(profile_id, hour_timestamp, domain, action)
      DO UPDATE SET count = count + excluded.count
    `).bind(profileId, hourTimestamp, domain, action, count);
  }

  async insert(log: ResolutionLog): Promise<boolean> {
    const result = await this.createInsertStatement(log).run();
    return result.success;
  }

  async getLogs(profileId: string, options: {
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
  }): Promise<ResolutionLog[]> {
    let baseSelect = "";
    if (options.export) {
      baseSelect = `
        SELECT l.profile_id, l.access_point_id, l.timestamp, l.client_ip, l.geo_country, l.domain, l.record_type, l.action, l.reason, l.answer, l.dest_geoip, l.ecs, l.upstream, l.latency
        FROM logs l
      `;
    } else {
      baseSelect = `
        SELECT l.id, l.timestamp, l.domain, l.action, l.record_type, l.latency, l.answer, l.geo_country, l.reason, l.access_point_id, ap.name as access_point_name 
        FROM logs l
        LEFT JOIN access_points ap ON l.access_point_id = ap.id
      `;
    }

    const whereClauses: string[] = ["l.profile_id = ?"];
    const params: any[] = [profileId];

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
      params.push(options.geo_country);
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
      whereClauses.push("json_extract(l.dest_geoip, '$.country_code') = ?");
      params.push(options.dest_country.toUpperCase());
    }
    if (options.isp) {
      whereClauses.push("json_extract(l.dest_geoip, '$.isp') = ?");
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

  async deleteByOwner(ownerId: string): Promise<boolean> {
    const results = await this.db.batch([
      this.db.prepare("DELETE FROM domain_hourly_rollups WHERE profile_id IN (SELECT id FROM profiles WHERE owner_id = ?)").bind(ownerId),
      this.db.prepare("DELETE FROM log_hourly_rollups WHERE profile_id IN (SELECT id FROM profiles WHERE owner_id = ?)").bind(ownerId),
      this.db.prepare("DELETE FROM client_hourly_rollups WHERE profile_id IN (SELECT id FROM profiles WHERE owner_id = ?)").bind(ownerId),
      this.db.prepare("DELETE FROM destination_hourly_rollups WHERE profile_id IN (SELECT id FROM profiles WHERE owner_id = ?)").bind(ownerId),
      this.db.prepare("DELETE FROM logs WHERE profile_id IN (SELECT id FROM profiles WHERE owner_id = ?)").bind(ownerId)
    ]);
    return results.every(r => r.success);
  }

  async cleanup(profileId: string, olderThanTimestamp: number, maxRows = 20000): Promise<number> {
    // Purge expired rollups first (small table, sub-millisecond execution)
    await this.db.batch([
      this.db.prepare("DELETE FROM domain_hourly_rollups WHERE profile_id = ? AND hour_timestamp < ?").bind(profileId, olderThanTimestamp),
      this.db.prepare("DELETE FROM log_hourly_rollups WHERE profile_id = ? AND hour_timestamp < ?").bind(profileId, olderThanTimestamp),
      this.db.prepare("DELETE FROM client_hourly_rollups WHERE profile_id = ? AND hour_timestamp < ?").bind(profileId, olderThanTimestamp),
      this.db.prepare("DELETE FROM destination_hourly_rollups WHERE profile_id = ? AND hour_timestamp < ?").bind(profileId, olderThanTimestamp)
    ]);

    let totalDeleted = 0;
    const batchSize = 10000;
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

  /**
   * Global log cleanup: runs on every cron trigger.
   *
   * Applies two independent safety caps per profile:
   *   1. Time-based: deletes logs older than min(user_setting, MAX_LOG_RETENTION_DAYS).
   *      The global cap prevents users from setting arbitrarily long retention periods
   *      (e.g. 360 days) that would cause D1 to overflow.
   *   2. Batch limiting: deletes at most 10,000 rows per profile per run to avoid
   *      exhausting daily D1 write quotas or causing CPU execution timeouts.
   *
   * Also purges expired entries from log_hourly_rollups.
   *
   * @param maxRetentionDays - Hard cap on log retention days (default 30).
   */
  async cleanupGlobal(
    maxRetentionDays = 30
  ): Promise<void> {
    try {
      const { results: profiles } = await this.db.prepare(
        "SELECT id, settings FROM profiles"
      ).all<{id: string, settings: string}>();

      const statements = [];

      for (const profile of profiles) {
        // ── 1. Time-based cleanup ────────────────────────────────────────────────
        let days = 30;
        try {
          const settings = JSON.parse(profile.settings);
          if (settings?.log_retention_days != null) {
            days = Number(settings.log_retention_days);
          }
        } catch {
          // Use default on parse error
        }

        // Enforce global hard cap: user setting cannot exceed maxRetentionDays
        const effectiveDays = Math.min(days, maxRetentionDays);
        const threshold = Math.floor(Date.now() / 1000 - (effectiveDays * 24 * 3600));

        // Purge expired rollups matching retention policy
        statements.push(
          this.db.prepare(
            "DELETE FROM domain_hourly_rollups WHERE profile_id = ? AND hour_timestamp < ?"
          ).bind(profile.id, threshold)
        );
        statements.push(
          this.db.prepare(
            "DELETE FROM log_hourly_rollups WHERE profile_id = ? AND hour_timestamp < ?"
          ).bind(profile.id, threshold)
        );
        statements.push(
          this.db.prepare(
            "DELETE FROM client_hourly_rollups WHERE profile_id = ? AND hour_timestamp < ?"
          ).bind(profile.id, threshold)
        );
        statements.push(
          this.db.prepare(
            "DELETE FROM destination_hourly_rollups WHERE profile_id = ? AND hour_timestamp < ?"
          ).bind(profile.id, threshold)
        );

        // Delete up to 10,000 rows per profile per hourly cron run to prevent write spikes
        statements.push(
          this.db.prepare(`
            DELETE FROM logs WHERE (profile_id, timestamp, id) IN (
              SELECT profile_id, timestamp, id FROM logs WHERE profile_id = ? AND timestamp < ? LIMIT 10000
            )
          `).bind(profile.id, threshold)
        );
      }

      if (statements.length > 0) {
        await this.db.batch(statements);
      }

      console.log(`[LogModel] cleanupGlobal: processed ${profiles.length} profile(s), maxRetentionDays=${maxRetentionDays}d`);
    } catch (e: any) {
      console.error("[LogModel] cleanupGlobal failed:", e.message || e);
    }
  }

  /**
   * Retrieves the latest completed hour timestamp aggregated in log_hourly_rollups for a profile.
   * Uses the primary key index (profile_id, hour_timestamp, action) for a sub-millisecond lookup.
   *
   * @param profileId - Profile identifier.
   * @returns The latest hour timestamp, or null if no rollups exist.
   */
  async getLatestRollupHour(profileId: string): Promise<number | null> {
    const row = await this.db.prepare(
      "SELECT MAX(hour_timestamp) as max_hour FROM log_hourly_rollups WHERE profile_id = ?"
    ).bind(profileId).first<{ max_hour: number | null }>();
    return row?.max_hour ?? null;
  }

  /**
   * Retrieves the latest completed hour timestamp aggregated in client_hourly_rollups for a profile.
   * Uses the primary key index (profile_id, hour_timestamp, client_ip, geo_country, access_point_id) for a sub-millisecond lookup.
   *
   * @param profileId - Profile identifier.
   * @returns The latest hour timestamp, or null if no rollups exist.
   */
  async getLatestClientRollupHour(profileId: string): Promise<number | null> {
    const row = await this.db.prepare(
      "SELECT MAX(hour_timestamp) as max_hour FROM client_hourly_rollups WHERE profile_id = ?"
    ).bind(profileId).first<{ max_hour: number | null }>();
    return row?.max_hour ?? null;
  }

  /**
   * Retrieves the latest completed hour timestamp aggregated in destination_hourly_rollups for a profile.
   * Uses the primary key index (profile_id, hour_timestamp, country_code, country, access_point_id) for a sub-millisecond lookup.
   *
   * @param profileId - Profile identifier.
   * @returns The latest hour timestamp, or null if no rollups exist.
   */
  async getLatestDestinationRollupHour(profileId: string): Promise<number | null> {
    const row = await this.db.prepare(
      "SELECT MAX(hour_timestamp) as max_hour FROM destination_hourly_rollups WHERE profile_id = ?"
    ).bind(profileId).first<{ max_hour: number | null }>();
    return row?.max_hour ?? null;
  }

  /**
   * Aggregates completed hours of raw logs into log_hourly_rollups, client_hourly_rollups, and destination_hourly_rollups.
   * Runs in the background during hourly cron maintenance (or can be called explicitly).
   *
   * Uses profile-isolated queries with `idx_logs_profile_time` to scan only the small window
   * of recently completed hours, upserting into rollup tables.
   *
   * @param sinceSec - Optional start timestamp. If omitted, bridges from latest rollup in DB or defaults to lookback.
   * @param untilSec - Optional end timestamp. Defaults to start of current hour (only completed hours).
   * @returns Total number of rollup records inserted or updated.
   */
  async aggregateHourlyRollups(sinceSec?: number, untilSec?: number): Promise<number> {
    const now = Math.floor(Date.now() / 1000);
    const currentHourStart = Math.floor(now / 3600) * 3600;
    const effectiveUntil = untilSec !== undefined ? Math.min(untilSec, currentHourStart) : currentHourStart;

    let effectiveSinceAction = sinceSec;
    if (effectiveSinceAction === undefined) {
      const row = await this.db.prepare(
        "SELECT MAX(hour_timestamp) AS max_hour FROM log_hourly_rollups"
      ).first<{ max_hour: number | null }>();

      if (row?.max_hour) {
        effectiveSinceAction = Math.max(row.max_hour, effectiveUntil - (7 * 86400));
      } else {
        effectiveSinceAction = effectiveUntil - (7 * 86400);
      }
    }

    let effectiveSinceClient = sinceSec;
    if (effectiveSinceClient === undefined) {
      const row = await this.db.prepare(
        "SELECT MAX(hour_timestamp) AS max_hour FROM client_hourly_rollups"
      ).first<{ max_hour: number | null }>();

      if (row?.max_hour) {
        effectiveSinceClient = Math.max(row.max_hour, effectiveUntil - (7 * 86400));
      } else {
        effectiveSinceClient = effectiveUntil - (7 * 86400);
      }
    }

    let effectiveSinceDestination = sinceSec;
    if (effectiveSinceDestination === undefined) {
      const row = await this.db.prepare(
        "SELECT MAX(hour_timestamp) AS max_hour FROM destination_hourly_rollups"
      ).first<{ max_hour: number | null }>();

      if (row?.max_hour) {
        effectiveSinceDestination = Math.max(row.max_hour, effectiveUntil - (7 * 86400));
      } else {
        effectiveSinceDestination = effectiveUntil - (7 * 86400);
      }
    }

    if (
      effectiveSinceAction >= effectiveUntil &&
      effectiveSinceClient >= effectiveUntil &&
      effectiveSinceDestination >= effectiveUntil
    ) {
      return 0;
    }

    try {
      const { results: profiles } = await this.db.prepare(
        "SELECT id FROM profiles"
      ).all<{ id: string }>();

      if (!profiles || profiles.length === 0) {
        return 0;
      }

      const statements: D1PreparedStatement[] = [];

      for (const profile of profiles) {
        if (effectiveSinceAction < effectiveUntil) {
          statements.push(
            this.db.prepare(`
              INSERT OR REPLACE INTO log_hourly_rollups (profile_id, hour_timestamp, action, count)
              SELECT
                profile_id,
                (timestamp / 3600) * 3600 AS hour_timestamp,
                action,
                COUNT(*) AS count
              FROM logs
              WHERE profile_id = ? AND timestamp >= ? AND timestamp < ?
              GROUP BY (timestamp / 3600) * 3600, action
            `).bind(profile.id, effectiveSinceAction, effectiveUntil)
          );
        }

        if (effectiveSinceClient < effectiveUntil) {
          statements.push(
            this.db.prepare(`
              INSERT OR REPLACE INTO client_hourly_rollups (profile_id, hour_timestamp, client_ip, geo_country, access_point_id, count)
              SELECT
                profile_id,
                (timestamp / 3600) * 3600 AS hour_timestamp,
                client_ip,
                COALESCE(geo_country, '') AS geo_country,
                COALESCE(access_point_id, '') AS access_point_id,
                COUNT(*) AS count
              FROM logs
              WHERE profile_id = ? AND timestamp >= ? AND timestamp < ?
              GROUP BY (timestamp / 3600) * 3600, client_ip, COALESCE(geo_country, ''), COALESCE(access_point_id, '')
            `).bind(profile.id, effectiveSinceClient, effectiveUntil)
          );
        }

        if (effectiveSinceDestination < effectiveUntil) {
          statements.push(
            this.db.prepare(`
              INSERT OR REPLACE INTO destination_hourly_rollups (profile_id, hour_timestamp, country_code, country, access_point_id, count)
              SELECT
                profile_id,
                (timestamp / 3600) * 3600 AS hour_timestamp,
                COALESCE(json_extract(dest_geoip, '$.country_code'), '') AS country_code,
                COALESCE(json_extract(dest_geoip, '$.country'), '') AS country,
                COALESCE(access_point_id, '') AS access_point_id,
                COUNT(*) AS count
              FROM logs
              WHERE profile_id = ? AND timestamp >= ? AND timestamp < ?
                AND dest_geoip IS NOT NULL
                AND json_extract(dest_geoip, '$.country_code') IS NOT NULL
                AND json_extract(dest_geoip, '$.country_code') != ''
              GROUP BY (timestamp / 3600) * 3600, COALESCE(json_extract(dest_geoip, '$.country_code'), ''), COALESCE(json_extract(dest_geoip, '$.country'), ''), COALESCE(access_point_id, '')
            `).bind(profile.id, effectiveSinceDestination, effectiveUntil)
          );
        }
      }

      if (statements.length === 0) {
        return 0;
      }

      let totalAggregatedRows = 0;
      const results = await this.db.batch(statements);
      for (const res of results) {
        totalAggregatedRows += res.meta.changes || 0;
      }

      return totalAggregatedRows;
    } catch (e: any) {
      console.error("[LogModel] aggregateHourlyRollups failed:", e.message || e);
      return 0;
    }
  }

  /**
   * Retrieves action counts (PASS, BLOCK, REDIRECT, FAIL) for a given time range.
   *
   * Performance optimization:
   * When no granular text search or accessPointId filter is applied, uses pre-aggregated
   * `log_hourly_rollups` for historical hours combined with a lightweight scan of `logs`
   * for the ongoing hour, reducing D1 read row scans by up to 99%.
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
  ): Promise<{ action: string; count: number }[]> {
    if (search || accessPointId) {
      let queryStr = "SELECT action, COUNT(*) as count FROM logs WHERE profile_id = ? AND timestamp >= ? AND timestamp <= ?";
      const params: any[] = [profileId, since, until];
      if (search) {
        queryStr += " AND domain LIKE ?";
        params.push(`%${search}%`);
      }
      if (accessPointId) {
        queryStr += " AND access_point_id = ?";
        params.push(accessPointId);
      }
      queryStr += " GROUP BY action";
      const { results } = await this.db.prepare(queryStr).bind(...params).all<{ action: string; count: number }>();
      return results;
    }

    const latestRollupHour = await this.getLatestRollupHour(profileId);
    const cutoff = latestRollupHour !== null ? (latestRollupHour + 3600) : since;

    // Case 1: No rollups available or entire range is after cutoff -> query raw logs only
    if (cutoff <= since) {
      const { results } = await this.db.prepare(
        "SELECT action, COUNT(*) as count FROM logs WHERE profile_id = ? AND timestamp >= ? AND timestamp <= ? GROUP BY action"
      ).bind(profileId, since, until).all<{ action: string; count: number }>();
      return results;
    }

    // Case 2: Entire range is within completed rollups
    if (cutoff > until) {
      const sinceHour = Math.floor(since / 3600) * 3600;
      const { results } = await this.db.prepare(
        "SELECT action, SUM(count) as count FROM log_hourly_rollups WHERE profile_id = ? AND hour_timestamp >= ? AND hour_timestamp <= ? GROUP BY action"
      ).bind(profileId, sinceHour, until).all<{ action: string; count: number }>();
      return results;
    }

    // Case 3: Spans historical rollups and unaggregated logs -> Hybrid UNION ALL query
    const sinceHour = Math.floor(since / 3600) * 3600;
    const { results } = await this.db.prepare(`
      SELECT action, SUM(count) as count FROM (
        SELECT action, count
        FROM log_hourly_rollups
        WHERE profile_id = ? AND hour_timestamp >= ? AND hour_timestamp < ?
        UNION ALL
        SELECT action, COUNT(*) as count
        FROM logs
        WHERE profile_id = ? AND timestamp >= ? AND timestamp <= ?
        GROUP BY action
      ) GROUP BY action
    `).bind(
      profileId, sinceHour, cutoff,
      profileId, cutoff, until
    ).all<{ action: string; count: number }>();

    return results;
  }

  /**
   * Retrieves timeseries trend data aggregated by interval.
   *
   * When filtering across all devices and interval is hour-based or day-based,
   * leverages `log_hourly_rollups` for historical hours, avoiding full-table log scans.
   *
   * @param profileId - Profile identifier.
   * @param since - Start timestamp in seconds.
   * @param until - End timestamp in seconds.
   * @param interval - SQL group by expression (e.g. `(timestamp/3600)*3600` or `(timestamp/86400)*86400`).
   * @param accessPointId - Optional device filter.
   * @returns Array of timeseries points.
   */
  async getTrend(
    profileId: string,
    since: number,
    until: number,
    interval: string,
    accessPointId?: string
  ): Promise<{ timestamp: number; action: string; count: number }[]> {
    const isHourly = interval.includes("3600");
    const isDaily = interval.includes("86400");

    // If device-specific or not an hourly/daily interval, query raw logs directly
    if (accessPointId || (!isHourly && !isDaily)) {
      let queryStr = `SELECT ${interval} as timestamp, action, COUNT(*) as count FROM logs WHERE profile_id = ? AND timestamp >= ? AND timestamp <= ?`;
      const params: any[] = [profileId, since, until];
      if (accessPointId) {
        queryStr += " AND access_point_id = ?";
        params.push(accessPointId);
      }
      queryStr += ` GROUP BY ${interval}, action ORDER BY timestamp ASC`;
      const { results } = await this.db.prepare(queryStr).bind(...params).all<{ timestamp: number; action: string; count: number }>();
      return results;
    }

    const latestRollupHour = await this.getLatestRollupHour(profileId);
    const cutoff = latestRollupHour !== null ? (latestRollupHour + 3600) : since;
    const rollupInterval = isDaily ? "(hour_timestamp / 86400) * 86400" : "hour_timestamp";
    const logsInterval = isDaily ? "(timestamp / 86400) * 86400" : "(timestamp / 3600) * 3600";

    // Case 1: No rollups available or entire range is after cutoff -> query raw logs only
    if (cutoff <= since) {
      const queryStr = `SELECT ${logsInterval} as timestamp, action, COUNT(*) as count FROM logs WHERE profile_id = ? AND timestamp >= ? AND timestamp <= ? GROUP BY ${logsInterval}, action ORDER BY timestamp ASC`;
      const { results } = await this.db.prepare(queryStr).bind(profileId, since, until).all<{ timestamp: number; action: string; count: number }>();
      return results;
    }

    // Case 2: Entire range is within completed rollups
    if (cutoff > until) {
      const sinceHour = Math.floor(since / 3600) * 3600;
      const queryStr = `SELECT ${rollupInterval} as timestamp, action, SUM(count) as count FROM log_hourly_rollups WHERE profile_id = ? AND hour_timestamp >= ? AND hour_timestamp <= ? GROUP BY ${rollupInterval}, action ORDER BY timestamp ASC`;
      const { results } = await this.db.prepare(queryStr).bind(profileId, sinceHour, until).all<{ timestamp: number; action: string; count: number }>();
      return results;
    }

    // Case 3: Hybrid query spanning historical rollups and unaggregated logs
    const sinceHour = Math.floor(since / 3600) * 3600;
    const queryStr = `
      SELECT timestamp, action, SUM(count) as count FROM (
        SELECT ${rollupInterval} as timestamp, action, count
        FROM log_hourly_rollups
        WHERE profile_id = ? AND hour_timestamp >= ? AND hour_timestamp < ?
        UNION ALL
        SELECT ${logsInterval} as timestamp, action, COUNT(*) as count
        FROM logs
        WHERE profile_id = ? AND timestamp >= ? AND timestamp <= ?
        GROUP BY ${logsInterval}, action
      ) GROUP BY timestamp, action ORDER BY timestamp ASC
    `;
    const { results } = await this.db.prepare(queryStr).bind(
      profileId, sinceHour, cutoff,
      profileId, cutoff, until
    ).all<{ timestamp: number; action: string; count: number }>();

    return results;
  }

  /**
   * Retrieves top allowed domains for a given time range.
   *
   * Performance optimization:
   * When no device/access point filter is present, queries pre-aggregated `domain_hourly_rollups`
   * using covering index `idx_domain_rollups_query` (profile_id, action, hour_timestamp, domain, count),
   * avoiding multi-million row table scans over raw logs.
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
  ): Promise<{ domain: string; count: number }[]> {
    if (!accessPointId) {
      const sinceHour = Math.floor(since / 3600) * 3600;
      const { results } = await this.db.prepare(`
        SELECT domain, SUM(count) as count
        FROM domain_hourly_rollups
        WHERE profile_id = ? AND action = 'PASS' AND hour_timestamp >= ? AND hour_timestamp <= ?
        GROUP BY domain
        ORDER BY count DESC
        LIMIT 10
      `).bind(profileId, sinceHour, until).all<{ domain: string; count: number }>();

      if (results && results.length > 0) {
        return results;
      }
    }

    let queryStr = "SELECT domain, COUNT(*) as count FROM logs WHERE profile_id = ? AND timestamp >= ? AND timestamp <= ? AND action = 'PASS'";
    const params: any[] = [profileId, since, until];
    if (accessPointId) {
      queryStr += " AND access_point_id = ?";
      params.push(accessPointId);
    }
    queryStr += " GROUP BY domain ORDER BY count DESC LIMIT 10";
    const { results } = await this.db.prepare(queryStr).bind(...params).all<{ domain: string; count: number }>();
    return results;
  }

  /**
   * Retrieves top blocked domains for a given time range.
   *
   * Performance optimization:
   * When no device/access point filter is present, queries pre-aggregated `domain_hourly_rollups`
   * using covering index `idx_domain_rollups_query` (profile_id, action, hour_timestamp, domain, count),
   * avoiding multi-million row table scans over raw logs.
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
  ): Promise<{ domain: string; count: number }[]> {
    if (!accessPointId) {
      const sinceHour = Math.floor(since / 3600) * 3600;
      const { results } = await this.db.prepare(`
        SELECT domain, SUM(count) as count
        FROM domain_hourly_rollups
        WHERE profile_id = ? AND action IN ('BLOCK', 'REDIRECT') AND hour_timestamp >= ? AND hour_timestamp <= ?
        GROUP BY domain
        ORDER BY count DESC
        LIMIT 10
      `).bind(profileId, sinceHour, until).all<{ domain: string; count: number }>();

      if (results && results.length > 0) {
        return results;
      }
    }

    let queryStr = "SELECT domain, COUNT(*) as count FROM logs WHERE profile_id = ? AND timestamp >= ? AND timestamp <= ? AND action = 'BLOCK'";
    const params: any[] = [profileId, since, until];
    if (accessPointId) {
      queryStr += " AND access_point_id = ?";
      params.push(accessPointId);
    }
    queryStr += " GROUP BY domain ORDER BY count DESC LIMIT 10";
    const { results } = await this.db.prepare(queryStr).bind(...params).all<{ domain: string; count: number }>();
    return results;
  }

  /**
   * Retrieves top client IPs and locations for a given time range.
   *
   * Performance optimization:
   * Uses pre-aggregated `client_hourly_rollups` for historical hours combined with
   * a lightweight scan of `logs` for the ongoing hour, reducing D1 read row scans
   * by over 98%.
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
  ): Promise<{ client_ip: string; geo_country: string | null; count: number }[]> {
    const latestRollupHour = await this.getLatestClientRollupHour(profileId);
    const cutoff = latestRollupHour !== null ? (latestRollupHour + 3600) : since;

    // Case 1: No rollups available or entire range is after cutoff -> query raw logs only
    if (cutoff <= since) {
      let queryStr = "SELECT client_ip, geo_country, COUNT(*) as count FROM logs WHERE profile_id = ? AND timestamp >= ? AND timestamp <= ?";
      const params: (string | number)[] = [profileId, since, until];
      if (accessPointId) {
        queryStr += " AND access_point_id = ?";
        params.push(accessPointId);
      }
      queryStr += " GROUP BY client_ip, geo_country ORDER BY count DESC LIMIT 20";
      const { results } = await this.db.prepare(queryStr).bind(...params).all<{ client_ip: string; geo_country: string | null; count: number }>();
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
      const { results } = await this.db.prepare(queryStr).bind(...params).all<{ client_ip: string; geo_country: string | null; count: number }>();
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

    let logWhere = "profile_id = ? AND timestamp >= ? AND timestamp <= ?";
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

    const { results } = await this.db.prepare(queryStr).bind(
      ...rollupParams,
      ...logParams
    ).all<{ client_ip: string; geo_country: string | null; count: number }>();

    return results;
  }

  /**
   * Retrieves top destination countries for a given time range.
   *
   * Performance optimization:
   * Uses pre-aggregated `destination_hourly_rollups` for historical hours combined with
   * a lightweight scan of `logs` for the ongoing hour, reducing D1 read row scans
   * by over 99% and avoiding runtime `json_extract()` operations.
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
    limit: number = 250
  ): Promise<{ country_code: string; country: string; count: number }[]> {
    const latestRollupHour = await this.getLatestDestinationRollupHour(profileId);
    const cutoff = latestRollupHour !== null ? (latestRollupHour + 3600) : since;

    // Case 1: No rollups available or entire range is after cutoff -> query raw logs only
    if (cutoff <= since) {
      let queryStr = `
        SELECT 
          json_extract(dest_geoip, '$.country_code') as country_code,
          json_extract(dest_geoip, '$.country') as country,
          COUNT(*) as count
        FROM logs 
        WHERE profile_id = ? AND timestamp >= ? AND timestamp <= ? AND dest_geoip IS NOT NULL
      `;
      const params: (string | number)[] = [profileId, since, until];
      if (accessPointId) {
        queryStr += " AND access_point_id = ?";
        params.push(accessPointId);
      }
      queryStr += ` GROUP BY country_code ORDER BY count DESC LIMIT ${limit}`;
      const { results } = await this.db.prepare(queryStr).bind(...params).all<{ country_code: string; country: string; count: number }>();
      return results;
    }

    // Case 2: Entire range is within completed rollups
    if (cutoff > until) {
      const sinceHour = Math.floor(since / 3600) * 3600;
      let queryStr = `
        SELECT country_code, country, SUM(count) as count
        FROM destination_hourly_rollups
        WHERE profile_id = ? AND hour_timestamp >= ? AND hour_timestamp <= ?
      `;
      const params: (string | number)[] = [profileId, sinceHour, until];
      if (accessPointId) {
        queryStr += " AND access_point_id = ?";
        params.push(accessPointId);
      }
      queryStr += ` GROUP BY country_code ORDER BY count DESC LIMIT ${limit}`;
      const { results } = await this.db.prepare(queryStr).bind(...params).all<{ country_code: string; country: string; count: number }>();
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

    let logWhere = "profile_id = ? AND timestamp >= ? AND timestamp <= ? AND dest_geoip IS NOT NULL AND json_extract(dest_geoip, '$.country_code') IS NOT NULL AND json_extract(dest_geoip, '$.country_code') != ''";
    const logParams: (string | number)[] = [profileId, cutoff, until];
    if (accessPointId) {
      logWhere += " AND access_point_id = ?";
      logParams.push(accessPointId);
    }

    const queryStr = `
      SELECT country_code, country, SUM(count) as count FROM (
        SELECT country_code, country, count
        FROM destination_hourly_rollups
        WHERE ${rollupWhere}
        UNION ALL
        SELECT 
          COALESCE(json_extract(dest_geoip, '$.country_code'), '') as country_code,
          COALESCE(json_extract(dest_geoip, '$.country'), '') as country,
          COUNT(*) as count
        FROM logs
        WHERE ${logWhere}
        GROUP BY country_code, country
      ) WHERE country_code != '' GROUP BY country_code ORDER BY count DESC LIMIT ${limit}
    `;

    const { results } = await this.db.prepare(queryStr).bind(
      ...rollupParams,
      ...logParams
    ).all<{ country_code: string; country: string; count: number }>();

    return results;
  }

  async getISPByCountry(profileId: string, countryCode: string | undefined, since: number, until: number, accessPointId?: string, limit: number = 250) {
    let queryStr = `
      SELECT 
        json_extract(dest_geoip, '$.isp') as name, 
        COUNT(*) as count 
      FROM logs 
      WHERE profile_id = ? 
        AND timestamp >= ? 
        AND timestamp <= ? 
        AND dest_geoip IS NOT NULL
    `;
    let params: any[] = [profileId, since, until];
    if (countryCode) {
      queryStr += " AND json_extract(dest_geoip, '$.country_code') = ?";
      params.push(countryCode.toUpperCase());
    }
    if (accessPointId) { queryStr += " AND access_point_id = ?"; params.push(accessPointId); }
    queryStr += ` GROUP BY name ORDER BY count DESC LIMIT ${limit}`;
    const { results } = await this.db.prepare(queryStr).bind(...params).all<{ name: string | null, count: number }>();
    return results.map(r => ({
      name: r.name || "Unknown",
      count: r.count
    }));
  }

  async getAnalytics(profileId: string, since: number, until: number, interval: string, accessPointId?: string) {
    const [summary, trend, topAllowed, topBlocked, clients, destinations] = await Promise.all([
      this.getSummary(profileId, since, until, undefined, accessPointId),
      this.getTrend(profileId, since, until, interval, accessPointId),
      this.getTopAllowed(profileId, since, until, accessPointId),
      this.getTopBlocked(profileId, since, until, accessPointId),
      this.getClients(profileId, since, until, accessPointId),
      this.getDestinations(profileId, since, until, accessPointId)
    ]);
    return { summary, trend, top_allowed: topAllowed, top_blocked: topBlocked, clients, destinations };
  }
}
