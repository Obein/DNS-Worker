import React from "react";
import { HTMLTable, Tag, Button, Intent } from "@blueprintjs/core";
import { ShieldX, CheckCircle, ArrowRightLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import type {  Rule  } from "../types";

export interface RulesTableProps {
  rules: Rule[];
  startEdit: (rule: Rule) => void;
  getBlockDetail: () => string;
}

export const RulesTable: React.FC<RulesTableProps> = ({ rules, startEdit, getBlockDetail }) => {
  const { t } = useTranslation();

  return (
    <div className="w-full max-w-full overflow-x-auto pb-4">
      <HTMLTable interactive striped className="w-full min-w-max whitespace-nowrap">
        <thead>
          <tr>
            <th className="w-32">{t("rules.tableAction")}</th>
            <th className="w-1/4">{t("rules.tablePattern")}</th>
            <th>{t("rules.tableDetails")}</th>
          </tr>
        </thead>
        <tbody>
          {rules.map((rule) => (
            <tr key={rule.id} onClick={() => startEdit(rule)} className="cursor-pointer">
              <td>
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
              </td>
              <td className="font-mono font-bold">{rule.pattern}</td>
              <td className="py-2">
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
              </td>
            </tr>
          ))}
        </tbody>
      </HTMLTable>
    </div>
  );
};
