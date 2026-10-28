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

export interface SyncCheckpoint {
  since: number;
  until: number;
  checkpointBefore: number;
  syncedCount: number;
  totalExpected: number;
  updatedAt: number;
}

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
   * Retrieves any active synchronization checkpoint for the given profile and exact time range.
   */
  getCheckpoint(profileId: string, since: number, until: number): SyncCheckpoint | null {
    try {
      const raw = localStorage.getItem(`obex_sync_checkpoint_${profileId}`);
      if (!raw) return null;
      const parsed: SyncCheckpoint = JSON.parse(raw);
      if (
        parsed &&
        parsed.since === since &&
        parsed.until === until &&
        typeof parsed.checkpointBefore === "number" &&
        parsed.checkpointBefore > since &&
        parsed.checkpointBefore < until
      ) {
        return parsed;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Saves a synchronization checkpoint so sync can resume from the last committed batch cursor.
   */
  saveCheckpoint(profileId: string, checkpoint: SyncCheckpoint): void {
    try {
      localStorage.setItem(`obex_sync_checkpoint_${profileId}`, JSON.stringify(checkpoint));
    } catch {}
  }

  /**
   * Clears the synchronization checkpoint upon completion or invalidation.
   */
  clearCheckpoint(profileId: string): void {
    try {
      localStorage.removeItem(`obex_sync_checkpoint_${profileId}`);
    } catch {}
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

    // If hasMore is false, the interval was completely downloaded down to start.
    // If hasMore is true, we only reached currentBefore, so the watermark boundary
    // should only be expanded down to currentBefore (or start if currentBefore is undefined).
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

    // 1. Determine total expected count from server summary (with exact=true for raw log accuracy)
    let totalExpected = 0;
    try {
      const summaryRes = await profileFetch(
        `/api/profiles/${profileId}/analytics/summary?start=${since}&end=${until}&exact=true`,
        { signal }
      );
      if (summaryRes.ok) {
        const summaryData: { count: number }[] = await summaryRes.json();
        if (Array.isArray(summaryData)) {
          totalExpected = summaryData.reduce((acc, curr) => acc + (curr.count || 0), 0);
        }
      }
    } catch (summaryErr) {
      if ((summaryErr as Error)?.name === "AbortError" || signal?.aborted) return 0;
      console.warn("[LocalDbSyncEngine] Failed to query server summary for target interval:", summaryErr);
    }

    if (totalExpected === 0) {
      this.clearCheckpoint(profileId);
      return 0;
    }

    // 2. Query how many logs we already have locally in this interval
    let localCount = 0;
    try {
      const localAnalytics = await this.bridge.sendRequest<{ summary?: { count: number }[] }>('QUERY_ANALYTICS', {
        profileId,
        since,
        until,
        bucketSec: 3600
      });
      if (localAnalytics?.summary && Array.isArray(localAnalytics.summary)) {
        localCount = localAnalytics.summary.reduce((acc: number, curr: { count: number }) => acc + (curr.count || 0), 0);
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

      let res: Response;
      try {
        res = await profileFetch(url, { signal });
      } catch (fetchErr) {
        if ((fetchErr as Error)?.name === "AbortError" || signal?.aborted) {
          // Transaction aborted by user; break immediately and keep checkpoint intact
          break;
        }
        throw fetchErr;
      }

      if (!res.ok) {
        console.warn(
          `[LocalDbSyncEngine] Failed to fetch segment for interval [${since}, ${until}] (${res.status}):`,
          await res.text()
        );
        break;
      }

      if (signal?.aborted) break;

      const rawLogs: LogEntry[] = await res.json();
      if (!rawLogs || !Array.isArray(rawLogs) || rawLogs.length === 0) {
        hasMore = false;
        this.clearCheckpoint(profileId);
        break;
      }

      if (signal?.aborted) break;

      // Decrypt any encrypted logs before inserting into local SQLite
      const logs = await e2ee.decryptLogsBatch(profileId, rawLogs);

      if (signal?.aborted) break;

      // Insert this batch into local SQLite atomically
      const { inserted } = await this.bridge.sendRequest<{ inserted: number }>('SYNC_BATCH', {
        profileId,
        logs
      });

      totalInserted += inserted;
      pageCount++;

      const oldestInBatch = Number(logs[logs.length - 1].timestamp);

      if (
        isNaN(oldestInBatch) ||
        oldestInBatch <= since ||
        (currentBefore !== undefined && oldestInBatch >= currentBefore) ||
        logs.length < PAGE_SIZE
      ) {
        hasMore = false;
        this.clearCheckpoint(profileId);
      } else {
        currentBefore = oldestInBatch;
        // Persist checkpoint after each successfully committed batch (1,000 items)
        this.saveCheckpoint(profileId, {
          since,
          until,
          checkpointBefore: oldestInBatch,
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
        break;
      }

      let insertedInPass = 0;
      for (const interval of intervals) {
        if (signal?.aborted) break;
        const count = await this.syncInterval(profileId, interval.start, interval.end, signal, onProgress);
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
