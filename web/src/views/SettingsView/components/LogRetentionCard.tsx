import React from "react";
import { Card, Elevation, H5, FormGroup, HTMLSelect } from "@blueprintjs/core";
import { Clock } from "lucide-react";
import { useTranslation } from "react-i18next";
import type {  ProfileSettings  } from "../types";
import { useLogRetentionOptions } from "../hooks";

export interface LogRetentionCardProps {
  settings: ProfileSettings;
  setSettings: (settings: ProfileSettings) => void;
  isAdmin: boolean;
  maxRetentionDays: number;
}

export const LogRetentionCard: React.FC<LogRetentionCardProps> = ({ settings, setSettings, isAdmin, maxRetentionDays }) => {
  const { t } = useTranslation();
  const LOG_RETENTION_OPTIONS = useLogRetentionOptions(isAdmin, maxRetentionDays);

  React.useEffect(() => {
    if (maxRetentionDays > 0 && settings.log_retention_days > maxRetentionDays && LOG_RETENTION_OPTIONS.length > 0) {
      const highestOption = LOG_RETENTION_OPTIONS[LOG_RETENTION_OPTIONS.length - 1];
      if (highestOption && settings.log_retention_days !== highestOption.value) {
        setSettings({ ...settings, log_retention_days: highestOption.value });
      }
    }
  }, [maxRetentionDays, settings.log_retention_days, LOG_RETENTION_OPTIONS, setSettings]);

  return (
    <Card elevation={Elevation.ONE} className="dark:bg-gray-900 dark:border-gray-800">
      <H5 className="flex items-center gap-2 mb-4 font-bold">
        <Clock size={18} className="text-purple-500" /> {t("settings.logRetentionTitle")}
      </H5>
      <div className="space-y-4">
        <FormGroup label={t("settings.retentionDuration")}>
          <HTMLSelect
            fill
            value={settings.log_retention_days}
            onChange={(e) => setSettings({ ...settings, log_retention_days: parseFloat(e.target.value) })}
          >
            {LOG_RETENTION_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </HTMLSelect>
        </FormGroup>
        <p className="text-xs opacity-60">
          {settings.log_retention_days === 0
            ? t("settings.retentionDisabledDesc", "已关闭日志记录。系统将不会记录任何 DNS 查询日志并立即清空历史日志。")
            : t("settings.retentionDesc")}
        </p>
      </div>
    </Card>
  );
};
