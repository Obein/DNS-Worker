import { D1Database } from "@cloudflare/workers-types";
import { LogTrafficAnalytics } from "./traffic";
import { LogDomainAnalytics } from "./domains";
import { LogClientAnalytics } from "./clients";
import { LogDestinationAnalytics } from "./destinations";
import {
  ActionCountResult,
  TimeSeriesTrendPoint,
  DomainCountResult,
  ClientCountResult,
  DestinationCountResult,
  ISPCountResult,
  DashboardAnalyticsResult
} from "./types";

export * from "./types";
export * from "./traffic";
export * from "./domains";
export * from "./clients";
export * from "./destinations";

/**
 * Unified analytics model facade coordinating specialized sub-analytics:
 * - traffic (action summaries and time-series trends)
 * - domains (top allowed and top blocked/redirected domains)
 * - clients (top client IPs and geo-locations)
 * - destinations (destination countries and ISP distributions)
 */
export class LogAnalyticsModel {
  public readonly traffic: LogTrafficAnalytics;
  public readonly domains: LogDomainAnalytics;
  public readonly clients: LogClientAnalytics;
  public readonly destinations: LogDestinationAnalytics;

  constructor(
    private readonly db: D1Database,
    _aggregation?: unknown
  ) {
    this.traffic = new LogTrafficAnalytics(db);
    this.domains = new LogDomainAnalytics(db);
    this.clients = new LogClientAnalytics(db);
    this.destinations = new LogDestinationAnalytics(db);
  }

  /**
   * Retrieves action counts (PASS, BLOCK, REDIRECT, FAIL) for a given time range.
   */
  async getSummary(
    profileId: string,
    since: number,
    until: number,
    search?: string,
    accessPointId?: string
  ): Promise<ActionCountResult[]> {
    return this.traffic.getSummary(profileId, since, until, search, accessPointId);
  }

  /**
   * Retrieves timeseries trend data aggregated by interval.
   */
  async getTrend(
    profileId: string,
    since: number,
    until: number,
    interval: string,
    accessPointId?: string
  ): Promise<TimeSeriesTrendPoint[]> {
    return this.traffic.getTrend(profileId, since, until, interval, accessPointId);
  }

  /**
   * Retrieves top allowed domains for a given time range.
   */
  async getTopAllowed(
    profileId: string,
    since: number,
    until: number,
    accessPointId?: string
  ): Promise<DomainCountResult[]> {
    return this.domains.getTopAllowed(profileId, since, until, accessPointId);
  }

  /**
   * Retrieves top blocked/redirected domains for a given time range.
   */
  async getTopBlocked(
    profileId: string,
    since: number,
    until: number,
    accessPointId?: string
  ): Promise<DomainCountResult[]> {
    return this.domains.getTopBlocked(profileId, since, until, accessPointId);
  }

  /**
   * Retrieves top client IPs and locations for a given time range.
   */
  async getClients(
    profileId: string,
    since: number,
    until: number,
    accessPointId?: string
  ): Promise<ClientCountResult[]> {
    return this.clients.getClients(profileId, since, until, accessPointId);
  }

  /**
   * Retrieves top destination countries for a given time range.
   */
  async getDestinations(
    profileId: string,
    since: number,
    until: number,
    accessPointId?: string,
    limit = 250
  ): Promise<DestinationCountResult[]> {
    return this.destinations.getDestinations(profileId, since, until, accessPointId, limit);
  }

  /**
   * Retrieves ISP distribution for queries matching an optional country code.
   */
  async getISPByCountry(
    profileId: string,
    countryCode: string | undefined,
    since: number,
    until: number,
    accessPointId?: string,
    limit = 250
  ): Promise<ISPCountResult[]> {
    return this.destinations.getISPByCountry(
      profileId,
      countryCode,
      since,
      until,
      accessPointId,
      limit
    );
  }

  /**
   * Concurrently aggregates all primary analytics components for the dashboard.
   */
  async getAnalytics(
    profileId: string,
    since: number,
    until: number,
    interval: string,
    accessPointId?: string
  ): Promise<DashboardAnalyticsResult> {
    const [summary, trend, topAllowed, topBlocked, clients, destinations] =
      await Promise.all([
        this.getSummary(profileId, since, until, undefined, accessPointId),
        this.getTrend(profileId, since, until, interval, accessPointId),
        this.getTopAllowed(profileId, since, until, accessPointId),
        this.getTopBlocked(profileId, since, until, accessPointId),
        this.getClients(profileId, since, until, accessPointId),
        this.getDestinations(profileId, since, until, accessPointId)
      ]);
    return {
      summary,
      trend,
      top_allowed: topAllowed,
      top_blocked: topBlocked,
      clients,
      destinations
    };
  }
}
