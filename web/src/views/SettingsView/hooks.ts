import { useMemo } from "react";
import { useTranslation } from "react-i18next";

export const usePresetUpstreams = () => {
  const { t } = useTranslation();
  return useMemo(() => {
    const config = (window as any).OBEX_CONFIG?.upstreams;
    if (config && Array.isArray(config)) {
      return config.map((item: any) => ({
        label: t(item.label),
        url: item.url
      }));
    }
    return [
      { label: t("settings.presetCloudflareSecurity"), url: "https://security.cloudflare-dns.com/dns-query" },
      { label: t("settings.presetCloudflareFamilies"), url: "https://family.cloudflare-dns.com/dns-query" },
      { label: t("settings.presetQuad9"), url: "https://dns.quad9.net/dns-query" },
      { label: t("settings.presetQuad9Ecs"), url: "https://dns11.quad9.net/dns-query" },
      { label: t("settings.presetControlDFree"), url: "https://freedns.controld.com/no-ads-malware-typo" },
      { label: t("settings.presetControlDUncensored"), url: "https://freedns.controld.com/uncensored" },
      { label: t("settings.presetAdGuard"), url: "https://dns.adguard-dns.com/dns-query" },
      { label: t("settings.presetAdGuardFamily"), url: "https://family.adguard-dns.com/dns-query" },
      { label: "Cloudflare (1.1.1.1)", url: "1.1.1.1" },
      { label: "Cloudflare Security (1.1.1.2)", url: "1.1.1.2" },
      { label: "Quad9 (9.9.9.9)", url: "9.9.9.9:9953" },
      { label: "Google (8.8.8.8)", url: "8.8.8.8" },
    ];
  }, [t]);
};

export const useLogRetentionOptions = () => {
  const { t } = useTranslation();
  return useMemo(
    () => [
      { label: t("settings.retention10m"), value: 0.007 },
      { label: t("settings.retention1h"), value: 0.0416 },
      { label: t("settings.retention24h"), value: 1 },
      { label: t("settings.retention7d"), value: 7 },
      { label: t("settings.retention30d"), value: 30 },
      { label: t("settings.retention180d"), value: 180 },
      { label: t("settings.retention360d"), value: 360 },
      { label: t("settings.retention720d"), value: 720 },
    ],
    [t]
  );
};
