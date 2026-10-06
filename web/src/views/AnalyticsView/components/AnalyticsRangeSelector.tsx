import React from "react";
import {
  ButtonGroup,
  Button,
  PopoverNext,
  H5,
  FormGroup,
  InputGroup,
  HTMLSelect,
  Spinner,
  Intent
} from "@blueprintjs/core";
import { Calendar } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TimeRange } from "../types";
import type { AccessPoint } from "../../../services";

export interface AnalyticsRangeSelectorProps {
  range: TimeRange;
  setRange: (range: TimeRange) => void;
  customRange: { start: string; end: string };
  setCustomRange: React.Dispatch<React.SetStateAction<{ start: string; end: string }>>;
  logRetentionDays: number;
  accessPoints: AccessPoint[];
  accessPointIdFilter: string | null;
  setAccessPointIdFilter: (id: string | null) => void;
  loading: boolean;
  onApplyCustom: () => void;
}

const RANGE_PRESETS = [
  { key: "10m", days: 0.007 },
  { key: "1h", days: 0.0416 },
  { key: "24h", days: 1 },
  { key: "7d", days: 7 },
  { key: "30d", days: 30 }
];

export const AnalyticsRangeSelector: React.FC<AnalyticsRangeSelectorProps> = ({
  range,
  setRange,
  customRange,
  setCustomRange,
  logRetentionDays,
  accessPoints,
  accessPointIdFilter,
  setAccessPointIdFilter,
  loading,
  onApplyCustom
}) => {
  const { t } = useTranslation();
  const nowStr = new Date().toLocaleString("sv-SE").replace(" ", "T").slice(0, 16);

  const visibleRanges = RANGE_PRESETS.filter((r) => r.days <= logRetentionDays).map(
    (r) => r.key as TimeRange
  );

  return (
    <div className="flex justify-between items-center bg-white dark:bg-gray-900 p-2 rounded-lg shadow-sm border border-gray-100 dark:border-gray-800">
      <ButtonGroup variant="minimal">
        {visibleRanges.map((r) => (
          <Button
            key={r}
            active={range === r}
            onClick={() => setRange(r)}
            text={r.toUpperCase()}
          />
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
                  onChange={(e) =>
                    setCustomRange({ ...customRange, start: e.target.value })
                  }
                />
              </FormGroup>
              <FormGroup label={t("analytics.endTime")}>
                <InputGroup
                  type="datetime-local"
                  min={customRange.start}
                  max={nowStr}
                  value={customRange.end}
                  onChange={(e) =>
                    setCustomRange({ ...customRange, end: e.target.value })
                  }
                />
              </FormGroup>
              <Button
                fill
                intent={Intent.PRIMARY}
                text={t("analytics.apply")}
                onClick={onApplyCustom}
              />
            </div>
          }
        >
          <Button
            active={range === "custom"}
            icon={<Calendar size={14} className="mr-1" />}
            text={t("analytics.custom")}
          />
        </PopoverNext>
      </ButtonGroup>
      <div className="flex items-center gap-4">
        {accessPoints.length > 0 && (
          <HTMLSelect
            value={accessPointIdFilter || ""}
            onChange={(e) => setAccessPointIdFilter(e.target.value || null)}
            options={[
              { label: `${t("logs.allAccessPoint")}`, value: "" },
              ...accessPoints.map((ap) => ({ label: ap.name, value: ap.id }))
            ]}
            minimal
          />
        )}
        {loading && <Spinner size={16} />}
      </div>
    </div>
  );
};
