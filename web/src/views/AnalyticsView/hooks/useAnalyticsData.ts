import { useState, useEffect, useCallback, useRef } from "react";
import type { AnalyticsData, TimeRange } from "../types";
import {
  getProfileAccessPoints,
  getProfileDetails,
  getProfileAnalytics,
  localDb,
  e2ee,
  type AccessPoint
} from "../../../services";

export interface UseAnalyticsDataReturn {
  data: AnalyticsData | null;
  loading: boolean;
  range: TimeRange;
  setRange: React.Dispatch<React.SetStateAction<TimeRange>>;
  customRange: { start: string; end: string };
  setCustomRange: React.Dispatch<React.SetStateAction<{ start: string; end: string }>>;
  accessPointIdFilter: string | null;
  setAccessPointIdFilter: React.Dispatch<React.SetStateAction<string | null>>;
  accessPoints: AccessPoint[];
  logRetentionDays: number;
  fetchData: (
    selectedRange: TimeRange,
    customStart?: string,
    customEnd?: string,
    apIdFilter?: string | null
  ) => Promise<void>;
}

/**
 * Hook to manage analytics data aggregation, local-first SQLite preview,
 * authoritative server analytics retrieval, and decrypted record merging.
 */
export function useAnalyticsData(profileId: string): UseAnalyticsDataReturn {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [range, setRange] = useState<TimeRange>("24h");
  const [customRange, setCustomRange] = useState({ start: "", end: "" });
  const [accessPointIdFilter, setAccessPointIdFilter] = useState<string | null>(null);
  const [accessPoints, setAccessPoints] = useState<AccessPoint[]>([]);
  const [logRetentionDays, setLogRetentionDays] = useState<number>(30);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    getProfileAccessPoints(profileId)
      .then((res) => setAccessPoints(res))
      .catch((e) => console.error("[useAnalyticsData] Failed to load access points:", e));
  }, [profileId]);

  useEffect(() => {
    getProfileDetails(profileId)
      .then((res) => {
        try {
          const settings = JSON.parse(res.settings || "{}");
          setLogRetentionDays(
            settings.log_retention_days !== undefined
              ? Number(settings.log_retention_days)
              : 30
          );
        } catch (e) {
          console.error("[useAnalyticsData] Failed to parse settings:", e);
        }
      })
      .catch((e) => console.error("[useAnalyticsData] Failed to fetch profile settings:", e));
  }, [profileId]);

  const fetchData = useCallback(
    async (
      selectedRange: TimeRange,
      customStart?: string,
      customEnd?: string,
      apIdFilter?: string | null
    ): Promise<void> => {
      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;
      const signal = controller.signal;

      setLoading(true);

      const now = Math.floor(Date.now() / 1000);
      let since: number;
      let until = now;
      let bucketSec: number;

      if (selectedRange === "custom" && customStart && customEnd) {
        since = Math.floor(new Date(customStart).getTime() / 1000);
        until = Math.floor(new Date(customEnd).getTime() / 1000);
        const span = until - since;
        bucketSec = span <= 7200 ? 60 : span <= 172800 ? 3600 : 86400;
      } else {
        switch (selectedRange) {
          case "10m":
            since = now - 600;
            bucketSec = 60;
            break;
          case "1h":
            since = now - 3600;
            bucketSec = 60;
            break;
          case "24h":
            since = now - 86400;
            bucketSec = 3600;
            break;
          case "7d":
            since = now - 604800;
            bucketSec = 86400;
            break;
          case "30d":
            since = now - 2592000;
            bucketSec = 86400;
            break;
          default:
            since = now - 86400;
            bucketSec = 3600;
            break;
        }
      }

      // Step 0: Ensure local encrypted logs are re-decrypted if E2EE is unlocked
      try {
        if (e2ee.isProfileUnlocked(profileId) || e2ee.isUnlocked()) {
          await localDb.reDecryptLocalLogs(profileId);
        }
      } catch {
        // Non-critical local decryption check
      }

      // Step 1: Attempt Local-First SQLite aggregation for instant preview (0ms latency)
      try {
        const isDbReady = await localDb.init();
        if (isDbReady && !signal.aborted) {
          const localAnalytics = await localDb.queryAnalytics({
            profileId,
            since,
            until,
            bucketSec,
            accessPointId: apIdFilter || undefined
          });

          if (localAnalytics.summary.some((s) => s.count > 0) && !signal.aborted) {
            setData(localAnalytics);
            setLoading(false);
          }
        }
      } catch (localErr) {
        console.warn("[useAnalyticsData] Local SQLite preview failed:", localErr);
      }

      // Step 2: Fetch Authoritative Analytics from Server
      try {
        let queryParams = `?range=${selectedRange}`;
        if (selectedRange === "custom" && customStart && customEnd) {
          queryParams += `&start=${since}&end=${until}`;
        }
        if (apIdFilter) {
          queryParams += `&access_point_id=${apIdFilter}`;
        }

        let serverAnalytics: AnalyticsData | null = null;
        try {
          serverAnalytics = await getProfileAnalytics(profileId, "", queryParams);
        } catch {
          if (signal.aborted) return;
          // Fallback to separate endpoints if unified endpoint fails
          const [summary, trend, topAllowed, topBlocked, clients, destinations] =
            await Promise.all([
              getProfileAnalytics(profileId, "summary", queryParams),
              getProfileAnalytics(profileId, "trend", queryParams),
              getProfileAnalytics(profileId, "top_allowed", queryParams),
              getProfileAnalytics(profileId, "top_blocked", queryParams),
              getProfileAnalytics(profileId, "clients", queryParams),
              getProfileAnalytics(profileId, "destinations", queryParams)
            ]);
          serverAnalytics = {
            summary,
            trend,
            top_allowed: topAllowed,
            top_blocked: topBlocked,
            clients,
            destinations
          };
        }

        if (serverAnalytics && !signal.aborted) {
          setData((prev) => {
            const hasLocalDecrypted =
              prev &&
              (prev.top_allowed?.some(
                (d) =>
                  d.domain &&
                  d.domain !== "[Encrypted]" &&
                  d.domain !== "[Decryption Failed]"
              ) ||
                prev.top_blocked?.some(
                  (d) =>
                    d.domain &&
                    d.domain !== "[Encrypted]" &&
                    d.domain !== "[Decryption Failed]"
                ) ||
                prev.clients?.some(
                  (c) =>
                    c.client_ip &&
                    c.client_ip !== "[Encrypted]" &&
                    c.client_ip !== "[Decryption Failed]"
                ));

            // For destinations:
            // If server returned non-empty destinations (plaintext profile), use server's complete analytics.
            // If server returned empty destinations (E2EE profile where dest fields are null on server),
            // retain local decrypted destinations from prev if available.
            const serverHasDestinations = (serverAnalytics!.destinations || []).length > 0;
            const effectiveDestinations = serverHasDestinations
              ? serverAnalytics!.destinations
              : (prev?.destinations && prev.destinations.length > 0 ? prev.destinations : []);

            return {
              ...serverAnalytics!,
              trend: serverAnalytics!.trend || [],
              summary: serverAnalytics!.summary || [],
              top_allowed:
                hasLocalDecrypted &&
                prev?.top_allowed?.length &&
                prev.top_allowed.some((d) => d.domain !== "[Encrypted]")
                  ? prev.top_allowed
                  : serverAnalytics!.top_allowed || [],
              top_blocked:
                hasLocalDecrypted &&
                prev?.top_blocked?.length &&
                prev.top_blocked.some((d) => d.domain !== "[Encrypted]")
                  ? prev.top_blocked
                  : serverAnalytics!.top_blocked || [],
              clients:
                hasLocalDecrypted &&
                prev?.clients?.length &&
                prev.clients.some((c) => c.client_ip !== "[Encrypted]")
                  ? prev.clients
                  : serverAnalytics!.clients || [],
              destinations: effectiveDestinations
            };
          });
        }
      } catch (e) {
        if (!signal.aborted) {
          console.error("[useAnalyticsData] Failed to fetch server analytics:", e);
        }
      } finally {
        if (!signal.aborted) {
          setLoading(false);
        }
      }

      // Step 3: Download missing time intervals into local SQLite and refresh aggregations
      try {
        const isUnlocked = e2ee.isProfileUnlocked(profileId) || e2ee.isUnlocked();
        const inserted = await localDb.syncMissingIntervals(
          profileId,
          since,
          until,
          signal
        );

        if (!signal.aborted && (inserted > 0 || isUnlocked)) {
          try {
            const freshLocal = await localDb.queryAnalytics({
              profileId,
              since,
              until,
              bucketSec,
              accessPointId: apIdFilter || undefined
            });

            if (!signal.aborted) {
              setData((curr) => {
                if (!curr) return freshLocal;
                return {
                  ...curr,
                  destinations:
                    freshLocal.destinations.length > 0
                      ? freshLocal.destinations
                      : curr.destinations,
                  top_allowed:
                    freshLocal.top_allowed.length > 0
                      ? freshLocal.top_allowed
                      : curr.top_allowed,
                  top_blocked:
                    freshLocal.top_blocked.length > 0
                      ? freshLocal.top_blocked
                      : curr.top_blocked,
                  clients:
                    freshLocal.clients.length > 0
                      ? freshLocal.clients
                      : curr.clients
                };
              });
            }
          } catch {
            // Ignore re-query errors
          }
        }
      } catch (syncErr) {
        if ((syncErr as Error)?.name !== "AbortError") {
          console.warn("[useAnalyticsData] Missing intervals sync error:", syncErr);
        }
      }
    },
    [profileId]
  );

  useEffect(() => {
    if (range !== "custom") {
      fetchData(range, undefined, undefined, accessPointIdFilter);
    }
  }, [range, accessPointIdFilter, fetchData]);

  return {
    data,
    loading,
    range,
    setRange,
    customRange,
    setCustomRange,
    accessPointIdFilter,
    setAccessPointIdFilter,
    accessPoints,
    logRetentionDays,
    fetchData
  };
}
