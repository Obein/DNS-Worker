import React, { useState } from "react";
import { Spinner } from "@blueprintjs/core";

import type { LogEntry, LogsViewProps } from "./types";
import { useIsMobile } from "../../hooks/useIsMobile";
import { LogsHeader } from "./components/LogsHeader";
import { LogsContent } from "./components/LogsContent";
import { LogDetailsDrawer } from "./components/LogDetailsDrawer";
import { E2eeUnlockBanner } from "./components/E2eeUnlockBanner";
import { UnlockWithRecoveryDialog } from "./components/UnlockWithRecoveryDialog";
import { RotatedKeyNotificationDialog } from "./components/RotatedKeyNotificationDialog";
import { useLogs } from "./hooks/useLogs";
import { useLogsE2ee } from "./hooks/useLogsE2ee";

export const LogsView: React.FC<LogsViewProps> = ({ profileId, onQuickAction, toasterRef }) => {
  const isMobile = useIsMobile();
  const [selectedLog, setSelectedLog] = useState<LogEntry | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState<boolean>(false);

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
    ispFilter,
    setIspFilter,
    searchQuery,
    setSearchQuery,

    // data
    logs,
    loading,
    loadingMore,
    syncing,
    hasMore,
    stats,
    logRetentionDays,
    prevLatestTimestamp,
    scrollContainerRef,
    lastLogElementRef,
    fetchLogs,

    // export
    exporting,
    handleExportLogs
  } = useLogs({ profileId, toasterRef });

  const {
    isE2eeEnabled,
    isE2eeUnlocked,
    unlocking,
    recoveryDialogOpen,
    setRecoveryDialogOpen,
    recoveryKeyInput,
    setRecoveryKeyInput,
    recoveryError,
    setRecoveryError,
    rotatedKey,
    setRotatedKey,
    copiedKey,
    handleCopyRotatedKey,
    handleUnlockPasskey,
    handleUnlockRecoveryKey
  } = useLogsE2ee({
    profileId,
    range,
    fetchLogs,
    toasterRef
  });

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
        profileId={profileId}
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
        ispFilter={ispFilter}
        setIspFilter={setIspFilter}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        stats={stats}
        logRetentionDays={logRetentionDays}
        onExport={handleExportLogs}
        exporting={exporting}
        loading={loading}
        syncing={syncing}
      />

      {isE2eeEnabled && !isE2eeUnlocked && (
        <E2eeUnlockBanner
          isMobile={isMobile}
          unlocking={unlocking}
          onUnlockPasskey={handleUnlockPasskey}
          onOpenRecoveryDialog={() => {
            setRecoveryError("");
            setRecoveryKeyInput("");
            setRecoveryDialogOpen(true);
          }}
        />
      )}

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
        logRetentionDays={logRetentionDays}
      />

      <LogDetailsDrawer
        isDrawerOpen={isDrawerOpen}
        setIsDrawerOpen={setIsDrawerOpen}
        selectedLog={selectedLog}
        profileId={profileId}
        isMobile={isMobile}
        onQuickAction={onQuickAction}
      />

      <UnlockWithRecoveryDialog
        isOpen={recoveryDialogOpen}
        onClose={() => setRecoveryDialogOpen(false)}
        recoveryKeyInput={recoveryKeyInput}
        setRecoveryKeyInput={setRecoveryKeyInput}
        recoveryError={recoveryError}
        unlocking={unlocking}
        onSubmit={handleUnlockRecoveryKey}
      />

      <RotatedKeyNotificationDialog
        rotatedKey={rotatedKey}
        onClose={() => setRotatedKey(null)}
        copiedKey={copiedKey}
        onCopyKey={handleCopyRotatedKey}
      />
    </div>
  );
};
