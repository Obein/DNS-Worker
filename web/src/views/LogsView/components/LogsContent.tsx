import React, { useState, useEffect, useCallback } from "react";
import { Spinner, Callout, Intent } from "@blueprintjs/core";
import { ArrowUp } from "lucide-react";
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
  const [showScrollTop, setShowScrollTop] = useState<boolean>(false);

  const checkScroll = useCallback(() => {
    if (scrollContainerRef.current) {
      setShowScrollTop(scrollContainerRef.current.scrollTop > 300);
    }
  }, [scrollContainerRef]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    container.addEventListener("scroll", checkScroll, { passive: true });
    checkScroll();

    return () => {
      container.removeEventListener("scroll", checkScroll);
    };
  }, [scrollContainerRef, checkScroll, logs]);

  const scrollToTop = () => {
    scrollContainerRef.current?.scrollTo({
      top: 0,
      behavior: "smooth"
    });
  };

  return (
    <div className="flex-1 relative overflow-hidden flex flex-col min-h-0">
      <div
        ref={scrollContainerRef}
        onScroll={checkScroll}
        className={clsx("flex-1 overflow-y-auto", isMobile ? "px-1" : "px-0")}
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

      {/* Semi-Transparent Scroll-to-Top Button */}
      <div
        className={clsx(
          "absolute z-30 pointer-events-none transition-all duration-300 ease-out",
          isMobile ? "bottom-20 right-3" : "bottom-6 right-6",
          showScrollTop
            ? "opacity-100 translate-y-0"
            : "opacity-0 translate-y-3"
        )}
      >
        <button
          type="button"
          onClick={scrollToTop}
          aria-label={t("logs.scrollToTop")}
          title={t("logs.scrollToTop")}
          className={clsx(
            "pointer-events-auto group inline-flex items-center gap-1.5 rounded-full select-none",
            "backdrop-blur-md bg-white/70 dark:bg-gray-900/70 hover:bg-white/90 dark:hover:bg-gray-800/90",
            "border border-gray-200/80 dark:border-gray-700/80 hover:border-gray-300 dark:hover:border-gray-600",
            "text-gray-700 dark:text-gray-200 hover:text-gray-950 dark:hover:text-white",
            "shadow-sm hover:shadow active:scale-95 transition-all duration-200 cursor-pointer",
            isMobile ? "px-2.5 py-1.5 text-[11px]" : "px-3.5 py-2 text-xs"
          )}
        >
          <ArrowUp
            size={isMobile ? 13 : 15}
            strokeWidth={2.4}
            className="transition-transform duration-200 group-hover:scale-105"
          />
        </button>
      </div>
    </div>
  );
};
