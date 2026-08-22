import React from "react";
import { Section, SectionCard, Tag, Intent } from "@blueprintjs/core";
import { Globe } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { LogEntry } from "../../types";

export interface ResolutionResultSectionProps {
  selectedLog: LogEntry;
}

export const ResolutionResultSection: React.FC<ResolutionResultSectionProps> = ({ selectedLog }) => {
  const { t } = useTranslation();

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
              {t("logs.rewritten", "已重写")}
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
                    (isType65Or64 ||
                      line.includes("alpn=") ||
                      line.includes("ech=") ||
                      line.includes("ipv4hint="))
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
};
