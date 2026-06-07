import React from "react";
import { HTMLTable, Tag, Button, Intent } from "@blueprintjs/core";
import { Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatDateTime } from "../../../utils/date";
import type {  FilterList  } from "../types";

export interface ListsTableProps {
  lists: FilterList[];
  onSelect: (list: FilterList) => void;
  onDelete: (id: number) => void;
}

export const ListsTable: React.FC<ListsTableProps> = ({ lists, onSelect, onDelete }) => {
  const { t } = useTranslation();

  return (
    <HTMLTable interactive striped className="w-full">
      <thead>
        <tr>
          <th>{t("filtering.tableUrl")}</th>
          <th>{t("filtering.tableLastSync")}</th>
          <th>{t("filtering.tableStatus")}</th>
          <th className="text-right">{t("filtering.tableOps")}</th>
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
              <Tag intent={list.enabled ? Intent.SUCCESS : Intent.NONE} minimal>
                {list.enabled ? t("filtering.enabled") : t("filtering.disabled")}
              </Tag>
            </td>
            <td className="text-right" onClick={(e) => e.stopPropagation()}>
              <Button
                icon={<Trash2 size={14} />}
                variant="minimal"
                intent={Intent.DANGER}
                onClick={() => onDelete(list.id)}
              />
            </td>
          </tr>
        ))}
      </tbody>
    </HTMLTable>
  );
};
