/**
 * @file syncEngine.ts
 * @description Synchronization engine handling forward delta syncs, missing interval backfills,
 * and watermark tracking between server and local SQLite.
 */

import type { LogEntry } from '../../views/LogsView/types';
import type { SyncWatermark } from './types';
import type { LocalDbWorkerBridge } from './workerBridge';
import { profileFetch } from '../profiles';
import { e2ee } from '../e2ee';

/**
 * Orchestrates log ingestion, pagination, decryption, and watermark maintenance.
 */
export class LocalDbSyncEngine {
  /** In-flight synchronization promises per profile to deduplicate concurrent requests */
  private inFlightSyncs = new Map<string, Promise<number>>();
  private readonly bridge: LocalDbWorkerBridge;

  constructor(bridge: LocalDbWorkerBridge) {
    this.bridge = bridge;
  }

  /**
   * Retrieves the sync watermark for a given profile.
   *
   * @param profileId - Profile identifier.
   * @returns Watermark row or null.
   */
  async getWatermark(profileId: string): Promise<SyncWatermark | null> {
    await this.bridge.init();
    return this.bridge.sendRequest<SyncWatermark | null>('GET_WATERMARK', { profileId });
  }

  /**
   * Updates or expands the watermark time boundaries for a profile.
   *
   * @param profileId - Profile identifier.
   * @param start - Start timestamp in seconds.
   * @param end - End timestamp in seconds.
   */
  async updateWatermarkBounds(profileId: string, start: number, end: number): Promise<void> {
    await this.bridge.init();
    await this.bridge.sendRequest('UPDATE_WATERMARK_BOUNDS', { profileId, start, end });
  }

  /**
   * Synchronizes latest logs from the server into local SQLite.
   * Only fetches delta intervals missing from the local database.
   * Capped to maxPages (default 2 = 200 logs) to avoid blocking UI or burning network quota.
   *
   * @param profileId - Profile identifier.
   * @param onProgress - Optional progress callback.
   * @param targetSince - Optional historical boundary for initial load.
   * @param signal - Optional AbortSignal to cancel requests.
   * @param force - If true, bypasses the 15-second throttle cooldown.
   * @returns Promise resolving to the number of newly inserted logs.
   */
  async syncProfileLogs(
    profileId: string,
    onProgress?: (syncedCount: number, total: number) => void,
    targetSince?: number,
    signal?: AbortSignal,
    force: boolean = false
  ): Promise<number> {
    if (this.inFlightSyncs.has(profileId)) {
      return this.inFlightSyncs.get(profileId)!;
    }

    const syncPromise = (async () => {
      await this.bridge.init();
      if (signal?.aborted) return 0;

      const watermark = await this.getWatermark(profileId);
      const now = Math.floor(Date.now() / 1000);

      // Throttling: If watermark exists and was synced within the last 15 seconds, avoid redundant network calls
      if (!force && watermark && watermark.last_synced_at && (now - watermark.last_synced_at < 15)) {
        return 0;
      }

      let since: number;
      const maxPages = 2; // Capped to 2 pages (200 logs) per sync pass to guarantee zero UI lock & no request spam

      if (watermark && watermark.latest_timestamp > 0) {
        // Incremental forward delta sync: fetch logs that arrived since the last watermark
        since = Math.max(0, watermark.latest_timestamp - 60);
      } else {
        // Initial sync for empty local database: fetch at most 200 recent logs
        since = targetSince !== undefined ? targetSince : Math.floor(now - 86400);
      }

      let totalInserted = 0;
      let currentBefore: number | undefined = undefined;
      let hasMore = true;
      let pageCount = 0;

      // Pull logs in pages of 100 until reaching the watermark point or maxPages limit
      while (hasMore && pageCount < maxPages) {
        if (signal?.aborted) break;

        let url = `/api/profiles/${profileId}/logs?start=${since}&end=${now}&limit=100`;
        if (currentBefore !== undefined) {
          url += `&before=${currentBefore}`;
        }

        const res = await profileFetch(url, { signal });
        if (!res.ok) {
          throw new Error(`Failed to fetch logs from server: ${await res.text()}`);
        }

        const rawLogs: LogEntry[] = await res.json();
        if (!rawLogs || !Array.isArray(rawLogs) || rawLogs.length === 0) {
          break;
        }

        // Decrypt any encrypted logs before inserting into local SQLite
        const logs = await e2ee.decryptLogsBatch(profileId, rawLogs);

        // Insert this batch into local SQLite
        const { inserted } = await this.bridge.sendRequest<{ inserted: number }>('SYNC_BATCH', {
          profileId,
          logs
        });

        totalInserted += inserted;
        pageCount++;
        if (onProgress) {
          onProgress(totalInserted, totalInserted);
        }

        if (logs.length < 100) {
          hasMore = false;
        } else {
          // Find the oldest timestamp in this batch for cursor pagination
          const oldestInBatch = Number(logs[logs.length - 1].timestamp);
          if (
            isNaN(oldestInBatch) ||
            oldestInBatch <= since ||
            (currentBefore !== undefined && oldestInBatch >= currentBefore)
          ) {
            hasMore = false;
          } else {
            currentBefore = oldestInBatch;
          }
        }
      }

      return totalInserted;
    })();

    this.inFlightSyncs.set(profileId, syncPromise);
    try {
      return await syncPromise;
    } finally {
      this.inFlightSyncs.delete(profileId);
    }
  }

