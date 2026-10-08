import React from "react";
import { H3 } from "@blueprintjs/core";
import { useTranslation } from "react-i18next";
import { DeploymentModeBadge } from "../../../components/DeploymentMode";

export interface SetupHeaderProps {
  isMobile?: boolean;
}

export const SetupHeader: React.FC<SetupHeaderProps> = () => {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
      <div>
        <H3 className="font-bold text-gray-900 dark:text-white m-0">{t("setup.title")}</H3>
        <p className="bp6-text-muted m-0 mt-1">{t("setup.subtitle")}</p>
      </div>

      <div className="flex items-center">
        <DeploymentModeBadge />
      </div>
    </div>
  );
};

