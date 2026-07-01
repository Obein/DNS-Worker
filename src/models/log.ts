import { D1Database } from "@cloudflare/workers-types";
import { ResolutionLog } from "../types";

export class LogModel {
  constructor(private db: D1Database) {}

  async insert(log: ResolutionLog): Promise<boolean> {
    const result = await this.db.prepare(
      "INSERT INTO logs (profile_id, access_point_id, timestamp, client_ip, geo_country, domain, record_type, action, reason, answer, dest_geoip, ecs, upstream, latency) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
      .bind(
        log.profile_id,
        log.access_point_id || null,
        log.timestamp,
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
      )
      .run();
    return result.success;
  }

  async getLogs(profileId: string, options: { since: number, until: number, status?: string, search?: string, before?: number, limit?: number, access_point_id?: string, dest_country?: string, isp?: string, export?: boolean }): Promise<ResolutionLog[]> {
    let queryStr = "";
    if (options.export) {
      queryStr = `
        SELECT l.profile_id, l.access_point_id, l.timestamp, l.client_ip, l.geo_country, l.domain, l.record_type, l.action, l.reason, l.answer, l.dest_geoip, l.ecs, l.upstream, l.latency
        FROM logs l
        WHERE l.profile_id = ? AND l.timestamp >= ? AND l.timestamp <= ?
      `;
    } else {
      queryStr = `
        SELECT l.id, l.timestamp, l.domain, l.action, l.record_type, l.latency, l.answer, l.geo_country, l.reason, l.access_point_id, ap.name as access_point_name 
        FROM logs l
        LEFT JOIN access_points ap ON l.access_point_id = ap.id
        WHERE l.profile_id = ? AND l.timestamp >= ? AND l.timestamp <= ?
      `;
    }
    let params: any[] = [profileId, options.since, options.until];
    
    if (options.status) { queryStr += " AND l.action = ?"; params.push(options.status); }
    if (options.search) { queryStr += " AND l.domain LIKE ?"; params.push(`%${options.search}%`); }
    if (options.before) { queryStr += " AND l.timestamp < ?"; params.push(options.before); }
    if (options.access_point_id) { queryStr += " AND l.access_point_id = ?"; params.push(options.access_point_id); }
    if (options.dest_country) { queryStr += " AND json_extract(l.dest_geoip, '$.country_code') = ?"; params.push(options.dest_country.toUpperCase()); }
    if (options.isp) { queryStr += " AND json_extract(l.dest_geoip, '$.isp') = ?"; params.push(options.isp); }
    
    if (options.export) {
      queryStr += " ORDER BY l.timestamp DESC LIMIT 50000";
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

  async getLog(profileId: string, logId: number): Promise<ResolutionLog | null> {
    return await this.db.prepare(`
      SELECT l.*, p.name as profile_name, ap.name as access_point_name 
      FROM logs l 
      JOIN profiles p ON l.profile_id = p.id 
      LEFT JOIN access_points ap ON l.access_point_id = ap.id
      WHERE l.profile_id = ? AND l.id = ?
    `)
      .bind(profileId, logId)
      .first<ResolutionLog | null>();
  }

  async deleteByOwner(ownerId: string): Promise<boolean> {
    const result = await this.db.prepare("DELETE FROM logs WHERE profile_id IN (SELECT id FROM profiles WHERE owner_id = ?)").bind(ownerId).run();
    return result.success;
  }

  async cleanup(profileId: string, olderThanTimestamp: number): Promise<number> {
    const result = await this.db.prepare(
      "DELETE FROM logs WHERE profile_id = ? AND timestamp < ?"
    )
      .bind(profileId, olderThanTimestamp)
      .run();
    return result.meta.changes || 0;
  }

  /**
   * Global log cleanup: runs on every cron trigger.
   *
   * Applies two independent safety caps per profile:
   *   1. Time-based: deletes logs older than min(user_setting, MAX_LOG_RETENTION_DAYS).
   *      The global cap prevents users from setting arbitrarily long retention periods
   *      (e.g. 360 days) that would cause D1 to overflow.
   *   2. Row-based: if the profile still has more than MAX_LOGS_PER_PROFILE rows after
   *      the time-based cleanup, the oldest excess rows are deleted. This acts as a
   *      circuit-breaker when write rate temporarily exceeds cleanup rate.
   *
   * @param maxRetentionDays - Hard cap on log retention days (default 90).
   * @param maxLogsPerProfile - Hard cap on row count per profile (default 500_000).
   */
  async cleanupGlobal(
    maxRetentionDays = 90,
    maxLogsPerProfile = 500_000,
  ): Promise<void> {
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

      statements.push(
        this.db.prepare(
          "DELETE FROM logs WHERE profile_id = ? AND timestamp < ?"
        ).bind(profile.id, threshold)
      );

      // ── 2. Row-count cap (circuit-breaker) ──────────────────────────────────
      // Delete oldest rows that exceed maxLogsPerProfile, using the
      // (profile_id, timestamp) composite index for efficiency.
      statements.push(
        this.db.prepare(`
          DELETE FROM logs
          WHERE profile_id = ?
            AND id IN (
              SELECT id FROM logs
              WHERE profile_id = ?
              ORDER BY timestamp ASC
              LIMIT MAX(0, (SELECT COUNT(*) FROM logs WHERE profile_id = ?) - ?)
            )
        `).bind(profile.id, profile.id, profile.id, maxLogsPerProfile)
      );
    }

    if (statements.length > 0) {
      await this.db.batch(statements);
    }

    console.log(`[LogModel] cleanupGlobal: processed ${profiles.length} profile(s), cap=${maxRetentionDays}d/${maxLogsPerProfile}rows`);
  }

  async getSummary(profileId: string, since: number, until: number, search?: string, accessPointId?: string) {
    let queryStr = "SELECT action, COUNT(*) as count FROM logs WHERE profile_id = ? AND timestamp >= ? AND timestamp <= ?";
    let params: any[] = [profileId, since, until];
    if (search) {
      queryStr += " AND domain LIKE ?";
      params.push(`%${search}%`);
    }
    if (accessPointId) {
      queryStr += " AND access_point_id = ?";
      params.push(accessPointId);
    }
    queryStr += " GROUP BY action";
    const { results } = await this.db.prepare(queryStr).bind(...params).all<{ action: string, count: number }>();
    return results;
  }

  async getTrend(profileId: string, since: number, until: number, interval: string, accessPointId?: string) {
    let queryStr = `SELECT ${interval} as timestamp, action, COUNT(*) as count FROM logs WHERE profile_id = ? AND timestamp >= ? AND timestamp <= ?`;
    let params: any[] = [profileId, since, until];
    if (accessPointId) {
      queryStr += " AND access_point_id = ?";
      params.push(accessPointId);
    }
    queryStr += ` GROUP BY ${interval}, action ORDER BY timestamp ASC`;
    const { results } = await this.db.prepare(queryStr).bind(...params).all<{ timestamp: number, action: string, count: number }>();
    return results;
  }

  async getTopAllowed(profileId: string, since: number, until: number, accessPointId?: string) {
    let queryStr = "SELECT domain, COUNT(*) as count FROM logs WHERE profile_id = ? AND timestamp >= ? AND timestamp <= ? AND action = 'PASS'";
    let params: any[] = [profileId, since, until];
    if (accessPointId) { queryStr += " AND access_point_id = ?"; params.push(accessPointId); }
    queryStr += " GROUP BY domain ORDER BY count DESC LIMIT 10";
    const { results } = await this.db.prepare(queryStr).bind(...params).all<{ domain: string, count: number }>();
    return results;
  }

  async getTopBlocked(profileId: string, since: number, until: number, accessPointId?: string) {
    let queryStr = "SELECT domain, COUNT(*) as count FROM logs WHERE profile_id = ? AND timestamp >= ? AND timestamp <= ? AND action = 'BLOCK'";
    let params: any[] = [profileId, since, until];
    if (accessPointId) { queryStr += " AND access_point_id = ?"; params.push(accessPointId); }
    queryStr += " GROUP BY domain ORDER BY count DESC LIMIT 10";
    const { results } = await this.db.prepare(queryStr).bind(...params).all<{ domain: string, count: number }>();
    return results;
  }

  async getClients(profileId: string, since: number, until: number, accessPointId?: string) {
    let queryStr = "SELECT client_ip, geo_country, COUNT(*) as count FROM logs WHERE profile_id = ? AND timestamp >= ? AND timestamp <= ?";
    let params: any[] = [profileId, since, until];
    if (accessPointId) { queryStr += " AND access_point_id = ?"; params.push(accessPointId); }
    queryStr += " GROUP BY client_ip, geo_country ORDER BY count DESC LIMIT 20";
    const { results } = await this.db.prepare(queryStr).bind(...params).all<{ client_ip: string, geo_country: string | null, count: number }>();
    return results;
  }

  async getDestinations(profileId: string, since: number, until: number, accessPointId?: string, limit: number = 250) {
    let queryStr = `
      SELECT 
        json_extract(dest_geoip, '$.country_code') as country_code,
        json_extract(dest_geoip, '$.country') as country,
        COUNT(*) as count
      FROM logs 
      WHERE profile_id = ? AND timestamp >= ? AND timestamp <= ? AND dest_geoip IS NOT NULL
    `;
    let params: any[] = [profileId, since, until];
    if (accessPointId) { queryStr += " AND access_point_id = ?"; params.push(accessPointId); }
    queryStr += ` GROUP BY country_code ORDER BY count DESC LIMIT ${limit}`;
    const { results } = await this.db.prepare(queryStr).bind(...params).all<{ country_code: string, country: string, count: number }>();
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
