import React, { useState, useEffect, Suspense, lazy } from "react";
import {
  Card,
  Elevation,
  H5,
  Spinner,
  Tag,
  Intent,
  HTMLTable,
  Section,
  ButtonGroup,
  Button,
  PopoverNext,
  FormGroup,
  InputGroup,
  HTMLSelect,
} from "@blueprintjs/core";
import { Shield, ShieldAlert, Zap, Globe, MapPin, Calendar, RotateCcw, } from "lucide-react";
import { useTranslation } from "react-i18next";
import { clsx } from "clsx";

import type {  AnalyticsData, TimeRange  } from "./types";
import { processTrendData } from "./utils";
import { getFlagEmoji } from "../../utils/getFlagEmoji";
import { MetricCard } from "./components/MetricCard";
import { RankTable } from "./components/RankTable";
import { getProfileAccessPoints, getProfileDetails, getProfileAnalytics } from "../../services";
import type { AccessPoint } from "../../services";
import { useIsMobile } from "../../hooks/useIsMobile";

// Lazy-load chart components so that recharts and react19-simple-maps
// are only fetched when the Analytics page is actually rendered.
const TrendChart = lazy(() =>
  import("./components/TrendChart").then((m) => ({ default: m.TrendChart })),
);
const DestinationMap = lazy(() =>
  import("./components/DestinationMap").then((m) => ({ default: m.DestinationMap })),
);

/** Minimal inline spinner used as fallback while lazy chunks load. */
const ChartFallback = () => (
  <div className="h-64 flex items-center justify-center">
    <Spinner size={30} />
  </div>
);

