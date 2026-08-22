import { useState, useEffect } from "react";
import type { LogEntry } from "../types";
import { getProfileLogDetails } from "../../../services";

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

  return { detailedLog, loading };
}
