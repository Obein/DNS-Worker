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
    if (!realtimeRefresh) return;

    const triggerRefresh = () => {
      if (
        document.visibilityState === "visible" &&
        scrollContainerRef.current &&
        scrollContainerRef.current.scrollTop < 50 &&
        !isFetchingRef.current &&
        !searchQuery &&
        range !== "custom"
      ) {
        fetchLogs(range, true, true);
      }
    };

    // 6-second interval (reasonable real-time refresh rate preventing DB quota burn)
    const autoRefreshTimer = setInterval(triggerRefresh, 6000);

    // When user returns to the tab, trigger an immediate refresh
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        triggerRefresh();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      clearInterval(autoRefreshTimer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
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
