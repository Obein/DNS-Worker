import React, { useState, useEffect, useCallback } from "react";
import { Card, Elevation, H4, Tag, Button, Intent, HTMLTable, Spinner } from "@blueprintjs/core";
import { Activity, RefreshCw, ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatDateTime } from "../../../utils/date";
import { ACTION_META } from "../constants";
import type {  ActivityEntry  } from "../types";

export const ActivityLogCard: React.FC = () => {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const [expanded, setExpanded] = useState(false);

  const fetchActivity = useCallback(async (before?: number) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "20" });
      if (before) params.set("before", String(before));
      const res = await fetch(`/api/account/activity?${params}`);
      if (res.ok) {
        const data: ActivityEntry[] = await res.json();
        if (before) {
          setEntries((prev) => [...prev, ...data]);
        } else {
          setEntries(data);
        }
        setHasMore(data.length === 20);
      }
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchActivity();
  }, [fetchActivity]);

  const handleLoadMore = () => {
    const last = entries[entries.length - 1];
    if (last) fetchActivity(last.timestamp);
  };

  const getActionMeta = (action: string) =>
    ACTION_META[action] ?? {
      label: action,
      icon: <Activity size={14} />,
      intent: Intent.NONE,
    };

  return (
    <Card elevation={Elevation.ONE}>
      <div
        className="flex items-center justify-between cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          <Activity size={20} className="text-purple-500" />
          <H4 style={{ margin: 0 }}>
            {t("account.activity.title", "Account Activity")}
          </H4>
          {entries.length > 0 && (
            <Tag minimal round intent={Intent.NONE}>
              {entries.length}
              {hasMore ? "+" : ""}
            </Tag>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            minimal
            icon={<RefreshCw size={14} />}
            onClick={(e) => {
              e.stopPropagation();
              fetchActivity();
            }}
          />
          <ChevronDown
            size={16}
            className={`text-gray-400 transition-transform ${
              expanded ? "rotate-180" : ""
            }`}
          />
        </div>
      </div>

      {expanded && (
        <div className="mt-4">
          {loading && entries.length === 0 ? (
            <div className="flex justify-center py-8">
              <Spinner size={24} />
            </div>
          ) : entries.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-6">
              {t("account.activity.empty", "No activity recorded yet.")}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <HTMLTable interactive striped className="w-full text-sm">
                <thead>
                  <tr>
                    <th>{t("account.activity.action", "Action")}</th>
                    <th>{t("account.activity.time", "Time")}</th>
                    <th>{t("account.activity.ip", "IP Address")}</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => {
                    const meta = getActionMeta(entry.action);
                    return (
                      <tr key={entry.id}>
                        <td>
                          <Tag minimal intent={meta.intent} icon={meta.icon as any}>
                            {t(meta.label, entry.action)}
                          </Tag>
                        </td>
                        <td className="text-xs text-gray-500 whitespace-nowrap">
                          {formatDateTime(new Date(entry.timestamp * 1000))}
                        </td>
                        <td className="font-mono text-xs text-gray-500">
                          {entry.ip_address || "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </HTMLTable>
              {hasMore && (
                <div className="flex justify-center mt-3">
                  <Button
                    minimal
                    loading={loading}
                    text={t("account.activity.loadMore", "Load More")}
                    onClick={handleLoadMore}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  );
};
