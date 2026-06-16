import React from "react";
import { Section, SectionCard, Button, PopoverNext, H5, Intent, HTMLSelect } from "@blueprintjs/core";
import { ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AccessPoint } from "../../../types/auth";

export interface DohUrlCardProps {
  dohUrl: string;
  accessPointName?: string;
  copyToClipboard: (text: string) => void;
  isMobile: boolean;
  onManageAccessPoints: () => void;
  accessPoints: AccessPoint[];
  selectedApId: string | null;
  onSelectAp: (id: string) => void;
}

export const DohUrlCard: React.FC<DohUrlCardProps> = ({
  dohUrl,
  accessPointName,
  copyToClipboard,
  isMobile,
  onManageAccessPoints,
  accessPoints,
  selectedApId,
  onSelectAp,
}) => {
  const { t } = useTranslation();

  return (
    <Section
      title={t("setup.accessPointTitle")}
      icon="globe"
      rightElement={
        <PopoverNext
          placement="bottom-end"
          usePortal={true}
          content={
            <div className="p-4 max-w-sm">
              <H5>{t("setup.whatIsDoh")}</H5>
              <p className="text-sm mb-2">
                {t("setup.dohDesc")}
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
        </PopoverNext>
      }
    >
      <SectionCard>
        <div className="flex flex-col gap-2">
          <div className="flex justify-between items-center text-sm">
            {accessPoints.length > 0 ? (
              <HTMLSelect
                value={selectedApId || ""}
                onChange={(e) => onSelectAp(e.target.value)}
                options={accessPoints.map(ap => ({ label: ap.name, value: ap.id }))}
                minimal
                className="font-semibold text-gray-900 dark:text-gray-100"
              />
            ) : (
              <div className="font-semibold flex items-center gap-2">
                {accessPointName || t("setup.defaultAccessPointName")}
              </div>
            )}
            <Button 
              variant="minimal" 
              intent={Intent.PRIMARY} 
              className="text-xs! px-2!" 
              text={t("setup.moreAccessPoints")} 
              onClick={onManageAccessPoints} 
            />
          </div>
          <div className="w-full bg-gray-100 dark:bg-gray-800 p-3 rounded-lg border border-gray-200 dark:border-gray-700 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <span className="font-mono text-blue-600 dark:text-blue-400 break-all text-xs sm:text-sm">{dohUrl}</span>
            <Button
              intent={Intent.PRIMARY}
              icon="duplicate"
              text={t("setup.copyUrl")}
              fill={isMobile}
              onClick={() => copyToClipboard(dohUrl)}
              className="shrink-0"
            />
          </div>
        </div>
      </SectionCard>
    </Section>
  );
};

