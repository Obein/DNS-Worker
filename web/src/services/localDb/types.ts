/**
 * @file types.ts
 * @description Type definitions and query parameter interfaces for Local Database Service.
 */

import type { LogEntry } from '../../views/LogsView/types';

/**
 * Telemetry and storage metrics for physical SQLite / OPFS storage.
 */
export interface LocalStorageInfo {
  totalRows: number;
  isOpfs: boolean;
  profileStats: {
    profile_id: string;
    count: number;
    earliest: number;
    latest: number;
  }[];
}

/**
 * Watermark tracking synchronization boundaries for a profile.
 */
export interface SyncWatermark {
  profile_id: string;
  latest_timestamp: number;
  earliest_timestamp: number;
  last_synced_at: number;
  total_synced_count: number;
}

/**
 * Query filter parameters for retrieving paginated logs from local SQLite.
 */
export interface LocalQueryLogsParams {
  profileId: string;
  search?: string;
  action?: string;
  accessPointId?: string;
  destCountry?: string;
  isp?: string;
  since?: number;
  until?: number;
  before?: number;
  limit: number;
  offset?: number;
}

/**
 * Paginated query result for logs retrieved from local SQLite.
 */
export interface LocalQueryResult {
  rows: LogEntry[];
  total: number;
  stats?: { total: number; pass: number; block: number; redirect: number };
}

/**
 * Query parameters for generating aggregated analytics from local SQLite.
 */
export interface LocalAnalyticsParams {
  profileId: string;
  since: number;
  until: number;
  bucketSec: number;
  accessPointId?: string;
}

/**
 * Query parameters for ISP traffic distribution from local SQLite.
 */
export interface LocalQueryISPsParams {
  profileId: string;
  countryCode?: string;
  since: number;
  until: number;
  accessPointId?: string;
  limit?: number;
}
