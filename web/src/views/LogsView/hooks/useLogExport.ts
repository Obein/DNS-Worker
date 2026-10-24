import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Intent, OverlayToaster } from "@blueprintjs/core";
import type { LogEntry, TimeRange } from "../types";
import { generateCSV, downloadCSV, buildExportFilename } from "../utils/export";
import { calculateTimeBoundaries } from "./logData/timeBoundaries";
import { localDb, e2ee } from "../../../services";

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
      const { since, until } = calculateTimeBoundaries(range, customRange);

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

      let logsData: LogEntry[] = [];
      let isRemote = false;

      // 1. Local-First: Prioritize querying client-side SQLite storage (OPFS / in-memory)
      try {
        const isDbReady = await localDb.init();
        if (isDbReady) {
          const localResult = await localDb.queryLogs({
            profileId,
            search: searchQuery.trim() || undefined,
            action: statusFilter || undefined,
            accessPointId: accessPointIdFilter || undefined,
            destCountry: destCountryFilter || undefined,
            isp: ispFilter || undefined,
            since,
            until,
            limit: 100000,
          });

          if (localResult && Array.isArray(localResult.rows) && localResult.rows.length > 0) {
            logsData = localResult.rows;
          }
        }
      } catch (localErr) {
        console.warn("[LogExport] Local SQLite query failed or unavailable, falling back to server:", localErr);
      }

      // 2. Fall back to backend export endpoint if local database has no records
      if (!logsData || logsData.length === 0) {
        isRemote = true;
        const { exportProfileLogs } = await import("../../../services");
        const serverLogs = await exportProfileLogs(profileId, params.toString());
        if (serverLogs && Array.isArray(serverLogs)) {
          logsData = serverLogs;
        }
      }

      if (!logsData || logsData.length === 0) {
        toasterRef?.current?.show({
          message: t("logs.noResults", "No logs found to export"),
          intent: Intent.WARNING
        });
        return;
      }

      // 3. E2EE decryption compatibility for encrypted records
      const hasEncrypted = logsData.some(
        (l) => (l.encrypt_version ?? (l.encrypted_payload ? 1 : 0)) > 0
      );

      if (hasEncrypted) {
        if (!e2ee.isProfileUnlocked(profileId)) {
          try {
            await e2ee.unlockProfile(profileId);
          } catch (unlockErr) {
            console.warn("[LogExport] Auto-unlock attempt failed or was cancelled:", unlockErr);
          }
        }

        logsData = await e2ee.decryptLogsBatch(profileId, logsData);

        const stillEncrypted = logsData.some(
          (l) => (l.encrypt_version ?? (l.encrypted_payload ? 1 : 0)) > 0 || l.domain === "[Encrypted]"
        );

        if (stillEncrypted) {
          toasterRef?.current?.show({
            message: t(
              "logs.e2eeLockedExportWarning",
              "部分日志处于加密状态且未解锁，导出的数据可能包含未解密内容。"
            ),
            intent: Intent.WARNING,
            icon: "lock"
          });
        }
      }

      // 4. Background caching: Populate decrypted server logs into local SQLite for fast subsequent access
      if (isRemote && logsData.length > 0) {
        void localDb.batchInsertLogs(profileId, logsData).catch((cacheErr) => {
          console.warn("[LogExport] Failed to cache exported logs into local SQLite:", cacheErr);
        });
      }

      // 5. Serialize to CSV and trigger file download
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
    } catch (e: unknown) {
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
