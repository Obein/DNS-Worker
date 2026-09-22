import React from "react";
import { HTMLTable, Tag, Intent } from "@blueprintjs/core";
import { useTranslation } from "react-i18next";
import { formatDateTime } from "../../../utils/date";
import type {  FilterList  } from "../types";

export interface ListsTableProps {
  lists: FilterList[];
  onSelect: (list: FilterList) => void;
}

interface ColumnConfig {
  key: string;
  header: React.ReactNode;
  headerClassName?: string;
  cellClassName?: string;
  render: (list: FilterList) => React.ReactNode;
}

export const ListsTable: React.FC<ListsTableProps> = ({ lists, onSelect }) => {
  const { t } = useTranslation();

  const columns: ColumnConfig[] = [
    {
      key: "url",
      header: t("filtering.tableUrl"),
      cellClassName: "font-mono text-sm max-w-md truncate",
      render: (list: FilterList): React.ReactNode => list.url,
    },
    {
      key: "lastSync",
      header: t("filtering.tableLastSync"),
      cellClassName: "text-xs opacity-60",
      render: (list: FilterList): React.ReactNode =>
        list.last_synced_at
          ? formatDateTime(new Date(list.last_synced_at * 1000))
          : t("filtering.neverSynced"),
    },
    {
      key: "status",
      header: t("filtering.tableStatus"),
      render: (list: FilterList): React.ReactNode => {
        // A disabled list contributes nothing to the merged bloom, so reporting
        // it by sync freshness would contradict the switch in the details dialog.
        if (!list.enabled) {
          return (
            <Tag intent={Intent.NONE} minimal>
              {t("filtering.statusDisabled", "Disabled")}
            </Tag>
          );
        }

        const hasError = !!list.sync_error;
        const hasSynced = !!list.last_synced_at;
        
        let statusText = t("filtering.statusNormal", "Active");
        let intent: Intent = Intent.SUCCESS;
        
        if (hasError) {
          if (hasSynced) {
            statusText = t("filtering.statusOutdated", "Outdated");
            intent = Intent.WARNING;
          } else {
            statusText = t("filtering.statusMissing", "Missing");
            intent = Intent.DANGER;
          }
        }
        
        return (
          <Tag intent={intent} minimal>
            {statusText}
          </Tag>
        );
      },
    },
  ];

  return (
    <div className="w-full max-w-full overflow-x-auto pb-4">
      <HTMLTable interactive striped className="w-full min-w-max whitespace-nowrap">
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.key} className={col.headerClassName}>
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lists.map((list) => (
            <tr key={list.id} onClick={() => onSelect(list)} className="cursor-pointer">
              {columns.map((col) => (
                <td key={col.key} className={col.cellClassName}>
                  {col.render(list)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </HTMLTable>
    </div>
  );
};
