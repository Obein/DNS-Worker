import React from "react";
import { Zap, ShieldAlert, RotateCcw, Shield, Globe } from "lucide-react";
import { useTranslation } from "react-i18next";
import { MetricCard } from "./MetricCard";
import type { AnalyticsData } from "../types";

export interface AnalyticsMetricCardsProps {
  data: AnalyticsData | null;
}

export const AnalyticsMetricCards: React.FC<AnalyticsMetricCardsProps> = ({ data }) => {
  const { t } = useTranslation();

  const total = data?.summary.reduce((acc, s) => acc + s.count, 0) || 0;
  const blocked = data?.summary.find((s) => s.action === "BLOCK")?.count || 0;
  const redirected = data?.summary.find((s) => s.action === "REDIRECT")?.count || 0;
  const blockRate = total > 0 ? ((blocked / total) * 100).toFixed(1) : "0.0";

  const cards = [
    {
      title: t("analytics.totalQueries"),
      value: total.toLocaleString(),
      icon: <Zap className="text-blue-500" size={20} />
    },
    {
      title: t("analytics.blocked"),
      value: blocked.toLocaleString(),
      icon: <ShieldAlert className="text-red-500" size={20} />
    },
    {
      title: t("analytics.redirected"),
      value: redirected.toLocaleString(),
      icon: <RotateCcw className="text-amber-500" size={20} />
    },
    {
      title: t("analytics.blockRate"),
      value: `${blockRate}%`,
      icon: <Shield className="text-green-500" size={20} />
    },
    {
      title: t("analytics.activeIPs"),
      value: data?.clients.length.toString() || "0",
      icon: <Globe className="text-purple-500" size={20} />
    }
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-2 lg:gap-4">
      {cards.map((config, index) => (
        <MetricCard
          key={index}
          title={config.title}
          value={config.value}
          icon={config.icon}
        />
      ))}
    </div>
  );
};
