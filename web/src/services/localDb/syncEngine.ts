/**
 * @file syncEngine.ts
 * @description Synchronization engine orchestrating incremental forward syncs, missing interval backfills,
 * resumable target interval syncs, and watermark tracking between server and local SQLite.
 */

import type { LogEntry } from "../../views/LogsView/types";
import type { SyncWatermark } from "./types";
import type { LocalDbWorkerBridge } from "./workerBridge";
import { SyncCheckpointManager, type SyncCheckpoint } from "./syncCheckpoint";
import { SyncWatermarkManager } from "./syncWatermark";
import { planMissingIntervals } from "./syncIntervalPlanner";
import { SyncLogFetcher } from "./syncLogFetcher";

export type { SyncCheckpoint } from "./syncCheckpoint";

/**
 * Orchestrates log ingestion, pagination, decryption, checkpointing, and watermark maintenance.
 */
export class LocalDbSyncEngine {
  /** In-flight synchronization promises per profile to deduplicate concurrent requests */
  private inFlightSyncs = new Map<string, Promise<number>>();
  private readonly bridge: LocalDbWorkerBridge;
  private readonly checkpointManager: SyncCheckpointManager;
  private readonly watermarkManager: SyncWatermarkManager;
  private readonly fetcher: SyncLogFetcher;

  constructor(bridge: LocalDbWorkerBridge) {
    this.bridge = bridge;
    this.checkpointManager = new SyncCheckpointManager();
    this.watermarkManager = new SyncWatermarkManager(bridge);
    this.fetcher = new SyncLogFetcher(bridge);
  }

  /**
   * Retrieves any active synchronization checkpoint for the given profile and exact time range.
   */
  getCheckpoint(profileId: string, since: number, until: number): SyncCheckpoint | null {
    return this.checkpointManager.getCheckpoint(profileId, since, until);
  }

  /**
   * Saves a synchronization checkpoint so sync can resume from the last committed batch cursor.
   */
  saveCheckpoint(profileId: string, checkpoint: SyncCheckpoint): void {
    this.checkpointManager.saveCheckpoint(profileId, checkpoint);
  }

  /**
   * Clears the synchronization checkpoint upon completion or invalidation.
   */
  clearCheckpoint(profileId: string): void {
    this.checkpointManager.clearCheckpoint(profileId);
  }

  /**
   * Retrieves the sync watermark for a given profile.
   */
  async getWatermark(profileId: string): Promise<SyncWatermark | null> {
    return this.watermarkManager.getWatermark(profileId);
  }

