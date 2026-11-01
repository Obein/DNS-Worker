/**
 * @file syncLogFetcher.ts
 * @description Handles remote HTTP log pagination, E2EE batch decryption, and SQLite batch insertion.
 */

import type { LogEntry } from "../../views/LogsView/types";
import type { LocalDbWorkerBridge } from "./workerBridge";
import { profileFetch } from "../profiles";
import { e2ee } from "../e2ee";

export interface BatchFetchResult {
  logs: LogEntry[];
  inserted: number;
  oldestTimestamp?: number;
}

/**
 * Service managing network fetching, zero-knowledge decryption, and batch ingestion of logs.
 */
export class SyncLogFetcher {
  private readonly bridge: LocalDbWorkerBridge;

  constructor(bridge: LocalDbWorkerBridge) {
    this.bridge = bridge;
  }

  /**
   * Queries the server analytics summary endpoint to determine the total expected log count
   * within the given interval [since, until].
   *
   * @param profileId - Profile identifier.
   * @param since - Start timestamp in seconds.
   * @param until - End timestamp in seconds.
   * @param signal - Optional cancellation signal.
   * @returns Total number of expected logs on the server.
   */
  async fetchExpectedCount(
    profileId: string,
    since: number,
    until: number,
    signal?: AbortSignal
  ): Promise<number> {
    try {
      const summaryRes = await profileFetch(
        `/api/profiles/${profileId}/analytics/summary?start=${since}&end=${until}&exact=true`,
        { signal }
      );
      if (summaryRes.ok) {
        const summaryData: { count: number }[] = await summaryRes.json();
        if (Array.isArray(summaryData)) {
          return summaryData.reduce((acc, curr) => acc + (curr.count || 0), 0);
        }
      }
    } catch (summaryErr) {
      if ((summaryErr as Error)?.name === "AbortError" || signal?.aborted) return 0;
      console.warn("[SyncLogFetcher] Failed to query server summary for target interval:", summaryErr);
    }
    return 0;
  }

  /**
   * Fetches a single page of logs from the server, decrypts them via E2EE, and commits them to SQLite.
   *
   * @param profileId - Profile identifier.
   * @param url - API URL with query parameters.
   * @param signal - Optional AbortSignal.
   * @returns Object containing decrypted logs, count of newly inserted rows, and the oldest timestamp in batch.
   */
  async fetchAndIngestBatch(
    profileId: string,
    url: string,
    signal?: AbortSignal
  ): Promise<BatchFetchResult> {
    await this.bridge.init();
    if (signal?.aborted) {
      return { logs: [], inserted: 0 };
    }

    const res = await profileFetch(url, { signal });
    if (!res.ok) {
      throw new Error(`Failed to fetch logs from server: ${await res.text()}`);
    }

    const rawLogs: LogEntry[] = await res.json();
    if (!rawLogs || !Array.isArray(rawLogs) || rawLogs.length === 0) {
      return { logs: [], inserted: 0 };
    }

    // Decrypt any encrypted logs before inserting into local SQLite
    const logs = await e2ee.decryptLogsBatch(profileId, rawLogs);

    if (signal?.aborted) {
      return { logs: [], inserted: 0 };
    }

    // Insert this batch into local SQLite atomically
    const { inserted } = await this.bridge.sendRequest<{ inserted: number }>("SYNC_BATCH", {
      profileId,
      logs
    });

    const oldestTimestamp = Number(logs[logs.length - 1].timestamp);

    return {
      logs,
      inserted,
      oldestTimestamp: isNaN(oldestTimestamp) ? undefined : oldestTimestamp
    };
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
    await this.bridge.sendRequest<{ inserted: number }>("SYNC_BATCH", {
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
    const res = await this.bridge.sendRequest<{ inserted: number }>("SYNC_BATCH", {
      profileId,
      logs
    });
    return res?.inserted || 0;
  }
}
