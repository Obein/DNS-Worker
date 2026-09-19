import { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import { ResolutionLog } from "../../types";
import {
  LogCoreModel,
  GetLogsOptions
} from "./core";
import { LogAggregationModel } from "./aggregation";
import { LogRetentionModel } from "./retention";
import {
  LogAnalyticsModel,
  ActionCountResult,
  TimeSeriesTrendPoint,
  DomainCountResult,
  ClientCountResult,
  DestinationCountResult,
  ISPCountResult,
  DashboardAnalyticsResult
} from "./analytics";

// Re-export sub-models, types, and utility functions
export * from "./core";
export * from "./aggregation";
export * from "./retention";
export * from "./analytics";

/**
 * Unified LogModel Facade providing backward-compatible access to
 * all log-related subsystems (core CRUD, aggregation, retention, analytics).
 */
export class LogModel {
  public readonly core: LogCoreModel;
  public readonly aggregation: LogAggregationModel;
  public readonly retention: LogRetentionModel;
  public readonly analytics: LogAnalyticsModel;

  constructor(private readonly db: D1Database) {
    this.core = new LogCoreModel(db);
    this.aggregation = new LogAggregationModel(db);
    this.retention = new LogRetentionModel(db);
    this.analytics = new LogAnalyticsModel(db, this.aggregation);
  }

  createInsertStatement(log: ResolutionLog): D1PreparedStatement {
    return this.core.createInsertStatement(log);
  }

  async insert(log: ResolutionLog): Promise<boolean> {
    return this.core.insert(log);
  }

  async getLogs(profileId: string, options: GetLogsOptions): Promise<ResolutionLog[]> {
    return this.core.getLogs(profileId, options);
  }

  async getLog(profileId: string, logId: number, timestamp?: number): Promise<ResolutionLog | null> {
    return this.core.getLog(profileId, logId, timestamp);
  }

  async deleteByOwner(ownerId: string): Promise<boolean> {
    return this.core.deleteByOwner(ownerId);
  }

  async cleanup(profileId: string, olderThanTimestamp: number, maxRows = 1000): Promise<number> {
    return this.core.cleanup(profileId, olderThanTimestamp, maxRows);
  }

  async cleanupGlobal(maxRetentionDays = 30, batchLimit = 1000, dailyBudget = 20000): Promise<void> {
    return this.retention.cleanupGlobal(maxRetentionDays, batchLimit, dailyBudget);
  }

  async getLatestRollupHour(profileId: string): Promise<number | null> {
    return this.aggregation.getLatestRollupHour(profileId);
  }

  async getLatestClientRollupHour(profileId: string): Promise<number | null> {
    return this.aggregation.getLatestClientRollupHour(profileId);
  }

  async getLatestDestinationRollupHour(profileId: string): Promise<number | null> {
    return this.aggregation.getLatestDestinationRollupHour(profileId);
  }

  async aggregateHourlyRollups(sinceSec?: number, untilSec?: number, minDomainCount = 2): Promise<number> {
    return this.aggregation.aggregateHourlyRollups(sinceSec, untilSec, minDomainCount);
  }

  async getSummary(
    profileId: string,
    since: number,
    until: number,
    search?: string,
    accessPointId?: string
  ): Promise<ActionCountResult[]> {
    return this.analytics.getSummary(profileId, since, until, search, accessPointId);
  }

  async getTrend(
    profileId: string,
    since: number,
    until: number,
    interval: string,
    accessPointId?: string
  ): Promise<TimeSeriesTrendPoint[]> {
    return this.analytics.getTrend(profileId, since, until, interval, accessPointId);
  }

  async getTopAllowed(
    profileId: string,
    since: number,
    until: number,
    accessPointId?: string
  ): Promise<DomainCountResult[]> {
    return this.analytics.getTopAllowed(profileId, since, until, accessPointId);
  }

  async getTopBlocked(
    profileId: string,
    since: number,
    until: number,
    accessPointId?: string
  ): Promise<DomainCountResult[]> {
    return this.analytics.getTopBlocked(profileId, since, until, accessPointId);
  }

  async getClients(
    profileId: string,
    since: number,
    until: number,
    accessPointId?: string
  ): Promise<ClientCountResult[]> {
    return this.analytics.getClients(profileId, since, until, accessPointId);
  }

  async getDestinations(
    profileId: string,
    since: number,
    until: number,
    accessPointId?: string,
    limit = 250
  ): Promise<DestinationCountResult[]> {
    return this.analytics.getDestinations(profileId, since, until, accessPointId, limit);
  }

  async getISPByCountry(
    profileId: string,
    countryCode: string | undefined,
    since: number,
    until: number,
    accessPointId?: string,
    limit = 250
  ): Promise<ISPCountResult[]> {
    return this.analytics.getISPByCountry(profileId, countryCode, since, until, accessPointId, limit);
  }

  async getAnalytics(
    profileId: string,
    since: number,
    until: number,
    interval: string,
    accessPointId?: string
  ): Promise<DashboardAnalyticsResult> {
    return this.analytics.getAnalytics(profileId, since, until, interval, accessPointId);
  }
}

