import { useState, useEffect, useRef, useCallback } from "react";
import type { LogEntry, TimeRange } from "../types";
import { getProfileDetails, getProfileAnalytics, getProfileLogs, localDb, logsWs } from "../../../services";

const PAGE_SIZE = 50;
const PAGE_SIZE_IN_REALTIME = 25;

interface LogDataParams {
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

export function useLogData({
  profileId,
  range,
  customRange,
  statusFilter,
  accessPointIdFilter,
  destCountryFilter,
  ispFilter,
  searchQuery,
  realtimeRefresh,
}: LogDataParams) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [stats, setStats] = useState<{ total: number; pass: number; block: number; redirect: number } | null>(null);
  const [logRetentionDays, setLogRetentionDays] = useState<number>(30);
  const [prevLatestTimestamp, setPrevLatestTimestamp] = useState<number | null>(null);

  const logsRef = useRef<LogEntry[]>([]);
  useEffect(() => {
    logsRef.current = logs;
  }, [logs]);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const observer = useRef<IntersectionObserver | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const isFetchingRef = useRef<boolean>(false);

  // Clean up any pending requests when the component unmounts
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  // Fetch log retention days from profile settings
  useEffect(() => {
    getProfileDetails(profileId)
      .then((data) => {
        try {
          const settings = JSON.parse(data.settings || "{}");
          setLogRetentionDays(settings.log_retention_days !== undefined ? Number(settings.log_retention_days) : 30);
        } catch (e) {
          console.error("Failed to parse settings", e);
        }
      })
      .catch((e) => console.error("Failed to fetch profile settings", e));
  }, [profileId]);

