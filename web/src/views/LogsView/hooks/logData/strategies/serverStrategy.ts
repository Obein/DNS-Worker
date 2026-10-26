/**
 * @file serverStrategy.ts
 * @description Remote server logs and analytics summary fetch strategy.
 */

import type { LogEntry, TimeRange } from "../../../types";
import { getProfileLogs, getProfileAnalytics } from "../../../../../services";

export interface ServerStrategyParams {
  profileId: string;
  currentRange: TimeRange;
  customRange: { start: string; end: string };
  since: number;
  until: number;
  limit: number;
  isInitial: boolean;
  statusFilter: string | null;
  accessPointIdFilter: string | null;
  destCountryFilter: string | null;
  ispFilter: string | null;
  searchQuery: string;
  lastTimestamp?: number;
  signal: AbortSignal;
}

export interface ServerStrategyResult {
  logs: LogEntry[];
  stats: { total: number; pass: number; block: number; redirect: number } | null;
}

/**
 * Fetches logs and summary analytics from the remote backend.
 */
export async function fetchServerLogs(params: ServerStrategyParams): Promise<ServerStrategyResult> {
  const {
    profileId,
    currentRange,
    customRange,
    since,
    until,
    limit,
    isInitial,
    statusFilter,
    accessPointIdFilter,
    destCountryFilter,
    ispFilter,
    searchQuery,
    lastTimestamp,
    signal
  } = params;

  const urlParams = new URLSearchParams({ range: currentRange, limit: String(limit) });
  if (currentRange === "custom" && customRange.start && customRange.end) {
    urlParams.set("start", String(since));
    urlParams.set("end", String(until));
  }
  if (statusFilter) urlParams.set("status", statusFilter);
  if (accessPointIdFilter) urlParams.set("access_point_id", accessPointIdFilter);
  if (destCountryFilter) urlParams.set("dest_country", destCountryFilter);
  if (ispFilter) urlParams.set("isp", ispFilter);
  if (searchQuery) urlParams.set("search", searchQuery);
  if (!isInitial && lastTimestamp !== undefined) {
    urlParams.set("before", String(lastTimestamp));
  }

  const fetchLogsPromise = getProfileLogs(profileId, urlParams.toString(), { signal });
  let fetchStatsPromise: Promise<Array<{ action: string; count: number }> | null> = Promise.resolve(null);

  if (isInitial) {
    const statsParams = new URLSearchParams({ range: currentRange });
    if (currentRange === "custom" && customRange.start && customRange.end) {
      statsParams.set("start", String(since));
      statsParams.set("end", String(until));
    }
    if (searchQuery) statsParams.set("search", searchQuery);
    if (statusFilter) statsParams.set("status", statusFilter);
    if (accessPointIdFilter) statsParams.set("access_point_id", accessPointIdFilter);
    if (destCountryFilter) statsParams.set("dest_country", destCountryFilter);
    if (ispFilter) statsParams.set("isp", ispFilter);
    fetchStatsPromise = getProfileAnalytics(profileId, "summary", statsParams.toString(), { signal });
  }

  const [logsData, statsData] = await Promise.all([fetchLogsPromise, fetchStatsPromise]);

  let stats: { total: number; pass: number; block: number; redirect: number } | null = null;
  if (statsData) {
    const summary = { total: 0, pass: 0, block: 0, redirect: 0 };
    statsData.forEach((item: { action: string; count: number }) => {
      const count = item.count;
      summary.total += count;
      if (item.action === "PASS") summary.pass = count;
      else if (item.action === "BLOCK") summary.block = count;
      else if (item.action === "REDIRECT") summary.redirect = count;
    });
    stats = summary;
  }

  return {
    logs: logsData || [],
    stats
  };
}
