/**
 * @file useAnalyticsData.ts
 * @description Primary orchestrator hook for analytics data aggregation, coordinating local SQLite preview,
 * authoritative server analytics retrieval, and decrypted record merging.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import type { OverlayToaster } from "@blueprintjs/core";
import type { AnalyticsData, TimeRange } from "../types";
import {
  getProfileAnalytics,
  localDb,
  e2ee,
  type AccessPoint
} from "../../../services";
import { analyticsCache } from "../utils/analyticsCache";
import {
  calculateTimeInterval,
  buildAnalyticsQueryParams,
  type TimeInterval
} from "../utils/timeInterval";
import {
  inspectServerAnalytics,
  mergeServerAnalytics,
  mergeLocalDecryptedAnalytics,
  type AnalyticsValidationFlags
} from "../utils/analyticsMerge";
import { useProfileMetadata } from "./useProfileMetadata";
import { useAnalyticsSync } from "./useAnalyticsSync";

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
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [range, setRange] = useState<TimeRange>("1h");
  const [customRange, setCustomRange] = useState<{ start: string; end: string }>({ start: "", end: "" });
  const [accessPointIdFilter, setAccessPointIdFilter] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const serverFlagsRef = useRef<AnalyticsValidationFlags>({
    serverHasValidClients: false,
    serverHasValidTopAllowed: false,
    serverHasValidTopBlocked: false,
    serverHasDestinations: false
  });

  const { accessPoints, logRetentionDays } = useProfileMetadata(profileId);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  /**
   * Refreshes local decrypted analytics into the active dataset during progressive sync.
   */
  const refreshLocalData = useCallback(
    async (interval: TimeInterval): Promise<void> => {
      try {
        const freshLocal = await localDb.queryAnalytics({
          profileId,
          since: interval.since,
          until: interval.until,
          bucketSec: interval.bucketSec,
          accessPointId: accessPointIdFilter || undefined
        });

        setData((curr) => mergeLocalDecryptedAnalytics(curr, freshLocal, serverFlagsRef.current));
      } catch {
        // Non-critical local aggregation query error
      }
    },
    [profileId, accessPointIdFilter]
  );

  const { syncing, syncProgress, syncTargetRange, stopSync } = useAnalyticsSync({
    profileId,
    range,
    customRange,
    accessPointIdFilter,
    toasterRef,
    onRefreshLocal: refreshLocalData
  });

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

      const interval = calculateTimeInterval(selectedRange, customStart, customEnd);

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
            since: interval.since,
            until: interval.until,
            bucketSec: interval.bucketSec,
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
        const queryParams = buildAnalyticsQueryParams(selectedRange, interval, apIdFilter);

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
          const flags = inspectServerAnalytics(serverAnalytics);
          serverFlagsRef.current = flags;

          setData((prev) => {
            const nextData = mergeServerAnalytics(serverAnalytics!, prev, flags);
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

        const updateFromFreshLocal = async (): Promise<void> => {
          if (signal.aborted) return;
          try {
            const freshLocal = await localDb.queryAnalytics({
              profileId,
              since: interval.since,
              until: interval.until,
              bucketSec: interval.bucketSec,
              accessPointId: apIdFilter || undefined
            });

            if (!signal.aborted) {
              setData((curr) => {
                const updated = mergeLocalDecryptedAnalytics(curr, freshLocal, serverFlagsRef.current);
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
          interval.since,
          interval.until,
          signal,
          () => {
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
