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
  const effectiveEncryptVersion =
    detailedLog?.encrypt_version ??
    selectedLog.encrypt_version ??
    (detailedLog?.kem_key_id || selectedLog.kem_key_id ? 2 : 0);
  const isEncrypted =
    effectiveEncryptVersion > 0 ||
    Boolean(selectedLog.kem_key_id || selectedLog.encrypted_payload || detailedLog?.kem_key_id || detailedLog?.encrypted_payload);
  const isPqc =
    effectiveEncryptVersion === 2 ||
    Boolean(selectedLog.kem_key_id || detailedLog?.kem_key_id);
  const isEncryptedLocked = isEncrypted && (!selectedLog.domain || selectedLog.domain === "[Encrypted]");

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
          <DetailItem label={t("logs.detailType")} value={selectedLog.record_type} />
          <DetailItem
            label={t("logs.detailLatency")}
            value={selectedLog.latency ? `${selectedLog.latency} ms` : "-"}
          />
          <DetailItem
            label={t("logs.detailAccessPoint")}
            value={
              (() => {
                const apName = detailedLog?.access_point_name || selectedLog.access_point_name;
                const apId = detailedLog?.access_point_id || selectedLog.access_point_id;

                if (apName) {
                  return apId && apId !== apName ? (
                    <span title={apId} className="cursor-help">
                      {apName}
                    </span>
                  ) : (
                    apName
                  );
                }
                if (apId) {
                  return <span className="font-mono text-xs">{apId}</span>;
                }
                if (loading) {
                  return <Spinner size={12} />;
                }
                return "-";
              })()
            }
          />
          <DetailItem
            label={t("logs.detailProfile")}
            value={
              detailedLog?.profile_name || detailedLog?.client_ip || selectedLog.client_ip || (loading ? <Spinner size={12} /> : "-")
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
            value={detailedLog?.upstream || selectedLog.upstream || (loading ? <Spinner size={12} /> : "-")}
          />
          <DetailItem
            label={t("logs.detailReason")}
            value={selectedLog.reason || t("logs.detailNoReason")}
            italic
          />
          <DetailItem
            label={t("logs.detailECS")}
            value={detailedLog?.ecs || selectedLog.ecs || (loading ? <Spinner size={12} /> : "-")}
            italic
          />
          <DetailItem
            label={t("logs.detailIsClientEncrypted", "是否用户端加密")}
            value={
              isEncrypted ? (
                <div className="flex items-center gap-1.5 justify-end">
                  <Lock size={13} className={isEncryptedLocked ? "text-amber-500" : "text-emerald-500"} />
                  <span
                    className={clsx(
                      "text-xs font-medium",
                      isEncryptedLocked ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"
                    )}
                  >
                    {isEncryptedLocked
                      ? t("logs.encryptedLocked", "是 (未解锁)")
                      : t("logs.encryptedYes", "是")}
                    {isPqc ? " (PQC)" : ""}
                  </span>
                </div>
              ) : (
                <span className="text-xs text-gray-400 dark:text-gray-500">
                  {t("logs.notEncrypted", "否")}
                </span>
              )
            }
          />
        </div>
      </SectionCard>
    </Section>
  );
};
