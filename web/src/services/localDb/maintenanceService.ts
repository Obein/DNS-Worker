/**
 * @file maintenanceService.ts
 * @description Storage maintenance service managing retention cleanup, physical inspection, and profile cache purging.
 */

import type { LocalStorageInfo } from './types';
import type { LocalDbWorkerBridge } from './workerBridge';

const LOCAL_RETENTION_KEY = 'obex_local_log_retention';
const DEFAULT_RETENTION_DAYS = 90;

/**
 * Manages SQLite local storage lifecycle and retention settings.
 */
export class LocalDbMaintenanceService {
  private readonly bridge: LocalDbWorkerBridge;

  constructor(bridge: LocalDbWorkerBridge) {
    this.bridge = bridge;
  }

  /**
   * Cleans up local logs older than the specified retention days.
   *
   * @param retentionDays - Days of logs to retain (older rows deleted).
   * @returns Number of deleted records.
   */
  async cleanup(retentionDays: number): Promise<number> {
    await this.bridge.init();
    const { deleted } = await this.bridge.sendRequest<{ deleted: number }>('CLEANUP', { retentionDays });
    if (deleted > 0) {
      console.log(`[LocalDbMaintenanceService] Cleaned up ${deleted} expired local logs`);
    }
    return deleted;
  }

  /**
   * Returns storage stats and row telemetry across all local profiles.
   *
   * @returns LocalStorageInfo object.
   */
  async getStorageInfo(): Promise<LocalStorageInfo> {
    await this.bridge.init();
    return this.bridge.sendRequest<LocalStorageInfo>('GET_STORAGE_INFO');
  }

  /**
   * Clears all local data, logs, and watermarks for a specific profile.
   *
   * @param profileId - Profile identifier.
   */
  async clearProfile(profileId: string): Promise<void> {
    await this.bridge.init();
    await this.bridge.sendRequest('CLEAR_PROFILE', { profileId });
  }

  /**
   * Retrieves user-configured local storage retention days from localStorage.
   * 0 means unlimited retention.
   *
   * @returns Number of retention days.
   */
  getLocalRetentionDays(): number {
    const val = localStorage.getItem(LOCAL_RETENTION_KEY);
    if (val === null) return DEFAULT_RETENTION_DAYS;
    const num = parseInt(val, 10);
    return isNaN(num) ? DEFAULT_RETENTION_DAYS : num;
  }

  /**
   * Updates local retention days in localStorage and triggers immediate cleanup.
   *
   * @param days - Number of retention days.
   */
  setLocalRetentionDays(days: number): void {
    localStorage.setItem(LOCAL_RETENTION_KEY, days.toString());
    if (days > 0) {
      void this.cleanup(days);
    }
  }
}
