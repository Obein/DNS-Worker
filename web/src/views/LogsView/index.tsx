import React, { useState } from "react";
import { Spinner } from "@blueprintjs/core";

import type { LogEntry, LogsViewProps } from "./types";
import { useIsMobile } from "../../hooks/useIsMobile";
import { LogsHeader } from "./components/LogsHeader";
import { LogsContent } from "./components/LogsContent";
import { LogDetailsDrawer } from "./components/LogDetailsDrawer";
import { useLogs } from "./hooks/useLogs";

export const LogsView: React.FC<LogsViewProps> = ({ profileId, onQuickAction, toasterRef }) => {
  const isMobile = useIsMobile();
  const [selectedLog, setSelectedLog] = useState<LogEntry | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  const {
    // states
    realtimeRefresh,
    setRealtimeRefresh,

    // filters
    range,
    setRange,
    customRange,
    setCustomRange,
    statusFilter,
    setStatusFilter,
    accessPointIdFilter,
    setAccessPointIdFilter,
    accessPoints,
    destCountryFilter,
    setDestCountryFilter,
    countries,
    ispFilter,
    setIspFilter,
    isps,
    searchQuery,
    setSearchQuery,

    // data
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

    // export
    exporting,
    handleExportLogs,
  } = useLogs({ profileId, toasterRef });

  const nowStr = new Date().toLocaleString("sv-SE").replace(" ", "T").slice(0, 16);

  if (loading && logs.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <Spinner />
      </div>
    );
  }

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
        onExport={handleExportLogs}
        exporting={exporting}
      />

      <LogsContent
        logs={logs}
        loading={loading}
        loadingMore={loadingMore}
        hasMore={hasMore}
        realtimeRefresh={realtimeRefresh}
        isMobile={isMobile}
        searchQuery={searchQuery}
        scrollContainerRef={scrollContainerRef}
        lastLogElementRef={lastLogElementRef}
        prevLatestTimestamp={prevLatestTimestamp}
        setSelectedLog={setSelectedLog}
        setIsDrawerOpen={setIsDrawerOpen}
      />

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
