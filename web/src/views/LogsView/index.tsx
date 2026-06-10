import React, { useState, useEffect, useRef, useCallback } from "react";
import { Spinner, Callout } from "@blueprintjs/core";
import { useTranslation } from "react-i18next";

import type {  LogEntry, LogsViewProps, TimeRange  } from "./types";
import { useIsMobile } from "./utils";
import { LogsHeader } from "./components/LogsHeader";
import { LogsTable } from "./components/LogsTable";
import { LogsList } from "./components/LogsList";
import { LogDetailsDrawer } from "./components/LogDetailsDrawer";

export const LogsView: React.FC<LogsViewProps> = ({ profileId, onQuickAction }) => {
  const isMobile = useIsMobile();
  const { t } = useTranslation();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selectedLog, setSelectedLog] = useState<LogEntry | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [range, setRange] = useState<TimeRange>("24h");
  const [customRange, setCustomRange] = useState({ start: "", end: "" });
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [hasMore, setHasMore] = useState(true);
  const [realtimeRefresh, setRealtimeRefresh] = useState(false);

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

  const fetchLogs = async (currentRange: TimeRange, isInitial: boolean = true) => {
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
      let url = `/api/profiles/${profileId}/logs?range=${currentRange}`;
      if (currentRange === "custom" && customRange.start && customRange.end) {
        const startTs = Math.floor(new Date(customRange.start).getTime() / 1000);
        const endTs = Math.floor(new Date(customRange.end).getTime() / 1000);
        url += `&start=${startTs}&end=${endTs}`;
      }
      if (statusFilter) url += `&status=${statusFilter}`;
      if (searchQuery) url += `&search=${encodeURIComponent(searchQuery)}`;
      if (!isInitial && logs.length > 0) {
        url += `&before=${logs[logs.length - 1].timestamp}`;
      }

      const res = await fetch(url, { signal: controller.signal });
      const data = await res.json();
      if (isInitial) {
        setLogs(data);
        setHasMore(data.length >= 50);
      } else {
        setLogs((prev) => [...prev, ...data]);
        setHasMore(data.length >= 50);
      }

      if (data && data.length > 0) {
        const domains = Array.from(new Set(data.map((log: LogEntry) => log.domain)));
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
    if (!loading && !loadingMore && hasMore) fetchLogs(range, false);
  }, [loading, loadingMore, hasMore, range, profileId, statusFilter, searchQuery, logs, customRange]);

  const lastLogElementRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (loading || loadingMore) return;
      if (observer.current) observer.current.disconnect();
      observer.current = new IntersectionObserver(
        (entries) => {
          if (entries[0].isIntersecting && hasMore) loadMore();
        },
        { root: scrollContainerRef.current, rootMargin: "200px" }
      );
      if (node) observer.current.observe(node);
    },
    [loading, loadingMore, hasMore, loadMore]
  );

  useEffect(() => {
    if (range === "custom" && (!customRange.start || !customRange.end)) return;
    const timer = setTimeout(() => fetchLogs(range, true), searchQuery ? 500 : 0);
    return () => clearTimeout(timer);
  }, [profileId, range, statusFilter, searchQuery, customRange]);

  useEffect(() => {
    const autoRefreshTimer = setInterval(() => {
      if (
        realtimeRefresh &&
        scrollContainerRef.current &&
        scrollContainerRef.current.scrollTop < 50 &&
        !isFetchingRef.current && // Skip if there is an active request in progress
        !searchQuery &&
        range !== "custom"
      ) {
        fetchLogs(range, true);
      }
    }, 2000);
    return () => clearInterval(autoRefreshTimer);
  }, [profileId, range, searchQuery, realtimeRefresh]);

  const nowStr = new Date().toLocaleString("sv-SE").replace(" ", "T").slice(0, 16);

  if (loading && logs.length === 0)
    return (
      <div className="h-full flex items-center justify-center">
        <Spinner />
      </div>
    );

  return (
    <div className="h-full flex flex-col overflow-hidden bg-gray-50/30 dark:bg-gray-950/10 max-w-7xl mx-auto w-full pt-14">
      <LogsHeader
        range={range}
        setRange={setRange}
        customRange={customRange}
        setCustomRange={setCustomRange}
        nowStr={nowStr}
        fetchLogs={fetchLogs}
        isMobile={isMobile}
        realtimeRefresh={realtimeRefresh}
        setRealtimeRefresh={setRealtimeRefresh}
        statusFilter={statusFilter}
        setStatusFilter={setStatusFilter}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
      />

      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto px-4 relative">
        {logs.length === 0 && !loading ? (
          <div className="py-20">
            <Callout title={searchQuery ? t("logs.noResults") : t("logs.noRecords")} icon={searchQuery ? "search" : "outdated"}>
              {searchQuery ? t("logs.noResultsDesc", { query: searchQuery }) : t("logs.noRecordsDesc")}
            </Callout>
          </div>
        ) : isMobile ? (
          <LogsList logs={logs} setSelectedLog={setSelectedLog} setIsDrawerOpen={setIsDrawerOpen} lastLogElementRef={lastLogElementRef} />
        ) : (
          <LogsTable logs={logs} setSelectedLog={setSelectedLog} setIsDrawerOpen={setIsDrawerOpen} lastLogElementRef={lastLogElementRef} />
        )}

        <div className="p-6 flex flex-col items-center">
          {loadingMore ? (
            <Spinner size={16} />
          ) : (
            !hasMore &&
            logs.length > 0 && <span className="text-[10px] opacity-30 italic">{t("logs.loadedAll", { count: logs.length })}</span>
          )}
        </div>
      </div>

      <LogDetailsDrawer
        isDrawerOpen={isDrawerOpen}
        setIsDrawerOpen={setIsDrawerOpen}
        selectedLog={selectedLog}
        isMobile={isMobile}
        onQuickAction={onQuickAction}
      />
    </div>
  );
};
