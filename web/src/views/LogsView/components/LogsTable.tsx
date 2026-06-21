import React from "react";
import { HTMLTable, Tag } from "@blueprintjs/core";
import { clsx } from "clsx";
import { useTranslation } from "react-i18next";
import type {  LogEntry  } from "../types";
import { getFlagEmoji } from "../../../utils/getFlagEmoji";

export interface LogsTableProps {
  logs: LogEntry[];
  setSelectedLog: (log: LogEntry) => void;
  setIsDrawerOpen: (open: boolean) => void;
  lastLogElementRef: (node: HTMLDivElement | null) => void;
  prevLatestTimestamp: number | null;
  realtimeRefresh: boolean;
}

interface ColumnConfig {
  key: string;
  header: React.ReactNode;
  headerClassName?: string;
  cellClassName?: string;
  render: (log: LogEntry, idx: number) => React.ReactNode;
}

export const LogsTable: React.FC<LogsTableProps> = ({
  logs,
  setSelectedLog,
  setIsDrawerOpen,
  lastLogElementRef,
  prevLatestTimestamp,
  realtimeRefresh,
}) => {
  const { t } = useTranslation();

  const columns: ColumnConfig[] = [
    {
      key: "time",
      header: t("logs.tableTime"),
      headerClassName: "w-24 rounded-tl-xl",
      cellClassName: "font-mono text-[11px] opacity-60",
      render: (log: LogEntry): React.ReactNode =>
        new Date(log.timestamp * 1000).toLocaleTimeString([], { hour12: false }),
    },
    {
      key: "domain",
      header: t("logs.tableDomain"),
      headerClassName: "w-1/4",
      render: (log: LogEntry): React.ReactNode => (
        <div className="flex items-center gap-2 truncate">
          <img
            src={`/api/icon/${log.domain.replace(/^\*\./, "")}.ico`}
            className="w-4 h-4 rounded-sm"
            alt=""
            referrerPolicy="no-referrer"
          />
          <span className="font-bold text-sm truncate">{log.domain}</span>
        </div>
      ),
    },
    {
      key: "answer",
      header: t("logs.tableAnswer"),
      headerClassName: "w-1/4",
      cellClassName: "truncate font-mono text-[11px] opacity-70",
      render: (log: LogEntry): React.ReactNode => log.answer || "-",
    },
    {
      key: "source",
      header: t("logs.tableSource"),
      headerClassName: "w-32",
      render: (log: LogEntry): React.ReactNode => (
        <div className="flex items-center gap-2">
          <Tag minimal className="font-mono text-[10px]">
            {getFlagEmoji(log.geo_country || "UN")}
          </Tag>
          {log.access_point_name && (
            <span className="text-xs opacity-70 truncate max-w-20" title={log.access_point_name}>
              {log.access_point_name}
            </span>
          )}
        </div>
      ),
    },
    {
      key: "type",
      header: t("logs.tableType"),
      headerClassName: "w-20",
      cellClassName: "text-center",
      render: (log: LogEntry): React.ReactNode => <code className="text-[10px]">{log.record_type}</code>,
    },
    {
      key: "status",
      header: t("logs.tableStatus"),
      headerClassName: "w-28",
      cellClassName: "text-center",
      render: (log: LogEntry): React.ReactNode => (
        <span
          className={clsx("bp6-tag", "bp6-fill", "bp6-minimal", "bp6-round", {
            "bp6-intent-success": log.action === "PASS",
            "bp6-intent-danger": log.action === "BLOCK",
            "bp6-intent-warning": log.action === "REDIRECT",
          })}
        >
          <span className="bp6-text-overflow-ellipsis bp6-fill text-center">{log.action}</span>
        </span>
      ),
    },
    {
      key: "reason",
      header: t("logs.tableReason"),
      headerClassName: "rounded-tr-xl",
      cellClassName: "text-xs text-gray-500 italic truncate",
      render: (log: LogEntry): React.ReactNode => log.reason || "-",
    },
  ];

  return (
    <div className="min-w-full inline-block align-middle py-0">
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-visible">
        <HTMLTable interactive striped className="w-full table-fixed">
          <thead className="sticky top-0 z-20 backdrop-blur-md">
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={clsx(
                    "px-4 py-3 text-xs font-bold uppercase text-gray-500 bg-white/80 dark:bg-gray-900/80 border-b border-gray-100 dark:border-gray-800",
                    col.headerClassName
                  )}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {logs.map((log, idx) => {
              const isNew = realtimeRefresh && prevLatestTimestamp !== null && log.timestamp > prevLatestTimestamp;
              return (
                <tr
                  key={log.id}
                  onClick={() => {
                    setSelectedLog(log);
                    setIsDrawerOpen(true);
                  }}
                  className={clsx("cursor-pointer", {
                    "animate-row-glow": isNew,
                  })}
                  ref={idx === logs.length - 1 ? lastLogElementRef : null}
                >
                  {columns.map((col) => (
                    <td key={col.key} className={clsx("px-4 py-3", col.cellClassName)}>
                      {col.render(log, idx)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </HTMLTable>
      </div>
    </div>
  );
};
