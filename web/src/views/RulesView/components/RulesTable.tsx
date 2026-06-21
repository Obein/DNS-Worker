import React from "react";
import { HTMLTable, Tag, Intent } from "@blueprintjs/core";
import { ShieldX, CheckCircle, ArrowRightLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import type {  Rule  } from "../types";

export interface RulesTableProps {
  rules: Rule[];
  startEdit: (rule: Rule) => void;
  getBlockDetail: () => string;
}

interface ColumnConfig {
  key: string;
  header: React.ReactNode;
  headerClassName?: string;
  cellClassName?: string;
  render: (rule: Rule) => React.ReactNode;
}

export const RulesTable: React.FC<RulesTableProps> = ({ rules, startEdit, getBlockDetail }) => {
  const { t } = useTranslation();

  const columns: ColumnConfig[] = [
    {
      key: "action",
      header: t("rules.tableAction"),
      headerClassName: "w-32",
      render: (rule: Rule): React.ReactNode => (
        <>
          {rule.type === "BLOCK" && (
            <Tag intent={Intent.DANGER} minimal icon={<ShieldX size={12} className="mr-1" />}>
              {t("rules.labelBlock")}
            </Tag>
          )}
          {rule.type === "ALLOW" && (
            <Tag intent={Intent.SUCCESS} minimal icon={<CheckCircle size={12} className="mr-1" />}>
              {t("rules.labelAllow")}
            </Tag>
          )}
          {rule.type === "REDIRECT" && (
            <Tag intent={Intent.WARNING} minimal icon={<ArrowRightLeft size={12} className="mr-1" />}>
              {t("rules.labelRedirect")}
            </Tag>
          )}
        </>
      ),
    },
    {
      key: "pattern",
      header: t("rules.tablePattern"),
      headerClassName: "w-1/4",
      cellClassName: "font-mono font-bold",
      render: (rule: Rule): React.ReactNode => rule.pattern,
    },
    {
      key: "details",
      header: t("rules.tableDetails"),
      cellClassName: "py-2",
      render: (rule: Rule): React.ReactNode => (
        <>
          {rule.type === "REDIRECT" ? (
            <div className="flex flex-wrap gap-2">
              {rule.v_a && (
                <Tag minimal className="font-mono text-[10px]">
                  A: {rule.v_a}
                </Tag>
              )}
              {rule.v_aaaa && (
                <Tag minimal className="font-mono text-[10px]">
                  AAAA: {rule.v_aaaa}
                </Tag>
              )}
              {rule.v_cname && (
                <Tag minimal className="font-mono text-[10px]">
                  CNAME: {rule.v_cname}
                </Tag>
              )}
              {rule.v_txt && (
                <Tag minimal className="font-mono text-[10px]">
                  TXT: {rule.v_txt}
                </Tag>
              )}
            </div>
          ) : rule.type === "BLOCK" ? (
            <div className="flex items-center gap-2">
              <span className="text-gray-400 text-xs italic">{t("rules.detailBlock")}</span>
              <Tag minimal round className="text-[9px] px-1.5 opacity-70">
                {getBlockDetail()}
              </Tag>
            </div>
          ) : (
            <span className="text-gray-400 text-xs italic">{t("rules.detailAllow")}</span>
          )}
        </>
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
          {rules.map((rule) => (
            <tr key={rule.id} onClick={() => startEdit(rule)} className="cursor-pointer">
              {columns.map((col) => (
                <td key={col.key} className={col.cellClassName}>
                  {col.render(rule)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </HTMLTable>
    </div>
  );
};
