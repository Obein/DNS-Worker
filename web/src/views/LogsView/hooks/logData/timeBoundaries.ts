import type { TimeRange } from "../../types";

export interface TimeBoundaries {
  since: number;
  until: number;
}

/**
 * Calculates Unix timestamp boundaries (in seconds) for a given time range or custom date range.
 */
export function calculateTimeBoundaries(
  range: TimeRange,
  customRange: { start: string; end: string }
): TimeBoundaries {
  const now = Math.floor(Date.now() / 1000);

  if (range === "custom" && customRange.start && customRange.end) {
    const since = Math.floor(new Date(customRange.start).getTime() / 1000);
    const until = Math.floor(new Date(customRange.end).getTime() / 1000);
    return { since, until };
  }

  let since: number;
  switch (range) {
    case "10m":
      since = now - 600;
      break;
    case "1h":
      since = now - 3600;
      break;
    case "24h":
      since = now - 86400;
      break;
    case "7d":
      since = now - 604800;
      break;
    case "30d":
      since = now - 2592000;
      break;
    default:
      since = now - 86400;
      break;
  }

  return { since, until: now };
}
