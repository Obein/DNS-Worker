import React from "react";
import {
  Card,
  Elevation,
  H5,
  Switch,
  FormGroup,
  InputGroup,
  Button,
  PopoverNext,
  Menu,
  MenuItem,
  Tag,
  Intent,
} from "@blueprintjs/core";
import { Lock, ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ProfileSettings } from "../types";

export interface BestEffortEchCardProps {
  settings: ProfileSettings;
  setSettings: (settings: ProfileSettings) => void;
}

const PRESET_FRONTING_DOMAINS = [
  { domain: "crypto.cloudflare.com", isPreferred: true },
  { domain: "cloudflare-ech.com", isPreferred: false },
  { domain: "one.one.one.one", isPreferred: false },
  { domain: "www.cloudflare.com", isPreferred: false },
  { domain: "encryptedsni.com", isPreferred: false },
  { domain: "cdnjs.com", isPreferred: false },
];

export const BestEffortEchCard: React.FC<BestEffortEchCardProps> = ({ settings, setSettings }) => {
  const { t } = useTranslation();

  const isEnabled = typeof settings.best_effort_ech === "boolean"
    ? settings.best_effort_ech
    : !!settings.best_effort_ech?.enabled;

  const currentFronting = (typeof settings.best_effort_ech === "object" && settings.best_effort_ech?.fronting_domain)
    ? settings.best_effort_ech.fronting_domain
    : "crypto.cloudflare.com";

  const handleToggle = (checked: boolean) => {
    setSettings({
      ...settings,
      best_effort_ech: {
        enabled: checked,
        fronting_domain: currentFronting || "crypto.cloudflare.com",
      },
    });
  };

  const handleDomainChange = (domain: string) => {
    setSettings({
      ...settings,
      best_effort_ech: {
        enabled: isEnabled,
        fronting_domain: domain,
      },
    });
  };

  const frontingMenu = (
    <Menu className="min-w-72">
      {PRESET_FRONTING_DOMAINS.map((item) => (
        <MenuItem
          key={item.domain}
          text={item.domain}
          onClick={() => handleDomainChange(item.domain)}
          labelElement={
            item.isPreferred ? (
              <Tag minimal intent={Intent.PRIMARY} className="text-[10px]">
                {t("settings.echPreferred", "首选")}
              </Tag>
            ) : undefined
          }
        />
      ))}
    </Menu>
  );

  return (
    <Card elevation={Elevation.ONE} className="dark:bg-gray-900 dark:border-gray-800">
      <div className="flex items-center justify-between mb-3">
        <H5 className="flex items-center gap-2 m-0 font-bold text-purple-600 dark:text-purple-400">
          <Lock size={18} /> {t("settings.echTitle")}
        </H5>
        <PopoverNext
          placement="bottom-end"
          usePortal={true}
          content={
            <div className="p-4 max-w-sm">
              <H5>{t("settings.whatIsEch", "何为 ECH (Encrypted Client Hello)？")}</H5>
              <p className="text-sm mb-2">
                {t("settings.echHelpDesc")}
              </p>
              <ul className="list-disc list-inside text-sm opacity-80 mb-3 space-y-1">
                <li>{t("settings.echHelpBenefit1")}</li>
                <li>{t("settings.echHelpBenefit2")}</li>
              </ul>
              <div className="text-xs border-t border-gray-100 dark:border-gray-700 pt-2">
                <a
                  href="https://en.wikipedia.org/wiki/Encrypted_Client_Hello"
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 text-blue-500 hover:underline"
                >
                  <ExternalLink size={10} /> {t("setup.learnMore", "了解更多")}
                </a>
              </div>
            </div>
          }
        >
          <Button icon="help" variant="minimal" intent={Intent.NONE} />
        </PopoverNext>
      </div>

      <div className="space-y-4">
        <Switch
          label={t("settings.enableEch", "启用重写 ECH")}
          checked={isEnabled}
          onChange={(e) => handleToggle(e.currentTarget.checked)}
        />
        <p className="text-xs opacity-60 leading-relaxed">
          {t(
            "settings.echDesc",
            "针对由 Cloudflare 代理的域名，当查询 HTTPS (Type 65) 或 SVCB (Type 64) 记录且上游未配置 ECH 时，自动重写注入 ECH 参数以保护 SNI 隐私。"
          )}
        </p>

        {isEnabled && (
          <div className="space-y-3 pt-3 border-t border-gray-100 dark:border-gray-800">
            <FormGroup
              label={t("settings.echFrontingTitle", "表层 SNI (ECH Fronting)")}
              labelInfo={
                <span className="text-xs opacity-60">
                  {t("settings.echFrontingDesc", "TLS 握手外层可见的伪装域名")}
                </span>
              }
            >
              <InputGroup
                fill
                placeholder={t("settings.echFrontingCustomPlaceholder", "输入自定义表层域名，例如 crypto.cloudflare.com")}
                value={currentFronting}
                onChange={(e) => handleDomainChange(e.target.value)}
                onFocus={(e) => e.target.select()}
                className="font-mono text-sm"
                rightElement={
                  <PopoverNext content={frontingMenu} placement="bottom-end" animation="minimal" arrow={false}>
                    <Button variant="minimal" icon="chevron-down" />
                  </PopoverNext>
                }
              />
            </FormGroup>
          </div>
        )}
      </div>
    </Card>
  );
};
