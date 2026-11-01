/**
 * @file syncIntervalPlanner.ts
 * @description Pure algorithm for detecting missing time intervals by comparing requested query
 * ranges against existing local SQLite watermarks.
 */

import type { SyncWatermark } from "./types";

export interface MissingInterval {
  start: number;
  end: number;
}

/**
 * Computes all missing time intervals between `since` and `until` by analyzing the profile's
 * current local SQLite sync watermark boundaries.
 *
 * @param watermark - Current watermark containing earliest and latest stored timestamps.
 * @param since - Desired query start boundary (seconds).
 * @param until - Desired query end boundary (seconds).
 * @returns Array of MissingInterval intervals that need to be synchronized from the server.
 */
export function planMissingIntervals(
  watermark: SyncWatermark | null,
  since: number,
  until: number
): MissingInterval[] {
  if (since >= until) {
    return [];
  }

  if (
    !watermark ||
    !watermark.earliest_timestamp ||
    !watermark.latest_timestamp ||
    watermark.latest_timestamp <= 0
  ) {
    return [{ start: since, end: until }];
  }

  const { earliest_timestamp: early, latest_timestamp: late } = watermark;
  const intervals: MissingInterval[] = [];

  if (until <= early) {
    // Entire query range is strictly earlier than local data
    intervals.push({ start: since, end: until });
  } else if (since >= late) {
    // Entire query range is strictly later than local data
    intervals.push({ start: since, end: until });
  } else {
    // Overlapping range: check forward and historical missing intervals
    if (until > late) {
      intervals.push({ start: Math.max(since, late - 60), end: until });
    }
    if (since < early) {
      intervals.push({ start: since, end: Math.min(until, early + 60) });
    }
  }

  return intervals;
}
