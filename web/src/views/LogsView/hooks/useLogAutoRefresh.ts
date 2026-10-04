import { useEffect, useRef } from "react";
import type { TimeRange, LogEntry } from "../types";
import { logsWs } from "../../../services";

interface AutoRefreshParams {
  profileId: string;
  range: TimeRange;
  searchQuery: string;
  realtimeRefresh: boolean;
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
  scrollContainerRef,
  isFetchingRef,
  fetchLogs,
  logsRef,
}: AutoRefreshParams) {
  // Keep latest mutable references to avoid re-triggering WebSocket reconnects on filter changes
  const latestParamsRef = useRef({
    range,
    searchQuery,
    fetchLogs,
    logsRef,
  });

  useEffect(() => {
    latestParamsRef.current = {
      range,
      searchQuery,
      fetchLogs,
      logsRef,
    };
  });

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
        const { range: curRange, searchQuery: curSearch, fetchLogs: curFetch } = latestParamsRef.current;
        if (
          !isWsConnected &&
          document.visibilityState === "visible" &&
          scrollContainerRef.current &&
          scrollContainerRef.current.scrollTop < 50 &&
          !isFetchingRef.current &&
          !curSearch &&
          curRange !== "custom"
        ) {
          void curFetch(curRange, true, true);
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
    const curLogs = latestParamsRef.current.logsRef.current;
    const latestLog = curLogs.length > 0 ? curLogs[0] : null;
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
          const currentLogs = latestParamsRef.current.logsRef.current;
          const currentLatest = currentLogs.length > 0 ? currentLogs[0] : null;
          if (currentLatest) {
            logsWs.updateCursor(currentLatest.timestamp, currentLatest.id);
          }
        } else {
          const { range: curRange, fetchLogs: curFetch } = latestParamsRef.current;
          void curFetch(curRange, true, true);
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
  }, [profileId, realtimeRefresh]);
}
