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

  async getLogs(profileId: string, options: { since: number, until: number, status?: string, search?: string, before?: number, limit?: number, access_point_id?: string }): Promise<ResolutionLog[]> {
    let queryStr = `
      SELECT l.id, l.timestamp, l.domain, l.action, l.record_type, l.latency, l.answer, l.geo_country, l.reason, l.access_point_id, ap.name as access_point_name 
      FROM logs l
      LEFT JOIN access_points ap ON l.access_point_id = ap.id
      WHERE l.profile_id = ? AND l.timestamp >= ? AND l.timestamp <= ?
    `;
    let params: any[] = [profileId, options.since, options.until];
    
    if (options.status) { queryStr += " AND l.action = ?"; params.push(options.status); }
    if (options.search) { queryStr += " AND l.domain LIKE ?"; params.push(`%${options.search}%`); }
    if (options.before) { queryStr += " AND l.timestamp < ?"; params.push(options.before); }
    if (options.access_point_id) { queryStr += " AND l.access_point_id = ?"; params.push(options.access_point_id); }
    
    queryStr += ` ORDER BY l.timestamp DESC LIMIT ${options.limit || 50}`;
    
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
   * 全局清理过期日志 (基于各 Profile 的 settings)
   * 这是一个更重的操作，建议优化为单个 SQL
   */
  async cleanupGlobal(): Promise<void> {
    // 这里的逻辑比较复杂，因为每个 Profile 的保留天数不同
    // 我们先查询出所有不同的天数配置
    const { results } = await this.db.prepare("SELECT DISTINCT json_extract(settings, '$.log_retention_days') as days FROM profiles").all<{days: number}>();
    
    for (const row of results) {
      const days = row.days || 30;
      const threshold = Math.floor(Date.now() / 1000 - (days * 24 * 3600));
      // 清理所有设置为该天数的 Profile 的过期日志
      await this.db.prepare("DELETE FROM logs WHERE timestamp < ? AND profile_id IN (SELECT id FROM profiles WHERE json_extract(settings, '$.log_retention_days') = ? OR (? = 30 AND json_extract(settings, '$.log_retention_days') IS NULL))")
        .bind(threshold, days, days).run();
    }
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

  async getISPByCountry(profileId: string, countryCode: string, since: number, until: number, accessPointId?: string, limit: number = 250) {
    let queryStr = `
      SELECT 
        json_extract(dest_geoip, '$.isp') as name, 
        COUNT(*) as count 
      FROM logs 
      WHERE profile_id = ? 
        AND timestamp >= ? 
        AND timestamp <= ? 
        AND json_extract(dest_geoip, '$.country_code') = ? 
        AND dest_geoip IS NOT NULL
    `;
    let params: any[] = [profileId, since, until, countryCode.toUpperCase()];
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
