/**
 * @file timeInterval.ts
 * @description Utilities for calculating analytics time boundaries and query parameters.
 */

import type { TimeRange } from "../types";

export interface TimeInterval {
  since: number;
  until: number;
  bucketSec: number;
}

/**
 * Calculates unix timestamp boundaries (since, until) and aggregation bucket sizes
 * based on the selected TimeRange or custom datetime range.
 *
 * @param selectedRange - Preset or custom time range.
 * @param customStart - ISO string for custom range start.
 * @param customEnd - ISO string for custom range end.
 * @param referenceTimeSec - Reference timestamp in seconds (defaults to now).
 * @returns Calculated time interval with since, until, and bucketSec in seconds.
 */
export function calculateTimeInterval(
  selectedRange: TimeRange,
  customStart?: string,
  customEnd?: string,
  referenceTimeSec?: number
): TimeInterval {
  const now = referenceTimeSec ?? Math.floor(Date.now() / 1000);

  if (selectedRange === "custom" && customStart && customEnd) {
    const since = Math.floor(new Date(customStart).getTime() / 1000);
    const until = Math.floor(new Date(customEnd).getTime() / 1000);
    const span = Math.max(0, until - since);
    const bucketSec = span <= 7200 ? 60 : span <= 172800 ? 3600 : 86400;
    return { since, until, bucketSec };
  }

  switch (selectedRange) {
    case "10m":
      return { since: now - 600, until: now, bucketSec: 60 };
    case "1h":
      return { since: now - 3600, until: now, bucketSec: 60 };
    case "24h":
      return { since: now - 86400, until: now, bucketSec: 3600 };
    case "7d":
      return { since: now - 604800, until: now, bucketSec: 86400 };
    case "30d":
      return { since: now - 2592000, until: now, bucketSec: 86400 };
    default:
      return { since: now - 3600, until: now, bucketSec: 60 };
  }
}

/**
 * Builds HTTP query parameter string for profile analytics endpoints.
 *
 * @param selectedRange - Current time range.
 * @param interval - Calculated since and until timestamps.
 * @param apIdFilter - Optional access point filter identifier.
 * @returns Query parameter string including leading question mark.
 */
export function buildAnalyticsQueryParams(
  selectedRange: TimeRange,
  interval: { since: number; until: number },
  apIdFilter?: string | null
): string {
  let queryParams = `?range=${selectedRange}`;
  if (selectedRange === "custom") {
    queryParams += `&start=${interval.since}&end=${interval.until}`;
  }
  if (apIdFilter) {
    queryParams += `&access_point_id=${encodeURIComponent(apIdFilter)}`;
  }
  return queryParams;
}
