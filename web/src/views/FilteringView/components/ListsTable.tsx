import React from "react";
import { HTMLTable, Tag, Intent } from "@blueprintjs/core";
import { useTranslation } from "react-i18next";
import { formatDateTime } from "../../../utils/date";
import type {  FilterList  } from "../types";

export interface ListsTableProps {
  lists: FilterList[];
  onSelect: (list: FilterList) => void;
}

export const ListsTable: React.FC<ListsTableProps> = ({ lists, onSelect }) => {
  const { t } = useTranslation();

  return (
    <HTMLTable interactive striped className="w-full">
      <thead>
        <tr>
          <th>{t("filtering.tableUrl")}</th>
          <th>{t("filtering.tableLastSync")}</th>
          <th>{t("filtering.tableStatus")}</th>
        </tr>
      </thead>
      <tbody>
        {lists.map((list) => (
          <tr key={list.id} onClick={() => onSelect(list)} className="cursor-pointer">
            <td className="font-mono text-sm max-w-md truncate">{list.url}</td>
            <td className="text-xs opacity-60">
              {list.last_synced_at
                ? formatDateTime(new Date(list.last_synced_at * 1000))
                : t("filtering.neverSynced")}
            </td>
            <td>
              <Tag intent={list.enabled ? Intent.SUCCESS : Intent.DANGER} minimal>
                {list.enabled ? t("filtering.enabled") : t("filtering.disabled")}
              </Tag>
            </td>
          </tr>
        ))}
      </tbody>
    </HTMLTable>
  );
};
