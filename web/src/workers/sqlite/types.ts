/**
 * @file types.ts
 * @description Strongly typed interfaces, data transfer objects, and SQLite driver definitions
 * for the SQLite Web Worker local storage engine.
 */

import type { LogEntry } from '../../views/LogsView/types';

export type WorkerLogEntry = LogEntry;

/**
 * Structural interface for the SQLite WASM Database instance.
 */
export interface SqliteDatabase {
  exec(sql: string | { sql: string; bind?: (string | number | null | undefined)[] }): void;
  prepare(sql: string): SqlitePreparedStatement;
  selectObject(sql: string, binds?: (string | number | null | undefined)[]): Record<string, unknown> | undefined;
}

/**
 * Structural interface for SQLite WASM prepared statements.
 */
export interface SqlitePreparedStatement {
  bind(values: (string | number | null | undefined)[]): void;
  step(): boolean;
  get<T = Record<string, unknown>>(target: Record<string, unknown>): T;
  reset(): void;
  finalize(): void;
}

/**
 * Parameters for querying paginated and filtered logs from local SQLite.
 */
export interface WorkerQueryLogsParams {
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
 * Parameters for calculating time-series and aggregate analytics.
 */
export interface WorkerAnalyticsParams {
  profileId: string;
  since: number;
  until: number;
  bucketSec: number;
  accessPointId?: string;
}

/**
 * Incoming message request envelope from the main thread.
 */
export interface WorkerMessageRequest {
  id: string;
  type:
    | 'INIT'
    | 'SYNC_BATCH'
    | 'UPDATE_LOGS_BATCH'
    | 'GET_ENCRYPTED_LOGS'
    | 'GET_WATERMARK'
    | 'QUERY_LOGS'
    | 'QUERY_ANALYTICS'
    | 'CLEANUP'
    | 'GET_STORAGE_INFO'
    | 'CLEAR_PROFILE';
  payload?: unknown;
}

/**
 * Outgoing message response envelope to the main thread.
 */
export interface WorkerMessageResponse<T = unknown> {
  id: string;
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Payload for batch log synchronization.
 */
export interface SyncBatchPayload {
  profileId: string;
  logs: WorkerLogEntry[];
  minTimestamp?: number;
  maxTimestamp?: number;
}

/**
 * Payload for updating decrypted log entries.
 */
export interface UpdateLogsBatchPayload {
  profileId: string;
  logs: WorkerLogEntry[];
}

/**
 * Payload for querying pending encrypted logs.
 */
export interface GetEncryptedLogsPayload {
  profileId: string;
  limit?: number;
}

/**
 * Payload for querying sync watermark cursors.
 */
export interface GetWatermarkPayload {
  profileId: string;
}

/**
 * Payload for retention cleanup.
 */
export interface CleanupPayload {
  retentionDays: number;
}

/**
 * Payload for clearing a profile's local records.
 */
export interface ClearProfilePayload {
  profileId: string;
}

/**
 * Sync watermark record persisted in SQLite.
 */
export interface SyncWatermarkRow {
  latest_timestamp: number;
  earliest_timestamp: number;
  last_synced_at: number;
  total_synced_count: number;
}

/**
 * Categorical breakdown of DNS action counts.
 */
export interface ActionSummaryStats {
  total: number;
  pass: number;
  block: number;
  redirect: number;
}

/**
 * Paginated log query result with matching totals and summary stats.
 */
export interface WorkerQueryResult {
  rows: WorkerLogEntry[];
  total: number;
  stats: ActionSummaryStats;
}

/**
 * Multi-dimensional analytics computation result.
 */
export interface WorkerAnalyticsResult {
  summary: { action: string; count: number }[];
  trend: { timestamp: number; action: string; count: number }[];
  top_allowed: { domain: string; count: number }[];
  top_blocked: { domain: string; count: number }[];
  clients: { client_ip: string; geo_country: string; count: number }[];
  destinations: { country_code: string; country: string; count: number }[];
}

/**
 * Storage telemetry and per-profile disk breakdown.
 */
export interface WorkerStorageInfo {
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
 * Result of database initialization.
 */
export interface InitResult {
  ready: boolean;
  isOpfs: boolean;
}
