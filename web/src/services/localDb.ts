/**
 * @file localDb.ts
 * @description Client-side Local Database Service backed by SQLite WASM with OPFS.
 * Implements Local-First incremental syncing, querying, and client-side retention.
 */

import type { LogEntry } from '../views/LogsView/types';
import type { AnalyticsData } from '../views/AnalyticsView/types';
import { profileFetch } from './profiles';
import { e2ee } from './e2ee';
import SqliteWorker from '../workers/sqlite.worker?worker';

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

export interface SyncWatermark {
  profile_id: string;
  latest_timestamp: number;
  earliest_timestamp: number;
  last_synced_at: number;
  total_synced_count: number;
}

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

export interface LocalQueryResult {
  rows: LogEntry[];
  total: number;
  stats?: { total: number; pass: number; block: number; redirect: number };
}

export interface LocalAnalyticsParams {
  profileId: string;
  since: number;
  until: number;
  bucketSec: number;
  accessPointId?: string;
}

class LocalDbService {
  private worker: Worker | null = null;
  private pendingRequests = new Map<string, { resolve: (val: any) => void; reject: (err: any) => void }>();
  private initPromise: Promise<boolean> | null = null;
  private isOpfs = false;
  private workerFailed = false;

  private getWorker(): Worker {
    if (!this.worker) {
      try {
        this.worker = new SqliteWorker();

        this.worker.onmessage = (e: MessageEvent) => {
          const { id, success, data, error } = e.data;
          const pending = this.pendingRequests.get(id);
          if (pending) {
            this.pendingRequests.delete(id);
            if (success) {
              pending.resolve(data);
            } else {
              pending.reject(new Error(error || 'Worker execution error'));
            }
          }
        };

        this.worker.onerror = (err) => {
          console.error('[LocalDb] Worker fatal error:', err);
          this.workerFailed = true;
          for (const [, pending] of this.pendingRequests.entries()) {
            pending.reject(new Error('SQLite Worker error: ' + ((err as any)?.message || 'Load failure')));
          }
          this.pendingRequests.clear();
        };
      } catch (err) {
        console.error('[LocalDb] Failed to instantiate worker:', err);
        this.workerFailed = true;
        throw err;
      }
    }
    return this.worker;
  }

