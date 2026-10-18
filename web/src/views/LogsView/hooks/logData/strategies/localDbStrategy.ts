/**
 * @file localDbStrategy.ts
 * @description Local-First SQLite execution, synchronization, and pagination strategy.
 */

import type { LogEntry } from "../../../types";
import { localDb } from "../../../../../services";

export interface LocalDbQueryParams {
  profileId: string;
  searchQuery: string;
  statusFilter: string | null;
  accessPointIdFilter: string | null;
  destCountryFilter: string | null;
  ispFilter: string | null;
  since: number;
  until: number;
  limit: number;
}

export interface LocalDbInitialResult {
  rows: LogEntry[];
  hasMore: boolean;
  stats?: { total: number; pass: number; block: number; redirect: number };
}

export interface LocalDbPaginationResult {
  rows: LogEntry[];
  hasMore: boolean;
}

/**
 * Executes initial local SQLite log query and background incremental sync.
 */
export async function queryInitialLocalLogs(
  params: LocalDbQueryParams,
  signal: AbortSignal,
  forceSync: boolean,
  onImmediateLocalHit?: (result: LocalDbInitialResult) => void
): Promise<{ success: boolean; result?: LocalDbInitialResult }> {
  const isDbReady = await localDb.init();
  if (!isDbReady || signal.aborted) {
    return { success: false };
  }

  const {
    profileId,
    searchQuery,
    statusFilter,
    accessPointIdFilter,
    destCountryFilter,
    ispFilter,
    since,
    until,
    limit
  } = params;

  let localResult = await localDb.queryLogs({
    profileId,
    search: searchQuery || undefined,
    action: statusFilter || undefined,
    accessPointId: accessPointIdFilter || undefined,
    destCountry: destCountryFilter || undefined,
    isp: ispFilter || undefined,
    since,
    until,
    before: undefined,
    limit,
    offset: 0
  });

  if (signal.aborted) return { success: false };

  if (localResult.rows.length > 0 && onImmediateLocalHit) {
    onImmediateLocalHit({
      rows: localResult.rows,
      hasMore: localResult.rows.length >= limit,
      stats: localResult.stats
    });
  }

  // Perform delta sync from server in background
  try {
    const inserted = await localDb.syncProfileLogs(
      profileId,
      undefined,
      since,
      signal,
      forceSync
    );

    if (!signal.aborted && (inserted > 0 || localResult.rows.length === 0)) {
      localResult = await localDb.queryLogs({
        profileId,
        search: searchQuery || undefined,
        action: statusFilter || undefined,
        accessPointId: accessPointIdFilter || undefined,
        destCountry: destCountryFilter || undefined,
        isp: ispFilter || undefined,
        since,
        until,
        before: undefined,
        limit,
        offset: 0
      });

      if (signal.aborted) return { success: false };
    }
  } catch (syncErr: unknown) {
    if ((syncErr as Error).name !== "AbortError") {
      console.warn("[localDbStrategy] Incremental sync error:", syncErr);
    }
  }

  if (localResult.rows.length > 0) {
    return {
      success: true,
      result: {
        rows: localResult.rows,
        hasMore: localResult.rows.length >= limit,
        stats: localResult.stats
      }
    };
  }

  return { success: false };
}

/**
 * Executes pagination (Load More) and historical backfill via local SQLite.
 */
export async function queryMoreLocalLogs(
  params: LocalDbQueryParams,
  before: number,
  signal: AbortSignal
): Promise<{ success: boolean; result?: LocalDbPaginationResult }> {
  const isDbReady = await localDb.init();
  if (!isDbReady || signal.aborted) {
    return { success: false };
  }

  const {
    profileId,
    searchQuery,
    statusFilter,
    accessPointIdFilter,
    destCountryFilter,
    ispFilter,
    since,
    until,
    limit
  } = params;

  const localResult = await localDb.queryLogs({
    profileId,
    search: searchQuery || undefined,
    action: statusFilter || undefined,
    accessPointId: accessPointIdFilter || undefined,
    destCountry: destCountryFilter || undefined,
    isp: ispFilter || undefined,
    since,
    until,
    before,
    limit,
    offset: 0
  });

  if (signal.aborted) return { success: false };

  if (localResult.rows.length >= limit) {
    return {
      success: true,
      result: {
        rows: localResult.rows,
        hasMore: localResult.rows.length >= limit
      }
    };
  }

  if (before > since) {
    try {
      const backfilled = await localDb.backfillLogs(
        profileId,
        before,
        since,
        limit,
        signal
      );
      if (signal.aborted) return { success: false };

      if (backfilled.length > 0) {
        const moreLocal = await localDb.queryLogs({
          profileId,
          search: searchQuery || undefined,
          action: statusFilter || undefined,
          accessPointId: accessPointIdFilter || undefined,
          destCountry: destCountryFilter || undefined,
          isp: ispFilter || undefined,
          since,
          until,
          before,
          limit,
          offset: 0
        });
        if (signal.aborted) return { success: false };

        return {
          success: true,
          result: {
            rows: moreLocal.rows,
            hasMore: moreLocal.rows.length >= limit && backfilled.length >= limit
          }
        };
      }

      return {
        success: true,
        result: {
          rows: localResult.rows,
          hasMore: false
        }
      };
    } catch (backfillErr: unknown) {
      if ((backfillErr as Error).name !== "AbortError") {
        console.warn("[localDbStrategy] Backfill error:", backfillErr);
      }
      return {
        success: true,
        result: {
          rows: localResult.rows,
          hasMore: false
        }
      };
    }
  }

  return {
    success: true,
    result: {
      rows: localResult.rows,
      hasMore: false
    }
  };
}
