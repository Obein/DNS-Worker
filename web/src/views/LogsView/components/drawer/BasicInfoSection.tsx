import React from "react";
import { Section, SectionCard, Tag, Intent, Spinner } from "@blueprintjs/core";
import { Activity } from "lucide-react";
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

  return (
    <Section title={t("logs.basicInfo")} icon={<Activity size={16} />} className="shadow-none! rounded-lg!">
      <SectionCard>
        <div className="space-y-3">
          <DetailItem
            label={t("logs.detailDomain")}
            value={
              <div className="flex items-center gap-2 justify-end font-bold">
                <img
                  src={`/api/icon/${selectedLog.domain.replace(/^\*\./, "")}.ico`}
                  className="w-4 h-4 rounded-sm"
                  alt=""
                  referrerPolicy="no-referrer"
                  onError={(e) => (e.currentTarget.style.display = "none")}
                />
                <span>{selectedLog.domain}</span>
              </div>
            }
            bold
          />
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
