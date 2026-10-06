import { useEffect, useRef, useCallback } from "react";
import type { TimeRange } from "../types";
import { useProfileRetention } from "./logData/useProfileRetention";
import {
  useLogsFetcher,
  PAGE_SIZE_IN_REALTIME
} from "./logData/useLogsFetcher";
import { useRealtimeLogs } from "./logData/useRealtimeLogs";

export interface LogDataParams {
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

/**
 * Hook to manage DNS query log state, coordinating local-first SQLite persistence,
 * server delta synchronizations, real-time WebSocket streams, and infinite scroll pagination.
 */
export function useLogData({
  profileId,
  range,
  customRange,
  statusFilter,
  accessPointIdFilter,
  destCountryFilter,
  ispFilter,
  searchQuery,
  realtimeRefresh
}: LogDataParams) {
  const logRetentionDays = useProfileRetention(profileId);

  const {
    logs,
    setLogs,
    loading,
    loadingMore,
    hasMore,
    stats,
    setStats,
    prevLatestTimestamp,
    setPrevLatestTimestamp,
    fetchLogs,
    isFetchingRef,
    logsRef
  } = useLogsFetcher({
    profileId,
    range,
    customRange,
    statusFilter,
    accessPointIdFilter,
    destCountryFilter,
    ispFilter,
    searchQuery,
    realtimeRefresh
  });

  useRealtimeLogs({
    realtimeRefresh,
    statusFilter,
    accessPointIdFilter,
    destCountryFilter,
    ispFilter,
    searchQuery,
    pageSize: PAGE_SIZE_IN_REALTIME,
    logsRef,
    setLogs,
    setStats,
    setPrevLatestTimestamp
  });

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const observer = useRef<IntersectionObserver | null>(null);

  const loadMore = useCallback(() => {
    if (realtimeRefresh) return;
    if (isFetchingRef.current || loading || loadingMore || !hasMore) return;
    void fetchLogs(range, false);
  }, [loading, loadingMore, hasMore, range, realtimeRefresh, fetchLogs, isFetchingRef]);

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
    [loading, loadingMore, hasMore, loadMore, realtimeRefresh, isFetchingRef]
  );

  useEffect(() => {
    if (range === "custom" && (!customRange.start || !customRange.end)) return;
    const timer = setTimeout(
      () => {
        void fetchLogs(range, true);
      },
      searchQuery ? 500 : 0
    );
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
    logsRef
  };
}
