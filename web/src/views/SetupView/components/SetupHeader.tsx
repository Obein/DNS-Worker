import React from "react";
import { H3, ButtonGroup, Button } from "@blueprintjs/core";
import { Navigation } from "lucide-react";
import { useTranslation } from "react-i18next";
import type {  RegionConfigItem  } from "../../../config/regions";

export interface SetupHeaderProps {
  isMobile: boolean;
  selectedRegion: string;
  setSelectedRegion: (region: string) => void;
  allRegions: Record<string, RegionConfigItem>;
}

export const SetupHeader: React.FC<SetupHeaderProps> = ({ isMobile, selectedRegion, setSelectedRegion, allRegions }) => {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col md:flex-row justify-between items-start gap-4">
      <div>
        <H3 className="font-bold text-gray-900 dark:text-white">{t("setup.title")}</H3>
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
  );
};
