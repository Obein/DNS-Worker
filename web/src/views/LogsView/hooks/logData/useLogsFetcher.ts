/**
 * @file useLogsFetcher.ts
 * @description State coordinator hook for DNS query logs retrieval, pagination, and real-time syncing.
 */

import { useState, useRef, useEffect, useCallback } from "react";
import type { LogEntry, TimeRange } from "../../types";
import { logsWs } from "../../../../services";
import { calculateTimeBoundaries } from "./timeBoundaries";
import { prefetchDomainIcons } from "./utils/prefetchIcons";
import { fetchServerLogs } from "./strategies/serverStrategy";
import { queryInitialLocalLogs, queryMoreLocalLogs } from "./strategies/localDbStrategy";

export const PAGE_SIZE = 50;
export const PAGE_SIZE_IN_REALTIME = 25;

export interface UseLogsFetcherParams {
  profileId: string;
  range: TimeRange;
  customRange: { start: string; end: string };
  statusFilter: string | null;
  accessPointIdFilter: string | null;
  destCountryFilter: string | null;
  ispFilter: string | null;
  searchQuery: string;
  realtimeRefresh: boolean;
}

export interface UseLogsFetcherReturn {
  logs: LogEntry[];
  setLogs: React.Dispatch<React.SetStateAction<LogEntry[]>>;
  loading: boolean;
  loadingMore: boolean;
  syncing: boolean;
  hasMore: boolean;
  setHasMore: React.Dispatch<React.SetStateAction<boolean>>;
  stats: { total: number; pass: number; block: number; redirect: number } | null;
  setStats: React.Dispatch<
    React.SetStateAction<{ total: number; pass: number; block: number; redirect: number } | null>
  >;
  prevLatestTimestamp: number | null;
  setPrevLatestTimestamp: React.Dispatch<React.SetStateAction<number | null>>;
  fetchLogs: (
    currentRange: TimeRange,
    isInitial?: boolean,
    isAutoRefresh?: boolean,
    forceSync?: boolean
  ) => Promise<void>;
  isFetchingRef: React.MutableRefObject<boolean>;
  logsRef: React.MutableRefObject<LogEntry[]>;
}

