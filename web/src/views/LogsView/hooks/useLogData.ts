import { useState, useEffect, useRef, useCallback } from "react";
import type { LogEntry, TimeRange } from "../types";
import { getProfileDetails, getProfileAnalytics, getProfileLogs } from "../../../services";

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

  const fetchLogs = async (currentRange: TimeRange, isInitial: boolean = true, isAutoRefresh: boolean = false) => {
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
      const params = new URLSearchParams({ range: currentRange, limit: String(limit) });
      if (currentRange === "custom" && customRange.start && customRange.end) {
        const startTs = Math.floor(new Date(customRange.start).getTime() / 1000);
        const endTs = Math.floor(new Date(customRange.end).getTime() / 1000);
        params.set("start", String(startTs));
        params.set("end", String(endTs));
      }
      if (statusFilter) params.set("status", statusFilter);
      if (accessPointIdFilter) params.set("access_point_id", accessPointIdFilter);
      if (destCountryFilter) params.set("dest_country", destCountryFilter);
      if (ispFilter) params.set("isp", ispFilter);
      if (searchQuery) params.set("search", searchQuery);
      if (!isInitial && logs.length > 0) {
        params.set("before", String(logs[logs.length - 1].timestamp));
      }

      const fetchLogsPromise = getProfileLogs(profileId, params.toString(), { signal: controller.signal });
      let fetchStatsPromise: Promise<any> = Promise.resolve(null);
      
      if (isInitial) {
        const statsParams = new URLSearchParams({ range: currentRange });
        if (currentRange === "custom" && customRange.start && customRange.end) {
          const startTs = Math.floor(new Date(customRange.start).getTime() / 1000);
          const endTs = Math.floor(new Date(customRange.end).getTime() / 1000);
          statsParams.set("start", String(startTs));
          statsParams.set("end", String(endTs));
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
  };

  const loadMore = useCallback(() => {
    if (realtimeRefresh) return;
    if (!loading && !loadingMore && hasMore) fetchLogs(range, false);
  }, [loading, loadingMore, hasMore, range, profileId, statusFilter, accessPointIdFilter, destCountryFilter, ispFilter, searchQuery, logs, customRange, realtimeRefresh]);

  const lastLogElementRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (observer.current) observer.current.disconnect();
      if (loading || loadingMore || realtimeRefresh) return;
      observer.current = new IntersectionObserver(
        (entries) => {
          if (entries[0].isIntersecting && hasMore) loadMore();
        },
        { root: scrollContainerRef.current, rootMargin: "200px" }
      );
      if (node) observer.current.observe(node);
    },
    [loading, loadingMore, hasMore, loadMore, realtimeRefresh]
  );

  useEffect(() => {
    if (range === "custom" && (!customRange.start || !customRange.end)) return;
    const timer = setTimeout(() => fetchLogs(range, true), searchQuery ? 500 : 0);
    return () => clearTimeout(timer);
  }, [profileId, range, statusFilter, accessPointIdFilter, destCountryFilter, ispFilter, searchQuery, customRange, realtimeRefresh]);

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
  };
}
