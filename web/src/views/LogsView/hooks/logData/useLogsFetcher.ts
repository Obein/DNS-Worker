import { useState, useRef, useEffect, useCallback } from "react";
import type { LogEntry, TimeRange } from "../../types";
import {
  getProfileLogs,
  getProfileAnalytics,
  localDb,
  logsWs
} from "../../../../services";
import { calculateTimeBoundaries } from "./timeBoundaries";

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

        // ── Step 1: Attempt Local-First SQLite execution ──
        let usedLocalDb = false;
        try {
          const isDbReady = await localDb.init();
          if (isDbReady && !controller.signal.aborted) {
            const before =
              !isInitial && logsRef.current.length > 0
                ? logsRef.current[logsRef.current.length - 1].timestamp
                : undefined;

            if (isInitial) {
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

              if (controller.signal.aborted) return;

              if (localResult.rows.length > 0) {
                usedLocalDb = true;
                if (isAutoRefresh) {
                  const oldLatest = logsRef.current.length > 0 ? logsRef.current[0].timestamp : null;
                  setPrevLatestTimestamp(oldLatest);
                } else {
                  setPrevLatestTimestamp(null);
                }
                setLogs(localResult.rows);
                setHasMore(realtimeRefresh ? false : localResult.rows.length >= limit);
                if (realtimeRefresh && localResult.rows.length > 0) {
                  logsWs.updateCursor(localResult.rows[0].timestamp, localResult.rows[0].id);
                }
                if (localResult.stats) {
                  setStats(localResult.stats);
                }
                setLoading(false);
              }

              // Perform delta sync from server in background
              try {
                const inserted = await localDb.syncProfileLogs(
                  profileId,
                  undefined,
                  since,
                  controller.signal,
                  forceSync
                );

                if (!controller.signal.aborted && (inserted > 0 || localResult.rows.length === 0)) {
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

                  if (controller.signal.aborted) return;

                  usedLocalDb = true;
                  if (isAutoRefresh) {
                    const oldLatest = logsRef.current.length > 0 ? logsRef.current[0].timestamp : null;
                    setPrevLatestTimestamp(oldLatest);
                  } else {
                    setPrevLatestTimestamp(null);
                  }
                  setLogs(localResult.rows);
                  setHasMore(realtimeRefresh ? false : localResult.rows.length >= limit);
                  if (realtimeRefresh && localResult.rows.length > 0) {
                    logsWs.updateCursor(localResult.rows[0].timestamp, localResult.rows[0].id);
                  }
                  if (localResult.stats) {
                    setStats(localResult.stats);
                  }
                } else if (!controller.signal.aborted && localResult.rows.length > 0) {
                  usedLocalDb = true;
                }
              } catch (syncErr: unknown) {
                if ((syncErr as Error).name !== "AbortError") {
                  console.warn("[useLogsFetcher] Incremental sync error:", syncErr);
                }
              }
            } else {
              // ── Pagination (Load More) ──
              if (before !== undefined) {
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

                if (controller.signal.aborted) return;

                if (localResult.rows.length >= limit) {
                  usedLocalDb = true;
                  setLogs((prev) => [...prev, ...localResult.rows]);
                  setHasMore(realtimeRefresh ? false : localResult.rows.length >= limit);
                } else if (before > since) {
                  try {
                    const backfilled = await localDb.backfillLogs(
                      profileId,
                      before,
                      since,
                      limit,
                      controller.signal
                    );
                    if (controller.signal.aborted) return;

                    usedLocalDb = true;
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
                      if (controller.signal.aborted) return;

                      setLogs((prev) => [...prev, ...moreLocal.rows]);
                      setHasMore(
                        realtimeRefresh
                          ? false
                          : moreLocal.rows.length >= limit && backfilled.length >= limit
                      );
                    } else {
                      if (localResult.rows.length > 0) {
                        setLogs((prev) => [...prev, ...localResult.rows]);
                      }
                      setHasMore(false);
                    }
                  } catch (backfillErr: unknown) {
                    if ((backfillErr as Error).name !== "AbortError") {
                      console.warn("[useLogsFetcher] Backfill error:", backfillErr);
                    }
                    if (localResult.rows.length > 0) {
                      setLogs((prev) => [...prev, ...localResult.rows]);
                    }
                    usedLocalDb = true;
                    setHasMore(false);
                  }
                } else {
                  usedLocalDb = true;
                  if (localResult.rows.length > 0) {
                    setLogs((prev) => [...prev, ...localResult.rows]);
                  }
                  setHasMore(false);
                }
              } else {
                usedLocalDb = true;
                setHasMore(false);
              }
            }

            if (usedLocalDb && logsRef.current.length > 0) {
              const domains = Array.from(new Set(logsRef.current.map((log: LogEntry) => log.domain)));
              if ("serviceWorker" in navigator && navigator.serviceWorker.controller) {
                navigator.serviceWorker.controller.postMessage({
                  type: "PREFETCH_ICONS",
                  domains
                });
              }
            }
          }
        } catch (localErr: unknown) {
          console.warn("[useLogsFetcher] Local SQLite failed, falling back to server:", localErr);
          usedLocalDb = false;
        }

        if (usedLocalDb) {
          if (abortControllerRef.current === controller) {
            setLoading(false);
            setLoadingMore(false);
            isFetchingRef.current = false;
          }
          return;
        }

        // ── Step 2: Fallback to Server Fetch ──
        const params = new URLSearchParams({ range: currentRange, limit: String(limit) });
        if (currentRange === "custom" && customRange.start && customRange.end) {
          params.set("start", String(since));
          params.set("end", String(until));
        }
        if (statusFilter) params.set("status", statusFilter);
        if (accessPointIdFilter) params.set("access_point_id", accessPointIdFilter);
        if (destCountryFilter) params.set("dest_country", destCountryFilter);
        if (ispFilter) params.set("isp", ispFilter);
        if (searchQuery) params.set("search", searchQuery);
        if (!isInitial && logsRef.current.length > 0) {
          params.set("before", String(logsRef.current[logsRef.current.length - 1].timestamp));
        }

        const fetchLogsPromise = getProfileLogs(profileId, params.toString(), {
          signal: controller.signal
        });
        let fetchStatsPromise: Promise<Array<{ action: string; count: number }> | null> =
          Promise.resolve(null);

        if (isInitial) {
          const statsParams = new URLSearchParams({ range: currentRange });
          if (currentRange === "custom" && customRange.start && customRange.end) {
            statsParams.set("start", String(since));
            statsParams.set("end", String(until));
          }
          if (searchQuery) statsParams.set("search", searchQuery);
          fetchStatsPromise = getProfileAnalytics(
            profileId,
            "summary",
            statsParams.toString(),
            { signal: controller.signal }
          );
        }

        const [logsData, statsData] = await Promise.all([fetchLogsPromise, fetchStatsPromise]);

        if (isInitial) {
          if (isAutoRefresh) {
            const oldLatest = logsRef.current.length > 0 ? logsRef.current[0].timestamp : null;
            setPrevLatestTimestamp(oldLatest);
          } else {
            setPrevLatestTimestamp(null);
          }
          setLogs(logsData);
          setHasMore(realtimeRefresh ? false : logsData.length >= limit);
          if (statsData) {
            const summary = { total: 0, pass: 0, block: 0, redirect: 0 };
            statsData.forEach((item: { action: string; count: number }) => {
              const count = item.count;
              summary.total += count;
              if (item.action === "PASS") summary.pass = count;
              else if (item.action === "BLOCK") summary.block = count;
              else if (item.action === "REDIRECT") summary.redirect = count;
            });
            setStats(summary);
          }
        } else {
          setLogs((prev) => [...prev, ...logsData]);
          setHasMore(realtimeRefresh ? false : logsData.length >= limit);
        }

        if (logsData && logsData.length > 0) {
          if (realtimeRefresh) {
            logsWs.updateCursor(logsData[0].timestamp, logsData[0].id);
          }
          const domains = Array.from(new Set(logsData.map((log: LogEntry) => log.domain)));
          if ("serviceWorker" in navigator && navigator.serviceWorker.controller) {
            navigator.serviceWorker.controller.postMessage({
              type: "PREFETCH_ICONS",
              domains
            });
          }
        }
      } catch (e: unknown) {
        if ((e as Error).name !== "AbortError") {
          console.error(e);
        }
      } finally {
        if (abortControllerRef.current === controller) {
          setLoading(false);
          setLoadingMore(false);
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
