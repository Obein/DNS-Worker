/**
 * @file useAnalyticsSync.ts
 * @description Hook managing manual log synchronization, progress updates, cancellation,
 * and user notifications for the active Analytics time range.
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { Intent, type OverlayToaster } from "@blueprintjs/core";
import { useTranslation } from "react-i18next";
import type { TimeRange } from "../types";
import { localDb } from "../../../services";
import { analyticsCache } from "../utils/analyticsCache";
import { calculateTimeInterval, type TimeInterval } from "../utils/timeInterval";

export interface UseAnalyticsSyncParams {
  profileId: string;
  range: TimeRange;
  customRange: { start: string; end: string };
  accessPointIdFilter: string | null;
  toasterRef?: React.RefObject<OverlayToaster | null>;
  onRefreshLocal: (interval: TimeInterval) => Promise<void>;
}

export interface UseAnalyticsSyncReturn {
  syncing: boolean;
  syncProgress: number;
  syncTargetRange: () => Promise<void>;
  stopSync: () => void;
}

/**
 * Orchestrates manual synchronization of target interval logs into local SQLite,
 * providing progressive UI progress updates, toast feedback, and abort control.
 */
export function useAnalyticsSync({
  profileId,
  range,
  customRange,
  accessPointIdFilter,
  toasterRef,
  onRefreshLocal
}: UseAnalyticsSyncParams): UseAnalyticsSyncReturn {
  const { t } = useTranslation();
  const [syncing, setSyncing] = useState<boolean>(false);
  const [syncProgress, setSyncProgress] = useState<number>(0);

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
      syncAbortControllerRef.current?.abort();
    };
  }, []);

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

    const interval = calculateTimeInterval(range, customRange.start, customRange.end, now);

    try {
      const inserted = await localDb.syncTargetInterval(
        profileId,
        interval.since,
        interval.until,
        signal,
        (progress) => {
          if (!signal.aborted) {
            setSyncProgress(progress);
            onRefreshLocal(interval);
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
          await onRefreshLocal(interval);
          toasterRef?.current?.show({
            message: t("analytics.syncSuccess", "本地记录同步完成"),
            intent: Intent.SUCCESS,
            icon: "tick"
          });
          await new Promise((r) => setTimeout(r, 600));
        }
      }
    } catch (err: unknown) {
      if ((err as Error)?.name !== "AbortError" && !signal.aborted) {
        console.error("[useAnalyticsSync] Manual sync error:", err);
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
  }, [profileId, range, customRange, accessPointIdFilter, syncing, toasterRef, t, onRefreshLocal]);

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

  return {
    syncing,
    syncProgress,
    syncTargetRange,
    stopSync
  };
}
