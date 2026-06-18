import type {  AnalyticsData, TimeRange  } from "./types";

export function getCountryName(countryCode: string, locale: string = "en"): string {
  if (!countryCode) return "";
  try {
    const regionNames = new Intl.DisplayNames([locale], { type: "region" });
    return regionNames.of(countryCode.toUpperCase()) || countryCode;
  } catch (e) {
    return countryCode;
  }
}

export function processTrendData(data: AnalyticsData | null, range: TimeRange, customRange: { start: string; end: string }) {
  if (!data) return [];

  const trendMap: Record<
    number,
    { timestamp: number; allowed: number; blocked: number; redirected: number }
  > = {};

  // Calculate time range and interval
  let until = Math.floor(Date.now() / 1000);
  let since: number;
  let interval: number;

  switch (range) {
    case "10m":
      interval = 60;
      since = until - 10 * 60;
      break;
    case "1h":
      interval = 60;
      since = until - 60 * 60;
      break;
    case "24h":
      interval = 3600;
      since = until - 24 * 3600;
      break;
    case "7d":
      interval = 86400;
      since = until - 7 * 86400;
      break;
    case "30d":
      interval = 86400;
      since = until - 30 * 86400;
      break;
    case "custom":
      interval = 3600;
      if (customRange.start && customRange.end) {
        since = Math.floor(new Date(customRange.start).getTime() / 1000);
        until = Math.floor(new Date(customRange.end).getTime() / 1000);
      } else {
        const ts = data.trend.map((t) => t.timestamp);
        since = ts.length ? Math.min(...ts) : until - 86400;
        until = ts.length ? Math.max(...ts) : until;
      }
      break;
    default:
      interval = 3600;
      since = until - 24 * 3600;
  }

  since = Math.floor(since / interval) * interval;
  until = Math.floor(until / interval) * interval;

  // Pre-fill all time points
  for (let t = since; t <= until; t += interval) {
    trendMap[t] = {
      timestamp: t,
      allowed: 0,
      blocked: 0,
      redirected: 0,
    };
  }

  data.trend.forEach((t) => {
    // Find nearest interval aligned point
    const ts = Math.floor(t.timestamp / interval) * interval;
    if (!trendMap[ts]) {
      trendMap[ts] = {
        timestamp: ts,
        allowed: 0,
        blocked: 0,
        redirected: 0,
      };
    }
    if (t.action === "PASS") trendMap[ts].allowed += t.count;
    else if (t.action === "BLOCK") trendMap[ts].blocked += t.count;
    else if (t.action === "REDIRECT") trendMap[ts].redirected += t.count;
  });

  return Object.keys(trendMap)
    .sort((a, b) => Number(a) - Number(b))
    .map((k) => trendMap[Number(k)]);
}
