import React, { useState, useEffect } from "react";
import {
  Card,
  Elevation,
  H4,
  FormGroup,
  InputGroup,
  Switch,
  Divider,
  Button,
  Intent,
  type OverlayToaster
} from "@blueprintjs/core";
import { Settings } from "lucide-react";
import { useTranslation } from "react-i18next";

import { updateSystemSettings } from "../../../services";
import { executeWithTimeout } from "../../../utils/async";

export interface SystemSettingsCardProps {
  initialSettings: Record<string, string>;
  onRefresh: () => void;
  onSavingChange?: (saving: boolean) => void;
  toasterRef?: React.RefObject<OverlayToaster | null>;
}

export const SystemSettingsCard: React.FC<SystemSettingsCardProps> = ({
  initialSettings,
  onRefresh,
  onSavingChange,
  toasterRef,
}) => {
  const { t } = useTranslation();
  const [sysSettings, setSysSettings] = useState<Record<string, string>>(initialSettings);
  const [sysLoading, setSysLoading] = useState(false);
  const [showTurnstileSecretKey, setShowTurnstileSecretKey] = useState(false);

  useEffect(() => {
    setSysSettings(initialSettings);
  }, [initialSettings]);

  const handleSaveSysSettings = async () => {
    setSysLoading(true);
    onSavingChange?.(true);
    try {
      await executeWithTimeout(
        updateSystemSettings({
          turnstile_site_key: sysSettings.turnstile_site_key || "",
          turnstile_secret_key: sysSettings.turnstile_secret_key || "",
          turnstile_enabled_signup: sysSettings.turnstile_enabled_signup || "false",
          turnstile_enabled_login: sysSettings.turnstile_enabled_login || "false",
        }),
        10000
      );
      toasterRef?.current?.show({
        message: t("common.saveSuccess", "保存成功"),
        intent: Intent.SUCCESS,
        icon: "tick",
      });
      onRefresh();
    } catch (e: any) {
      console.error(e);
      // Revert to initialSettings on error or timeout
      setSysSettings(initialSettings);
      toasterRef?.current?.show({
        message: e.message || t("common.saveFailed", "保存失败"),
        intent: Intent.DANGER,
        icon: "error",
      });
    } finally {
      setSysLoading(false);
      onSavingChange?.(false);
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
                type={showTurnstileSecretKey ? "text" : "password"}
                value={sysSettings.turnstile_secret_key || ""}
                onChange={(e) => setSysSettings({ ...sysSettings, turnstile_secret_key: e.target.value })}
                placeholder="0x000..."
                rightElement={
                  <Button
                    minimal={true}
                    icon={showTurnstileSecretKey ? "eye-open" : "eye-off"}
                    onClick={() => setShowTurnstileSecretKey(!showTurnstileSecretKey)}
                    title={showTurnstileSecretKey ? t("auth.hidePassword", "Hide password") : t("auth.showPassword", "Show password")}
                  />
                }
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
