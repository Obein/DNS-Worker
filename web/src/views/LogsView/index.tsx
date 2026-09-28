import React, { useState, useEffect, useCallback } from "react";
import { Spinner, Callout, Button, Intent } from "@blueprintjs/core";
import { useTranslation } from "react-i18next";
import { clsx } from "clsx";

import type { LogEntry, LogsViewProps } from "./types";
import { useIsMobile } from "../../hooks/useIsMobile";
import { LogsHeader } from "./components/LogsHeader";
import { LogsContent } from "./components/LogsContent";
import { LogDetailsDrawer } from "./components/LogDetailsDrawer";
import { useLogs } from "./hooks/useLogs";
import { e2ee, localDb } from "../../services";

export const LogsView: React.FC<LogsViewProps> = ({ profileId, onQuickAction, toasterRef }) => {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const [selectedLog, setSelectedLog] = useState<LogEntry | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isE2eeEnabled, setIsE2eeEnabled] = useState(false);
  const [isE2eeUnlocked, setIsE2eeUnlocked] = useState(false);
  const [unlocking, setUnlocking] = useState(false);

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

  const checkE2ee = useCallback(async () => {
    try {
      const status = await e2ee.getStatus(profileId);
      setIsE2eeEnabled(status.enabled);
      setIsE2eeUnlocked(e2ee.isProfileUnlocked(profileId));
    } catch {
      setIsE2eeEnabled(false);
    }
  }, [profileId]);

  useEffect(() => {
    checkE2ee();
  }, [checkE2ee]);

  const handleUnlockE2ee = async () => {
    try {
      setUnlocking(true);
      const success = await e2ee.unlockProfile(profileId);
      if (success) {
        setIsE2eeUnlocked(true);
        await localDb.reDecryptLocalLogs(profileId);
        toasterRef?.current?.show({
          message: t("settings.e2eeUnlockSuccess"),
          intent: Intent.SUCCESS,
        });
        fetchLogs(range, true);
      }
    } catch (err: any) {
      console.error("Failed to unlock E2EE:", err);
      toasterRef?.current?.show({
        message: err.message || t("settings.e2eeUnlockError"),
        intent: Intent.DANGER,
      });
    } finally {
      setUnlocking(false);
    }
  };

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
      />

      {isE2eeEnabled && !isE2eeUnlocked && (
        <div className={clsx("mb-2 shrink-0", isMobile ? "px-2" : "px-4")}>
          <Callout
            intent={Intent.PRIMARY}
            icon="lock"
            title={t("settings.e2eeTitle")}
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mt-1">
              <p className="text-xs opacity-80 m-0">
                {t("settings.e2eeUnlockPrompt")}
              </p>
              <Button
                intent={Intent.PRIMARY}
                icon="key"
                small
                loading={unlocking}
                onClick={handleUnlockE2ee}
                className="shrink-0 font-medium"
              >
                {t("settings.e2eeUnlockNow")}
              </Button>
            </div>
          </Callout>
        </div>
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
    </div>
  );
};
