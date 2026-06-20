import { useTranslation } from "react-i18next";
import { useState, useEffect } from "react";
import { getPresetFilters } from "../../services";

export const usePresetLists = () => {
  const { t } = useTranslation();
  const [presets, setPresets] = useState<{ label: string; url: string }[]>([]);

  useEffect(() => {
    getPresetFilters()
      .then((config) => {
        if (config && Array.isArray(config)) {
          setPresets(config.map((item: any) => ({
            label: t(item.label),
            url: item.url
          })));
        }
      })
      .catch((e) => console.warn("Failed to fetch preset filters from API", e));
  }, [t]);

  return presets;
};