export const AnalyticsView: React.FC<{ profileId: string }> = ({ profileId }) => {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const [range, setRange] = useState<TimeRange>("24h");
  const [customRange, setCustomRange] = useState({ start: "", end: "" });
  const [accessPointIdFilter, setAccessPointIdFilter] = useState<string | null>(null);
  const [accessPoints, setAccessPoints] = useState<AccessPoint[]>([]);
  const [logRetentionDays, setLogRetentionDays] = useState<number>(30);

  useEffect(() => {
    getProfileAccessPoints(profileId)
      .then(data => setAccessPoints(data))
      .catch(e => console.error("Failed to load access points", e));
  }, [profileId]);

  // Fetch log retention days from profile settings
  useEffect(() => {
    getProfileDetails(profileId)
      .then((data) => {
        try {
          const settings = JSON.parse(data.settings || "{}");
          setLogRetentionDays(settings.log_retention_days !== undefined ? Number(settings.log_retention_days) : 30);
        } catch (e) {
          console.error("Failed to parse settings", e);
        }
      })
      .catch((e) => console.error("Failed to fetch profile settings", e));
  }, [profileId]);

  const fetchData = async (selectedRange: TimeRange, customStart?: string, customEnd?: string, apIdFilter?: string | null) => {
    setLoading(true);
    try {
      let queryParams = `?range=${selectedRange}`;
      if (selectedRange === "custom" && customStart && customEnd) {
        const startTs = Math.floor(new Date(customStart).getTime() / 1000);
        const endTs = Math.floor(new Date(customEnd).getTime() / 1000);
        queryParams += `&start=${startTs}&end=${endTs}`;
      }
      if (apIdFilter) {
        queryParams += `&access_point_id=${apIdFilter}`;
      }
      
      const [summary, trend, topAllowed, topBlocked, clients, destinations] = await Promise.all([
        getProfileAnalytics(profileId, "summary", queryParams),
        getProfileAnalytics(profileId, "trend", queryParams),
        getProfileAnalytics(profileId, "top_allowed", queryParams),
        getProfileAnalytics(profileId, "top_blocked", queryParams),
        getProfileAnalytics(profileId, "clients", queryParams),
        getProfileAnalytics(profileId, "destinations", queryParams),
      ]);

      setData({
        summary,
        trend,
        top_allowed: topAllowed,
        top_blocked: topBlocked,
        clients,
        destinations,
      });
    } catch (e) {
      console.error("Failed to fetch analytics", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (range !== "custom") {
      fetchData(range, undefined, undefined, accessPointIdFilter);
    }
  }, [profileId, range, accessPointIdFilter]);

  if (loading && !data) {
    return (
      <div className="p-20 flex justify-center">
        <Spinner size={50} />
      </div>
    );
  }

  const chartData = processTrendData(data, range, customRange);
  const total = data?.summary.reduce((acc, s) => acc + s.count, 0) || 0;
  const blocked = data?.summary.find((s) => s.action === "BLOCK")?.count || 0;
  const redirected = data?.summary.find((s) => s.action === "REDIRECT")?.count || 0;
  const blockRate = total > 0 ? ((blocked / total) * 100).toFixed(1) : "0.0";
  const nowStr = new Date().toLocaleString("sv-SE").replace(" ", "T").slice(0, 16);

  // Using config array for metric cards to reduce hardcoding
  const metricCardsConfig = [
    { title: t("analytics.totalQueries"), value: total.toLocaleString(), icon: <Zap className="text-blue-500" size={20} /> },
    { title: t("analytics.blocked"), value: blocked.toLocaleString(), icon: <ShieldAlert className="text-red-500" size={20} /> },
    { title: t("analytics.redirected"), value: redirected.toLocaleString(), icon: <RotateCcw className="text-amber-500" size={20} /> },
    { title: t("analytics.blockRate"), value: `${blockRate}%`, icon: <Shield className="text-green-500" size={20} /> },
    { title: t("analytics.activeIPs"), value: data?.clients.length.toString() || "0", icon: <Globe className="text-purple-500" size={20} /> },
  ];

  const RANGE_PRESETS = [
    { key: "10m", days: 0.007 },
    { key: "1h", days: 0.0416 },
    { key: "24h", days: 1 },
    { key: "7d", days: 7 },
    { key: "30d", days: 30 },
  ];
  const visibleRanges = RANGE_PRESETS.filter(r => r.days <= logRetentionDays).map(r => r.key as TimeRange);

  return (
    <div className={clsx("max-w-7xl mx-auto space-y-6", isMobile ? "p-0" : "p-6")}>
      {/* Time Range Selector */}
      <div className="flex justify-between items-center bg-white dark:bg-gray-900 p-2 rounded-lg shadow-sm border border-gray-100 dark:border-gray-800">
        <ButtonGroup variant="minimal">
          {visibleRanges.map((r) => (
            <Button key={r} active={range === r} onClick={() => setRange(r)} text={r.toUpperCase()} />
          ))}
          <PopoverNext
            content={
              <div className="p-4 space-y-4 w-64">
                <H5>{t("analytics.customRange")}</H5>
                <FormGroup label={t("analytics.startTime")}>
                  <InputGroup
                    type="datetime-local"
                    max={customRange.end || nowStr}
                    value={customRange.start}
                    onChange={(e) => setCustomRange({ ...customRange, start: e.target.value })}
                  />
                </FormGroup>
                <FormGroup label={t("analytics.endTime")}>
                  <InputGroup
                    type="datetime-local"
                    min={customRange.start}
                    max={nowStr}
                    value={customRange.end}
                    onChange={(e) => setCustomRange({ ...customRange, end: e.target.value })}
                  />
                </FormGroup>
                <Button
                  fill
                  intent={Intent.PRIMARY}
                  text={t("analytics.apply")}
                  onClick={() => {
                    setRange("custom");
                    fetchData("custom", customRange.start, customRange.end, accessPointIdFilter);
                  }}
                />
              </div>
            }
          >
            <Button active={range === "custom"} icon={<Calendar size={14} className="mr-1" />} text={t("analytics.custom")} />
          </PopoverNext>
        </ButtonGroup>
        <div className="flex items-center gap-4">
          {accessPoints.length > 0 && (
            <HTMLSelect 
              value={accessPointIdFilter || ""}
              onChange={(e) => setAccessPointIdFilter(e.target.value || null)}
              options={[
                { label: `${t("logs.allAccessPoint")}`, value: "" },
                ...accessPoints.map(ap => ({ label: ap.name, value: ap.id }))
              ]}
              minimal
            />
          )}
          {loading && <Spinner size={16} />}
        </div>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-2 lg:gap-4">
        {metricCardsConfig.map((config, index) => (
          <MetricCard key={index} title={config.title} value={config.value} icon={config.icon} />
        ))}
      </div>

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
        <RankTable title={t("analytics.topAllowed")} data={data?.top_allowed || []} intent={Intent.SUCCESS} />
        <RankTable title={t("analytics.topBlocked")} data={data?.top_blocked || []} intent={Intent.DANGER} />
      </div>

      {/* Geolocation & Destinations */}
      <div className={`grid gap-6 grid-cols-1`}>
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
              {data?.clients.map((c, i) => (
                <tr key={i}>
                  <td className="font-mono text-xs">{c.client_ip}</td>
                  <td>
                    <Tag minimal>{getFlagEmoji(c.geo_country)}</Tag>
                  </td>
                  <td className="text-right font-bold">{c.count}</td>
                </tr>
              ))}
            </tbody>
          </HTMLTable>
        </Section>
      </div>
    </div>
  );
};
