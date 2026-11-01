/**
 * @file test_analytics_and_sync_srp.ts
 * @description Unit tests for decomposed modules following Single Responsibility Principle:
 * - timeInterval: calculateTimeInterval, buildAnalyticsQueryParams
 * - analyticsMerge: inspectServerAnalytics, mergeServerAnalytics, mergeLocalDecryptedAnalytics
 * - syncIntervalPlanner: planMissingIntervals
 * - syncCheckpoint: SyncCheckpointManager
 */

import assert from "node:assert";
import {
  calculateTimeInterval,
  buildAnalyticsQueryParams
} from "../web/src/views/AnalyticsView/utils/timeInterval";
import {
  hasValidClients,
  hasValidDomains,
  inspectServerAnalytics,
  mergeServerAnalytics,
  mergeLocalDecryptedAnalytics
} from "../web/src/views/AnalyticsView/utils/analyticsMerge";
import { planMissingIntervals } from "../web/src/services/localDb/syncIntervalPlanner";
import { SyncCheckpointManager } from "../web/src/services/localDb/syncCheckpoint";
import type { AnalyticsData } from "../web/src/views/AnalyticsView/types";
import type { SyncWatermark } from "../web/src/services/localDb/types";

// Mock localStorage for Node.js test environment
const mockStorage = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (key: string) => mockStorage.get(key) ?? null,
  setItem: (key: string, value: string) => { mockStorage.set(key, value); },
  removeItem: (key: string) => { mockStorage.delete(key); },
  clear: () => { mockStorage.clear(); }
};

