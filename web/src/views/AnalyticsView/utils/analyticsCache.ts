/**
 * @file analyticsCache.ts
 * @description In-memory multi-tier client-side cache for dashboard analytics queries.
 * Provides instant preview (0ms latency, 0 server reads) on tab switching and range toggles,
 * with adaptive TTL and Stale-While-Revalidate (SWR) background refresh.
 */

import type { AnalyticsData, TimeRange } from "../types";

export interface CacheLookupResult {
  data: AnalyticsData;
  isStale: boolean;
}

interface CacheEntry {
  data: AnalyticsData;
  timestamp: number;
  ttlMs: number;
  staleAfterMs: number;
}

class AnalyticsClientCache {
  private cache = new Map<string, CacheEntry>();
  private readonly MAX_ENTRIES = 50;

  /**
   * Builds a normalized cache key from query parameters.
   */
  buildKey(
    profileId: string,
    range: TimeRange,
    customStart?: string,
    customEnd?: string,
    apIdFilter?: string | null
  ): string {
    return `${profileId}|${range}|${customStart || ""}|${customEnd || ""}|${apIdFilter || "all"}`;
  }

  /**
   * Computes adaptive TTL based on query time range.
   * Real-time ranges (10m, 1h) have short TTLs for freshness;
   * Historical closed hours (24h, 7d, 30d) have longer TTLs to save server read quotas.
   */
  private getTtlConfig(range: TimeRange, customEnd?: string): { ttlMs: number; staleAfterMs: number } {
    const now = Date.now();

    if (range === "custom" && customEnd) {
      const endTs = new Date(customEnd).getTime();
      // If custom end range is older than 2 hours ago, historical data is immutable
      if (now - endTs > 2 * 3600 * 1000) {
        return {
          staleAfterMs: 30 * 60 * 1000, // 30 minutes soft TTL
          ttlMs: 60 * 60 * 1000         // 1 hour hard TTL
        };
      }
    }

    switch (range) {
      case "10m":
      case "1h":
        return {
          staleAfterMs: 30 * 1000, // 30s soft TTL
          ttlMs: 60 * 1000         // 60s hard TTL
        };
      case "24h":
        return {
          staleAfterMs: 2 * 60 * 1000, // 2 minutes soft TTL
          ttlMs: 5 * 60 * 1000         // 5 minutes hard TTL
        };
      case "7d":
      case "30d":
        return {
          staleAfterMs: 5 * 60 * 1000,  // 5 minutes soft TTL
          ttlMs: 15 * 60 * 1000         // 15 minutes hard TTL
        };
      default:
        return {
          staleAfterMs: 60 * 1000,
          ttlMs: 2 * 60 * 1000
        };
    }
  }

  /**
   * Retrieves an entry from cache.
   * Returns data and whether the entry is stale (ready for background revalidation).
   */
  get(key: string): CacheLookupResult | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    const now = Date.now();
    const age = now - entry.timestamp;

    // Hard expiration: evict from cache
    if (age > entry.ttlMs) {
      this.cache.delete(key);
      return null;
    }

    return {
      data: entry.data,
      isStale: age > entry.staleAfterMs
    };
  }

  /**
   * Stores an analytics response in cache with adaptive TTL.
   */
  set(
    key: string,
    data: AnalyticsData,
    range: TimeRange,
    customEnd?: string
  ): void {
    // Evict oldest entries if cache limit reached
    if (this.cache.size >= this.MAX_ENTRIES) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) this.cache.delete(oldestKey);
    }

    const { ttlMs, staleAfterMs } = this.getTtlConfig(range, customEnd);
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttlMs,
      staleAfterMs
    });
  }

  /**
   * Invalidates all cached analytics entries for a given profile.
   * Useful when the user clicks 'Refresh' or when manual sync completes.
   */
  invalidateProfile(profileId: string): void {
    for (const key of Array.from(this.cache.keys())) {
      if (key.startsWith(`${profileId}|`)) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Clears the entire cache.
   */
  clear(): void {
    this.cache.clear();
  }
}

export const analyticsCache = new AnalyticsClientCache();
