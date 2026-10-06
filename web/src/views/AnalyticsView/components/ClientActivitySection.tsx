import React from "react";
import { Section, HTMLTable, Tag } from "@blueprintjs/core";
import { Globe } from "lucide-react";
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
              <td className="font-mono text-xs">{c.client_ip || "-"}</td>
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
