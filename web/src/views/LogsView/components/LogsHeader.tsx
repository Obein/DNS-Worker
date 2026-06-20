import React, { useState } from "react";
import { Tag, Button, Intent, Switch, InputGroup } from "@blueprintjs/core";
import { useTranslation } from "react-i18next";
import type { TimeRange } from "../types";
import type { AccessPoint } from "../../../types/auth";
import { TimeRangeSelector } from "./TimeRangeSelector";
import { StatusFilter } from "./StatusFilter";
import { AccessPointFilter } from "./AccessPointFilter";
import { DestCountryFilter } from "./DestCountryFilter";
import { IspFilter } from "./IspFilter";

export interface LogsHeaderProps {
  range: TimeRange;
  setRange: (r: TimeRange) => void;
  customRange: { start: string; end: string };
  setCustomRange: (cr: { start: string; end: string }) => void;
  nowStr: string;
  fetchLogs: (range: TimeRange, initial: boolean) => void;
  isMobile: boolean;
  realtimeRefresh: boolean;
  setRealtimeRefresh: (val: boolean) => void;
  statusFilter: string | null;
  setStatusFilter: (val: string | null) => void;
  accessPointIdFilter: string | null;
  setAccessPointIdFilter: (val: string | null) => void;
  accessPoints: AccessPoint[];
  destCountryFilter: string | null;
  setDestCountryFilter: (val: string | null) => void;
  countries: { country_code: string; country: string }[];
  ispFilter: string | null;
  setIspFilter: (val: string | null) => void;
  isps: { name: string; count: number }[];
  searchQuery: string;
  setSearchQuery: (val: string) => void;
  stats: { total: number; pass: number; block: number; redirect: number } | null;
  logRetentionDays: number;
}

export const LogsHeader: React.FC<LogsHeaderProps> = ({
  range,
  setRange,
  customRange,
  setCustomRange,
  nowStr,
  fetchLogs,
  isMobile,
  realtimeRefresh,
  setRealtimeRefresh,
  statusFilter,
  setStatusFilter,
  accessPointIdFilter,
  setAccessPointIdFilter,
  accessPoints,
  destCountryFilter,
  setDestCountryFilter,
  countries,
  ispFilter,
  setIspFilter,
  isps,
  searchQuery,
  setSearchQuery,
  stats,
  logRetentionDays,
}) => {
  const { t } = useTranslation();
  const [isCollapsed, setIsCollapsed] = useState(true);

  const hasActiveFilters = statusFilter !== null || accessPointIdFilter !== null || destCountryFilter !== null || ispFilter !== null;

  const handleClearFilters = () => {
    setStatusFilter(null);
    setAccessPointIdFilter(null);
    setDestCountryFilter(null);
    setIspFilter(null);
  };

  return (
    <div className={`p-4 ${isMobile && isCollapsed ? "space-y-0" : "space-y-4"} shrink-0 bg-white/50 dark:bg-gray-900/50 backdrop-blur-sm border-b border-gray-100 dark:border-gray-800`}>
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        {/* Title & Collapse button */}
        <div className="flex items-center justify-between w-full md:w-auto">
          <div>
            <h2 className="bp6-heading flex flex-wrap items-center gap-2 text-xl md:text-2xl m-0">
              {t("logs.title")}{" "}
              {(!isMobile || !isCollapsed) && (
                <Tag minimal round>
                  {range === "custom" ? t("analytics.custom") : range.toUpperCase()}
                </Tag>
              )}
              {stats && (
                <>
                  <Tag minimal round>
                    {stats.total.toLocaleString()}
                  </Tag>
                  <Tag minimal round intent={Intent.SUCCESS}>
                    {stats.pass.toLocaleString()}
                  </Tag>
                  <Tag minimal round intent={Intent.DANGER}>
                    {stats.block.toLocaleString()}
                  </Tag>
                  <Tag minimal round intent={Intent.WARNING}>
                    {stats.redirect.toLocaleString()}
                  </Tag>
                </>
              )}
            </h2>
            {!isMobile && <p className="bp6-text-muted mt-1">{t("logs.subtitle")}</p>}
          </div>
          {isMobile && (
            <Button
              icon={isCollapsed ? "chevron-down" : "chevron-up"}
              variant="minimal"
              onClick={() => setIsCollapsed(!isCollapsed)}
            />
          )}
        </div>

        {/* Range Selector */}
        {(!isMobile || !isCollapsed) && (
          <div className="flex flex-col items-stretch md:items-end gap-2">
            <TimeRangeSelector
              range={range}
              setRange={setRange}
              customRange={customRange}
              setCustomRange={setCustomRange}
              nowStr={nowStr}
              fetchLogs={fetchLogs}
              isMobile={isMobile}
              logRetentionDays={logRetentionDays}
            />
            {/* Real-time Refresh Toggle */}
            <div className="flex items-center justify-between md:justify-end gap-4">
              <Switch
                label={t("logs.realtime")}
                checked={realtimeRefresh}
                onChange={(e) => setRealtimeRefresh((e.target as HTMLInputElement).checked)}
                className="mb-0!"
              />
              <Button icon="refresh" onClick={() => fetchLogs(range, true)} variant="minimal" small={isMobile} />
            </div>
          </div>
        )}
      </div>

      {/* Filters & Search */}
      {(!isMobile || !isCollapsed) && (
        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
          <div className="grid grid-cols-2 md:flex md:items-center gap-2">
            {hasActiveFilters && (
              <div className="col-span-2 md:contents">
                <Button
                  icon="filter-remove"
                  onClick={handleClearFilters}
                  variant="minimal"
                  title={t("logs.clearFilters")}
                  text={isMobile ? t("logs.clearFilters") : undefined}
                  fill={isMobile}
                />
              </div>
            )}
            <StatusFilter
              statusFilter={statusFilter}
              setStatusFilter={setStatusFilter}
              isMobile={isMobile}
            />
            {accessPoints.length > 0 && (
              <AccessPointFilter
                accessPointIdFilter={accessPointIdFilter}
                setAccessPointIdFilter={setAccessPointIdFilter}
                accessPoints={accessPoints}
                isMobile={isMobile}
              />
            )}
            {countries.length > 0 && (
              <DestCountryFilter
                destCountryFilter={destCountryFilter}
                setDestCountryFilter={setDestCountryFilter}
                countries={countries}
                isMobile={isMobile}
              />
            )}
            {isps.length > 0 && (
              <IspFilter
                ispFilter={ispFilter}
                setIspFilter={setIspFilter}
                isps={isps}
                isMobile={isMobile}
              />
            )}
          </div>
          <div className="flex-1 md:max-w-xs">
            <InputGroup
              leftIcon="search"
              placeholder={t("logs.searchPlaceholder")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              rightElement={searchQuery ? <Button icon="cross" minimal onClick={() => setSearchQuery("")} /> : undefined}
              fill
            />
          </div>
        </div>
      )}
    </div>
  );
};
