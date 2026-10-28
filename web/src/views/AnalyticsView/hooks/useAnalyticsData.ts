import { useState, useEffect, useCallback, useRef } from "react";
import { Intent, type OverlayToaster } from "@blueprintjs/core";
import { useTranslation } from "react-i18next";
import type { AnalyticsData, TimeRange } from "../types";
import {
  getProfileAccessPoints,
  getProfileDetails,
  getProfileAnalytics,
  localDb,
  e2ee,
  type AccessPoint
} from "../../../services";
import { analyticsCache } from "../utils/analyticsCache";

export interface UseAnalyticsDataReturn {
  data: AnalyticsData | null;
  loading: boolean;
  syncing: boolean;
  syncProgress: number;
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
    apIdFilter?: string | null,
    force?: boolean
  ) => Promise<void>;
  syncTargetRange: () => Promise<void>;
  stopSync: () => void;
}

/**
 * Hook to manage analytics data aggregation, local-first SQLite preview,
 * authoritative server analytics retrieval, and decrypted record merging.
 */
export function useAnalyticsData(
  profileId: string,
  toasterRef?: React.RefObject<OverlayToaster | null>
): UseAnalyticsDataReturn {
  const { t } = useTranslation();
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [syncing, setSyncing] = useState<boolean>(false);
  const [syncProgress, setSyncProgress] = useState<number>(0);
  const [range, setRange] = useState<TimeRange>("1h");
  const [customRange, setCustomRange] = useState({ start: "", end: "" });
  const [accessPointIdFilter, setAccessPointIdFilter] = useState<string | null>(null);
  const [accessPoints, setAccessPoints] = useState<AccessPoint[]>([]);
  const [logRetentionDays, setLogRetentionDays] = useState<number>(30);
  const abortControllerRef = useRef<AbortController | null>(null);
  const syncAbortControllerRef = useRef<AbortController | null>(null);
  const lastSyncInfoRef = useRef<{
    range: TimeRange;
    customStart?: string;
    customEnd?: string;
    accessPointId?: string | null;
    completedAt: number;
  } | null>(null);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
      syncAbortControllerRef.current?.abort();
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
      apIdFilter?: string | null,
      force = false
    ): Promise<void> => {
      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;
      const signal = controller.signal;

      const cacheKey = analyticsCache.buildKey(
        profileId,
        selectedRange,
        customStart,
        customEnd,
        apIdFilter
      );

      if (force) {
        analyticsCache.invalidateProfile(profileId);
      } else {
        // Step -1: Check L1 in-memory client cache for instant preview (0ms latency, 0 server reads)
        const cached = analyticsCache.get(cacheKey);
        if (cached && !signal.aborted) {
          setData(cached.data);
          setLoading(false);
          // If cached data is fresh (within soft TTL), skip server network fetch entirely
          if (!cached.isStale) {
            return;
          }
        }
      }

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
            since = now - 3600;
            bucketSec = 60;
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
      let serverHasValidClients = false;
      let serverHasDestinations = false;
      let serverHasValidTopAllowed = false;
      let serverHasValidTopBlocked = false;

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
          // Check if server returned valid, unencrypted clients
          serverHasValidClients =
            (serverAnalytics.clients || []).length > 0 &&
            serverAnalytics.clients.some(
              (c) =>
                c.client_ip &&
                c.client_ip !== "[Encrypted]" &&
                c.client_ip !== "[Decryption Failed]"
            );

          // Check if server returned valid, unencrypted top_allowed
          serverHasValidTopAllowed =
            (serverAnalytics.top_allowed || []).length > 0 &&
            serverAnalytics.top_allowed.some(
              (d) =>
                d.domain &&
                d.domain !== "[Encrypted]" &&
                d.domain !== "[Decryption Failed]"
            );

          // Check if server returned valid, unencrypted top_blocked
          serverHasValidTopBlocked =
            (serverAnalytics.top_blocked || []).length > 0 &&
            serverAnalytics.top_blocked.some(
              (d) =>
                d.domain &&
                d.domain !== "[Encrypted]" &&
                d.domain !== "[Decryption Failed]"
            );

          // Check if server returned non-empty destinations (plaintext profile)
          serverHasDestinations = (serverAnalytics.destinations || []).length > 0;

          setData((prev) => {
            const nextData: AnalyticsData = {
              ...serverAnalytics!,
              trend: serverAnalytics!.trend || [],
              summary: serverAnalytics!.summary || [],
              top_allowed: serverHasValidTopAllowed
                ? serverAnalytics!.top_allowed
                : (prev?.top_allowed?.length ? prev.top_allowed : serverAnalytics!.top_allowed || []),
              top_blocked: serverHasValidTopBlocked
                ? serverAnalytics!.top_blocked
                : (prev?.top_blocked?.length ? prev.top_blocked : serverAnalytics!.top_blocked || []),
              clients: serverHasValidClients
                ? serverAnalytics!.clients
                : (prev?.clients?.length ? prev.clients : serverAnalytics!.clients || []),
              destinations: serverHasDestinations
                ? serverAnalytics!.destinations
                : (prev?.destinations && prev.destinations.length > 0 ? prev.destinations : [])
            };
            analyticsCache.set(cacheKey, nextData, selectedRange, customEnd);
            return nextData;
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

        const updateFromFreshLocal = async () => {
          if (signal.aborted) return;
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
                if (!curr) {
                  analyticsCache.set(cacheKey, freshLocal, selectedRange, customEnd);
                  return freshLocal;
                }

                // Keep authoritative server data when provided; substitute freshLocal for missing/encrypted fields
                const updated: AnalyticsData = {
                  ...curr,
                  destinations: serverHasDestinations
                    ? curr.destinations
                    : (freshLocal.destinations.length > 0 ? freshLocal.destinations : curr.destinations),
                  top_allowed: serverHasValidTopAllowed
                    ? curr.top_allowed
                    : (freshLocal.top_allowed.length > 0 ? freshLocal.top_allowed : curr.top_allowed),
                  top_blocked: serverHasValidTopBlocked
                    ? curr.top_blocked
                    : (freshLocal.top_blocked.length > 0 ? freshLocal.top_blocked : curr.top_blocked),
                  clients: serverHasValidClients
                    ? curr.clients
                    : (freshLocal.clients.length > 0 ? freshLocal.clients : curr.clients)
                };
                analyticsCache.set(cacheKey, updated, selectedRange, customEnd);
                return updated;
              });
            }
          } catch {
            // Ignore re-query errors
          }
        };

        const inserted = await localDb.syncMissingIntervals(
          profileId,
          since,
          until,
          signal,
          () => {
            // Progressive live update as chunks of missing logs arrive
            updateFromFreshLocal();
          }
        );

        if (!signal.aborted && (inserted > 0 || isUnlocked)) {
          await updateFromFreshLocal();
        }
      } catch (syncErr) {
        if ((syncErr as Error)?.name !== "AbortError") {
          console.warn("[useAnalyticsData] Missing intervals sync error:", syncErr);
        }
      }
    },
    [profileId]
  );

  const syncTargetRange = useCallback(async (): Promise<void> => {
    if (syncing) return;

    const now = Math.floor(Date.now() / 1000);
    const lastSync = lastSyncInfoRef.current;
    const isSameRange =
      lastSync !== null &&
      lastSync.range === range &&
      lastSync.accessPointId === accessPointIdFilter &&
      (range !== "custom" ||
        (lastSync.customStart === customRange.start &&
          lastSync.customEnd === customRange.end));

    // If interval has not changed and was recently synchronized (within 30 seconds),
    // records are guaranteed up to date without redundant execution.
    if (isSameRange && now - lastSync.completedAt < 30) {
      toasterRef?.current?.show({
        message: t("analytics.syncAlreadyUpToDate", "本地记录已是最新"),
        intent: Intent.PRIMARY,
        icon: "tick"
      });
      return;
    }

    setSyncing(true);
    setSyncProgress(0.05);

    syncAbortControllerRef.current?.abort();
    const controller = new AbortController();
    syncAbortControllerRef.current = controller;
    const signal = controller.signal;

    let since: number;
    let until = now;
    let bucketSec: number;

    if (range === "custom" && customRange.start && customRange.end) {
      since = Math.floor(new Date(customRange.start).getTime() / 1000);
      until = Math.floor(new Date(customRange.end).getTime() / 1000);
      const span = until - since;
      bucketSec = span <= 7200 ? 60 : span <= 172800 ? 3600 : 86400;
    } else {
      switch (range) {
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
          since = now - 3600;
          bucketSec = 60;
          break;
      }
    }

    try {
      const refreshLocalData = async () => {
        if (signal.aborted) return;
        try {
          const freshLocal = await localDb.queryAnalytics({
            profileId,
            since,
            until,
            bucketSec,
            accessPointId: accessPointIdFilter || undefined
          });
          if (!signal.aborted) {
            setData((curr) => {
              if (!curr) return freshLocal;
              return {
                ...curr,
                destinations: freshLocal.destinations.length > 0 ? freshLocal.destinations : curr.destinations,
                top_allowed: freshLocal.top_allowed.length > 0 ? freshLocal.top_allowed : curr.top_allowed,
                top_blocked: freshLocal.top_blocked.length > 0 ? freshLocal.top_blocked : curr.top_blocked,
                clients: freshLocal.clients.length > 0 ? freshLocal.clients : curr.clients
              };
            });
          }
        } catch {}
      };

      const inserted = await localDb.syncTargetInterval(
        profileId,
        since,
        until,
        signal,
        (progress) => {
          if (!signal.aborted) {
            setSyncProgress(progress);
            refreshLocalData();
          }
        }
      );

      if (!signal.aborted) {
        lastSyncInfoRef.current = {
          range,
          customStart: customRange.start,
          customEnd: customRange.end,
          accessPointId: accessPointIdFilter,
          completedAt: Math.floor(Date.now() / 1000)
        };

        analyticsCache.invalidateProfile(profileId);

        if (inserted === 0) {
          toasterRef?.current?.show({
            message: t("analytics.syncAlreadyUpToDate", "本地记录已是最新"),
            intent: Intent.PRIMARY,
            icon: "tick"
          });
        } else {
          setSyncProgress(1);
          await refreshLocalData();
          toasterRef?.current?.show({
            message: t("analytics.syncSuccess", "本地记录同步完成"),
            intent: Intent.SUCCESS,
            icon: "tick"
          });
          await new Promise((r) => setTimeout(r, 600));
        }
      }
    } catch (err: any) {
      if ((err as Error)?.name !== "AbortError" && !signal.aborted) {
        console.error("[useAnalyticsData] Manual sync error:", err);
        toasterRef?.current?.show({
          message: t("analytics.syncFailed", "本地记录同步失败"),
          intent: Intent.DANGER,
          icon: "error"
        });
      }
    } finally {
      setSyncing(false);
      setSyncProgress(0);
    }
  }, [profileId, range, customRange, accessPointIdFilter, syncing, toasterRef, t]);

  const stopSync = useCallback(() => {
    if (syncAbortControllerRef.current) {
      syncAbortControllerRef.current.abort();
      syncAbortControllerRef.current = null;
    }
    setSyncing(false);
    setSyncProgress(0);
    toasterRef?.current?.show({
      message: t("analytics.syncStopped", "同步已停止"),
      intent: Intent.WARNING,
      icon: "stop"
    });
  }, [toasterRef, t]);

  useEffect(() => {
    if (range !== "custom") {
      fetchData(range, undefined, undefined, accessPointIdFilter);
    }
  }, [range, accessPointIdFilter, fetchData]);

  return {
    data,
    loading,
    syncing,
    syncProgress,
    range,
    setRange,
    customRange,
    setCustomRange,
    accessPointIdFilter,
    setAccessPointIdFilter,
    accessPoints,
    logRetentionDays,
    fetchData,
    syncTargetRange,
    stopSync
  };
}
