import { useTranslation } from "react-i18next";
import { useMemo } from "react";

export const usePresetLists = () => {
  const { t } = useTranslation();
  return useMemo(() => {
    const config = (window as any).OBEX_CONFIG?.filters;
    if (config && Array.isArray(config)) {
      return config.map((item: any) => ({
        label: t(item.label),
        url: item.url
      }));
    }
    return [
      { label: t("filtering.presetOisdBig"), url: "https://big.oisd.nl" },
      { label: t("filtering.presetOisdNsfw"), url: "https://nsfw.oisd.nl" },
      {
        label: t("filtering.presetAdGuard"),
        url: "https://adguardteam.github.io/AdguardFilters/BaseFilter/sections/adservers.txt",
      },
      {
        label: t("filtering.presetStevenBlack"),
        url: "https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts",
      },
    ];
  }, [t]);
};
