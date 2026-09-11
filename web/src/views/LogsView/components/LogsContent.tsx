import React from "react";
import { Spinner, Callout, Intent } from "@blueprintjs/core";
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
  logRetentionDays?: number;
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
  logRetentionDays,
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
            title={
              logRetentionDays === 0
                ? t("logs.loggingDisabledTitle", "日志记录已关闭")
                : searchQuery
                ? t("logs.noResults")
                : t("logs.noRecords")
            }
            icon={logRetentionDays === 0 ? "disable" : searchQuery ? "search" : "outdated"}
            intent={logRetentionDays === 0 ? Intent.WARNING : Intent.NONE}
          >
            {logRetentionDays === 0
              ? t("logs.loggingDisabledDesc", "当前配置的日志留存已设置为“关闭”，系统不记录任何查询日志。如需查看，请在设置中启用日志留存。")
              : searchQuery
              ? t("logs.noResultsDesc", { query: searchQuery })
              : t("logs.noRecordsDesc")}
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
