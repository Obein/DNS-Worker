import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Intent, OverlayToaster } from "@blueprintjs/core";
import type { TimeRange } from "../types";
import { generateCSV, downloadCSV, buildExportFilename } from "../utils/export";

interface LogExportParams {
  profileId: string;
  range: TimeRange;
  customRange: { start: string; end: string };
  statusFilter: string | null;
  accessPointIdFilter: string | null;
  destCountryFilter: string | null;
  ispFilter: string | null;
  searchQuery: string;
  toasterRef?: React.RefObject<OverlayToaster | null>;
}

export function useLogExport({
  profileId,
  range,
  customRange,
  statusFilter,
  accessPointIdFilter,
  destCountryFilter,
  ispFilter,
  searchQuery,
  toasterRef,
}: LogExportParams) {
  const { t } = useTranslation();
  const [exporting, setExporting] = useState(false);

  const handleExportLogs = async () => {
    setExporting(true);
    try {
      const params = new URLSearchParams({ range });
      if (range === "custom" && customRange.start && customRange.end) {
        const startTs = Math.floor(new Date(customRange.start).getTime() / 1000);
        const endTs = Math.floor(new Date(customRange.end).getTime() / 1000);
        params.set("start", String(startTs));
        params.set("end", String(endTs));
      }
      if (statusFilter) params.set("status", statusFilter);
      if (accessPointIdFilter) params.set("access_point_id", accessPointIdFilter);
      if (destCountryFilter) params.set("dest_country", destCountryFilter);
      if (ispFilter) params.set("isp", ispFilter);
      if (searchQuery) params.set("search", searchQuery);

      const { exportProfileLogs } = await import("../../../services");
      const logsData = await exportProfileLogs(profileId, params.toString());
      
      if (!logsData || logsData.length === 0) {
        toasterRef?.current?.show({
          message: t("logs.noResults", "No logs found to export"),
          intent: Intent.WARNING
        });
        return;
      }

      const csvContent = generateCSV(logsData);
      const filename = buildExportFilename(
        profileId,
        logsData[0].timestamp,
        logsData[logsData.length - 1].timestamp,
        params
      );
      downloadCSV(csvContent, filename);

      toasterRef?.current?.show({
        message: t("logs.exportSuccess", "Logs exported successfully"),
        intent: Intent.SUCCESS
      });
    } catch (e: any) {
      console.error("Failed to export logs", e);
      toasterRef?.current?.show({
        message: t("logs.exportError", "Failed to export logs"),
        intent: Intent.DANGER
      });
    } finally {
      setExporting(false);
    }
  };

  return {
    exporting,
    handleExportLogs,
  };
}
