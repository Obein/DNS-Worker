import React from "react";
import { Card, Elevation, H5, FormGroup, Switch, InputGroup } from "@blueprintjs/core";
import { Globe } from "lucide-react";
import { useTranslation } from "react-i18next";
import type {  ProfileSettings  } from "../types";

export interface AdvancedEcsCardProps {
  settings: ProfileSettings;
  setSettings: (settings: ProfileSettings) => void;
}

export const AdvancedEcsCard: React.FC<AdvancedEcsCardProps> = ({ settings, setSettings }) => {
  const { t } = useTranslation();

  return (
    <Card elevation={Elevation.ONE} className="dark:bg-gray-900 dark:border-gray-800">
      <H5 className="flex items-center gap-2 mb-3 font-bold">
        <Globe size={18} className="text-orange-500" /> {t("settings.ecsTitle")}
      </H5>
      <div className="space-y-4">
        <Switch
          label={t("settings.sendEcs")}
          checked={settings.ecs.enabled}
          onChange={(e) =>
            setSettings({
              ...settings,
              ecs: { ...settings.ecs, enabled: e.currentTarget.checked },
            })
          }
        />
        <Switch
          label={t("settings.customSubnet")}
          disabled={!settings.ecs.enabled}
          checked={!settings.ecs.use_client_ip}
          onChange={(e) =>
            setSettings({
              ...settings,
              ecs: {
                ...settings.ecs,
                use_client_ip: !e.currentTarget.checked,
              },
            })
          }
        />

        <div className="space-y-3 pt-2 border-t border-gray-100 dark:border-gray-800">
          <FormGroup
            label={t("settings.customIpv4")}
            labelInfo={t("settings.ipv4Hint")}
            disabled={!(settings.ecs.enabled && !settings.ecs.use_client_ip)}
          >
            <InputGroup
              placeholder="0.0.0.0/0"
              value={settings.ecs.ipv4_cidr || ""}
              disabled={!(settings.ecs.enabled && !settings.ecs.use_client_ip)}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  ecs: { ...settings.ecs, ipv4_cidr: e.target.value },
                })
              }
            />
          </FormGroup>
          <FormGroup
            label={t("settings.customIpv6")}
            labelInfo={t("settings.ipv6Hint")}
            disabled={!(settings.ecs.enabled && !settings.ecs.use_client_ip)}
          >
            <InputGroup
              placeholder="::/0"
              value={settings.ecs.ipv6_cidr || ""}
              disabled={!(settings.ecs.enabled && !settings.ecs.use_client_ip)}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  ecs: { ...settings.ecs, ipv6_cidr: e.target.value },
                })
              }
            />
          </FormGroup>
        </div>
        <p className="text-xs opacity-60">{t("settings.ecsUpstreamHint")}</p>
      </div>
    </Card>
  );
};
