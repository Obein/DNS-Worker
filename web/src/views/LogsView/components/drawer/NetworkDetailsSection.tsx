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

  const clientIp = detailedLog?.client_ip || selectedLog.client_ip;
  const clientCountry = detailedLog?.geo_country || selectedLog.geo_country;

  let destCountryCode = detailedLog?.dest_country_code || selectedLog.dest_country_code;
  const destCountry = detailedLog?.dest_country || selectedLog.dest_country;
  const destIsp = detailedLog?.dest_isp || selectedLog.dest_isp;

  let geoDetails: {
    locationTitle?: string;
    isp?: string;
    as?: string;
  } | null = null;

  const rawGeoJson = detailedLog?.dest_geoip || selectedLog.dest_geoip;
  if (rawGeoJson) {
    try {
      const geo = JSON.parse(rawGeoJson);
      if (!destCountryCode && geo.country_code) {
        destCountryCode = geo.country_code;
      }
      const locationParts = [geo.city, geo.region, geo.country].filter(Boolean);
      const fallbackTitle = (destCountry || destCountryCode) || undefined;
      geoDetails = {
        locationTitle: locationParts.length > 0 ? locationParts.join(", ") : fallbackTitle,
        isp: (geo.isp || destIsp) || undefined,
        as: geo.as || undefined,
      };
    } catch {
      // Ignore JSON parse errors
    }
  }

  if (!geoDetails && (destCountry || destCountryCode || destIsp)) {
    geoDetails = {
      locationTitle: (destCountry || destCountryCode) || undefined,
      isp: destIsp || undefined,
    };
  }

  return (
    <Section title={t("logs.networkDetails")} icon={<User size={16} />} className="shadow-none! rounded-lg!">
      <SectionCard>
        <div className="space-y-4">
          {/* Client (Source) */}
          <div>
            <div className="text-[10px] uppercase font-bold opacity-50 mb-1">
              {t("logs.clientSource")}
            </div>
            <div className="flex justify-between items-center">
              <span className="font-mono">
                {clientIp || (loading ? <Spinner size={12} /> : "-")}
              </span>
              {(clientCountry || loading) && (
                <Tag minimal title={clientCountry || "Unknown"}>
                  {clientCountry ? getFlagEmoji(clientCountry) : "-"}
                </Tag>
              )}
            </div>
          </div>

          {/* Destination */}
          <div>
            <div className="flex justify-between items-center mb-1">
              <div className="text-[10px] uppercase font-bold opacity-50">
                {t("logs.destination")}
              </div>
              {(destCountryCode || loading) && (
                <Tag minimal title={destCountry || destCountryCode || "Unknown"}>
                  {destCountryCode ? getFlagEmoji(destCountryCode) : "-"}
                </Tag>
              )}
            </div>

            {loading && !geoDetails ? (
              <div className="flex items-center justify-center py-2">
                <Spinner size={16} />
              </div>
            ) : geoDetails ? (
              <div className="bg-gray-50 dark:bg-gray-800 p-3 rounded-lg mt-1">
                <div className="flex items-start gap-3">
                  <MapPin size={16} className="oklch(60.9% 0.126 221.723) mt-1 shrink-0" />
                  <div>
                    {geoDetails.locationTitle && (
                      <div className="font-bold text-sm">
                        {geoDetails.locationTitle}
                      </div>
                    )}
                    {(geoDetails.isp || geoDetails.as) && (
                      <div className="text-xs opacity-70 mt-1">
                        {geoDetails.isp}
                        {geoDetails.as && <span className="opacity-60 block mt-0.5">{geoDetails.as}</span>}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-xs opacity-50 py-1">-</div>
            )}
          </div>
        </div>
      </SectionCard>
    </Section>
  );
};
