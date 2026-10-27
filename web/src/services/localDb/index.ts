/**
 * @file index.ts
 * @description Unified Local Database facade adhering to the Single Responsibility Principle.
 * Composes specialized modules: worker bridge, sync engine, query service, maintenance, and E2EE.
 */

import type { LogEntry } from '../../views/LogsView/types';
import type { AnalyticsData } from '../../views/AnalyticsView/types';
import type {
  LocalStorageInfo,
  SyncWatermark,
  LocalQueryLogsParams,
  LocalQueryResult,
  LocalAnalyticsParams,
  LocalQueryISPsParams
} from './types';

import { LocalDbWorkerBridge } from './workerBridge';
import { LocalDbSyncEngine } from './syncEngine';
import { LocalDbQueryService } from './queryService';
import { LocalDbMaintenanceService } from './maintenanceService';
import { LocalDbE2eeService } from './e2eeService';

export * from './types';
export { LocalDbWorkerBridge } from './workerBridge';
export { LocalDbSyncEngine } from './syncEngine';
export { LocalDbQueryService } from './queryService';
export { LocalDbMaintenanceService } from './maintenanceService';
export { LocalDbE2eeService } from './e2eeService';

/**
 * Unified LocalDbService coordinating modular SQLite WASM capabilities.
 */
export class LocalDbService {
  private readonly bridge: LocalDbWorkerBridge;
  private readonly syncEngine: LocalDbSyncEngine;
  private readonly queryService: LocalDbQueryService;
  private readonly maintenanceService: LocalDbMaintenanceService;
  private readonly e2eeService: LocalDbE2eeService;

  constructor() {
    this.bridge = new LocalDbWorkerBridge();
    this.syncEngine = new LocalDbSyncEngine(this.bridge);
    this.queryService = new LocalDbQueryService(this.bridge);
    this.maintenanceService = new LocalDbMaintenanceService(this.bridge);
    this.e2eeService = new LocalDbE2eeService(this.bridge);
  }

  /** Initializes the client SQLite WASM engine and OPFS storage */
  async init(): Promise<boolean> {
    const ready = await this.bridge.init();
    if (ready) {
      const retentionDays = this.maintenanceService.getLocalRetentionDays();
      if (retentionDays > 0) {
        void this.maintenanceService.cleanup(retentionDays);
      }
    }
    return ready;
  }

  /** Returns whether persistent OPFS storage is active */
  getIsOpfs(): boolean {
    return this.bridge.getIsOpfs();
  }

  /** Retrieves the sync watermark for a given profile */
  async getWatermark(profileId: string): Promise<SyncWatermark | null> {
    return this.syncEngine.getWatermark(profileId);
  }

  /** Updates or expands the watermark boundaries */
  async updateWatermarkBounds(profileId: string, start: number, end: number): Promise<void> {
    return this.syncEngine.updateWatermarkBounds(profileId, start, end);
  }

  /** Synchronizes latest delta logs from server into local SQLite */
  async syncProfileLogs(
    profileId: string,
    onProgress?: (syncedCount: number, total: number) => void,
    targetSince?: number,
    signal?: AbortSignal,
    force: boolean = false
  ): Promise<number> {
    return this.syncEngine.syncProfileLogs(profileId, onProgress, targetSince, signal, force);
  }

  /** Synchronizes missing raw logs for a specific time interval */
  async syncInterval(
    profileId: string,
    start: number,
    end: number,
    signal?: AbortSignal,
    onProgress?: (inserted: number) => void
  ): Promise<number> {
    return this.syncEngine.syncInterval(profileId, start, end, signal, onProgress);
  }

  /** Identifies and downloads all missing time intervals */
  async syncMissingIntervals(
    profileId: string,
    since: number,
    until: number,
    signal?: AbortSignal,
    onProgress?: (inserted: number) => void
  ): Promise<number> {
    return this.syncEngine.syncMissingIntervals(profileId, since, until, signal, onProgress);
  }

  /** Synchronizes target time interval records with chunked transfer and progress reporting */
  async syncTargetInterval(
    profileId: string,
    since: number,
    until: number,
    signal?: AbortSignal,
    onProgress?: (progress: number, insertedSoFar: number, totalExpected: number) => void
  ): Promise<number> {
    return this.syncEngine.syncTargetInterval(profileId, since, until, signal, onProgress);
  }

  /** Backfills older logs from the server into local SQLite */
  async backfillLogs(
    profileId: string,
    before: number,
    since: number,
    limit: number = 50,
    signal?: AbortSignal
  ): Promise<LogEntry[]> {
    return this.syncEngine.backfillLogs(profileId, before, since, limit, signal);
  }

  /** Inserts a batch of log entries directly into local SQLite storage */
  async batchInsertLogs(profileId: string, logs: LogEntry[]): Promise<number> {
    return this.syncEngine.batchInsertLogs(profileId, logs);
  }

  /** Queries local logs from SQLite with pagination, search, and action filters */
  async queryLogs(params: LocalQueryLogsParams): Promise<LocalQueryResult> {
    return this.queryService.queryLogs(params);
  }

  /** Queries local analytics aggregations directly using SQLite GROUP BY queries */
  async queryAnalytics(params: LocalAnalyticsParams): Promise<AnalyticsData> {
    return this.queryService.queryAnalytics(params);
  }

  /** Queries local ISP aggregations optionally filtered by country code */
  async queryISPs(params: LocalQueryISPsParams): Promise<{ name: string; count: number }[]> {
    return this.queryService.queryISPs(params);
  }

  /** Cleans up local logs older than the specified retention days */
  async cleanup(retentionDays: number): Promise<number> {
    return this.maintenanceService.cleanup(retentionDays);
  }

  /** Returns storage stats and row telemetry across all local profiles */
  async getStorageInfo(): Promise<LocalStorageInfo> {
    return this.maintenanceService.getStorageInfo();
  }

  /** Clears all local data for a profile */
  async clearProfile(profileId: string): Promise<void> {
    return this.maintenanceService.clearProfile(profileId);
  }

  /** Re-decrypts any local logs that were previously stored encrypted */
  async reDecryptLocalLogs(profileId: string): Promise<number> {
    return this.e2eeService.reDecryptLocalLogs(profileId);
  }

  /** Retrieves user-configured local storage retention days */
  getLocalRetentionDays(): number {
    return this.maintenanceService.getLocalRetentionDays();
  }

  /** Updates local retention days in localStorage and triggers immediate cleanup */
  setLocalRetentionDays(days: number): void {
    this.maintenanceService.setLocalRetentionDays(days);
  }
}

/** Global singleton instance */
export const localDb = new LocalDbService();
