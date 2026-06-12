import React from "react";
import { Drawer, Position, Section, SectionCard, Tag, Intent, Button } from "@blueprintjs/core";
import { Activity, Globe, User, Edit3, ShieldCheck, ShieldAlert, ArrowRight, MapPin } from "lucide-react";
import { clsx } from "clsx";
import { useTranslation } from "react-i18next";
import { formatDateTime } from "../../../utils/date";
import type {  LogEntry  } from "../types";
import { getFlagEmoji } from "../utils";

export interface LogDetailsDrawerProps {
  isDrawerOpen: boolean;
  setIsDrawerOpen: (open: boolean) => void;
  selectedLog: LogEntry | null;
  isMobile: boolean;
  onQuickAction?: (domain: string, type: "ALLOW" | "BLOCK" | "REDIRECT", recordType?: string) => void;
}

const DetailItem = ({ label, value, bold, italic }: any) => (
  <div className="flex justify-between items-start gap-4">
    <span className="text-xs opacity-50 mt-1">{label}</span>
    <span className={clsx("text-sm text-right", bold && "font-bold", italic && "italic")}>{value}</span>
  </div>
);

export const LogDetailsDrawer: React.FC<LogDetailsDrawerProps> = ({
  isDrawerOpen,
  setIsDrawerOpen,
  selectedLog,
  isMobile,
  onQuickAction,
}) => {
  const { t } = useTranslation();

  return (
    <Drawer
      isOpen={isDrawerOpen}
      onClose={() => setIsDrawerOpen(false)}
      title={t("logs.details")}
      icon="info-sign"
      position={Position.RIGHT}
      size={isMobile ? "100%" : "450px"}
      className="dark:bg-gray-900 dark:text-white shadow-none! bg-transparent! bg-bulletin! backdrop-blur-sm!"
    >
      {selectedLog && (
        <div className="p-6 space-y-4 overflow-y-auto h-full pb-safe">
          <Section title={t("logs.basicInfo")} icon={<Activity size={16} />} className="shadow-none! rounded-lg!">
            <SectionCard>
              <div className="space-y-3">
                <DetailItem
                  label={t("logs.detailDomain")}
                  value={
                    <div className="flex items-center gap-2 justify-end font-bold">
                      <img
                        src={`https://icons.duckduckgo.com/ip3/${selectedLog.domain.replace(/^\*\./, "")}.ico`}
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
                <DetailItem label={t("logs.detailLatency")} value={selectedLog.latency ? `${selectedLog.latency} ms` : "-"} />
                <DetailItem label={t("logs.detailProfile")} value={selectedLog.profile_name || selectedLog.client_ip} />
                <DetailItem label={t("logs.detailTime")} value={formatDateTime(new Date(selectedLog.timestamp * 1000))} />
                <DetailItem
                  label={t("logs.detailStatus")}
                  value={
                    <Tag minimal intent={selectedLog.action === "PASS" ? Intent.SUCCESS : selectedLog.action === "BLOCK" ? Intent.DANGER : Intent.WARNING}>
                      {selectedLog.action}
                    </Tag>
                  }
                />
                <DetailItem label={t("logs.detailUpstream")} value={selectedLog.upstream || "-"} />
                <DetailItem label={t("logs.detailReason")} value={selectedLog.reason || t("logs.detailNoReason")} italic />
                <DetailItem label={t("logs.detailECS")} value={selectedLog.ecs} italic />
              </div>
            </SectionCard>
          </Section>

          <Section title={t("logs.resolutionResult")} icon={<Globe size={16} />} className="shadow-none! rounded-lg!">
            <SectionCard>
              <div className="bg-gray-50 dark:bg-gray-800 p-3 font-mono text-xs break-all leading-relaxed rounded-lg">
                {selectedLog.answer?.split(/[(,\s)|\n]/).map((ans, idx) => (
                  <div key={idx} className="mb-1 last:mb-0 oklch(30.2% 0.056 229.695) dark:oklch(60.9% 0.126 221.723)">
                    {ans}
                  </div>
                )) || t("logs.noResult")}
              </div>
            </SectionCard>
          </Section>

          <Section title={t("logs.networkDetails")} icon={<User size={16} />} className="shadow-none! rounded-lg!">
            <SectionCard>
              <div className="space-y-4">
                <div>
                  <div className="text-[10px] uppercase font-bold opacity-50 mb-1">{t("logs.clientSource")}</div>
                  <div className="flex justify-between items-center">
                    <span className="font-mono">{selectedLog.client_ip}</span>
                    <Tag minimal title={selectedLog.geo_country || "Unknown"}>
                      {getFlagEmoji(selectedLog.geo_country || "")}
                    </Tag>
                  </div>
                </div>
                {selectedLog.dest_geoip && (
                  <div>
                    <div className="text-[10px] uppercase font-bold opacity-50 mb-1">{t("logs.destination")}</div>
                    {(() => {
                      const geo = JSON.parse(selectedLog.dest_geoip!);
                      return (
                        <div className="bg-gray-50 dark:bg-gray-800 p-3 rounded-lg">
                          <div className="flex items-start gap-3">
                            <MapPin size={16} className="oklch(60.9% 0.126 221.723) mt-1" />
                            <div>
                              <div className="font-bold text-sm">
                                {geo.city}, {geo.country}
                              </div>
                              <div className="text-xs opacity-70 mt-1">{geo.isp}</div>
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>
            </SectionCard>
          </Section>

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
        </div>
      )}
    </Drawer>
  );
};
