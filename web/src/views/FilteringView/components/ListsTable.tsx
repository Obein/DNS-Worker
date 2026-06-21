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
      render: (list: FilterList): React.ReactNode => (
        <Tag intent={list.enabled ? Intent.SUCCESS : Intent.DANGER} minimal>
          {list.enabled ? t("filtering.enabled") : t("filtering.disabled")}
        </Tag>
      ),
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