function runTests() {
  console.log(">>> [TEST] Running Analytics & Sync Engine SRP Decomposed Tests...");

  // --- Suite 1: timeInterval tests ---
  console.log("1. Testing calculateTimeInterval & buildAnalyticsQueryParams...");
  const refTime = 1700000000;

  const t10m = calculateTimeInterval("10m", undefined, undefined, refTime);
  assert.strictEqual(t10m.since, refTime - 600);
  assert.strictEqual(t10m.until, refTime);
  assert.strictEqual(t10m.bucketSec, 60);

  const t24h = calculateTimeInterval("24h", undefined, undefined, refTime);
  assert.strictEqual(t24h.since, refTime - 86400);
  assert.strictEqual(t24h.bucketSec, 3600);

  const t7d = calculateTimeInterval("7d", undefined, undefined, refTime);
  assert.strictEqual(t7d.since, refTime - 604800);
  assert.strictEqual(t7d.bucketSec, 86400);

  // Custom short range (1 hour => bucket 60s)
  const customShort = calculateTimeInterval(
    "custom",
    "2026-01-01T00:00:00Z",
    "2026-01-01T01:00:00Z",
    refTime
  );
  assert.strictEqual(customShort.bucketSec, 60);

  // Custom medium range (24 hours => bucket 3600s)
  const customMedium = calculateTimeInterval(
    "custom",
    "2026-01-01T00:00:00Z",
    "2026-01-02T00:00:00Z",
    refTime
  );
  assert.strictEqual(customMedium.bucketSec, 3600);

  // Custom long range (7 days => bucket 86400s)
  const customLong = calculateTimeInterval(
    "custom",
    "2026-01-01T00:00:00Z",
    "2026-01-08T00:00:00Z",
    refTime
  );
  assert.strictEqual(customLong.bucketSec, 86400);

  const queryParams = buildAnalyticsQueryParams(
    "custom",
    { since: 1000, until: 2000 },
    "ap_123"
  );
  assert.strictEqual(queryParams, "?range=custom&start=1000&end=2000&access_point_id=ap_123");
  console.log("  PASS: timeInterval utilities verified.");

  // --- Suite 2: analyticsMerge tests ---
  console.log("2. Testing analyticsMerge functions...");
  assert.strictEqual(
    hasValidClients([{ client_ip: "1.2.3.4", geo_country: "US", count: 1 }]),
    true
  );
  assert.strictEqual(
    hasValidClients([{ client_ip: "[Encrypted]", geo_country: "US", count: 1 }]),
    false
  );
  assert.strictEqual(
    hasValidClients([{ client_ip: "[Decryption Failed]", geo_country: "US", count: 1 }]),
    false
  );

  assert.strictEqual(hasValidDomains([{ domain: "example.com", count: 5 }]), true);
  assert.strictEqual(hasValidDomains([{ domain: "[Encrypted]", count: 5 }]), false);

  const serverData: AnalyticsData = {
    summary: [{ action: "PASS", count: 10 }],
    trend: [{ timestamp: 1000, action: "PASS", count: 10 }],
    top_allowed: [{ domain: "[Encrypted]", count: 5 }],
    top_blocked: [],
    clients: [{ client_ip: "[Encrypted]", geo_country: "US", count: 10 }],
    destinations: []
  };

  const flags = inspectServerAnalytics(serverData);
  assert.strictEqual(flags.serverHasValidClients, false);
  assert.strictEqual(flags.serverHasValidTopAllowed, false);
  assert.strictEqual(flags.serverHasDestinations, false);

  const prevData: AnalyticsData = {
    summary: [],
    trend: [],
    top_allowed: [{ domain: "cached-allowed.com", count: 3 }],
    top_blocked: [{ domain: "cached-blocked.com", count: 2 }],
    clients: [{ client_ip: "192.168.1.1", geo_country: "US", count: 8 }],
    destinations: [{ country_code: "US", country: "United States", count: 8 }]
  };

  const merged = mergeServerAnalytics(serverData, prevData, flags);
  assert.strictEqual(merged.summary[0].count, 10);
  assert.strictEqual(merged.clients[0].client_ip, "192.168.1.1");
  assert.strictEqual(merged.destinations[0].country_code, "US");

  const freshLocal: AnalyticsData = {
    summary: [{ action: "PASS", count: 12 }],
    trend: [{ timestamp: 1000, action: "PASS", count: 12 }],
    top_allowed: [{ domain: "decrypted-local.com", count: 7 }],
    top_blocked: [],
    clients: [{ client_ip: "10.0.0.1", geo_country: "DE", count: 12 }],
    destinations: [{ country_code: "DE", country: "Germany", count: 12 }]
  };

  const localMerged = mergeLocalDecryptedAnalytics(merged, freshLocal, flags);
  assert.strictEqual(localMerged.clients[0].client_ip, "10.0.0.1");
  assert.strictEqual(localMerged.top_allowed[0].domain, "decrypted-local.com");
  assert.strictEqual(localMerged.destinations[0].country_code, "DE");
  console.log("  PASS: analyticsMerge utilities verified.");

  // --- Suite 3: syncIntervalPlanner tests ---
  console.log("3. Testing planMissingIntervals...");
  // No watermark -> full range
  const p1 = planMissingIntervals(null, 1000, 2000);
  assert.deepStrictEqual(p1, [{ start: 1000, end: 2000 }]);

  const watermark: SyncWatermark = {
    profile_id: "prof1",
    earliest_timestamp: 1200,
    latest_timestamp: 1800,
    last_synced_at: 1800,
    total_synced_count: 50
  };

  // Strictly earlier
  const pEarlier = planMissingIntervals(watermark, 500, 1000);
  assert.deepStrictEqual(pEarlier, [{ start: 500, end: 1000 }]);

  // Strictly later
  const pLater = planMissingIntervals(watermark, 2000, 2500);
  assert.deepStrictEqual(pLater, [{ start: 2000, end: 2500 }]);

  // Overlapping forward only
  const pForward = planMissingIntervals(watermark, 1300, 2000);
  assert.deepStrictEqual(pForward, [{ start: 1740, end: 2000 }]);

  // Overlapping historical only
  const pHistorical = planMissingIntervals(watermark, 1000, 1500);
  assert.deepStrictEqual(pHistorical, [{ start: 1000, end: 1260 }]);

  // Overlapping both forward and historical
  const pBoth = planMissingIntervals(watermark, 1000, 2000);
  assert.deepStrictEqual(pBoth, [
    { start: 1740, end: 2000 },
    { start: 1000, end: 1260 }
  ]);

  // Completely covered by existing local data
  const pCovered = planMissingIntervals(watermark, 1300, 1700);
  assert.deepStrictEqual(pCovered, []);
  console.log("  PASS: syncIntervalPlanner verified.");

  // --- Suite 4: syncCheckpoint tests ---
  console.log("4. Testing SyncCheckpointManager...");
  const checkpointMgr = new SyncCheckpointManager();
  const cp = {
    since: 1000,
    until: 5000,
    checkpointBefore: 3000,
    syncedCount: 200,
    totalExpected: 500,
    updatedAt: Date.now()
  };

  checkpointMgr.saveCheckpoint("prof1", cp);
  const loaded = checkpointMgr.getCheckpoint("prof1", 1000, 5000);
  assert.ok(loaded !== null);
  assert.strictEqual(loaded?.checkpointBefore, 3000);
  assert.strictEqual(loaded?.syncedCount, 200);

  // Different range should return null
  assert.strictEqual(checkpointMgr.getCheckpoint("prof1", 1000, 6000), null);

  checkpointMgr.clearCheckpoint("prof1");
  assert.strictEqual(checkpointMgr.getCheckpoint("prof1", 1000, 5000), null);
  console.log("  PASS: SyncCheckpointManager verified.");

  console.log("\n======================================================");
  console.log("   ALL ANALYTICS & SYNC SRP TESTS PASSED!            ");
  console.log("======================================================");
}

runTests();
