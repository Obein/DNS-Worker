import React from "react";
import { Section, HTMLTable, Tag } from "@blueprintjs/core";
import { Globe, Lock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { getFlagEmoji } from "../../../utils/getFlagEmoji";
import type { AnalyticsData } from "../types";

export interface ClientActivitySectionProps {
  clients?: AnalyticsData["clients"];
}

export const ClientActivitySection: React.FC<ClientActivitySectionProps> = ({ clients }) => {
  const { t } = useTranslation();

  return (
    <Section title={t("analytics.clientActivity")} icon={<Globe size={16} />}>
      <HTMLTable striped className="w-full mt-2">
        <thead>
          <tr>
            <th className="text-xs uppercase opacity-60">{t("analytics.ipAddress")}</th>
            <th className="text-xs uppercase opacity-60">{t("analytics.location")}</th>
            <th className="text-xs uppercase opacity-60 text-right">{t("analytics.queries")}</th>
          </tr>
        </thead>
        <tbody>
          {clients?.map((c, i) => (
            <tr key={i}>
              <td className="font-mono text-xs">
                {c.client_ip === "[Encrypted]" ? (
                  <span className="inline-flex items-center gap-1.5 text-gray-400 dark:text-gray-500 italic">
                    <Lock size={12} className="text-amber-500 shrink-0" />
                    <span>{t("logs.encryptedRecord", "[加密记录]")}</span>
                  </span>
                ) : c.client_ip === "[Decryption Failed]" ? (
                  <span className="inline-flex items-center gap-1.5 text-red-400 dark:text-red-500 italic">
                    <Lock size={12} className="text-red-500 shrink-0" />
                    <span>{t("logs.decryptionFailed", "[解密失败]")}</span>
                  </span>
                ) : (
                  c.client_ip || "-"
                )}
              </td>
              <td>
                <Tag minimal>{getFlagEmoji(c.geo_country)}</Tag>
              </td>
              <td className="text-right font-bold">{c.count}</td>
            </tr>
          ))}
          {(!clients || clients.length === 0) && (
            <tr>
              <td colSpan={3} className="text-center py-8 opacity-50">
                {t("analytics.noData")}
              </td>
            </tr>
          )}
        </tbody>
      </HTMLTable>
    </Section>
  );
};
