import React, { useState, useEffect, useRef, useCallback } from "react";
import { Spinner, Callout } from "@blueprintjs/core";
import { useTranslation } from "react-i18next";
import { clsx } from "clsx";

import type {  LogEntry, LogsViewProps, TimeRange  } from "./types";
import { getProfileDetails, getProfileAccessPoints, getProfileAnalytics, getProfileLogs } from "../../services";
import type { AccessPoint } from "../../services";
import { useIsMobile } from "../../hooks/useIsMobile";
import { LogsHeader } from "./components/LogsHeader";
import { LogsTable } from "./components/LogsTable";
import { LogsList } from "./components/LogsList";
import { LogDetailsDrawer } from "./components/LogDetailsDrawer";

const PAGE_SIZE = 50;
const PAGE_SIZE_IN_REALTIME = 25;

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
  const [accessPointIdFilter, setAccessPointIdFilter] = useState<string | null>(null);
  const [accessPoints, setAccessPoints] = useState<AccessPoint[]>([]);
  const [destCountryFilter, setDestCountryFilter] = useState<string | null>(null);
  const [countries, setCountries] = useState<{ country_code: string; country: string }[]>([]);
  const [ispFilter, setIspFilter] = useState<string | null>(null);
  const [isps, setIsps] = useState<{ name: string; count: number }[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [hasMore, setHasMore] = useState(true);
  const [realtimeRefresh, setRealtimeRefresh] = useState(false);
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

  useEffect(() => {
    getProfileAccessPoints(profileId)
      .then(setAccessPoints)
      .catch(console.error);
  }, [profileId]);

  useEffect(() => {
    getProfileAnalytics(profileId, "destinations", "range=30d")
      .then((data) => {
        if (Array.isArray(data)) {
          const filtered = data
            .filter((item: any) => item.country_code)
            .map((item: any) => ({
              country_code: item.country_code,
              country: item.country || item.country_code,
            }));
          setCountries(filtered);
        }
      })
      .catch((e) => console.error("Failed to fetch destinations for filter", e));
  }, [profileId]);

  useEffect(() => {
    setIspFilter(null);
    const params = new URLSearchParams({ range: "30d" });
    if (destCountryFilter) {
      params.set("country_code", destCountryFilter);
    }
    getProfileAnalytics(profileId, "isps", params.toString())
      .then((data) => {
        if (Array.isArray(data)) {
          setIsps(data);
        }
      })
      .catch((e) => console.error("Failed to fetch ISPs for filter", e));
  }, [profileId, destCountryFilter]);

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
        fetchLogs(range, true, true);
      }
    }, 2000);
    return () => clearInterval(autoRefreshTimer);
  }, [profileId, range, searchQuery, realtimeRefresh, statusFilter, accessPointIdFilter, destCountryFilter, ispFilter]);

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
        accessPointIdFilter={accessPointIdFilter}
        setAccessPointIdFilter={setAccessPointIdFilter}
        accessPoints={accessPoints}
        destCountryFilter={destCountryFilter}
        setDestCountryFilter={setDestCountryFilter}
        countries={countries}
        ispFilter={ispFilter}
        setIspFilter={setIspFilter}
        isps={isps}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        stats={stats}
        logRetentionDays={logRetentionDays}
      />

      <div ref={scrollContainerRef} className={clsx("flex-1 overflow-y-auto relative", isMobile ? "px-1" : "px-4")}>
        {logs.length === 0 && !loading ? (
          <div className="py-20">
            <Callout title={searchQuery ? t("logs.noResults") : t("logs.noRecords")} icon={searchQuery ? "search" : "outdated"}>
              {searchQuery ? t("logs.noResultsDesc", { query: searchQuery }) : t("logs.noRecordsDesc")}
            </Callout>
          </div>
        ) : isMobile ? (
          <LogsList
            logs={logs}
            setSelectedLog={setSelectedLog}
            setIsDrawerOpen={setIsDrawerOpen}
            lastLogElementRef={lastLogElementRef}
            prevLatestTimestamp={prevLatestTimestamp}
            realtimeRefresh={realtimeRefresh}
          />
        ) : (
          <LogsTable
            logs={logs}
            setSelectedLog={setSelectedLog}
            setIsDrawerOpen={setIsDrawerOpen}
            lastLogElementRef={lastLogElementRef}
            prevLatestTimestamp={prevLatestTimestamp}
            realtimeRefresh={realtimeRefresh}
          />
        )}

        <div className="p-6 flex flex-col items-center">
          {loadingMore ? (
            <Spinner size={16} />
          ) : realtimeRefresh ? (
            logs.length > 0 && <span className="text-[10px] opacity-30 italic">{t("logs.realtimeLoadMoreTip")}</span>
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
        profileId={profileId}
        isMobile={isMobile}
        onQuickAction={onQuickAction}
      />
    </div>
  );
};
