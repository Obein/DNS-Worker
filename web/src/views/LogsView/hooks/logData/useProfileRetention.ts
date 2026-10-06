import { useState, useEffect } from "react";
import { getProfileDetails } from "../../../../services";

/**
 * Hook to retrieve log retention duration (in days) configured for a profile.
 */
export function useProfileRetention(profileId: string): number {
  const [logRetentionDays, setLogRetentionDays] = useState<number>(30);

  useEffect(() => {
    getProfileDetails(profileId)
      .then((data) => {
        try {
          const settings = JSON.parse(data.settings || "{}");
          setLogRetentionDays(
            settings.log_retention_days !== undefined
              ? Number(settings.log_retention_days)
              : 30
          );
        } catch (e) {
          console.error("[useProfileRetention] Failed to parse settings:", e);
        }
      })
      .catch((e) =>
        console.error("[useProfileRetention] Failed to fetch profile details:", e)
      );
  }, [profileId]);

  return logRetentionDays;
}
