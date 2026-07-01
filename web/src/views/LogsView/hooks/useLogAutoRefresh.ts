import { useEffect } from "react";
import type { TimeRange } from "../types";

interface AutoRefreshParams {
  profileId: string;
  range: TimeRange;
  searchQuery: string;
  realtimeRefresh: boolean;
  statusFilter: string | null;
  accessPointIdFilter: string | null;
  destCountryFilter: string | null;
  ispFilter: string | null;
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  isFetchingRef: React.MutableRefObject<boolean>;
  fetchLogs: (currentRange: TimeRange, isInitial: boolean, isAutoRefresh: boolean) => Promise<void>;
}

export function useLogAutoRefresh({
  profileId,
  range,
  searchQuery,
  realtimeRefresh,
  statusFilter,
  accessPointIdFilter,
  destCountryFilter,
  ispFilter,
  scrollContainerRef,
  isFetchingRef,
  fetchLogs,
}: AutoRefreshParams) {
  useEffect(() => {
    const autoRefreshTimer = setInterval(() => {
      if (
        realtimeRefresh &&
        scrollContainerRef.current &&
        scrollContainerRef.current.scrollTop < 50 &&
        !isFetchingRef.current &&
        !searchQuery &&
        range !== "custom"
      ) {
        fetchLogs(range, true, true);
      }
    }, 2000);
    return () => clearInterval(autoRefreshTimer);
  }, [
    profileId,
    range,
    searchQuery,
    realtimeRefresh,
    statusFilter,
    accessPointIdFilter,
    destCountryFilter,
    ispFilter,
    scrollContainerRef,
    isFetchingRef,
    fetchLogs,
  ]);
}