  const fetchLogs = useCallback(
    async (
      currentRange: TimeRange,
      isInitial: boolean = true,
      isAutoRefresh: boolean = false,
      forceSync: boolean = false
    ) => {
      // Abort the previous request if it's still running
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      // Create a new AbortController for this request
      const controller = new AbortController();
      abortControllerRef.current = controller;
      isFetchingRef.current = true;

      if (isInitial) setLoading(true);
      else setLoadingMore(true);

      try {
        const limit = realtimeRefresh ? PAGE_SIZE_IN_REALTIME : PAGE_SIZE;

        // Compute time boundaries
        const now = Math.floor(Date.now() / 1000);
        let since = now;
        let until = now;
        if (currentRange === "custom" && customRange.start && customRange.end) {
          since = Math.floor(new Date(customRange.start).getTime() / 1000);
          until = Math.floor(new Date(customRange.end).getTime() / 1000);
        } else {
          switch (currentRange) {
            case "10m": since = now - 600; break;
            case "1h": since = now - 3600; break;
            case "24h": since = now - 86400; break;
            case "7d": since = now - 604800; break;
            case "30d": since = now - 2592000; break;
            default: since = now - 86400; break;
          }
        }

        // ── Step 1: Attempt Local-First SQLite execution ──
        let usedLocalDb = false;
        try {
          const isDbReady = await localDb.init();
          if (isDbReady && !controller.signal.aborted) {
            const before = !isInitial && logsRef.current.length > 0 ? logsRef.current[logsRef.current.length - 1].timestamp : undefined;

            if (isInitial) {
              // 1. Immediately query local SQLite for instant, zero-latency rendering
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

              // If local SQLite has cached rows, display them immediately (0ms visual latency)
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

              // 2. Perform delta sync from server in background (or initial sync if local DB was empty)
              try {
                const inserted = await localDb.syncProfileLogs(profileId, undefined, since, controller.signal, forceSync);
                if (!controller.signal.aborted && (inserted > 0 || localResult.rows.length === 0)) {
                  // Re-query local database to reflect newly synced records
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
              } catch (syncErr: any) {
                if (syncErr.name !== "AbortError") {
                  console.warn("[useLogData] Incremental sync error (continuing with cached):", syncErr);
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
                  // Local cache has fewer than 'limit' rows; backfill older logs from server
                  try {
                    const backfilled = await localDb.backfillLogs(profileId, before, since, limit, controller.signal);
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
                      setHasMore(realtimeRefresh ? false : moreLocal.rows.length >= limit && backfilled.length >= limit);
                    } else {
                      if (localResult.rows.length > 0) {
                        setLogs((prev) => [...prev, ...localResult.rows]);
                      }
                      setHasMore(false);
                    }
                  } catch (backfillErr: any) {
                    if (backfillErr.name !== "AbortError") {
                      console.warn("[useLogData] Backfill error:", backfillErr);
                    }
                    if (localResult.rows.length > 0) {
                      setLogs((prev) => [...prev, ...localResult.rows]);
                    }
                    usedLocalDb = true;
                    setHasMore(false);
                  }
                } else {
                  // Reached historical boundary
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
                  domains,
                });
              }
            }
          }
        } catch (localErr) {
          console.warn("[useLogData] Local SQLite failed, falling back to server:", localErr);
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

        const fetchLogsPromise = getProfileLogs(profileId, params.toString(), { signal: controller.signal });
        let fetchStatsPromise: Promise<any> = Promise.resolve(null);
        
        if (isInitial) {
          const statsParams = new URLSearchParams({ range: currentRange });
          if (currentRange === "custom" && customRange.start && customRange.end) {
            statsParams.set("start", String(since));
            statsParams.set("end", String(until));
          }
          if (searchQuery) statsParams.set("search", searchQuery);
          fetchStatsPromise = getProfileAnalytics(profileId, "summary", statsParams.toString(), { signal: controller.signal });
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
              domains,
            });
          }
        }
      } catch (e: any) {
        if (e.name !== "AbortError") {
          console.error(e);
        }
      } finally {
        // Only disable loading state if this is still the active/latest request
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
      customRange.start,
      customRange.end,
      searchQuery,
      statusFilter,
      accessPointIdFilter,
      destCountryFilter,
      ispFilter,
    ]
  );

  // Real-time WebSocket log streaming listener
  useEffect(() => {
    if (!realtimeRefresh) return;

    const unsubscribe = logsWs.onNewLogs((newLogs: LogEntry[]) => {
      if (!newLogs || newLogs.length === 0) return;

      const filteredNew = newLogs.filter((log) => {
        if (statusFilter && log.action !== statusFilter) return false;
        if (accessPointIdFilter && log.access_point_id !== accessPointIdFilter) return false;
        if (destCountryFilter && (log.dest_country_code || log.dest_country) !== destCountryFilter) return false;
        if (ispFilter && log.dest_isp !== ispFilter) return false;
        if (searchQuery) {
          const q = searchQuery.toLowerCase();
          const domainMatch = log.domain?.toLowerCase().includes(q);
          const ipMatch = log.client_ip?.toLowerCase().includes(q);
          const reasonMatch = log.reason?.toLowerCase().includes(q);
          if (!domainMatch && !ipMatch && !reasonMatch) return false;
        }
        return true;
      });

      if (filteredNew.length === 0) return;

      const oldLatest = logsRef.current.length > 0 ? logsRef.current[0].timestamp : null;
      setPrevLatestTimestamp(oldLatest);

      setLogs((prev) => {
        const existingIds = new Set(prev.map((l) => `${l.timestamp}-${l.id}`));
        const uniqueNew = filteredNew.filter((l) => !existingIds.has(`${l.timestamp}-${l.id}`));
        if (uniqueNew.length === 0) return prev;
        return [...uniqueNew, ...prev].slice(0, PAGE_SIZE_IN_REALTIME);
      });

      setStats((prev) => {
        if (!prev) return prev;
        let addedPass = 0;
        let addedBlock = 0;
        let addedRedirect = 0;
        for (const l of newLogs) {
          if (l.action === "PASS") addedPass++;
          else if (l.action === "BLOCK") addedBlock++;
          else if (l.action === "REDIRECT") addedRedirect++;
        }
        return {
          total: prev.total + newLogs.length,
          pass: prev.pass + addedPass,
          block: prev.block + addedBlock,
          redirect: prev.redirect + addedRedirect,
        };
      });
    });

    return unsubscribe;
  }, [realtimeRefresh, statusFilter, accessPointIdFilter, destCountryFilter, ispFilter, searchQuery]);

  const loadMore = useCallback(() => {
    if (realtimeRefresh) return;
    if (isFetchingRef.current || loading || loadingMore || !hasMore) return;
    void fetchLogs(range, false);
  }, [loading, loadingMore, hasMore, range, realtimeRefresh, fetchLogs]);

  const lastLogElementRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (observer.current) observer.current.disconnect();
      if (loading || loadingMore || realtimeRefresh || !hasMore) return;
      observer.current = new IntersectionObserver(
        (entries) => {
          if (entries[0]?.isIntersecting && hasMore && !isFetchingRef.current) {
            loadMore();
          }
        },
        { root: scrollContainerRef.current, rootMargin: "100px" }
      );
      if (node) observer.current.observe(node);
    },
    [loading, loadingMore, hasMore, loadMore, realtimeRefresh]
  );

  useEffect(() => {
    if (range === "custom" && (!customRange.start || !customRange.end)) return;
    const timer = setTimeout(() => {
      void fetchLogs(range, true);
    }, searchQuery ? 500 : 0);
    return () => clearTimeout(timer);
  }, [range, customRange.start, customRange.end, searchQuery, fetchLogs]);

  return {
    logs,
    loading,
    loadingMore,
    hasMore,
    stats,
    logRetentionDays,
    prevLatestTimestamp,
    scrollContainerRef,
    lastLogElementRef,
    fetchLogs,
    isFetchingRef,
    logsRef,
  };
}
