import React from "react";
import { Section, SectionCard, Button, HTMLSelect, Intent, Tag } from "@blueprintjs/core";
import { MonitorSmartphone, Settings2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AccessPoint } from "../../../types/auth";

export interface AccessPointCardProps {
  accessPoints: AccessPoint[];
  selectedApId: string | null;
  onSelectAp: (id: string) => void;
  accessPointName?: string;
  onManageAccessPoints: () => void;
  isMobile: boolean;
}

export const AccessPointCard: React.FC<AccessPointCardProps> = ({
  accessPoints,
  selectedApId,
  onSelectAp,
  accessPointName,
  onManageAccessPoints,
  isMobile,
}) => {
  const { t } = useTranslation();

  return (
    <Section
      title={t("setup.accessPointsCardTitle", "接入点")}
      icon={<MonitorSmartphone size={16} />}
      rightElement={
        <Button
          variant="minimal"
          intent={Intent.PRIMARY}
          className="text-xs! px-2!"
          text={t("setup.moreAccessPoints", "更多接入点 ↗")}
          onClick={onManageAccessPoints}
        />
      }
    >
      <SectionCard>
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex flex-col gap-1.5 w-full sm:w-auto">
            <span className="text-xs opacity-50 font-medium">{t("setup.currentAccessPoint", "当前接入点")}</span>
            <div className="flex items-center gap-3">
              {accessPoints.length > 0 ? (
                <HTMLSelect
                  value={selectedApId || ""}
                  onChange={(e) => onSelectAp(e.target.value)}
                  options={accessPoints.map((ap) => ({ label: ap.name, value: ap.id }))}
                  className="font-semibold text-gray-900 dark:text-gray-100"
                />
              ) : (
                <div className="font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                  {accessPointName || t("setup.defaultAccessPointName", "设备-1")}
                </div>
              )}
              {accessPoints.length > 0 && (
                <Tag minimal round intent={Intent.PRIMARY} className="text-xs">
                  {accessPoints.length}
                </Tag>
              )}
            </div>
          </div>

          <Button
            variant="outlined"
            intent={Intent.NONE}
            icon={<Settings2 size={14} />}
            text={t("setup.manageAccessPoints", "管理接入点")}
            onClick={onManageAccessPoints}
            fill={isMobile}
            className="shrink-0"
          />
        </div>
      </SectionCard>
    </Section>
  );
};
