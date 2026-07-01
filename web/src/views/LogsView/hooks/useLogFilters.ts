import { useState, useEffect } from "react";
import type { TimeRange } from "../types";
import { getProfileAccessPoints, getProfileAnalytics } from "../../../services";
import type { AccessPoint } from "../../../services";

export function useLogFilters(profileId: string) {
  const [range, setRange] = useState<TimeRange>("24h");
  const [customRange, setCustomRange] = useState({ start: "", end: "" });
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [accessPointIdFilter, setAccessPointIdFilter] = useState<string | null>(null);
  const [accessPoints, setAccessPoints] = useState<AccessPoint[]>([]);
  const [destCountryFilter, setDestCountryFilter] = useState<string | null>(null);
  const [countries, setCountries] = useState<{ country_code: string; country: string }[]>([]);
  const [ispFilter, setIspFilter] = useState<string | null>(null);
  const [isps, setIsps] = useState<{ name: string; count: number }[]>([]);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    getProfileAccessPoints(profileId)
      .then(setAccessPoints)
      .catch(console.error);
  }, [profileId]);

  useEffect(() => {
    getProfileAnalytics(profileId, "destinations", "range=30d")
      .then((data) => {
        if (Array.isArray(data)) {
          const filtered = data
            .filter((item: any) => item.country_code)
            .map((item: any) => ({
              country_code: item.country_code,
              country: item.country || item.country_code,
            }));
          setCountries(filtered);
        }
      })
      .catch((e) => console.error("Failed to fetch destinations for filter", e));
  }, [profileId]);

  useEffect(() => {
    setIspFilter(null);
    const params = new URLSearchParams({ range: "30d" });
    if (destCountryFilter) {
      params.set("country_code", destCountryFilter);
    }
    getProfileAnalytics(profileId, "isps", params.toString())
      .then((data) => {
        if (Array.isArray(data)) {
          setIsps(data);
        }
      })
      .catch((e) => console.error("Failed to fetch ISPs for filter", e));
  }, [profileId, destCountryFilter]);

  return {
    range,
    setRange,
    customRange,
    setCustomRange,
    statusFilter,
    setStatusFilter,
    accessPointIdFilter,
    setAccessPointIdFilter,
    accessPoints,
    destCountryFilter,
    setDestCountryFilter,
    countries,
    ispFilter,
    setIspFilter,
    isps,
    searchQuery,
    setSearchQuery,
  };
}
