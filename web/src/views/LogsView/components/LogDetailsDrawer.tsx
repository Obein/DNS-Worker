import React from "react";
import { Activity } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { LogEntry } from "../types";
import { SwipeableDrawer } from "../../../components/SwipeableDrawer";
import { useLogDetails } from "../hooks/useLogDetails";
import { BasicInfoSection } from "./drawer/BasicInfoSection";
import { ResolutionResultSection } from "./drawer/ResolutionResultSection";
import { NetworkDetailsSection } from "./drawer/NetworkDetailsSection";
import { QuickActionsSection } from "./drawer/QuickActionsSection";

export interface LogDetailsDrawerProps {
  isDrawerOpen: boolean;
  setIsDrawerOpen: (open: boolean) => void;
  selectedLog: LogEntry | null;
  profileId: string;
  isMobile: boolean;
  onQuickAction?: (domain: string, type: "ALLOW" | "BLOCK" | "REDIRECT", recordType?: string) => void;
}

/**
 * Drawer presenting comprehensive query metadata, resolution results, and diagnostic details.
 */
export const LogDetailsDrawer: React.FC<LogDetailsDrawerProps> = ({
  isDrawerOpen,
  setIsDrawerOpen,
  selectedLog,
  profileId,
  isMobile,
  onQuickAction,
}) => {
  const { t } = useTranslation();
  const { detailedLog, loading } = useLogDetails(isDrawerOpen, selectedLog, profileId);

  return (
    <SwipeableDrawer
      isOpen={isDrawerOpen && selectedLog !== null}
      onClose={() => setIsDrawerOpen(false)}
      title={
        <div className="flex items-center gap-2">
          <Activity size={18} />
          <span>{t("logs.logDetails")}</span>
        </div>
      }
      icon="info-sign"
      size={isMobile ? "100%" : "450px"}
    >
      {selectedLog && (
        <>
          <BasicInfoSection
            selectedLog={selectedLog}
            detailedLog={detailedLog}
            loading={loading}
          />

          <ResolutionResultSection selectedLog={selectedLog} />

          <NetworkDetailsSection
            selectedLog={selectedLog}
            detailedLog={detailedLog}
            loading={loading}
          />

          <QuickActionsSection
            selectedLog={selectedLog}
            onQuickAction={onQuickAction}
          />
        </>
      )}
    </SwipeableDrawer>
  );
};