export function useLogsFetcher({
  profileId,
  range: _range,
  customRange,
  statusFilter,
  accessPointIdFilter,
  destCountryFilter,
  ispFilter,
  searchQuery,
  realtimeRefresh
}: UseLogsFetcherParams): UseLogsFetcherReturn {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadingMore, setLoadingMore] = useState<boolean>(false);
  const [syncing, setSyncing] = useState<boolean>(false);
  const [hasMore, setHasMore] = useState<boolean>(true);
  const [stats, setStats] = useState<{
    total: number;
    pass: number;
    block: number;
    redirect: number;
  } | null>(null);
  const [prevLatestTimestamp, setPrevLatestTimestamp] = useState<number | null>(null);

  const logsRef = useRef<LogEntry[]>([]);
  useEffect(() => {
    logsRef.current = logs;
  }, [logs]);

  const abortControllerRef = useRef<AbortController | null>(null);
  const isFetchingRef = useRef<boolean>(false);

  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  const fetchLogs = useCallback(
    async (
      currentRange: TimeRange,
      isInitial: boolean = true,
      isAutoRefresh: boolean = false,
      forceSync: boolean = false
    ): Promise<void> => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      const controller = new AbortController();
      abortControllerRef.current = controller;
      isFetchingRef.current = true;

      if (isInitial) setLoading(true);
      else setLoadingMore(true);

      try {
        const limit = realtimeRefresh ? PAGE_SIZE_IN_REALTIME : PAGE_SIZE;
        const { since, until } = calculateTimeBoundaries(currentRange, customRange);
        const queryParams = {
          profileId,
          searchQuery,
          statusFilter,
          accessPointIdFilter,
          destCountryFilter,
          ispFilter,
          since,
          until,
          limit
        };

        // ── Step 1: Attempt Local-First SQLite execution ──
        let usedLocalDb = false;

        if (isInitial) {
          if (!isAutoRefresh) setSyncing(true);

          const localResult = await queryInitialLocalLogs(
            queryParams,
            controller.signal,
            forceSync,
            (immediate) => {
              usedLocalDb = true;
              if (isAutoRefresh) {
                const oldLatest = logsRef.current.length > 0 ? logsRef.current[0].timestamp : null;
                setPrevLatestTimestamp(oldLatest);
              } else {
                setPrevLatestTimestamp(null);
              }
              setLogs(immediate.rows);
              setHasMore(realtimeRefresh ? false : immediate.hasMore);
              if (realtimeRefresh && immediate.rows.length > 0) {
                logsWs.updateCursor(immediate.rows[0].timestamp, immediate.rows[0].id);
              }
              if (immediate.stats) {
                setStats(immediate.stats);
              }
              setLoading(false);
            }
          );

          if (controller.signal.aborted) return;

          if (localResult.success && localResult.result) {
            usedLocalDb = true;
            if (isAutoRefresh) {
              const oldLatest = logsRef.current.length > 0 ? logsRef.current[0].timestamp : null;
              setPrevLatestTimestamp(oldLatest);
            } else {
              setPrevLatestTimestamp(null);
            }
            setLogs(localResult.result.rows);
            setHasMore(realtimeRefresh ? false : localResult.result.hasMore);
            if (realtimeRefresh && localResult.result.rows.length > 0) {
              logsWs.updateCursor(localResult.result.rows[0].timestamp, localResult.result.rows[0].id);
            }
            if (localResult.result.stats) {
              setStats(localResult.result.stats);
            }
          }
        } else {
          // ── Pagination (Load More) ──
          const before = logsRef.current.length > 0
            ? logsRef.current[logsRef.current.length - 1].timestamp
            : undefined;

          if (before !== undefined) {
            const paginationResult = await queryMoreLocalLogs(queryParams, before, controller.signal);
            if (controller.signal.aborted) return;

            if (paginationResult.success && paginationResult.result) {
              usedLocalDb = true;
              setLogs((prev) => [...prev, ...paginationResult.result!.rows]);
              setHasMore(realtimeRefresh ? false : paginationResult.result.hasMore);
            }
          } else {
            usedLocalDb = true;
            setHasMore(false);
          }
        }

        if (usedLocalDb) {
          prefetchDomainIcons(logsRef.current);
          if (abortControllerRef.current === controller) {
            setLoading(false);
            setLoadingMore(false);
            setSyncing(false);
            isFetchingRef.current = false;
          }
          return;
        }

        // ── Step 2: Fallback to Server Fetch ──
        const lastTimestamp = !isInitial && logsRef.current.length > 0
          ? logsRef.current[logsRef.current.length - 1].timestamp
          : undefined;

        const serverResult = await fetchServerLogs({
          profileId,
          currentRange,
          customRange,
          since,
          until,
          limit,
          isInitial,
          statusFilter,
          accessPointIdFilter,
          destCountryFilter,
          ispFilter,
          searchQuery,
          lastTimestamp,
          signal: controller.signal
        });

        if (controller.signal.aborted) return;

        if (isInitial) {
          if (isAutoRefresh) {
            const oldLatest = logsRef.current.length > 0 ? logsRef.current[0].timestamp : null;
            setPrevLatestTimestamp(oldLatest);
          } else {
            setPrevLatestTimestamp(null);
          }
          setLogs(serverResult.logs);
          setHasMore(realtimeRefresh ? false : serverResult.logs.length >= limit);
          if (serverResult.stats) {
            setStats(serverResult.stats);
          }
        } else {
          setLogs((prev) => [...prev, ...serverResult.logs]);
          setHasMore(realtimeRefresh ? false : serverResult.logs.length >= limit);
        }

        if (serverResult.logs.length > 0) {
          if (realtimeRefresh) {
            logsWs.updateCursor(serverResult.logs[0].timestamp, serverResult.logs[0].id);
          }
          prefetchDomainIcons(serverResult.logs);
        }
      } catch (e: unknown) {
        if ((e as Error).name !== "AbortError") {
          console.error(e);
        }
      } finally {
        if (abortControllerRef.current === controller) {
          setLoading(false);
          setLoadingMore(false);
          setSyncing(false);
          isFetchingRef.current = false;
        }
      }
    },
    [
      profileId,
      realtimeRefresh,
      customRange,
      searchQuery,
      statusFilter,
      accessPointIdFilter,
      destCountryFilter,
      ispFilter
    ]
  );

  return {
    logs,
    setLogs,
    loading,
    loadingMore,
    syncing,
    hasMore,
    setHasMore,
    stats,
    setStats,
    prevLatestTimestamp,
    setPrevLatestTimestamp,
    fetchLogs,
    isFetchingRef,
    logsRef
  };
}
