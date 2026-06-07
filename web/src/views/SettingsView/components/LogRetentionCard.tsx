import React from "react";
import { Card, Elevation, H5, FormGroup, HTMLSelect } from "@blueprintjs/core";
import { Clock } from "lucide-react";
import { useTranslation } from "react-i18next";
import type {  ProfileSettings  } from "../types";
import { useLogRetentionOptions } from "../hooks";

export interface LogRetentionCardProps {
  settings: ProfileSettings;
  setSettings: (settings: ProfileSettings) => void;
}

export const LogRetentionCard: React.FC<LogRetentionCardProps> = ({ settings, setSettings }) => {
  const { t } = useTranslation();
  const LOG_RETENTION_OPTIONS = useLogRetentionOptions();

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
        <p className="text-xs opacity-60">{t("settings.retentionDesc")}</p>
      </div>
    </Card>
  );
};
