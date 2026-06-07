import React from "react";
import {
  Tag,
  ButtonGroup,
  Button,
  Popover,
  H5,
  FormGroup,
  InputGroup,
  Intent,
  Switch,
  Position,
  Menu,
  MenuItem,
  MenuDivider,
} from "@blueprintjs/core";
import { Calendar, Filter } from "lucide-react";
import { useTranslation } from "react-i18next";
import type {  TimeRange  } from "../types";

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
  searchQuery: string;
  setSearchQuery: (val: string) => void;
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
  searchQuery,
  setSearchQuery,
}) => {
  const { t } = useTranslation();

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

  return (
    <div className="p-4 space-y-4 shrink-0 bg-white/50 dark:bg-gray-900/50 backdrop-blur-sm border-b border-gray-100 dark:border-gray-800">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="bp6-heading flex items-center gap-2 text-xl md:text-2xl">
            {t("logs.title")}{" "}
            <Tag minimal round>
              {range === "custom" ? t("analytics.custom") : range.toUpperCase()}
            </Tag>
          </h2>
          {!isMobile && <p className="bp6-text-muted">{t("logs.subtitle")}</p>}
        </div>

        <div className="flex flex-col items-stretch md:items-end gap-2">
          <div className="overflow-x-auto pb-1 -mx-4 px-4 md:mx-0 md:px-0">
            <ButtonGroup minimal={isMobile} variant={isMobile ? undefined : "minimal"}>
              {(["10m", "1h", "24h", "7d", "30d"] as TimeRange[]).map((r) => (
                <Button key={r} active={range === r} onClick={() => setRange(r)} text={r.toUpperCase()} small={isMobile} />
              ))}
              <Popover
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
              </Popover>
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
          <Popover content={filterMenu} position={Position.BOTTOM_LEFT}>
            <Button
              icon={<Filter size={14} />}
              rightIcon="caret-down"
              intent={currentFilter.intent}
              text={currentFilter.text}
              variant="outlined"
              fill={isMobile}
            />
          </Popover>
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
