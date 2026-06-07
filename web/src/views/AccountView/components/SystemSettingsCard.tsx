import React, { useState } from "react";
import { Card, Elevation, H4, FormGroup, InputGroup, Switch, Divider, Button, Intent } from "@blueprintjs/core";
import { Settings } from "lucide-react";
import { useTranslation } from "react-i18next";

export interface SystemSettingsCardProps {
  initialSettings: Record<string, string>;
  onRefresh: () => void;
}

export const SystemSettingsCard: React.FC<SystemSettingsCardProps> = ({ initialSettings, onRefresh }) => {
  const { t } = useTranslation();
  const [sysSettings, setSysSettings] = useState<Record<string, string>>(initialSettings);
  const [sysLoading, setSysLoading] = useState(false);

  const handleSaveSysSettings = async () => {
    setSysLoading(true);
    try {
      await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sysSettings),
      });
      alert(t("common.saveSuccess", "Settings saved"));
      onRefresh();
    } catch (e) {
      console.error(e);
    } finally {
      setSysLoading(false);
    }
  };

  return (
    <>
      <div className="flex items-center gap-2">
        <Settings size={20} className="text-gray-500" />
        <H4 style={{ margin: 0 }}>{t("account.systemSettings", "System Settings")}</H4>
      </div>
      <Card elevation={Elevation.ONE}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
          <div className="space-y-4">
            <H4 className="text-sm font-bold opacity-70 text-blue-500">Cloudflare Turnstile</H4>
            <FormGroup label="Site Key">
              <InputGroup
                value={sysSettings.turnstile_site_key || ""}
                onChange={(e) => setSysSettings({ ...sysSettings, turnstile_site_key: e.target.value })}
                placeholder="0x000..."
              />
            </FormGroup>
            <FormGroup label="Secret Key">
              <InputGroup
                type="password"
                value={sysSettings.turnstile_secret_key || ""}
                onChange={(e) => setSysSettings({ ...sysSettings, turnstile_secret_key: e.target.value })}
                placeholder="0x000..."
              />
            </FormGroup>
          </div>
          <div className="space-y-4">
            <H4 className="text-sm font-bold opacity-70 text-green-500">
              {t("account.featureToggle", "Feature Toggle")}
            </H4>
            <Switch
              label={t("account.enableTurnstileSignup", "Enable verification on Signup")}
              checked={sysSettings.turnstile_enabled_signup === "true"}
              onChange={(e) =>
                setSysSettings({ ...sysSettings, turnstile_enabled_signup: String(e.currentTarget.checked) })
              }
            />
            <Switch
              label={t("account.enableTurnstileLogin", "Enable verification on Login")}
              checked={sysSettings.turnstile_enabled_login === "true"}
              onChange={(e) =>
                setSysSettings({ ...sysSettings, turnstile_enabled_login: String(e.currentTarget.checked) })
              }
            />
          </div>
        </div>
        <Divider className="my-4" />
        <div className="flex justify-end">
          <Button
            intent={Intent.PRIMARY}
            icon="floppy-disk"
            text={t("common.save", "Save")}
            loading={sysLoading}
            onClick={handleSaveSysSettings}
          />
        </div>
      </Card>
    </>
  );
};
