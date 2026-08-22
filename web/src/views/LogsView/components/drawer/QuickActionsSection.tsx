import React from "react";
import { Section, SectionCard, Button, Intent } from "@blueprintjs/core";
import { Edit3, ShieldCheck, ShieldAlert, ArrowRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { LogEntry } from "../../types";

export interface QuickActionsSectionProps {
  selectedLog: LogEntry;
  onQuickAction?: (domain: string, type: "ALLOW" | "BLOCK" | "REDIRECT", recordType?: string) => void;
}

export const QuickActionsSection: React.FC<QuickActionsSectionProps> = ({
  selectedLog,
  onQuickAction,
}) => {
  const { t } = useTranslation();

  return (
    <Section title={t("logs.quickActions")} icon={<Edit3 size={16} />} className="shadow-none! rounded-lg!">
      <SectionCard>
        <div className="flex flex-col gap-2">
          <Button
            fill
            intent={Intent.SUCCESS}
            icon={<ShieldCheck size={16} />}
            text={t("logs.actionAllow")}
            onClick={() => onQuickAction?.(selectedLog.domain, "ALLOW")}
          />
          <Button
            fill
            intent={Intent.DANGER}
            icon={<ShieldAlert size={16} />}
            text={t("logs.actionBlock")}
            onClick={() => onQuickAction?.(selectedLog.domain, "BLOCK")}
          />
          <Button
            fill
            icon={<ArrowRight size={16} />}
            text={t("logs.actionRedirect")}
            onClick={() => onQuickAction?.(selectedLog.domain, "REDIRECT", selectedLog.record_type)}
          />
        </div>
      </SectionCard>
    </Section>
  );
};
