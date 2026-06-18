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

export const LogsTable: React.FC<LogsTableProps> = ({
  logs,
  setSelectedLog,
  setIsDrawerOpen,
  lastLogElementRef,
  prevLatestTimestamp,
  realtimeRefresh,
}) => {
  const { t } = useTranslation();

  return (
    <div className="min-w-full inline-block align-middle py-0">
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-visible">
        <HTMLTable interactive striped className="w-full table-fixed">
          <thead className="sticky top-0 z-20 backdrop-blur-md">
            <tr>
              <th className="px-4 py-3 text-xs font-bold uppercase text-gray-500 w-24 bg-white/80 dark:bg-gray-900/80 rounded-tl-xl border-b border-gray-100 dark:border-gray-800">
                {t("logs.tableTime")}
              </th>
              <th className="px-4 py-3 text-xs font-bold uppercase text-gray-500 w-1/4 bg-white/80 dark:bg-gray-900/80 border-b border-gray-100 dark:border-gray-800">
                {t("logs.tableDomain")}
              </th>
              <th className="px-4 py-3 text-xs font-bold uppercase text-gray-500 w-1/4 bg-white/80 dark:bg-gray-900/80 border-b border-gray-100 dark:border-gray-800">
                {t("logs.tableAnswer")}
              </th>
              <th className="px-4 py-3 text-xs font-bold uppercase text-gray-500 w-32 bg-white/80 dark:bg-gray-900/80 border-b border-gray-100 dark:border-gray-800">
                {t("logs.tableSource")}
              </th>
              <th className="px-4 py-3 text-xs font-bold uppercase text-gray-500 w-20 bg-white/80 dark:bg-gray-900/80 border-b border-gray-100 dark:border-gray-800">
                {t("logs.tableType")}
              </th>
              <th className="px-4 py-3 text-xs font-bold uppercase text-gray-500 w-28 bg-white/80 dark:bg-gray-900/80 border-b border-gray-100 dark:border-gray-800">
                {t("logs.tableStatus")}
              </th>
              <th className="px-4 py-3 text-xs font-bold uppercase text-gray-500 bg-white/80 dark:bg-gray-900/80 rounded-tr-xl border-b border-gray-100 dark:border-gray-800">
                {t("logs.tableReason")}
              </th>
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
                  <td className="px-4 py-3 font-mono text-[11px] opacity-60">
                    {new Date(log.timestamp * 1000).toLocaleTimeString([], { hour12: false })}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 truncate">
                      <img
                        src={`https://icons.duckduckgo.com/ip3/${log.domain.replace(/^\*\./, "")}.ico`}
                        className="w-4 h-4 rounded-sm"
                        alt=""
                        referrerPolicy="no-referrer"
                      />
                      <span className="font-bold text-sm truncate">{log.domain}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 truncate font-mono text-[11px] opacity-70">
                    {log.answer || "-"}
                  </td>
                  <td className="px-4 py-3">
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
                  </td>
                  <td className="px-4 py-3 text-center">
                    <code className="text-[10px]">{log.record_type}</code>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span
                      className={clsx("bp6-tag", "bp6-fill", "bp6-minimal", "bp6-round", {
                        "bp6-intent-success": log.action === "PASS",
                        "bp6-intent-danger": log.action === "BLOCK",
                        "bp6-intent-warning": log.action === "REDIRECT",
                      })}
                    >
                      <span className="bp6-text-overflow-ellipsis bp6-fill text-center">{log.action}</span>
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500 italic truncate">{log.reason || "-"}</td>
                </tr>
              );
            })}
          </tbody>
        </HTMLTable>
      </div>
    </div>
  );
};
