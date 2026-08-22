import React, { useState, useEffect } from "react";
import { Section, SectionCard, Tag, Intent, Button, Spinner } from "@blueprintjs/core";
import { Activity, Globe, User, Edit3, ShieldCheck, ShieldAlert, ArrowRight, MapPin } from "lucide-react";
import { clsx } from "clsx";
import { useTranslation } from "react-i18next";
import { formatDateTime } from "../../../utils/date";
import type {  LogEntry  } from "../types";
import { getFlagEmoji } from "../../../utils/getFlagEmoji";
import { getProfileLogDetails } from "../../../services";
import { SwipeableDrawer } from "../../../components/SwipeableDrawer";

export interface LogDetailsDrawerProps {
  isDrawerOpen: boolean;
  setIsDrawerOpen: (open: boolean) => void;
  selectedLog: LogEntry | null;
  profileId: string;
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
  profileId,
  isMobile,
  onQuickAction,
}) => {
  const { t } = useTranslation();
  const [detailedLog, setDetailedLog] = useState<LogEntry | null>(null);
  const [loading, setLoading] = useState(false);


  useEffect(() => {
    if (isDrawerOpen && selectedLog?.id) {
      setLoading(true);
      setDetailedLog(null);
      
      const controller = new AbortController();
      getProfileLogDetails(profileId, selectedLog.id, { signal: controller.signal })
        .then((data: any) => {
          setDetailedLog(data);
        })
        .catch((err: any) => {
          if (err.name !== "AbortError") {
            console.error(err);
          }
        })
        .finally(() => {
          setLoading(false);
        });

      return () => {
        controller.abort();
      };
    } else {
      setDetailedLog(null);
    }
  }, [isDrawerOpen, selectedLog?.id, profileId]);

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
                <DetailItem label={t("logs.detailLatency")} value={selectedLog.latency ? `${selectedLog.latency} ms` : "-"} />
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
                <DetailItem label={t("logs.detailTime")} value={formatDateTime(new Date(selectedLog.timestamp * 1000))} />
                <DetailItem
                  label={t("logs.detailStatus")}
                  value={
                    <Tag minimal intent={selectedLog.action === "PASS" ? Intent.SUCCESS : selectedLog.action === "BLOCK" ? Intent.DANGER : Intent.WARNING}>
                      {selectedLog.action}
                    </Tag>
                  }
                />
                <DetailItem
                  label={t("logs.detailUpstream")}
                  value={loading ? <Spinner size={12} /> : (detailedLog?.upstream || "-")}
                />
                <DetailItem label={t("logs.detailReason")} value={selectedLog.reason || t("logs.detailNoReason")} italic />
                <DetailItem
                  label={t("logs.detailECS")}
                  value={loading ? <Spinner size={12} /> : (detailedLog?.ecs || "-")}
                  italic
                />
              </div>
            </SectionCard>
          </Section>
 
          {(() => {
            const isType65Or64 =
              selectedLog.record_type === "HTTPS" ||
              selectedLog.record_type === "SVCB" ||
              selectedLog.record_type === "TYPE65" ||
              selectedLog.record_type === "TYPE64";
            const isRewritten =
              isType65Or64 &&
              (selectedLog.reason === "ECH Rewritten" ||
                (selectedLog.reason?.toLowerCase().includes("rewritten") ?? false));

            return (
              <Section
                title={
                  <div className="flex items-center justify-between w-full pr-2">
                    <span>{t("logs.resolutionResult")}</span>
                    {isRewritten && (
                      <Tag minimal intent={Intent.PRIMARY} className="text-xs">
                        {t("logs.rewritten", "Rewritten")}
                      </Tag>
                    )}
                  </div>
                }
                icon={<Globe size={16} />}
                className="shadow-none! rounded-lg!"
              >
                <SectionCard>
                  <div className="bg-gray-50 dark:bg-gray-800 p-3 font-mono text-xs break-all leading-relaxed rounded-lg">
                    {(() => {
                      if (!selectedLog.answer) return t("logs.noResult");
                      const lines = selectedLog.answer.split("\n").map((l) => l.trim()).filter(Boolean);
                      if (lines.length === 0) return t("logs.noResult");

                      return (
                        <div className="space-y-2">
                          {lines.map((line, idx) => {
                            const httpsMatch = line.match(/^(\d+)\s+([^\s]+)(?:\s+(.*))?$/);
                            if (
                              httpsMatch &&
                              (isType65Or64 || line.includes("alpn=") || line.includes("ech=") || line.includes("ipv4hint="))
                            ) {
                              const priority = httpsMatch[1];
                              const target = httpsMatch[2];
                              const paramStr = httpsMatch[3] || "";
                              const params = paramStr.split(/\s+/).filter(Boolean);

                              return (
                                <div
                                  key={idx}
                                  className="bg-white dark:bg-gray-900 p-2.5 rounded-md space-y-2 border border-gray-200 dark:border-gray-700"
                                >
                                  <div className="flex items-center gap-2 text-xs">
                                    <Tag minimal intent={Intent.PRIMARY}>
                                      Priority {priority}
                                    </Tag>
                                    <span className="font-semibold text-gray-700 dark:text-gray-300">
                                      Target: {target}
                                    </span>
                                  </div>
                                  {params.length > 0 && (
                                    <div className="flex flex-wrap gap-1.5 pt-1 border-t border-gray-100 dark:border-gray-800 text-xs">
                                      {params.map((p, pIdx) => {
                                        const eq = p.indexOf("=");
                                        if (eq === -1) {
                                          return (
                                            <Tag key={pIdx} minimal className="font-mono">
                                              {p}
                                            </Tag>
                                          );
                                        }
                                        const k = p.substring(0, eq);
                                        const v = p.substring(eq + 1);
                                        if (k === "ech") {
                                          return (
                                            <Tag
                                              key={pIdx}
                                              minimal
                                              intent={Intent.SUCCESS}
                                              className="font-mono break-all max-w-full select-all"
                                              title={v}
                                            >
                                              <span className="font-bold">ech:</span>{" "}
                                              {v.length > 24 ? `${v.substring(0, 20)}...` : v}
                                            </Tag>
                                          );
                                        }
                                        if (k === "alpn") {
                                          return (
                                            <Tag key={pIdx} minimal intent={Intent.WARNING} className="font-mono">
                                              <span className="font-bold">alpn:</span> {v}
                                            </Tag>
                                          );
                                        }
                                        return (
                                          <Tag key={pIdx} minimal className="font-mono">
                                            <span className="font-bold">{k}:</span> {v}
                                          </Tag>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              );
                            }

                            // Standard comma-separated or raw records
                            const items = line.split(",").map((s) => s.trim()).filter(Boolean);
                            return (
                              <div key={idx} className="space-y-1">
                                {items.map((sub, sIdx) => (
                                  <div
                                    key={sIdx}
                                    className="text-xs font-mono text-gray-800 dark:text-gray-200 select-all"
                                  >
                                    {sub}
                                  </div>
                                ))}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}
                  </div>
                </SectionCard>
              </Section>
            );
          })()}
 
          <Section title={t("logs.networkDetails")} icon={<User size={16} />} className="shadow-none! rounded-lg!">
            <SectionCard>
              <div className="space-y-4">
                <div>
                  <div className="text-[10px] uppercase font-bold opacity-50 mb-1">{t("logs.clientSource")}</div>
                  <div className="flex justify-between items-center">
                    <span className="font-mono">
                      {loading ? <Spinner size={12} /> : (detailedLog?.client_ip || "-")}
                    </span>
                    <Tag minimal title={selectedLog.geo_country || "Unknown"}>
                      {getFlagEmoji(selectedLog.geo_country || "")}
                    </Tag>
                  </div>
                </div>
                {loading ? (
                  <div className="flex items-center justify-center py-2">
                    <Spinner size={16} />
                  </div>
                ) : (
                  detailedLog?.dest_geoip && (
                    <div>
                      <div className="text-[10px] uppercase font-bold opacity-50 mb-1">{t("logs.destination")}</div>
                      {(() => {
                        const geo = JSON.parse(detailedLog.dest_geoip!);
                        return (
                          <div className="bg-gray-50 dark:bg-gray-800 p-3 rounded-lg">
                            <div className="flex items-start gap-3">
                              <MapPin size={16} className="oklch(60.9% 0.126 221.723) mt-1" />
                              <div>
                                <div className="font-bold text-sm">
                                  {[geo.city, geo.region, geo.country].filter(Boolean).join(", ")}
                                </div>
                                <div className="text-xs opacity-70 mt-1">
                                  {geo.isp}
                                  {geo.as && <span className="opacity-60 block mt-0.5">{geo.as}</span>}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  )
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
        </>
      )}
    </SwipeableDrawer>
  );
};