  /**
   * Synchronizes missing raw logs for a specific time interval [start, end] from the server into local SQLite.
   * Paginates backwards through up to 50 pages (5,000 logs) to avoid incomplete window ingestions.
   *
   * @param profileId - Profile identifier.
   * @param start - Start timestamp in seconds.
   * @param end - End timestamp in seconds.
   * @param signal - Optional AbortSignal.
   * @param onProgress - Optional progress callback with running inserted count.
   * @returns Total number of newly inserted logs.
   */
  async syncInterval(
    profileId: string,
    start: number,
    end: number,
    signal?: AbortSignal,
    onProgress?: (inserted: number) => void
  ): Promise<number> {
    await this.bridge.init();
    if (signal?.aborted || start >= end) return 0;

    let totalInserted = 0;
    let currentBefore: number | undefined = undefined;
    let hasMore = true;
    let pageCount = 0;
    const MAX_PAGES = 50; // Safety guard: up to 5,000 logs per interval pass

    while (hasMore && pageCount < MAX_PAGES) {
      if (signal?.aborted) break;

      let url = `/api/profiles/${profileId}/logs?start=${start}&end=${end}&limit=100`;
      if (currentBefore !== undefined) {
        url += `&before=${currentBefore}`;
      }

      const res = await profileFetch(url, { signal });
      if (!res.ok) {
        console.warn(`[LocalDbSyncEngine] Failed to fetch logs for interval [${start}, ${end}] (${res.status}):`, await res.text());
        break;
      }

      const rawLogs: LogEntry[] = await res.json();
      if (!rawLogs || !Array.isArray(rawLogs) || rawLogs.length === 0) {
        break;
      }

      // Decrypt any encrypted logs before inserting into local SQLite
      const logs = await e2ee.decryptLogsBatch(profileId, rawLogs);

      // Insert this batch into local SQLite
      const { inserted } = await this.bridge.sendRequest<{ inserted: number }>('SYNC_BATCH', {
        profileId,
        logs
      });

      totalInserted += inserted;
      pageCount++;
      if (onProgress) {
        onProgress(totalInserted);
      }

      if (logs.length < 100) {
        hasMore = false;
      } else {
        const oldestInBatch = Number(logs[logs.length - 1].timestamp);
        if (
          isNaN(oldestInBatch) ||
          oldestInBatch <= start ||
          (currentBefore !== undefined && oldestInBatch >= currentBefore)
        ) {
          hasMore = false;
        } else {
          currentBefore = oldestInBatch;
        }
      }
    }

    // Explicitly update watermark boundaries so we record that [start, end] was checked
    await this.updateWatermarkBounds(profileId, start, end);

    return totalInserted;
  }

