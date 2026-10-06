import { useState, useEffect } from "react";
import type { LogEntry } from "../types";
import { getProfileLogDetails } from "../../../services";
import { e2ee } from "../../../services/e2ee";

/**
 * Hook to fetch and manage detailed metadata for a selected log entry.
 *
 * @param isDrawerOpen - Whether the drawer is currently open.
 * @param selectedLog - The selected log entry summary.
 * @param profileId - The profile ID to query logs for.
 * @returns Object containing detailedLog state and loading status.
 */
export function useLogDetails(
  isDrawerOpen: boolean,
  selectedLog: LogEntry | null,
  profileId: string
) {
  const [detailedLog, setDetailedLog] = useState<LogEntry | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isDrawerOpen && selectedLog?.id) {
      setLoading(true);
      // Initialize with selectedLog so summary data (client_ip, answer, etc.) is immediately available
      setDetailedLog(selectedLog);

      const controller = new AbortController();
      getProfileLogDetails(profileId, selectedLog.id, selectedLog.timestamp, { signal: controller.signal })
        .then(async (data: any) => {
          if (controller.signal.aborted) return;
          try {
            const decrypted = await e2ee.decryptLogEntry(profileId, data);
            setDetailedLog((prev) => ({ ...(prev || selectedLog), ...decrypted }));
          } catch {
            setDetailedLog((prev) => ({ ...(prev || selectedLog), ...data }));
          }
        })
        .catch((err: any) => {
          if (err.name !== "AbortError") {
            console.error(err);
            setDetailedLog((prev) => prev || selectedLog);
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setLoading(false);
          }
        });

      return () => {
        controller.abort();
      };
    } else {
      setDetailedLog(null);
    }
  }, [isDrawerOpen, selectedLog?.id, profileId]);

  return { detailedLog, loading };
}
