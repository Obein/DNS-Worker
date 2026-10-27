import { useState, useEffect } from "react";
import type { TimeRange } from "../types";
import { getProfileAccessPoints } from "../../../services";
import type { AccessPoint } from "../../../services";

export function useLogFilters(profileId: string) {
  const [range, setRange] = useState<TimeRange>("1h");
  const [customRange, setCustomRange] = useState({ start: "", end: "" });
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [accessPointIdFilter, setAccessPointIdFilter] = useState<string | null>(null);
  const [accessPoints, setAccessPoints] = useState<AccessPoint[]>([]);
  const [destCountryFilter, setDestCountryFilter] = useState<string | null>(null);
  const [ispFilter, setIspFilter] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    getProfileAccessPoints(profileId)
      .then(setAccessPoints)
      .catch(console.error);
  }, [profileId]);

  // Reset ISP selection whenever the destination country changes
  useEffect(() => {
    setIspFilter(null);
  }, [destCountryFilter]);

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
    ispFilter,
    setIspFilter,
    searchQuery,
    setSearchQuery,
  };
}
