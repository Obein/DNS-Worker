import React from "react";
import { Section, SectionCard, Tag, Intent, Spinner } from "@blueprintjs/core";
import { Activity, Lock } from "lucide-react";
import { clsx } from "clsx";
import { useTranslation } from "react-i18next";
import { formatDateTime } from "../../../../utils/date";
import type { LogEntry } from "../../types";
import { DetailItem } from "./DetailItem";

export interface BasicInfoSectionProps {
  selectedLog: LogEntry;
  detailedLog: LogEntry | null;
  loading: boolean;
}

export const BasicInfoSection: React.FC<BasicInfoSectionProps> = ({
  selectedLog,
  detailedLog,
  loading,
}) => {
  const { t } = useTranslation();
  const isEncryptedLocked = selectedLog.is_encrypted === 1 && (!selectedLog.domain || selectedLog.domain === "[Encrypted]");

  return (
    <Section title={t("logs.basicInfo")} icon={<Activity size={16} />} className="shadow-none! rounded-lg!">
      <SectionCard>
        <div className="space-y-3">
          <DetailItem
            label={t("logs.detailDomain")}
            value={
              <div className="flex items-center gap-2 justify-end font-bold">
                {isEncryptedLocked ? (
                  <Lock size={14} className="text-amber-500" />
                ) : (
                  <img
                    src={`/api/icon/${selectedLog.domain.replace(/^\*\./, "")}.ico`}
                    className="w-4 h-4 rounded-sm"
                    alt=""
                    referrerPolicy="no-referrer"
                    onError={(e) => (e.currentTarget.style.display = "none")}
                  />
                )}
                <span className={clsx({ "italic text-gray-400 dark:text-gray-500": isEncryptedLocked })}>
                  {isEncryptedLocked ? t("logs.encryptedRecord", "[加密记录]") : selectedLog.domain}
                </span>
              </div>
            }
            bold
          />
          {selectedLog.is_encrypted === 1 && (
            <DetailItem
              label={t("settings.e2eeTitle", "端到端加密")}
              value={
                <div className="flex items-center gap-1.5 justify-end">
                  <Lock size={13} className={isEncryptedLocked ? "text-amber-500" : "text-emerald-500"} />
                  <span
                    className={clsx(
                      "text-xs font-medium",
                      isEncryptedLocked ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"
                    )}
                  >
                    {isEncryptedLocked
                      ? t("logs.lockedRecord", "已加密 (未解锁)")
                      : t("logs.decryptedLocal", "端到端加密 (已本地解密)")}
                  </span>
                </div>
              }
            />
          )}
          <DetailItem label={t("logs.detailType")} value={selectedLog.record_type} />
          <DetailItem
            label={t("logs.detailLatency")}
            value={selectedLog.latency ? `${selectedLog.latency} ms` : "-"}
          />
          {selectedLog.access_point_name && (
            <DetailItem label={t("logs.detailAccessPoint")} value={selectedLog.access_point_name} />
          )}
          <DetailItem
            label={t("logs.detailProfile")}
            value={
              loading ? (
                <Spinner size={12} />
              ) : (
                detailedLog?.profile_name || detailedLog?.client_ip || "-"
              )
            }
          />
          <DetailItem
            label={t("logs.detailTime")}
            value={formatDateTime(new Date(selectedLog.timestamp * 1000))}
          />
          <DetailItem
            label={t("logs.detailStatus")}
            value={
              <Tag
                minimal
                intent={
                  selectedLog.action === "PASS"
                    ? Intent.SUCCESS
                    : selectedLog.action === "BLOCK"
                    ? Intent.DANGER
                    : Intent.WARNING
                }
              >
                {selectedLog.action}
              </Tag>
            }
          />
          <DetailItem
            label={t("logs.detailUpstream")}
            value={loading ? <Spinner size={12} /> : detailedLog?.upstream || "-"}
          />
          <DetailItem
            label={t("logs.detailReason")}
            value={selectedLog.reason || t("logs.detailNoReason")}
            italic
          />
          <DetailItem
            label={t("logs.detailECS")}
            value={loading ? <Spinner size={12} /> : detailedLog?.ecs || "-"}
            italic
          />
        </div>
      </SectionCard>
    </Section>
  );
};
