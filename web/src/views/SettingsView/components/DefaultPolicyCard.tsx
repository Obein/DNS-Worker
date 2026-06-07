import React from "react";
import { Card, Elevation, H5, FormGroup, HTMLSelect, Divider, InputGroup } from "@blueprintjs/core";
import { Shield } from "lucide-react";
import { useTranslation } from "react-i18next";
import type {  ProfileSettings  } from "../types";

export interface DefaultPolicyCardProps {
  settings: ProfileSettings;
  setSettings: (settings: ProfileSettings) => void;
}

export const DefaultPolicyCard: React.FC<DefaultPolicyCardProps> = ({ settings, setSettings }) => {
  const { t } = useTranslation();

  return (
    <Card elevation={Elevation.ONE} className="dark:bg-gray-900 dark:border-gray-800">
      <H5 className="flex items-center gap-2 mb-4 font-bold">
        <Shield size={18} className="text-green-500" /> {t("settings.defaultPolicyTitle")}
      </H5>
      <div className="space-y-4">
        <FormGroup label={t("settings.onNoMatch")}>
          <HTMLSelect
            fill
            value={settings.default_policy}
            onChange={(e) => setSettings({ ...settings, default_policy: e.target.value as any })}
          >
            <option value="ALLOW">{t("settings.allowAll")}</option>
            <option value="BLOCK">{t("settings.blockAll")}</option>
          </HTMLSelect>
        </FormGroup>

        <Divider />

        <FormGroup label={t("settings.blockModeTitle")} helperText={t("settings.blockModeDesc")}>
          <HTMLSelect
            fill
            value={settings.block_mode || "NULL_IP"}
            onChange={(e) => setSettings({ ...settings, block_mode: e.target.value as any })}
          >
            <option value="NULL_IP">0.0.0.0 / :: ({t("settings.default")})</option>
            <option value="NXDOMAIN">NXDOMAIN ({t("settings.NXDOMAIN")})</option>
            <option value="NODATA">NODATA ({t("settings.NODATA")})</option>
            <option value="CUSTOM_IP">{t("settings.customIP")}</option>
          </HTMLSelect>
        </FormGroup>

        {settings.block_mode === "CUSTOM_IP" && (
          <div className="space-y-2 animate-in fade-in slide-in-from-top-1">
            <InputGroup
              placeholder="IPv4: 127.0.0.1"
              value={settings.custom_block_ipv4 || ""}
              onChange={(e) => setSettings({ ...settings, custom_block_ipv4: e.target.value })}
            />
            <InputGroup
              placeholder="IPv6: ::1"
              value={settings.custom_block_ipv6 || ""}
              onChange={(e) => setSettings({ ...settings, custom_block_ipv6: e.target.value })}
            />
          </div>
        )}
      </div>
    </Card>
  );
};
