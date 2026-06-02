import React, { useEffect, useState, useMemo } from "react";
import {
  H3,
  H5,
  Intent,
  Button,
  Icon,
  Section,
  SectionCard,
  Callout,
  Tabs,
  Tab,
  Spinner,
  OverlayToaster,
  ButtonGroup,
  Tag,
  Popover,
  Position,
} from "@blueprintjs/core";
import {
  Smartphone,
  Globe,
  AppWindowMac,
  Monitor,
  ShieldCheck,
  Activity,
  MapPin,
  Server,
  Navigation,
  Eye,
  EyeOff,
  ExternalLink,
  Terminal,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { clsx } from "clsx";
import { getPresetRegions, type RegionConfigItem } from "../config/regions";
import { generateMobileConfig } from "../utils/mobileconfig";
import { generateLinuxScript } from "../utils/unixScript";

interface SetupViewProps {
  profileId: string;
  profileKey: string;
  toasterRef?: React.RefObject<OverlayToaster | null>;
}

interface DebugInfo {
  ip: string;
  country: string;
  city: string;
  asn: number;
  asOrganization: string;
  connectedProfileId?: string;
  regions?: Record<string, RegionConfigItem>;
}

// 移动端适配 Hook
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);
  return isMobile;
}

export const SetupView: React.FC<SetupViewProps> = ({
  profileId,
  profileKey,
  toasterRef,
}) => {
  const isMobile = useIsMobile();
  const { t, i18n } = useTranslation();
  const presetRegions = useMemo(() => getPresetRegions(t), [i18n.language]);
  const dohUrl = `${window.location.origin}/${profileKey}`;
  const [debugInfo, setDebugInfo] = useState<DebugInfo | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [pagesDevIp, setPagesDevIp] = useState<string | null>(null);
  const [pagesDevIpv6, setPagesDevIpv6] = useState<string | null>(null);
  const [selectedRegion, setSelectedRegion] = useState<string>("APAC");
  const [showIp, setShowIp] = useState(false);
  const [serverRegions, setServerRegions] = useState<
    Record<string, RegionConfigItem>
  >({});
  const [verifyResult, setVerifyResult] = useState<{
    success: boolean;
    profileMatch: boolean;
  } | null>(null);

  // 默认硬编码的“其他地区”
  const OTHER_REGION: RegionConfigItem = {
    label: t("setup.otherRegion"),
    ips: [],
    countries: [],
  };

  // 整合后的地区配置
  const allRegions = useMemo<Record<string, RegionConfigItem>>(() => {
    return { ...presetRegions, ...serverRegions, Other: OTHER_REGION };
  }, [presetRegions, serverRegions, i18n.language]);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toasterRef?.current?.show({
      message: t("setup.copied"),
      intent: Intent.SUCCESS,
    });
  };

  const resolvePagesDev = async () => {
    try {
      const res = await fetch(
        "https://cloudflare-dns.com/dns-query?name=pages.dev&type=A",
        {
          headers: { Accept: "application/dns-json" },
        },
      );
      const res6 = await fetch(
        "https://cloudflare-dns.com/dns-query?name=pages.dev&type=AAAA",
        {
          headers: { Accept: "application/dns-json" },
        },
      );
      const data = await res.json();
      const data6 = await res6.json();
      if (data.Answer && data.Answer.length > 0) {
        setPagesDevIp(data.Answer[0].data);
      }
      if (data6.Answer && data6.Answer.length > 0) {
        setPagesDevIpv6(data6.Answer[0].data);
      }
    } catch (e) {
      console.error("Failed to resolve pages.dev", e);
    }
  };

  const handleVerify = async () => {
    setIsVerifying(true);
    setVerifyResult(null);
    try {
      const debugRes = await fetch("/api/debug");
      const debugData = await debugRes.json();
      setDebugInfo(debugData);

      if (debugData.regions) {
        const enriched: Record<string, RegionConfigItem> = {};
        for (const [key, ips] of Object.entries(debugData.regions)) {
          enriched[key] = {
            label: presetRegions[key]?.label || key,
            countries: presetRegions[key]?.countries || [],
            ips: ips as any,
          };
        }
        setServerRegions(enriched);
      }

      // 自动推荐地区逻辑
      if (debugData.country) {
        for (const [key, config] of Object.entries(presetRegions)) {
          if (config.countries.includes(debugData.country)) {
            setSelectedRegion(key);
            break;
          }
        }
      }

      setVerifyResult({
        success: !!debugData.connectedProfileId,
        profileMatch: debugData.connectedProfileId === profileId,
      });
    } catch (e) {
      console.error("Verification failed", e);
    } finally {
      setIsVerifying(false);
    }
  };

  useEffect(() => {
    handleVerify();
    resolvePagesDev();
  }, []);

  const currentIps = useMemo(() => {
    const region = allRegions[selectedRegion] || OTHER_REGION;
    const baseIps = [...region.ips];
    if (pagesDevIpv6) {
      baseIps.unshift({
        ip: pagesDevIpv6,
        area: t("setup.dynamicFromPagesDevV6"),
      });
    }
    if (pagesDevIp) {
      baseIps.unshift({ ip: pagesDevIp, area: t("setup.dynamicFromPagesDev") });
    }
    return baseIps;
  }, [selectedRegion, allRegions, pagesDevIp, i18n.language]);

  return (
    <div
      className={`mx-auto space-y-8 pb-24 ${isMobile ? "p-4" : "p-8 max-w-5xl"}`}
    >
      <div className="flex flex-col md:flex-row justify-between items-start gap-4">
        <div>
          <H3 className="font-bold text-gray-900 dark:text-white">
            {t("setup.title")}
          </H3>
          <p className="bp6-text-muted">{t("setup.subtitle")}</p>
        </div>

        <div className="flex flex-col items-end gap-2 w-full md:w-auto">
          <span className="text-[10px] font-bold uppercase opacity-50 flex items-center gap-1">
            <Navigation size={10} /> {t("setup.regionOptimization")}
          </span>
          <ButtonGroup minimal fill={isMobile}>
            {Object.keys(allRegions).map((key) => (
              <Button
                key={key}
                active={selectedRegion === key}
                onClick={() => setSelectedRegion(key)}
                text={isMobile ? key.split("_")[0] : key.replace("_", " ")}
                small
              />
            ))}
          </ButtonGroup>
        </div>
      </div>

      <Section
        title={t("setup.verifyConnection")}
        icon={<Activity size={16} />}
      >
        <SectionCard>
          <div className="flex flex-col space-y-6">
            <div className="flex flex-col md:flex-row items-center justify-between bg-gray-50 dark:bg-gray-800/50 p-6 rounded-xl border border-gray-100 dark:border-gray-800 gap-6">
              <div className="flex flex-col md:flex-row items-center gap-4 text-center md:text-left">
                <div
                  className={`p-3 rounded-full ${verifyResult?.success ? "bg-green-100 text-green-600" : verifyResult ? "bg-red-100 text-red-600" : "bg-blue-100 text-blue-600"}`}
                >
                  {isVerifying ? (
                    <Spinner size={24} />
                  ) : verifyResult?.success ? (
                    <ShieldCheck size={24} />
                  ) : (
                    <Server size={24} />
                  )}
                </div>
                <div>
                  <div className="font-bold text-lg">
                    {isVerifying
                      ? t("setup.verifying")
                      : verifyResult?.success
                        ? t("setup.connected")
                        : t("setup.notConnected")}
                  </div>
                  <div className="text-sm opacity-60">
                    {verifyResult?.success
                      ? verifyResult.profileMatch
                        ? t("setup.profileMatch")
                        : t("setup.profileMismatch")
                      : t("setup.verifyHint")}
                  </div>
                </div>
              </div>
              <Button
                size="large"
                intent={verifyResult?.success ? Intent.SUCCESS : Intent.PRIMARY}
                icon="refresh"
                text={t("setup.refreshStatus")}
                onClick={handleVerify}
                loading={isVerifying}
                fill={isMobile}
              />
            </div>

            {debugInfo && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-white dark:bg-gray-900 p-4 rounded-lg border border-gray-100 dark:border-gray-800 shadow-sm flex items-start gap-3">
                  <Globe size={18} className="text-blue-500 mt-1" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <div className="text-[10px] uppercase font-bold opacity-40">
                        {t("setup.egressIp")}
                      </div>
                      <button
                        onClick={() => setShowIp(!showIp)}
                        className="text-gray-400 hover:text-blue-500 transition-colors"
                      >
                        {showIp ? <Eye size={16} /> : <EyeOff size={16} />}
                      </button>
                    </div>
                    <div className="font-mono font-bold text-blue-600 dark:text-blue-400 truncate">
                      {showIp ? debugInfo.ip : "• • • • • • • • • •"}
                    </div>
                  </div>
                </div>
                <div className="bg-white dark:bg-gray-900 p-4 rounded-lg border border-gray-100 dark:border-gray-800 shadow-sm flex items-start gap-3">
                  <MapPin size={18} className="text-red-500 mt-1" />
                  <div className="min-w-0">
                    <div className="text-[10px] uppercase font-bold opacity-40">
                      {t("setup.currentLocation")}
                    </div>
                    <div className="font-bold truncate">
                      {debugInfo.city}, {debugInfo.country}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </SectionCard>
      </Section>

      <Section
        title={t("setup.dohUrlTitle")}
        icon="globe"
        rightElement={
          <Popover
            position={Position.BOTTOM_RIGHT}
            usePortal={true}
            content={
              <div className="p-4 max-w-sm">
                <H5>{t("setup.whatIsDoh")}</H5>
                <p className="text-sm mb-2">
                  <strong>DNS over HTTPS (DoH)</strong> {t("setup.dohDesc")}
                </p>
                <ul className="list-disc list-inside text-sm opacity-80 mb-3 space-y-1">
                  <li>{t("setup.dohBenefit1")}</li>
                  <li>{t("setup.dohBenefit2")}</li>
                </ul>
                <div className="text-xs border-t border-gray-100 dark:border-gray-700 pt-2">
                  <a
                    href="https://en.wikipedia.org/wiki/DNS_over_HTTPS"
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 text-blue-500 hover:underline"
                  >
                    <ExternalLink size={10} /> {t("setup.learnMore")}
                  </a>
                </div>
              </div>
            }
          >
            <Button icon="help" variant="minimal" intent={Intent.NONE} />
          </Popover>
        }
      >
        <SectionCard>
          <div className="flex flex-col md:flex-row items-center gap-4">
            <div className="flex-1 w-full bg-gray-100 dark:bg-gray-800 p-4 rounded-lg border border-gray-200 dark:border-gray-700 font-mono text-blue-600 dark:text-blue-400 break-all text-xs md:text-sm">
              {dohUrl}
            </div>
            <Button
              size="large"
              intent={Intent.PRIMARY}
              icon="duplicate"
              text={t("setup.copyUrl")}
              fill={isMobile}
              onClick={() => copyToClipboard(dohUrl)}
            />
          </div>
        </SectionCard>
      </Section>

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
          ],
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
              <p
                className="text-[10px] opacity-50 cursor-pointer"
                onClick={() => copyToClipboard("chrome://settings/security")}
              >
                {t(
                  "setup.browserTips",
                  "or copy this URL to the address bar: ",
                ) + "chrome://settings/security"}
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
              <p className="text-[10px] opacity-50 text-center">
                {t("setup.appleWarning")}
              </p>
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
              <p className="text-[10px] opacity-50 mt-4! text-center">
                {t("setup.appleInstallHint")}
              </p>
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
                  region:
                    allRegions[selectedRegion]?.label || t("setup.otherRegion"),
                })}
              </H5>
              <ol className="list-decimal list-inside space-y-4 text-sm leading-relaxed">
                <li>
                  <a href="ms-settings:network-status">
                    {t("setup.windowsStep0")}
                  </a>
                </li>
                <li>{t("setup.windowsStep1")}</li>
                <li>
                  {t("setup.windowsStep2")}
                  <div className="mt-2 flex flex-wrap gap-2">
                    {currentIps.map((item) => (
                      <div key={item.ip} className="flex flex-col gap-1">
                        <Tag
                          minimal
                          interactive
                          onClick={() => copyToClipboard(item.ip)}
                          icon="duplicate"
                          className="font-mono"
                        >
                          {item.ip}
                        </Tag>
                        {!isMobile && (
                          <span className="text-[9px] opacity-40 ml-1">
                            {item.area}
                          </span>
                        )}
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
                    <code>{generateLinuxScript(dohUrl)}</code>
                  </pre>
                  <Button
                    className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
                    icon="duplicate"
                    onClick={() => {
                      copyToClipboard(generateLinuxScript(dohUrl));
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
    </div>
  );
};
