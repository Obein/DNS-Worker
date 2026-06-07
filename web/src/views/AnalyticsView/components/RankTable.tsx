import React from "react";
import { Card, Elevation, H5, HTMLTable, Tag, Intent } from "@blueprintjs/core";
import { useTranslation } from "react-i18next";

export interface RankTableProps {
  title: string;
  data: { domain: string; count: number }[];
  intent: Intent;
}

export const RankTable: React.FC<RankTableProps> = ({ title, data, intent }) => {
  const { t } = useTranslation();
  return (
    <Card elevation={Elevation.ZERO} className="dark:bg-gray-900 dark:border-gray-800 border border-gray-100 shadow-sm">
      <H5 className="mb-4 font-bold">{title}</H5>
      <HTMLTable striped className="w-full">
        <tbody>
          {data.map((d, i) => (
            <tr key={i}>
              <td className="w-8 opacity-30 font-mono text-xs">{i + 1}</td>
              <td className="font-medium text-sm truncate max-w-50">{d.domain}</td>
              <td className="text-right">
                <Tag minimal intent={intent} className="font-bold">
                  {d.count}
                </Tag>
              </td>
            </tr>
          ))}
          {data.length === 0 && (
            <tr>
              <td colSpan={3} className="text-center py-8 opacity-50">
                {t("analytics.noData")}
              </td>
            </tr>
          )}
        </tbody>
      </HTMLTable>
    </Card>
  );
};
