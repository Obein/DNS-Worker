import React, { useState, useEffect, useRef } from "react";
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
  Popover,
  FormGroup,
  InputGroup,
  HTMLSelect,
} from "@blueprintjs/core";
import { Shield, ShieldAlert, Zap, Globe, MapPin, Calendar, RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  ComposableMap,
  ZoomableGroup,
  Geographies,
  Geography,
  createCoordinates,
  createTranslateExtent,
} from "@vnedyalk0v/react19-simple-maps";

import type {  AnalyticsData, TimeRange  } from "./types";
import { getFlagEmoji, processTrendData } from "./utils";
import { MetricCard } from "./components/MetricCard";
import { RankTable } from "./components/RankTable";
import { TrendChart } from "./components/TrendChart";
import type { AccessPoint } from "../../types/auth";
import { numericToAlpha2 } from "./countryMapping";

export const AnalyticsView: React.FC<{ profileId: string }> = ({ profileId }) => {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const { t } = useTranslation();
  const [range, setRange] = useState<TimeRange>("24h");
  const [customRange, setCustomRange] = useState({ start: "", end: "" });
  const [accessPointIdFilter, setAccessPointIdFilter] = useState<string | null>(null);
  const [accessPoints, setAccessPoints] = useState<AccessPoint[]>([]);

  const [geographyData, setGeographyData] = useState<any>(null);
  const [position, setPosition] = useState({ coordinates: createCoordinates(0, 0), zoom: 1 });
  const [hoveredCountry, setHoveredCountry] = useState<{
    name: string;
    code: string;
    count: number;
    flag: string;
    x: number;
    y: number;
  } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const bounds = React.useMemo(() => {
    return createTranslateExtent(
      createCoordinates(-100, -50),
      createCoordinates(900, 450)
    );
  }, []);

  useEffect(() => {
    fetch("/world-110m.json")
      .then((r) => r.json())
      .then((data) => setGeographyData(data))
      .catch((e) => console.error("Failed to load map topology", e));
  }, []);

  const totalQueriesCount = data?.summary.reduce((acc, s) => acc + s.count, 0) || 0;

  const scaleConfig = React.useMemo(() => {
    if (totalQueriesCount <= 0) {
      return { maxThreshold: 10, step: 1 };
    }
    if (totalQueriesCount <= 1000) {
      return { maxThreshold: 100, step: 10 };
    }
    const power = Math.floor(Math.log10(totalQueriesCount));
    const maxThreshold = Math.pow(10, power);
    const step = maxThreshold / 10;
    return { maxThreshold, step };
  }, [totalQueriesCount]);

  const destinationMap = React.useMemo(() => {
    const map: Record<string, { count: number; name: string; countryCode: string }> = {};
    if (!data?.destinations) return map;
    
    data.destinations.forEach((d) => {
      try {
        const geo = JSON.parse(d.dest_geoip);
        if (geo && geo.country_code) {
          const code = geo.country_code.toUpperCase();
          map[code] = {
            count: d.count,
            name: geo.country,
            countryCode: code
          };
        }
      } catch (e) {
        console.error("Failed to parse dest_geoip", e);
      }
    });
    return map;
  }, [data?.destinations]);

  const getLevel = (count: number) => {
    if (!count || count <= 0) return 0;
    return Math.min(10, Math.floor(count / scaleConfig.step) + 1);
  };

  const formatNumber = (num: number): string => {
    if (num >= 1000000) {
      const v = num / 1000000;
      return Number.isInteger(v) ? `${v}M` : `${v.toFixed(1)}M`;
    }
    if (num >= 1000) {
      const v = num / 1000;
      return Number.isInteger(v) ? `${v}K` : `${v.toFixed(1)}K`;
    }
    return num.toString();
  };

  const handleZoomIn = () => {
    if (position.zoom >= 8) return;
    setPosition((pos) => ({ ...pos, zoom: pos.zoom * 1.5 }));
  };

  const handleZoomOut = () => {
    if (position.zoom <= 1) return;
    setPosition((pos) => ({ ...pos, zoom: pos.zoom / 1.5 }));
  };

  const handleReset = () => {
    setPosition({ coordinates: createCoordinates(0, 0), zoom: 1 });
  };

  useEffect(() => {
    fetch(`/api/profiles/${profileId}/access_points`)
      .then(r => r.json())
      .then(data => setAccessPoints(data))
      .catch(e => console.error("Failed to load access points", e));
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
      
      const baseStatsUrl = `/api/profiles/${profileId}/analytics`;
      const [summary, trend, topAllowed, topBlocked, clients, destinations] = await Promise.all([
        fetch(`${baseStatsUrl}/summary${queryParams}`).then((r) => r.json()),
        fetch(`${baseStatsUrl}/trend${queryParams}`).then((r) => r.json()),
        fetch(`${baseStatsUrl}/top_allowed${queryParams}`).then((r) => r.json()),
        fetch(`${baseStatsUrl}/top_blocked${queryParams}`).then((r) => r.json()),
        fetch(`${baseStatsUrl}/clients${queryParams}`).then((r) => r.json()),
        fetch(`${baseStatsUrl}/destinations${queryParams}`).then((r) => r.json()),
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

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Time Range Selector */}
      <div className="flex justify-between items-center bg-white dark:bg-gray-900 p-2 rounded-lg shadow-sm border border-gray-100 dark:border-gray-800">
        <ButtonGroup variant="minimal">
          {(["10m", "1h", "24h", "7d", "30d"] as TimeRange[]).map((r) => (
            <Button key={r} active={range === r} onClick={() => setRange(r)} text={r.toUpperCase()} />
          ))}
          <Popover
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
          </Popover>
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
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 md:gap-4">
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
        <TrendChart chartData={chartData} range={range} />
      </Card>

      {/* Ranks */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <RankTable title={t("analytics.topAllowed")} data={data?.top_allowed || []} intent={Intent.SUCCESS} />
        <RankTable title={t("analytics.topBlocked")} data={data?.top_blocked || []} intent={Intent.DANGER} />
      </div>

      {/* Geolocation & Destinations */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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

        <Section title={t("analytics.destinationDistribution")} icon={<MapPin size={16} />}>
          <div className="relative w-full h-[400px] mt-4 bg-gray-50 dark:bg-slate-950 rounded-xl overflow-hidden border border-gray-100 dark:border-slate-800 flex flex-col justify-between shadow-sm">
            {/* Map wrapper */}
            <div
              ref={containerRef}
              className="relative w-full flex-1 overflow-hidden select-none cursor-grab active:cursor-grabbing"
              onClick={(e) => {
                if (e.target === e.currentTarget || (e.target as SVGElement).tagName === "svg") {
                  setHoveredCountry(null);
                }
              }}
            >
              <ComposableMap
                projection="geoEqualEarth"
                width={800}
                height={400}
                style={{ width: "100%", height: "100%" }}
              >
                <ZoomableGroup
                  zoom={position.zoom}
                  center={position.coordinates}
                  onMoveEnd={(pos) => setPosition({ coordinates: createCoordinates(pos.coordinates[0], pos.coordinates[1]), zoom: pos.zoom })}
                  maxZoom={8}
                  minZoom={1}
                  enablePan={true}
                  translateExtent={bounds}
                >
                  {geographyData && (
                    <Geographies geography={geographyData}>
                      {({ geographies }) =>
                        geographies.map((geo) => {
                          const countryCode = numericToAlpha2[geo.id];
                          const dest = countryCode ? destinationMap[countryCode] : null;
                          const count = dest?.count || 0;
                          const fillLevel = getLevel(count);

                          return (
                            <Geography
                              key={geo.rsmKey}
                              geography={geo}
                              onMouseEnter={(event) => {
                                if (!countryCode) return;
                                const name = dest?.name || geo.properties.name;
                                const flag = getFlagEmoji(countryCode);
                                const containerRect = containerRef.current?.getBoundingClientRect();
                                const x = event.clientX - (containerRect?.left || 0);
                                const y = event.clientY - (containerRect?.top || 0) - 15;
                                setHoveredCountry({
                                  name,
                                  code: countryCode,
                                  count,
                                  flag,
                                  x,
                                  y,
                                });
                              }}
                              onMouseMove={(event) => {
                                const containerRect = containerRef.current?.getBoundingClientRect();
                                const x = event.clientX - (containerRect?.left || 0);
                                const y = event.clientY - (containerRect?.top || 0) - 15;
                                setHoveredCountry((prev) => (prev ? { ...prev, x, y } : null));
                              }}
                              onMouseLeave={() => {
                                setHoveredCountry(null);
                              }}
                              onClick={(event) => {
                                if (!countryCode) return;
                                const name = dest?.name || geo.properties.name;
                                const flag = getFlagEmoji(countryCode);
                                const containerRect = containerRef.current?.getBoundingClientRect();
                                const x = event.clientX - (containerRect?.left || 0);
                                const y = event.clientY - (containerRect?.top || 0) - 15;
                                setHoveredCountry({
                                  name,
                                  code: countryCode,
                                  count,
                                  flag,
                                  x,
                                  y,
                                });
                              }}
                              style={{
                                default: {
                                  fill: `var(--map-color-${fillLevel})`,
                                  stroke: "var(--map-stroke)",
                                  strokeWidth: 0.5,
                                  outline: "none",
                                  transition: "fill 250ms, stroke 250ms",
                                },
                                hover: {
                                  fill: "var(--map-hover)",
                                  stroke: "var(--map-stroke)",
                                  strokeWidth: 0.5,
                                  outline: "none",
                                  cursor: "pointer",
                                },
                                pressed: {
                                  fill: "var(--map-hover)",
                                  stroke: "var(--map-stroke)",
                                  strokeWidth: 0.5,
                                  outline: "none",
                                },
                              }}
                            />
                          );
                        })
                      }
                    </Geographies>
                  )}
                </ZoomableGroup>
              </ComposableMap>

              {/* Tooltip */}
              {hoveredCountry && (
                <div
                  className="absolute pointer-events-none bg-white/95 dark:bg-slate-900/95 backdrop-blur-sm px-3 py-2 rounded-lg shadow-xl border border-gray-200/50 dark:border-slate-800/50 text-xs z-50 flex flex-col gap-1 transition-all duration-75 text-gray-900 dark:text-gray-100"
                  style={{
                    left: `${hoveredCountry.x}px`,
                    top: `${hoveredCountry.y}px`,
                    transform: "translate(-50%, -100%)",
                  }}
                >
                  <div className="flex items-center gap-1.5 font-semibold whitespace-nowrap">
                    <span className="text-sm">{hoveredCountry.flag}</span>
                    <span>{hoveredCountry.name}</span>
                  </div>
                  <div className="text-gray-500 dark:text-gray-400 whitespace-nowrap">
                    {hoveredCountry.count.toLocaleString()} {t("analytics.queries")}
                  </div>
                </div>
              )}
            </div>

            {/* Zoom Controls */}
            <div className="absolute top-3 right-3 flex flex-col gap-1.5 bg-white/80 dark:bg-slate-950/80 backdrop-blur-md p-1.5 rounded-lg border border-gray-200/50 dark:border-slate-800/50 shadow-sm z-10">
              <button
                type="button"
                onClick={handleZoomIn}
                className="p-1.5 hover:bg-gray-100 dark:hover:bg-slate-800 rounded text-gray-600 dark:text-gray-300 transition-colors cursor-pointer"
                title="Zoom In"
              >
                <ZoomIn size={16} />
              </button>
              <button
                type="button"
                onClick={handleZoomOut}
                className="p-1.5 hover:bg-gray-100 dark:hover:bg-slate-800 rounded text-gray-600 dark:text-gray-300 transition-colors cursor-pointer"
                title="Zoom Out"
              >
                <ZoomOut size={16} />
              </button>
              <button
                type="button"
                onClick={handleReset}
                className="p-1.5 hover:bg-gray-100 dark:hover:bg-slate-800 rounded text-gray-600 dark:text-gray-300 transition-colors cursor-pointer"
                title="Reset Zoom"
              >
                <RotateCcw size={16} />
              </button>
            </div>

            {/* Legend */}
            <div className="absolute bottom-3 left-3 flex flex-col gap-1.5 bg-white/80 dark:bg-slate-950/80 backdrop-blur-md p-2 rounded-lg border border-gray-200/50 dark:border-slate-800/50 shadow-sm z-10 max-w-[280px]">
              <span className="text-[9px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{t("analytics.queries")}</span>
              <div className="flex items-center gap-0.5">
                {Array.from({ length: 11 }).map((_, i) => (
                  <div
                    key={i}
                    className="w-4 h-2.5 rounded-sm border border-black/5 dark:border-white/5"
                    style={{ backgroundColor: `var(--map-color-${i})` }}
                  />
                ))}
              </div>
              <div className="flex justify-between text-[9px] text-gray-500 dark:text-gray-400 font-semibold px-0.5">
                <span>0</span>
                <span>{formatNumber(scaleConfig.maxThreshold / 2)}</span>
                <span>{formatNumber(scaleConfig.maxThreshold)}+</span>
              </div>
            </div>
          </div>
        </Section>
      </div>
    </div>
  );
};
