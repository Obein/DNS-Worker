import { useMemo, useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { getPresetUpstreams } from "../../services";

export const usePresetUpstreams = () => {
  const { t } = useTranslation();
  const [presets, setPresets] = useState<{ label: string; url: string }[]>([]);

  useEffect(() => {
    getPresetUpstreams()
      .then((config) => {
        if (config && Array.isArray(config)) {
          setPresets(config.map((item: any) => ({
            label: t(item.label),
            url: item.url
          })));
        }
      })
      .catch((e) => console.warn("Failed to fetch preset upstreams from API", e));
  }, [t]);

  return presets;
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
      { label: t("settings.retention90d"), value: 90 },
    ],
    [t]
  );
};
