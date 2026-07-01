import React from "react";
import { Spinner, Callout } from "@blueprintjs/core";
import { useTranslation } from "react-i18next";
import { clsx } from "clsx";
import type { LogEntry } from "../types";
import { LogsList } from "./LogsList";
import { LogsTable } from "./LogsTable";

interface LogsContentProps {
  logs: LogEntry[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  realtimeRefresh: boolean;
  isMobile: boolean;
  searchQuery: string;
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  lastLogElementRef: (node: HTMLDivElement | null) => void;
  prevLatestTimestamp: number | null;
  setSelectedLog: (log: LogEntry | null) => void;
  setIsDrawerOpen: (isOpen: boolean) => void;
}

export const LogsContent: React.FC<LogsContentProps> = ({
  logs,
  loading,
  loadingMore,
  hasMore,
  realtimeRefresh,
  isMobile,
  searchQuery,
  scrollContainerRef,
  lastLogElementRef,
  prevLatestTimestamp,
  setSelectedLog,
  setIsDrawerOpen,
}) => {
  const { t } = useTranslation();

  return (
    <div
      ref={scrollContainerRef}
      className={clsx("flex-1 overflow-y-auto relative", isMobile ? "px-1" : "px-4")}
    >
      {logs.length === 0 && !loading ? (
        <div className="py-20">
          <Callout
            title={searchQuery ? t("logs.noResults") : t("logs.noRecords")}
            icon={searchQuery ? "search" : "outdated"}
          >
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
  );
};