  /**
   * Updates or expands the watermark time boundaries for a profile.
   */
  async updateWatermarkBounds(profileId: string, start: number, end: number): Promise<void> {
    return this.watermarkManager.updateWatermarkBounds(profileId, start, end);
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
      if (!force && watermark && watermark.last_synced_at && now - watermark.last_synced_at < 15) {
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

      while (hasMore && pageCount < maxPages) {
        if (signal?.aborted) break;

        let url = `/api/profiles/${profileId}/logs?start=${since}&end=${now}&limit=100`;
        if (currentBefore !== undefined) {
          url += `&before=${currentBefore}`;
        }

        const { logs, inserted, oldestTimestamp } = await this.fetcher.fetchAndIngestBatch(
          profileId,
          url,
          signal
        );

        if (logs.length === 0) {
          break;
        }

        totalInserted += inserted;
        pageCount++;
        onProgress?.(totalInserted, totalInserted);

        if (logs.length < 100) {
          hasMore = false;
        } else if (
          oldestTimestamp === undefined ||
          oldestTimestamp <= since ||
          (currentBefore !== undefined && oldestTimestamp >= currentBefore)
        ) {
          hasMore = false;
        } else {
          currentBefore = oldestTimestamp;
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

      try {
        const { logs, inserted, oldestTimestamp } = await this.fetcher.fetchAndIngestBatch(
          profileId,
          url,
          signal
        );

        if (logs.length === 0) {
          break;
        }

        totalInserted += inserted;
        pageCount++;
        onProgress?.(totalInserted);

        if (logs.length < 100) {
          hasMore = false;
        } else if (
          oldestTimestamp === undefined ||
          oldestTimestamp <= start ||
          (currentBefore !== undefined && oldestTimestamp >= currentBefore)
        ) {
          hasMore = false;
        } else {
          currentBefore = oldestTimestamp;
        }
      } catch (err: unknown) {
        console.warn(
          `[LocalDbSyncEngine] Failed to fetch logs for interval [${start}, ${end}]:`,
          (err as Error)?.message || err
        );
        break;
      }
    }

    const effectiveEarliest = hasMore && currentBefore !== undefined ? currentBefore : start;
    await this.updateWatermarkBounds(profileId, effectiveEarliest, end);

    return totalInserted;
  }

  /**
   * Synchronizes missing records for the specified target interval [since, until].
   * Divides data transmission into segments/pages (chunked transfer), decrypts each batch,
   * commits into local SQLite, and notifies progress after each successful batch.
   *
   * @param profileId - Profile identifier.
   * @param since - Start timestamp in seconds.
   * @param until - End timestamp in seconds.
   * @param signal - Optional AbortSignal for cancellation.
   * @param onProgress - Callback providing (progress: number, insertedSoFar: number, totalExpected: number)
   *                     where progress is between 0.0 and 1.0.
   * @returns Total number of newly inserted logs.
   */
  async syncTargetInterval(
    profileId: string,
    since: number,
    until: number,
    signal?: AbortSignal,
    onProgress?: (progress: number, insertedSoFar: number, totalExpected: number) => void
  ): Promise<number> {
    await this.bridge.init();
    if (signal?.aborted || since >= until) return 0;

    const PAGE_SIZE = 1000;

    // 1. Determine total expected count from server summary
    const totalExpected = await this.fetcher.fetchExpectedCount(profileId, since, until, signal);
    if (totalExpected === 0) {
      this.clearCheckpoint(profileId);
      return 0;
    }

    // 2. Query how many logs we already have locally in this interval
    let localCount = 0;
    try {
      const localAnalytics = await this.bridge.sendRequest<{ summary?: { count: number }[] }>(
        "QUERY_ANALYTICS",
        {
          profileId,
          since,
          until,
          bucketSec: 3600
        }
      );
      if (localAnalytics?.summary && Array.isArray(localAnalytics.summary)) {
        localCount = localAnalytics.summary.reduce(
          (acc: number, curr: { count: number }) => acc + (curr.count || 0),
          0
        );
      }
    } catch {
      localCount = 0;
    }

    if (totalExpected <= localCount) {
      // Local SQLite already has all logs for this interval
      this.clearCheckpoint(profileId);
      return 0;
    }

    // 3. Check for existing checkpoint (断点续传)
    const checkpoint = this.getCheckpoint(profileId, since, until);
    let currentBefore: number | undefined = checkpoint?.checkpointBefore;
    let totalInserted = checkpoint?.syncedCount || localCount;

    // Set initial progress reflecting already synced records
    const initialProgress = Math.min(0.95, Math.max(0.05, totalInserted / totalExpected));
    onProgress?.(initialProgress, totalInserted, totalExpected);

    // 4. Segmented transfer: fetch in batches of 1,000 logs backwards from `until` (or checkpoint) down to `since`
    let hasMore = true;
    const MAX_PAGES = 500; // Allows syncing up to 500,000 logs
    let pageCount = 0;

    while (hasMore && pageCount < MAX_PAGES && !signal?.aborted) {
      let url = `/api/profiles/${profileId}/logs?start=${since}&end=${until}&limit=${PAGE_SIZE}`;
      if (currentBefore !== undefined) {
        url += `&before=${currentBefore}`;
      }

      try {
        const { logs, inserted, oldestTimestamp } = await this.fetcher.fetchAndIngestBatch(
          profileId,
          url,
          signal
        );

        if (logs.length === 0) {
          hasMore = false;
          this.clearCheckpoint(profileId);
          break;
        }

        totalInserted += inserted;
        pageCount++;

        if (
          oldestTimestamp === undefined ||
          oldestTimestamp <= since ||
          (currentBefore !== undefined && oldestTimestamp >= currentBefore) ||
          logs.length < PAGE_SIZE
        ) {
          hasMore = false;
          this.clearCheckpoint(profileId);
        } else {
          currentBefore = oldestTimestamp;
          // Persist checkpoint after each successfully committed batch (1,000 items)
          this.saveCheckpoint(profileId, {
            since,
            until,
            checkpointBefore: oldestTimestamp,
            syncedCount: totalInserted,
            totalExpected,
            updatedAt: Date.now()
          });
        }

        // Progress only advances AFTER successful segment persistence
        const currentProgress = Math.min(0.98, Math.max(0.05, totalInserted / totalExpected));
        onProgress?.(currentProgress, totalInserted, totalExpected);

        if (signal?.aborted) break;

        // Small yield for UI responsiveness
        await new Promise((r) => setTimeout(r, 15));
      } catch (fetchErr: unknown) {
        if ((fetchErr as Error)?.name === "AbortError" || signal?.aborted) {
          break;
        }
        console.warn(
          `[LocalDbSyncEngine] Failed to fetch segment for interval [${since}, ${until}]:`,
          (fetchErr as Error)?.message || fetchErr
        );
        break;
      }
    }

    if (!signal?.aborted && !hasMore) {
      this.clearCheckpoint(profileId);
      const effectiveEarliest = currentBefore !== undefined ? currentBefore : since;
      await this.updateWatermarkBounds(profileId, effectiveEarliest, until);
      onProgress?.(1, totalInserted, totalExpected);
    } else if (currentBefore !== undefined) {
      await this.updateWatermarkBounds(profileId, currentBefore, until);
    }

    return totalInserted;
  }

  /**
   * Identifies and downloads all missing time intervals between `since` and `until` from the server.
   * Compares the requested range against local SQLite sync watermarks (earliest and latest timestamps).
   * Automatically loops through multiple passes if the dataset exceeds a single interval pass capacity.
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

    let totalInserted = 0;
    let passes = 0;
    const MAX_PASSES = 25; // Supports fetching up to 25 passes * 5,000 logs = 125,000 logs

    while (!signal?.aborted && passes < MAX_PASSES) {
      const watermark = await this.getWatermark(profileId);
      const intervals = planMissingIntervals(watermark, since, until);

      if (intervals.length === 0) {
        break;
      }

      let insertedInPass = 0;
      for (const interval of intervals) {
        if (signal?.aborted) break;
        const count = await this.syncInterval(
          profileId,
          interval.start,
          interval.end,
          signal,
          onProgress
        );
        insertedInPass += count;
      }

      totalInserted += insertedInPass;
      passes++;

      // If no new logs were inserted in this pass, all available server logs have been fetched
      if (insertedInPass === 0) {
        break;
      }

      // Yield control briefly to ensure UI remains responsive
      await new Promise((r) => setTimeout(r, 20));
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
    return this.fetcher.backfillLogs(profileId, before, since, limit, signal);
  }

  /**
   * Inserts a batch of log entries directly into local SQLite storage.
   *
   * @param profileId - Profile identifier.
   * @param logs - Array of LogEntry records to insert.
   * @returns Number of inserted rows.
   */
  async batchInsertLogs(profileId: string, logs: LogEntry[]): Promise<number> {
    return this.fetcher.batchInsertLogs(profileId, logs);
  }
}
