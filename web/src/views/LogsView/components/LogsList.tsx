import React from "react";
import { Card, Tag, Intent } from "@blueprintjs/core";
import { clsx } from "clsx";
import type {  LogEntry  } from "../types";

export interface LogsListProps {
  logs: LogEntry[];
  setSelectedLog: (log: LogEntry) => void;
  setIsDrawerOpen: (open: boolean) => void;
  lastLogElementRef: (node: HTMLDivElement | null) => void;
  prevLatestTimestamp: number | null;
  realtimeRefresh: boolean;
}

export const LogsList: React.FC<LogsListProps> = ({
  logs,
  setSelectedLog,
  setIsDrawerOpen,
  lastLogElementRef,
  prevLatestTimestamp,
  realtimeRefresh,
}) => {
  return (
    <div className="space-y-3 py-4">
      {logs.map((log, idx) => {
        const isNew = realtimeRefresh && prevLatestTimestamp !== null && log.timestamp > prevLatestTimestamp;
        return (
          <Card
            key={log.id}
            interactive
            onClick={() => {
              setSelectedLog(log);
              setIsDrawerOpen(true);
            }}
            className={clsx(
              "p-3 dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden",
              { "animate-row-glow": isNew }
            )}
            ref={idx === logs.length - 1 ? lastLogElementRef : null}
          >
          <div className="flex justify-between items-start mb-2">
            <div className="flex items-center gap-2 min-w-0">
              <img
                src={`/api/icon/${log.domain.replace(/^\*\./, "")}.ico`}
                className="w-4 h-4 rounded-sm shrink-0"
                alt=""
                referrerPolicy="no-referrer"
                onError={(e) => (e.currentTarget.style.opacity = "0")}
              />
              <span className="font-bold text-sm truncate">{log.domain}</span>
            </div>
            <Tag
              minimal
              round
              intent={
                log.action === "PASS"
                  ? Intent.SUCCESS
                  : log.action === "BLOCK"
                  ? Intent.DANGER
                  : Intent.WARNING
              }
              className="text-[10px] shrink-0"
            >
              {log.action}
            </Tag>
          </div>
          <div className="flex justify-between items-center">
            <div className="flex gap-2 items-center">
              <span className="text-[10px] font-mono opacity-50">
                {new Date(log.timestamp * 1000).toLocaleTimeString([], { hour12: false })}
              </span>
              <span className="text-[10px] bg-gray-100 dark:bg-gray-800 px-1 rounded opacity-60">
                {log.record_type}
              </span>
              {log.access_point_name && (
                <span className="text-[10px] opacity-50 truncate max-w-25">
                  {log.access_point_name}
                </span>
              )}
            </div>
            <div className="text-[10px] opacity-40 font-mono italic">
              {log.latency ? `${log.latency}ms` : ""}
            </div>
          </div>
          </Card>
        );
      })}
    </div>
  );
};
