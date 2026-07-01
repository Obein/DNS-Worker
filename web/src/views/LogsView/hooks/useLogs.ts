import { useState } from "react";
import { OverlayToaster } from "@blueprintjs/core";
import { useLogFilters } from "./useLogFilters";
import { useLogData } from "./useLogData";
import { useLogAutoRefresh } from "./useLogAutoRefresh";
import { useLogExport } from "./useLogExport";

interface UseLogsParams {
  profileId: string;
  toasterRef?: React.RefObject<OverlayToaster | null>;
}

export function useLogs({ profileId, toasterRef }: UseLogsParams) {
  const [realtimeRefresh, setRealtimeRefresh] = useState(false);

  const filters = useLogFilters(profileId);

  const data = useLogData({
    profileId,
    realtimeRefresh,
    range: filters.range,
    customRange: filters.customRange,
    statusFilter: filters.statusFilter,
    accessPointIdFilter: filters.accessPointIdFilter,
    destCountryFilter: filters.destCountryFilter,
    ispFilter: filters.ispFilter,
    searchQuery: filters.searchQuery,
  });

  useLogAutoRefresh({
    profileId,
    realtimeRefresh,
    range: filters.range,
    statusFilter: filters.statusFilter,
    accessPointIdFilter: filters.accessPointIdFilter,
    destCountryFilter: filters.destCountryFilter,
    ispFilter: filters.ispFilter,
    searchQuery: filters.searchQuery,
    scrollContainerRef: data.scrollContainerRef,
    isFetchingRef: data.isFetchingRef,
    fetchLogs: data.fetchLogs,
  });

  const exportState = useLogExport({
    profileId,
    range: filters.range,
    customRange: filters.customRange,
    statusFilter: filters.statusFilter,
    accessPointIdFilter: filters.accessPointIdFilter,
    destCountryFilter: filters.destCountryFilter,
    ispFilter: filters.ispFilter,
    searchQuery: filters.searchQuery,
    toasterRef,
  });

  return {
    realtimeRefresh,
    setRealtimeRefresh,
    ...filters,
    ...data,
    ...exportState,
  };
}
