import React from "react";
import { Card, Elevation, H5, FormGroup, InputGroup, Button, PopoverNext, Menu, MenuItem } from "@blueprintjs/core";
import { Server } from "lucide-react";
import { useTranslation } from "react-i18next";
import type {  ProfileSettings  } from "../types";
import { usePresetUpstreams } from "../hooks";

export interface UpstreamCardProps {
  settings: ProfileSettings;
  setSettings: (settings: ProfileSettings) => void;
}

export const UpstreamCard: React.FC<UpstreamCardProps> = ({ settings, setSettings }) => {
  const { t } = useTranslation();
  const PRESET_UPSTREAMS = usePresetUpstreams();

  const upstreamMenu = (
    <Menu className="min-w-96">
      {PRESET_UPSTREAMS.map((preset, i) => (
        <MenuItem
          key={i}
          text={preset.label}
          onClick={() => setSettings({ ...settings, upstream: [preset.url] })}
          labelElement={
            <div className="flex flex-col items-end text-right">
              <span className="text-[9px] opacity-85 max-w-64 truncate" title={preset.url}>
                {preset.url}
              </span>
            </div>
          }
        />
      ))}
    </Menu>
  );

  return (
    <Card elevation={Elevation.ONE} className="dark:bg-gray-900 dark:border-gray-800">
      <H5 className="flex items-center gap-2 mb-4 font-bold">
        <Server size={18} className="text-blue-500" /> {t("settings.upstreamTitle")}
      </H5>
      <FormGroup label={t("settings.dohUrl") + "/" + t("settings.classicDns")}>
        <InputGroup
          fill
          placeholder="https://dns.example.net/dns-query"
          value={settings.upstream?.[0] || ""}
          onChange={(e) => setSettings({ ...settings, upstream: [e.target.value] })}
          onFocus={(e) => e.target.select()}
          rightElement={
            <PopoverNext content={upstreamMenu} placement="bottom-end" animation="minimal" arrow={false}>
              <Button variant="minimal" icon="chevron-down" />
            </PopoverNext>
          }
        />
      </FormGroup>
      <p className="text-xs opacity-60">{t("settings.upstreamDesc")}</p>
    </Card>
  );
};
