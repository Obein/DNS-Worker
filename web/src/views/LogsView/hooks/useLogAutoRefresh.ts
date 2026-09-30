import { useEffect } from "react";
import type { TimeRange, LogEntry } from "../types";
import { logsWs } from "../../../services";

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
  logsRef: React.MutableRefObject<LogEntry[]>;
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
  logsRef,
}: AutoRefreshParams) {
  useEffect(() => {
    if (!realtimeRefresh) {
      logsWs.disconnect();
      return;
    }

    let isWsConnected = false;
    let fallbackTimer: ReturnType<typeof setInterval> | null = null;

    const startFallbackTimer = () => {
      if (fallbackTimer) return;
      fallbackTimer = setInterval(() => {
        if (
          !isWsConnected &&
          document.visibilityState === "visible" &&
          scrollContainerRef.current &&
          scrollContainerRef.current.scrollTop < 50 &&
          !isFetchingRef.current &&
          !searchQuery &&
          range !== "custom"
        ) {
          void fetchLogs(range, true, true);
        }
      }, 8000);
    };

    const stopFallbackTimer = () => {
      if (fallbackTimer) {
        clearInterval(fallbackTimer);
        fallbackTimer = null;
      }
    };

    // Listen to WebSocket status changes: disable HTTP fallback when WebSocket is healthy
    const unsubStatus = logsWs.onStatusChange((connected) => {
      isWsConnected = connected;
      if (connected) {
        stopFallbackTimer();
      } else {
        startFallbackTimer();
      }
    });

    // Establish WebSocket push connection with current cursor
    const latestLog = logsRef.current.length > 0 ? logsRef.current[0] : null;
    const sinceTs = latestLog ? latestLog.timestamp : Math.floor(Date.now() / 1000) - 60;
    const lastId = latestLog ? latestLog.id : 0;
    logsWs.connect(profileId, sinceTs, lastId);

    // Initial check: if WS takes longer than 2.5s to establish, arm fallback timer
    const initFallbackTimeout = setTimeout(() => {
      if (!isWsConnected) {
        startFallbackTimer();
      }
    }, 2500);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        if (isWsConnected) {
          const currentLatest = logsRef.current.length > 0 ? logsRef.current[0] : null;
          if (currentLatest) {
            logsWs.updateCursor(currentLatest.timestamp, currentLatest.id);
          }
        } else {
          void fetchLogs(range, true, true);
        }
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      clearTimeout(initFallbackTimeout);
      stopFallbackTimer();
      unsubStatus();
      logsWs.disconnect();
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
    logsRef,
  ]);
}