  private sendRequest<T = any>(type: string, payload?: any): Promise<T> {
    const worker = this.getWorker();
    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      worker.postMessage({ id, type, payload });
    });
  }

  /**
   * Initializes the client SQLite WASM engine and OPFS storage.
   */
  async init(): Promise<boolean> {
    if (this.workerFailed) return false;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      try {
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('SQLite Worker init timed out (12s)')), 12000)
        );
        const res = await Promise.race([
          this.sendRequest<{ ready: boolean; isOpfs: boolean }>('INIT'),
          timeoutPromise,
        ]);
        this.isOpfs = res.isOpfs;
        console.log(`[LocalDb] Initialized (OPFS storage: ${this.isOpfs ? 'ENABLED' : 'IN-MEMORY'})`);

        // Automatically trigger background cleanup on startup
        const retentionDays = this.getLocalRetentionDays();
        if (retentionDays > 0) {
          void this.cleanup(retentionDays);
        }

        return res.ready;
      } catch (err) {
        console.warn('[LocalDb] SQLite engine unavailable, falling back to server:', err);
        this.workerFailed = true;
        return false;
      }
    })();

    return this.initPromise;
  }

  /**
   * Returns whether persistent OPFS storage is active in the current browser.
   */
  getIsOpfs(): boolean {
    return this.isOpfs;
  }

  /**
   * Retrieves the sync watermark for a given profile.
   */
  async getWatermark(profileId: string): Promise<SyncWatermark | null> {
    await this.init();
    return this.sendRequest<SyncWatermark | null>('GET_WATERMARK', { profileId });
  }

  /**
   * Synchronizes latest logs from the server into local SQLite.
   * Only fetches delta intervals missing from the local database.
   */
  async syncProfileLogs(
    profileId: string,
    onProgress?: (syncedCount: number, total: number) => void,
    targetSince?: number
  ): Promise<number> {
    await this.init();
    const watermark = await this.getWatermark(profileId);

    const now = Math.floor(Date.now() / 1000);
    // If local DB already has data, sync from (latest_timestamp - 60s) to guard against clock skew/in-flight inserts
    // If completely empty or targetSince is earlier, ensure we cover up to targetSince or last 7 days
    let since = watermark && watermark.latest_timestamp > 0
      ? Math.max(0, watermark.latest_timestamp - 60)
      : Math.floor(now - 7 * 86400);

    if (targetSince !== undefined && targetSince < since) {
      since = targetSince;
    }

    let totalInserted = 0;
    let currentBefore: number | undefined = undefined;
    let hasMore = true;

    // Pull logs in pages of 100 until reaching the watermark point
    while (hasMore) {
      let url = `/api/profiles/${profileId}/logs?start=${since}&end=${now}&limit=100`;
      if (currentBefore !== undefined) {
        url += `&before=${currentBefore}`;
      }

      const res = await profileFetch(url);
      if (!res.ok) {
        throw new Error(`Failed to fetch logs from server: ${await res.text()}`);
      }

      const rawLogs: LogEntry[] = await res.json();
      if (!rawLogs || rawLogs.length === 0) {
        break;
      }

      // Decrypt any encrypted logs before inserting into local SQLite
      const logs = await e2ee.decryptLogsBatch(profileId, rawLogs);

      // Insert this batch into local SQLite
      const { inserted } = await this.sendRequest<{ inserted: number }>('SYNC_BATCH', {
        profileId,
        logs
      });

      totalInserted += inserted;
      if (onProgress) {
        onProgress(totalInserted, totalInserted);
      }

      if (logs.length < 100) {
        hasMore = false;
      } else {
        // Find the oldest timestamp in this batch for cursor pagination
        const oldestInBatch = logs[logs.length - 1].timestamp;
        if (oldestInBatch <= since || (currentBefore !== undefined && oldestInBatch >= currentBefore)) {
          hasMore = false;
        } else {
          currentBefore = oldestInBatch;
        }
      }
    }

    return totalInserted;
  }

  /**
   * Queries local logs from SQLite with pagination, search, and action filters.
   */
  async queryLogs(params: LocalQueryLogsParams): Promise<LocalQueryResult> {
    await this.init();
    return this.sendRequest<LocalQueryResult>('QUERY_LOGS', params);
  }

  /**
   * Queries local analytics aggregations directly using SQLite GROUP BY queries.
   */
  async queryAnalytics(params: LocalAnalyticsParams): Promise<AnalyticsData> {
    await this.init();
    return this.sendRequest<AnalyticsData>('QUERY_ANALYTICS', params);
  }

  /**
   * Cleans up local logs older than the specified retention days.
   */
  async cleanup(retentionDays: number): Promise<number> {
    await this.init();
    const { deleted } = await this.sendRequest<{ deleted: number }>('CLEANUP', { retentionDays });
    if (deleted > 0) {
      console.log(`[LocalDb] Cleaned up ${deleted} expired local logs`);
    }
    return deleted;
  }

  /**
   * Returns storage stats across profiles.
   */
  async getStorageInfo(): Promise<LocalStorageInfo> {
    await this.init();
    return this.sendRequest<LocalStorageInfo>('GET_STORAGE_INFO');
  }

  /**
   * Clears all local data for a profile.
   */
  async clearProfile(profileId: string): Promise<void> {
    await this.init();
    await this.sendRequest('CLEAR_PROFILE', { profileId });
  }

  /**
   * Re-decrypts any local logs that were previously stored encrypted.
   * Called when the user unlocks their Passkey key.
   */
  async reDecryptLocalLogs(profileId: string): Promise<number> {
    await this.init();
    const res = await this.sendRequest<{ rows: LogEntry[] }>('GET_ENCRYPTED_LOGS', { profileId, limit: 1000 });
    if (!res.rows || res.rows.length === 0) return 0;

    const decrypted = await e2ee.decryptLogsBatch(profileId, res.rows);
    const successfullyDecrypted = decrypted.filter((l) => l.is_encrypted === 0);
    if (successfullyDecrypted.length === 0) return 0;

    const updateRes = await this.sendRequest<{ updated: number }>('UPDATE_LOGS_BATCH', {
      profileId,
      logs: successfullyDecrypted,
    });
    return updateRes.updated;
  }

  /**
   * Local storage retention settings (in days).
   * 0 means unlimited (keep until user clears browser data).
   */
  getLocalRetentionDays(): number {
    const val = localStorage.getItem('obex_local_log_retention');
    if (val === null) return 90; // Default 90 days
    const num = parseInt(val, 10);
    return isNaN(num) ? 90 : num;
  }

  setLocalRetentionDays(days: number): void {
    localStorage.setItem('obex_local_log_retention', days.toString());
    if (days > 0) {
      void this.cleanup(days);
    }
  }
}

export const localDb = new LocalDbService();
