import React from "react";
import { H4, H5, Tag, PopoverNext, Button, Intent } from "@blueprintjs/core";
import { Lock } from "lucide-react";
import { useTranslation } from "react-i18next";

export interface E2eeHeaderProps {
  isLogsE2eeEnabled: boolean;
}

export const E2eeHeader: React.FC<E2eeHeaderProps> = ({ isLogsE2eeEnabled }) => {
  const { t } = useTranslation();

  return (
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center gap-2">
        <Lock
          size={20}
          className={isLogsE2eeEnabled ? "text-emerald-500" : "text-gray-400"}
        />
        <H4 style={{ margin: 0 }}>
          {t("account.e2ee.title", "E2EE")}
        </H4>
        <Tag
          intent={isLogsE2eeEnabled ? Intent.SUCCESS : Intent.NONE}
          minimal
          round
        >
          {isLogsE2eeEnabled
            ? t("account.e2ee.enabled")
            : t("account.e2ee.disabled")}
        </Tag>
      </div>
      <PopoverNext
        placement="bottom-end"
        usePortal={true}
        content={
          <div className="p-4 max-w-sm">
            <H5>{t("account.e2ee.trustBoundaryTitle")}</H5>
            <p className="text-sm text-gray-700 dark:text-gray-300 m-0">
              {t(
                "account.e2ee.trustBoundaryDesc",
                "All DNS query traffic inevitably passes through the hosting server (Cloudflare Workers edge nodes or self-hosted server runtime) during resolution, where queries are processed in memory before being encrypted and saved. This feature strictly protects data at rest in the cloud database (D1 / persistent storage) from data leaks or offline analysis; it does not conceal active network traffic from the hosting server processing the request."
              )}
            </p>
          </div>
        }
      >
        <Button icon="help" variant="minimal" intent={Intent.NONE} />
      </PopoverNext>
    </div>
  );
};
