import React from "react";
import { Card, Elevation, H5, HTMLTable, Tag, Intent } from "@blueprintjs/core";
import { useTranslation } from "react-i18next";

export interface RankTableProps {
  title: string;
  data: { domain: string; count: number }[];
  intent: Intent;
}

interface ColumnConfig {
  key: string;
  cellClassName?: string;
  render: (row: { domain: string; count: number }, index: number) => React.ReactNode;
}

export const RankTable: React.FC<RankTableProps> = ({ title, data, intent }) => {
  const { t } = useTranslation();

  const columns: ColumnConfig[] = [
    {
      key: "rank",
      cellClassName: "w-8 opacity-30 font-mono text-xs",
      render: (_: { domain: string; count: number }, i: number): React.ReactNode => i + 1,
    },
    {
      key: "domain",
      cellClassName: "font-medium text-sm truncate max-w-50",
      render: (d: { domain: string; count: number }): React.ReactNode => d.domain,
    },
    {
      key: "count",
      cellClassName: "text-right",
      render: (d: { domain: string; count: number }): React.ReactNode => (
        <Tag minimal intent={intent} className="font-bold">
          {d.count}
        </Tag>
      ),
    },
  ];

  return (
    <Card elevation={Elevation.ZERO} className="dark:bg-gray-900 dark:border-gray-800 border border-gray-100 shadow-sm">
      <H5 className="mb-4 font-bold">{title}</H5>
      <HTMLTable striped className="w-full">
        <tbody>
          {data.map((d, i) => (
            <tr key={i}>
              {columns.map((col) => (
                <td key={col.key} className={col.cellClassName}>
                  {col.render(d, i)}
                </td>
              ))}
            </tr>
          ))}
          {data.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="text-center py-8 opacity-50">
                {t("analytics.noData")}
              </td>
            </tr>
          )}
        </tbody>
      </HTMLTable>
    </Card>
  );
};
