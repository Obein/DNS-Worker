import React from "react";
import { Section, SectionCard, Tag, Spinner } from "@blueprintjs/core";
import { User, MapPin } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { LogEntry } from "../../types";
import { getFlagEmoji } from "../../../../utils/getFlagEmoji";

export interface NetworkDetailsSectionProps {
  selectedLog: LogEntry;
  detailedLog: LogEntry | null;
  loading: boolean;
}

export const NetworkDetailsSection: React.FC<NetworkDetailsSectionProps> = ({
  selectedLog,
  detailedLog,
  loading,
}) => {
  const { t } = useTranslation();

  return (
    <Section title={t("logs.networkDetails")} icon={<User size={16} />} className="shadow-none! rounded-lg!">
      <SectionCard>
        <div className="space-y-4">
          <div>
            <div className="text-[10px] uppercase font-bold opacity-50 mb-1">
              {t("logs.clientSource")}
            </div>
            <div className="flex justify-between items-center">
              <span className="font-mono">
                {loading ? <Spinner size={12} /> : detailedLog?.client_ip || "-"}
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
                <div className="text-[10px] uppercase font-bold opacity-50 mb-1">
                  {t("logs.destination")}
                </div>
                {(() => {
                  try {
                    const geo = JSON.parse(detailedLog.dest_geoip!);
                    return (
                      <div className="bg-gray-50 dark:bg-gray-800 p-3 rounded-lg">
                        <div className="flex items-start gap-3">
                          <MapPin size={16} className="oklch(60.9% 0.126 221.723) mt-1 shrink-0" />
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
                  } catch {
                    return null;
                  }
                })()}
              </div>
            )
          )}
        </div>
      </SectionCard>
    </Section>
  );
};
