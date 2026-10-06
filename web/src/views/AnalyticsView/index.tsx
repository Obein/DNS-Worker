import React, { Suspense, lazy } from "react";
import {
  Card,
  Elevation,
  H5,
  Spinner,
  Tag,
  Intent,
  Section
} from "@blueprintjs/core";
import { MapPin } from "lucide-react";
import { useTranslation } from "react-i18next";
import { clsx } from "clsx";

import { processTrendData } from "./utils";
import { RankTable } from "./components/RankTable";
import { useIsMobile } from "../../hooks/useIsMobile";
import { useAnalyticsData } from "./hooks/useAnalyticsData";
import { AnalyticsRangeSelector } from "./components/AnalyticsRangeSelector";
import { AnalyticsMetricCards } from "./components/AnalyticsMetricCards";
import { ClientActivitySection } from "./components/ClientActivitySection";

// Lazy-load chart components so that recharts and react19-simple-maps
// are only fetched when the Analytics page is actually rendered.
const TrendChart = lazy(() =>
  import("./components/TrendChart").then((m) => ({ default: m.TrendChart }))
);
const DestinationMap = lazy(() =>
  import("./components/DestinationMap").then((m) => ({ default: m.DestinationMap }))
);

/** Minimal inline spinner used as fallback while lazy chunks load. */
const ChartFallback = () => (
  <div className="h-64 flex items-center justify-center">
    <Spinner size={30} />
  </div>
);

export const AnalyticsView: React.FC<{ profileId: string }> = ({ profileId }) => {
  const { t } = useTranslation();
  const isMobile = useIsMobile();

  const {
    data,
    loading,
    range,
    setRange,
    customRange,
    setCustomRange,
    accessPointIdFilter,
    setAccessPointIdFilter,
    accessPoints,
    logRetentionDays,
    fetchData
  } = useAnalyticsData(profileId);

  if (loading && !data) {
    return (
      <div className="p-20 flex justify-center">
        <Spinner size={50} />
      </div>
    );
  }

  const chartData = processTrendData(data, range, customRange);

  return (
    <div className={clsx("max-w-7xl mx-auto space-y-6", isMobile ? "p-0" : "p-6")}>
      {/* Time Range & Access Point Selector */}
      <AnalyticsRangeSelector
        range={range}
        setRange={setRange}
        customRange={customRange}
        setCustomRange={setCustomRange}
        logRetentionDays={logRetentionDays}
        accessPoints={accessPoints}
        accessPointIdFilter={accessPointIdFilter}
        setAccessPointIdFilter={setAccessPointIdFilter}
        loading={loading}
        onApplyCustom={() => {
          setRange("custom");
          fetchData("custom", customRange.start, customRange.end, accessPointIdFilter);
        }}
      />

      {/* Metrics */}
      <AnalyticsMetricCards data={data} />

      {/* Trend Chart */}
      <Card elevation={Elevation.ONE} className="dark:bg-gray-900 dark:border-gray-800 relative">
        <H5 className="mb-4 font-bold flex items-center gap-2">
          {t("analytics.queryTrend")}
          <Tag minimal round>
            {range === "custom" ? t("analytics.custom") : range.toUpperCase()}
          </Tag>
        </H5>
        <Suspense fallback={<ChartFallback />}>
          <TrendChart chartData={chartData} range={range} />
        </Suspense>
      </Card>

      {/* Ranks */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <RankTable
          title={t("analytics.topAllowed")}
          data={data?.top_allowed || []}
          intent={Intent.SUCCESS}
        />
        <RankTable
          title={t("analytics.topBlocked")}
          data={data?.top_blocked || []}
          intent={Intent.DANGER}
        />
      </div>

      {/* Geolocation & Destinations */}
      <div className="grid gap-6 grid-cols-1">
        <Section
          title={t("analytics.destinationDistribution")}
          icon={<MapPin size={16} />}
        >
          <Suspense fallback={<ChartFallback />}>
            <DestinationMap
              destinations={data?.destinations || []}
              profileId={profileId || ""}
              range={range}
              customRange={customRange}
              accessPointId={accessPointIdFilter || undefined}
            />
          </Suspense>
        </Section>

        {/* Client Activity */}
        <ClientActivitySection clients={data?.clients} />
      </div>
    </div>
  );
};
