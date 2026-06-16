import React from "react";
import {
  Tag,
  ButtonGroup,
  Button,
  PopoverNext,
  H5,
  FormGroup,
  InputGroup,
  Intent,
  Switch,
  Menu,
  MenuItem,
  MenuDivider,
  HTMLSelect,
} from "@blueprintjs/core";
import { Calendar, Filter } from "lucide-react";
import { useTranslation } from "react-i18next";
import type {  TimeRange  } from "../types";
import type { AccessPoint } from "../../../types/auth";

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
  searchQuery,
  setSearchQuery,
  stats,
  logRetentionDays,
}) => {
  const { t } = useTranslation();
  console.log("stats in LogsHeader:", stats);

  const filterMenu = (
    <Menu>
      <MenuItem
        icon={statusFilter === null ? "tick" : undefined}
        text={t("logs.allStatus")}
        onClick={() => setStatusFilter(null)}
      />
      <MenuDivider />
      <MenuItem
        icon={statusFilter === "PASS" ? "tick" : undefined}
        intent={Intent.SUCCESS}
        text={t("logs.onlyPass")}
        onClick={() => setStatusFilter("PASS")}
      />
      <MenuItem
        icon={statusFilter === "BLOCK" ? "tick" : undefined}
        intent={Intent.DANGER}
        text={t("logs.onlyBlock")}
        onClick={() => setStatusFilter("BLOCK")}
      />
      <MenuItem
        icon={statusFilter === "REDIRECT" ? "tick" : undefined}
        intent={Intent.WARNING}
        text={t("logs.onlyRedirect")}
        onClick={() => setStatusFilter("REDIRECT")}
      />
    </Menu>
  );

  const getFilterLabel = () => {
    switch (statusFilter) {
      case "PASS":
        return { text: t("logs.statusPass"), intent: Intent.SUCCESS };
      case "BLOCK":
        return { text: t("logs.statusBlock"), intent: Intent.DANGER };
      case "REDIRECT":
        return { text: t("logs.statusRedirect"), intent: Intent.WARNING };
      default:
        return { text: t("logs.allStatus"), intent: Intent.NONE };
    }
  };

  const currentFilter = getFilterLabel();

  const RANGE_PRESETS = [
    { key: "10m", days: 0.007 },
    { key: "1h", days: 0.0416 },
    { key: "24h", days: 1 },
    { key: "7d", days: 7 },
    { key: "30d", days: 30 },
    { key: "180d", days: 180 },
    { key: "360d", days: 360 },
    { key: "720d", days: 720 },
  ];
  const visibleRanges = RANGE_PRESETS.filter(r => r.days <= logRetentionDays).map(r => r.key as TimeRange);

  return (
    <div className="p-4 space-y-4 shrink-0 bg-white/50 dark:bg-gray-900/50 backdrop-blur-sm border-b border-gray-100 dark:border-gray-800">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="bp6-heading flex flex-wrap items-center gap-2 text-xl md:text-2xl">
            {t("logs.title")}{" "}
            <Tag minimal round>
              {range === "custom" ? t("analytics.custom") : range.toUpperCase()}
            </Tag>
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
          {!isMobile && <p className="bp6-text-muted">{t("logs.subtitle")}</p>}
        </div>

        <div className="flex flex-col items-stretch md:items-end gap-2">
          <div className="overflow-x-auto pb-1 -mx-4 px-4 md:mx-0 md:px-0">
            <ButtonGroup minimal={isMobile} variant={isMobile ? undefined : "minimal"}>
              {visibleRanges.map((r) => (
                <Button key={r} active={range === r} onClick={() => setRange(r)} text={r.toUpperCase()} small={isMobile} />
              ))}
              <PopoverNext
                content={
                  <div className="p-4 space-y-2 w-64">
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
                        fetchLogs("custom", true);
                      }}
                    />
                  </div>
                }
              >
                <Button active={range === "custom"} icon={<Calendar size={14} />} text={isMobile ? "" : t("analytics.custom")} small={isMobile} />
              </PopoverNext>
            </ButtonGroup>
          </div>

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
      </div>

      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <PopoverNext content={filterMenu} placement="bottom-start">
            <Button
              icon={<Filter size={14} />}
              rightIcon="caret-down"
              intent={currentFilter.intent}
              text={currentFilter.text}
              variant="outlined"
              fill={isMobile}
            />
          </PopoverNext>
          {accessPoints.length > 0 && (
            <HTMLSelect 
              value={accessPointIdFilter || ""}
              onChange={(e) => setAccessPointIdFilter(e.target.value || null)}
              options={[
                { label: `${t("logs.allAccessPoint")}`, value: "" },
                ...accessPoints.map(ap => ({ label: ap.name, value: ap.id }))
              ]}
              fill={isMobile}
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
    </div>
  );
};
