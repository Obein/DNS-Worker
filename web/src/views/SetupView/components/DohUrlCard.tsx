import React from "react";
import { Section, SectionCard, Button, Popover, Position, H5, Intent } from "@blueprintjs/core";
import { ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";

export interface DohUrlCardProps {
  dohUrl: string;
  copyToClipboard: (text: string) => void;
  isMobile: boolean;
}

export const DohUrlCard: React.FC<DohUrlCardProps> = ({ dohUrl, copyToClipboard, isMobile }) => {
  const { t } = useTranslation();

  return (
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
  );
};
