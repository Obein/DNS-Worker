import React from "react";
import { Tabs, Tab, H5, Button, Icon, Intent, Tag, Callout } from "@blueprintjs/core";
import { Globe, AppWindowMac, Monitor, Terminal, Smartphone } from "lucide-react";
import { clsx } from "clsx";
import { useTranslation } from "react-i18next";
import type {  RegionConfigItem  } from "../../../config/regions";
import { generateMobileConfig } from "../../../utils/mobileconfig";

export interface SetupTabsProps {
  isMobile: boolean;
  copyToClipboard: (text: string) => void;
  profileKey: string;
  allRegions: Record<string, RegionConfigItem>;
  selectedRegion: string;
  currentIps: { ip: string; area: string | null }[];
}

export const SetupTabs: React.FC<SetupTabsProps> = ({
  isMobile,
  copyToClipboard,
  profileKey,
  allRegions,
  selectedRegion,
  currentIps,
}) => {
  const { t } = useTranslation();

  return (
    <Tabs
      id="setup-tabs"
      renderActiveTabPanelOnly={true}
      vertical={!isMobile} // 移动端使用水平 Tab
      size="large"
      className={clsx(
        "bg-white dark:bg-gray-900 p-4 md:p-6 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm setup-tabs-container",
        isMobile && [
          "[&_.bp6-tab-list]:overflow-x-auto!",
          "[&_.bp6-tab-list]:flex-nowrap!",
          "[&_.bp6-tab-list]:pb-1",
          "[&_.bp6-tab-list]:[scrollbar-width:none]",
          "[&_.bp6-tab-list]:[-ms-overflow-style:none]",
          "[&_.bp6-tab-list::-webkit-scrollbar]:hidden",
          "[&_.bp6-tab]:shrink-0",
        ]
      )}
    >
      <Tab
        id="browsers"
        title={
          <span>
            <Globe size={16} className="inline mr-2" />
            {t("setup.browsers")}
          </span>
        }
        panel={
          <div className="space-y-4 md:ml-4 mt-4 md:mt-0">
            <H5 className="font-bold">{t("setup.browserTitle")}</H5>
            <p className="text-sm">{t("setup.browserSteps")}</p>
            <p className="text-[10px] opacity-50 cursor-pointer" onClick={() => copyToClipboard("chrome://settings/security")}>
              {t("setup.browserTips", "or copy this URL to the address bar: ") + "chrome://settings/security"}
            </p>
          </div>
        }
      />

      <Tab
        id="apple"
        title={
          <span>
            <AppWindowMac size={16} className="inline mr-2" />
            {t("setup.apple")}
          </span>
        }
        panel={
          <div className="space-y-4 md:ml-4 mt-4 md:mt-0">
            <H5 className="font-bold">{t("setup.appleTitle")}</H5>
            <p className="text-sm">{t("setup.appleDesc")}</p>
            <p className="text-[10px] opacity-50 text-center">{t("setup.appleWarning")}</p>
            <div className="p-6 bg-gray-50 dark:bg-gray-800 rounded-xl border border-dashed border-gray-300 dark:border-gray-700 flex flex-col items-center justify-center">
              <Icon icon="document" size={40} className="opacity-20 mb-4" />
              <Button
                intent={Intent.PRIMARY}
                text={t("setup.downloadConfig")}
                icon="download"
                onClick={() => {
                  const xml = generateMobileConfig(profileKey, "Obex", window.location.origin);
                  const blob = new Blob([xml], { type: "application/x-apple-aspen-config" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `obex-${profileKey}.mobileconfig`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
              />
            </div>
            <p className="text-[10px] opacity-50 mt-4! text-center">{t("setup.appleInstallHint")}</p>
          </div>
        }
      />
      <Tab
        id="windows"
        title={
          <span>
            <Monitor size={16} className="inline mr-2" />
            {t("setup.windows")}
          </span>
        }
        panel={
          <div className="space-y-4 md:ml-4 mt-4 md:mt-0">
            <H5 className="font-bold">
              {t("setup.windowsTitle", {
                region: allRegions[selectedRegion]?.label || t("setup.otherRegion"),
              })}
            </H5>
            <ol className="list-decimal list-inside space-y-4 text-sm leading-relaxed">
              <li>
                <a href="ms-settings:network-status">{t("setup.windowsStep0")}</a>
              </li>
              <li>{t("setup.windowsStep1")}</li>
              <li>
                {t("setup.windowsStep2")}
                <div className="mt-2 flex flex-wrap gap-2">
                  {currentIps.map((item) => (
                    <div key={item.ip} className="flex flex-col gap-1">
                      <Tag minimal interactive onClick={() => copyToClipboard(item.ip)} icon="duplicate" className="font-mono">
                        {item.ip}
                      </Tag>
                      {!isMobile && <span className="text-[9px] opacity-40 ml-1">{item.area}</span>}
                    </div>
                  ))}
                </div>
              </li>
              <li>{t("setup.windowsStep3")}</li>
              <li>{t("setup.windowsStep4")}</li>
            </ol>
          </div>
        }
      />

      <Tab
        id="linux"
        title={
          <span>
            <Terminal size={16} className="inline mr-2" />
            {t("setup.linux")}
          </span>
        }
        panel={
          <div className="space-y-4 md:ml-4 mt-4 md:mt-0">
            <H5 className="font-bold">{t("setup.linuxTitle")}</H5>
            <p className="text-sm">{t("setup.linuxDesc")}</p>

            <div className="mt-4">
              <p className="text-sm font-bold mb-2">{t("setup.linuxStep1")}</p>
              <div className="relative group">
                <pre className="bg-gray-100 dark:bg-gray-800 p-4 rounded-lg overflow-x-auto text-xs font-mono border border-gray-200 dark:border-gray-700">
                  <code>{`curl -sL "${window.location.origin}/setup.sh?key=${profileKey}&origin=${window.location.origin}" | sudo bash`}</code>
                </pre>
                <Button
                  className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
                  icon="duplicate"
                  minimal
                  small
                  onClick={() => {
                    copyToClipboard(`curl -sL "${window.location.origin}/setup.sh?key=${profileKey}&origin=${window.location.origin}" | sudo bash`);
                  }}
                />
              </div>
            </div>

            <div className="mt-4">
              <p className="text-sm font-bold">{t("setup.linuxStep2")}</p>
            </div>
          </div>
        }
      />

      <Tab
        id="android"
        title={
          <span>
            <Smartphone size={16} className="inline mr-2" />
            {t("setup.android")}
          </span>
        }
        panel={
          <div className="space-y-4 md:ml-4 mt-4 md:mt-0">
            <H5 className="font-bold">{t("setup.androidTitle")}</H5>
            <p className="text-sm">{t("setup.androidDesc")}</p>
            <Callout intent={Intent.WARNING} icon="help" className="text-xs">
              {t("setup.androidWarning")}
            </Callout>
          </div>
        }
      />
    </Tabs>
  );
};