  /**
   * Identifies and downloads all missing time intervals between `since` and `until` from the server.
   * Compares the requested range against local SQLite sync watermarks (earliest and latest timestamps).
   *
   * @param profileId - Profile identifier.
   * @param since - Start of the requested time range (seconds).
   * @param until - End of the requested time range (seconds).
   * @param signal - Optional AbortSignal.
   * @param onProgress - Optional progress callback.
   * @returns Total number of newly inserted logs across all missing intervals.
   */
  async syncMissingIntervals(
    profileId: string,
    since: number,
    until: number,
    signal?: AbortSignal,
    onProgress?: (inserted: number) => void
  ): Promise<number> {
    await this.bridge.init();
    if (signal?.aborted || since >= until) return 0;

    const watermark = await this.getWatermark(profileId);
    const intervals: { start: number; end: number }[] = [];

    if (!watermark || !watermark.earliest_timestamp || !watermark.latest_timestamp || watermark.latest_timestamp <= 0) {
      intervals.push({ start: since, end: until });
    } else {
      const { earliest_timestamp: early, latest_timestamp: late } = watermark;

      if (until <= early) {
        // Entire query range is strictly earlier than local data
        intervals.push({ start: since, end: until });
      } else if (since >= late) {
        // Entire query range is strictly later than local data
        intervals.push({ start: since, end: until });
      } else {
        // Overlapping range: check forward and historical missing intervals
        if (until > late) {
          intervals.push({ start: Math.max(since, late - 60), end: until });
        }
        if (since < early) {
          intervals.push({ start: since, end: Math.min(until, early + 60) });
        }
      }
    }

    if (intervals.length === 0) {
      return 0;
    }

    let totalInserted = 0;
    for (const interval of intervals) {
      if (signal?.aborted) break;
      const count = await this.syncInterval(profileId, interval.start, interval.end, signal, onProgress);
      totalInserted += count;
    }

    return totalInserted;
  }

  /**
   * Backfills older logs from the server into local SQLite (e.g. when scrolling down).
   * Fetches at most 1 page (up to 100 logs) older than `before` down to `since`.
   *
   * @param profileId - Profile identifier.
   * @param before - Maximum timestamp cursor.
   * @param since - Minimum timestamp boundary.
   * @param limit - Page size limit (default 50).
   * @param signal - Optional AbortSignal.
   * @returns Array of decrypted backfilled logs.
   */
  async backfillLogs(
    profileId: string,
    before: number,
    since: number,
    limit: number = 50,
    signal?: AbortSignal
  ): Promise<LogEntry[]> {
    await this.bridge.init();
    if (signal?.aborted || before <= since) return [];

    const url = `/api/profiles/${profileId}/logs?start=${since}&end=${before}&limit=${Math.min(limit, 100)}&before=${before}`;
    const res = await profileFetch(url, { signal });
    if (!res.ok) return [];

    const rawLogs: LogEntry[] = await res.json();
    if (!rawLogs || !Array.isArray(rawLogs) || rawLogs.length === 0) return [];

    const logs = await e2ee.decryptLogsBatch(profileId, rawLogs);
    await this.bridge.sendRequest<{ inserted: number }>('SYNC_BATCH', {
      profileId,
      logs
    });
    return logs;
  }

  /**
   * Inserts a batch of log entries directly into local SQLite storage.
   *
   * @param profileId - Profile identifier.
   * @param logs - Array of LogEntry records to insert.
   * @returns Number of inserted rows.
   */
  async batchInsertLogs(profileId: string, logs: LogEntry[]): Promise<number> {
    if (!logs || logs.length === 0) return 0;
    await this.bridge.init();
    const res = await this.bridge.sendRequest<{ inserted: number }>('SYNC_BATCH', {
      profileId,
      logs
    });
    return res?.inserted || 0;
  }
}
