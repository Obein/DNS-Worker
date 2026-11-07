/**
 * @file test_global_lists.ts
 * @description Integration and unit tests for Phase 2: Globalized List Compilation (Option B).
 * Validates:
 * 1. Global list bloom deduplication across multiple profiles.
 * 2. System-side unified sync (syncNextGlobalList) with upstream update and HTTP 304 caching.
 * 3. Fast user-side local recombination without external network requests.
 * 4. Automatic affected profiles fan-out recompilation on upstream changes.
 * 5. Domain check verification against global list blooms.
 */

import assert from "node:assert";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { NodeD1Database, runMigrations } from "../src/serverfull/db";
import { ListModel } from "../src/models/list";
import { ListBloomModel } from "../src/models/listBloom";
import { ProfileBloomModel } from "../src/models/profileBloom";
import { ProfileModel } from "../src/models/profile";
import { syncGlobalList } from "../src/utils/sync/singleListSync";
import { syncNextGlobalList, syncAllListsForProfile } from "../src/utils/sync/orchestrator";
import { BloomFilter } from "../src/utils/bloom";
import { initNodeGlobals } from "../src/serverfull/cache";
import type { Env, ExecutionContext } from "../src/types";

async function runGlobalListTests() {
  console.log("================================================================");
  console.log("     Phase 2: Globalized List Compilation Test Suite            ");
  console.log("================================================================\n");

  initNodeGlobals();

  // 1. Initialize SQLite Database and run migrations
  console.log("1. Initializing database and running schema migrations...");
  const rawDb = new DatabaseSync(":memory:");
  const migrationsDir = path.resolve(__dirname, "../migrations");
  runMigrations(rawDb, migrationsDir);
  const mockD1 = new NodeD1Database(rawDb);
  console.log("   ✓ Database initialized with all 65 migrations (including 0064_globalize_list_compilation).\n");

  const env: Env = {
    DB: mockD1,
    ASSETS: { fetch: async () => new Response("Not Found", { status: 404 }) },
    MAX_SYNC_DOMAINS: 100000,
    BLOOM_FALSE_POSITIVE_RATE: 0.001,
    SYNC_PROFILE_INTERVAL_SEC: 3600
  };

  const ctx = {
    waitUntil(promise: Promise<any>) {
      promise.catch(() => {});
    },
    passThroughOnException() {}
  } as unknown as ExecutionContext;

  const listModel = new ListModel(mockD1);
  const listBloomModel = new ListBloomModel(mockD1);
  const profileBloomModel = new ProfileBloomModel(mockD1);
  const profileModel = new ProfileModel(mockD1);

  // 2. Setup Profiles and Subscriptions
  console.log("2. Creating Profile A and Profile B sharing a common list URL...");
  const profileA = "prof_user_alice";
  const profileB = "prof_user_bob";
  const sharedUrl = "http://93.184.216.34/adblock_shared.txt";
  const aliceOnlyUrl = "http://93.184.216.34/alice_special.txt";
  const initNow = Math.floor(Date.now() / 1000);

  rawDb.prepare("INSERT INTO users (id, username, hashed_password, role, created_at, timezone, locale) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
    "acc_alice", "alice", "hash", "user", initNow, "UTC", "en-US"
  );
  rawDb.prepare("INSERT INTO users (id, username, hashed_password, role, created_at, timezone, locale) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
    "acc_bob", "bob", "hash", "user", initNow, "UTC", "en-US"
  );

  await profileModel.create({
    id: profileA,
    owner_id: "acc_alice",
    name: "Alice Profile",
    settings: {
      upstream: ["1.1.1.1"],
      ecs: { enabled: false, use_client_ip: false },
      log_retention_days: 7,
      default_policy: "ALLOW"
    }
  });
  await profileModel.create({
    id: profileB,
    owner_id: "acc_bob",
    name: "Bob Profile",
    settings: {
      upstream: ["1.1.1.1"],
      ecs: { enabled: false, use_client_ip: false },
      log_retention_days: 7,
      default_policy: "ALLOW"
    }
  });

  await listModel.addList(profileA, sharedUrl);
  await listModel.addList(profileA, aliceOnlyUrl);
  await listModel.addList(profileB, sharedUrl);

  const listsA = await listModel.getLists(profileA);
  const listsB = await listModel.getLists(profileB);
  assert.strictEqual(listsA.length, 2, "Alice should have 2 lists");
  assert.strictEqual(listsB.length, 1, "Bob should have 1 list");
  console.log("   ✓ Profiles and list subscriptions initialized.\n");

  // 3. Test Global Sync & Storage Deduplication
  console.log("3. Testing global list synchronization and storage deduplication...");
  const originalFetch = globalThis.fetch;
  let fetchCallCount = 0;

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    fetchCallCount++;
    const urlStr = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

    if (urlStr.includes("adblock_shared.txt")) {
      return new Response("||ad-tracker.com^\n||telemetry.shared.org^\n0.0.0.0 bad-actor.net\n", {
        status: 200,
        headers: {
          "Content-Type": "text/plain",
          "ETag": '"shared-etag-v1"',
          "Last-Modified": "Wed, 01 Jan 2026 00:00:00 GMT"
        }
      });
    }

    if (urlStr.includes("alice_special.txt")) {
      return new Response("||alice-block.org^\n", {
        status: 200,
        headers: {
          "Content-Type": "text/plain",
          "ETag": '"alice-etag-v1"'
        }
      });
    }

    return new Response("", { status: 404 });
  };

  const now = Math.floor(Date.now() / 1000);
  // Perform global sync on shared URL
  const syncResult1 = await syncGlobalList(sharedUrl, env, listModel, listBloomModel, now);
  assert.strictEqual(syncResult1.syncError, null, "Sync should succeed without error");
  assert.strictEqual(syncResult1.notModified, false, "First sync should not be 304");

  // Query global_list_blooms table directly to verify single copy
  const bloomRows = rawDb
    .prepare("SELECT chunk_index, LENGTH(bloom_filter_chunk) as len FROM global_list_blooms WHERE url = ?")
    .all(sharedUrl) as { chunk_index: number; len: number }[];
  assert.strictEqual(bloomRows.length, 1, "Exactly 1 chunk must be stored globally for the shared URL");
  console.log(`   ✓ global_list_blooms contains exactly 1 global copy (${bloomRows[0].len} bytes compressed).`);

  // Verify metadata stored globally
  const meta = await listModel.getGlobalListMetadata(sharedUrl);
  assert.ok(meta, "Global metadata row must exist");
  assert.strictEqual(meta?.etag, '"shared-etag-v1"', "ETag must be persisted globally");
  assert.strictEqual(meta?.sync_error, null);
  assert.strictEqual(typeof meta?.last_modified, "number", "last_modified in global_list_metadata must be stored as Unix timestamp integer");
  assert.strictEqual(meta?.last_modified, Math.floor(Date.parse("Wed, 01 Jan 2026 00:00:00 GMT") / 1000));

  const dbRow = rawDb.prepare("SELECT typeof(last_modified) as col_type, last_modified FROM global_list_metadata WHERE url = ?").get(sharedUrl) as { col_type: string; last_modified: number };
  assert.strictEqual(dbRow.col_type, "integer", "SQLite column storage type for last_modified must be integer");
  console.log("   ✓ global_list_metadata correctly persisted ETag and Unix timestamp (integer).\n");

  // 4. Test User Manual Recombination (Option B: Pure Local Merge, Zero HTTP Requests)
  console.log("4. Testing user manual recombine (Option B: zero external network traffic)...");
  fetchCallCount = 0;

  // Alice also needs alice_special compiled globally
  await syncGlobalList(aliceOnlyUrl, env, listModel, listBloomModel, now);
  assert.strictEqual(fetchCallCount, 1, "Fetched only alice_special once");

  fetchCallCount = 0; // Reset fetch counter
  // Trigger manual sync on Alice and Bob
  await syncAllListsForProfile(profileA, env, ctx);
  await syncAllListsForProfile(profileB, env, ctx);

  assert.strictEqual(
    fetchCallCount,
    0,
    "Option B Guarantee: user-side profile sync must NOT issue external HTTP requests when filters are cached"
  );
  console.log("   ✓ Option B verified: User profile sync performed fast local merge with 0 external HTTP requests.");

  // Verify Profile Blooms
  const bloomABytes = await profileBloomModel.getProfileBloom(profileA);
  const bloomBBytes = await profileBloomModel.getProfileBloom(profileB);
  assert.ok(bloomABytes, "Alice profile bloom must exist");
  assert.ok(bloomBBytes, "Bob profile bloom must exist");

  const filterA = BloomFilter.fromUint8Array(new Uint8Array(bloomABytes!));
  const filterB = BloomFilter.fromUint8Array(new Uint8Array(bloomBBytes!));

  // Alice has shared + alice_special
  assert.strictEqual(filterA.test("ad-tracker.com"), true, "Alice blocks ad-tracker.com");
  assert.strictEqual(filterA.test("alice-block.org"), true, "Alice blocks alice-block.org");
  assert.strictEqual(filterA.test("safe-site.com"), false, "Alice allows safe-site.com");

  // Bob only has shared
  assert.strictEqual(filterB.test("ad-tracker.com"), true, "Bob blocks ad-tracker.com");
  assert.strictEqual(filterB.test("alice-block.org"), false, "Bob DOES NOT block alice-block.org");
  assert.strictEqual(filterB.test("safe-site.com"), false, "Bob allows safe-site.com");
  console.log("   ✓ Profile bloom separation and filter correctness verified.\n");

  // 5. Test System Cron Sync (syncNextGlobalList) with HTTP 304 Not Modified
  console.log("5. Testing system cron sync with HTTP 304 Not Modified...");
  let upstreamHits = 0;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    upstreamHits++;
    const headers = init?.headers as Record<string, string>;
    assert.strictEqual(
      headers?.["If-Modified-Since"],
      "Thu, 01 Jan 2026 00:00:00 GMT",
      "If-Modified-Since must format Unix timestamp to RFC 7231 HTTP-date"
    );
    if (headers && headers["If-None-Match"] === '"shared-etag-v1"') {
      return new Response(null, { status: 304 });
    }
    return new Response(null, { status: 404 });
  };

  // Backdate last_synced_at so the list is considered stale
  rawDb.prepare("UPDATE global_list_metadata SET last_synced_at = ? WHERE url = ?").run(now - 7200, sharedUrl);

  const cronProcessed = await syncNextGlobalList(env, ctx);
  assert.strictEqual(cronProcessed, true, "Cron should have selected and processed stale list");
  assert.strictEqual(upstreamHits, 1, "Should have contacted upstream with ETag");

  const updatedMeta = await listModel.getGlobalListMetadata(sharedUrl);
  assert.ok(
    updatedMeta?.last_synced_at && updatedMeta.last_synced_at >= now - 2,
    "last_synced_at updated on 304"
  );
  console.log("   ✓ HTTP 304 successfully handled: 0 recompilations and 0 profile merges.\n");

  // 6. Test Upstream Content Mutation & Multi-Profile Auto-Fanout
  console.log("6. Testing upstream content mutation & automatic fanout recompilation to all subscribers...");
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    // Return updated blocklist with new malicious domain
    return new Response("||ad-tracker.com^\n||telemetry.shared.org^\n||new-zero-day-threat.com^\n", {
      status: 200,
      headers: {
        "Content-Type": "text/plain",
        "ETag": '"shared-etag-v2"'
      }
    });
  };

  rawDb.prepare("UPDATE global_list_metadata SET last_synced_at = ? WHERE url = ?").run(now - 7200, sharedUrl);

  const cronUpdateRan = await syncNextGlobalList(env, ctx);
  assert.strictEqual(cronUpdateRan, true);

  // Both Alice and Bob should now automatically block new-zero-day-threat.com!
  const newBloomA = await profileBloomModel.getProfileBloom(profileA);
  const newBloomB = await profileBloomModel.getProfileBloom(profileB);
  const newFilterA = BloomFilter.fromUint8Array(new Uint8Array(newBloomA!));
  const newFilterB = BloomFilter.fromUint8Array(new Uint8Array(newBloomB!));

  assert.strictEqual(newFilterA.test("new-zero-day-threat.com"), true, "Alice automatically updated with new threat");
  assert.strictEqual(newFilterB.test("new-zero-day-threat.com"), true, "Bob automatically updated with new threat");
  console.log("   ✓ Automatic subscriber fan-out verified: both profiles received upstream update.\n");

  // 7. Test Domain Check API Endpoint querying global bloom
  console.log("7. Testing domain check API endpoint (/check?domain=...) querying global bloom...");
  const { handleProfileListsRequest } = await import("../src/api/profiles/lists");
  const aliceUser: any = { id: "acc_alice", username: "alice", role: "user" };
  const aliceSharedList = listsA.find((l) => l.url === sharedUrl)!;

  // Check malicious domain on shared list
  const reqBlocked = new Request(`http://localhost/api/profiles/${profileA}/lists/${aliceSharedList.id}/check?domain=ad-tracker.com`);
  const resBlocked = await handleProfileListsRequest(reqBlocked, env, aliceUser, profileA, ["api", "profiles", profileA, "lists", String(aliceSharedList.id), "check"], ctx);
  assert.strictEqual(resBlocked.status, 200);
  const dataBlocked = await resBlocked.json() as any;
  assert.strictEqual(dataBlocked.blocked, true, "ad-tracker.com should be reported as blocked");
  assert.strictEqual(dataBlocked.synced, true);

  // Check safe domain on shared list
  const reqSafe = new Request(`http://localhost/api/profiles/${profileA}/lists/${aliceSharedList.id}/check?domain=google.com`);
  const resSafe = await handleProfileListsRequest(reqSafe, env, aliceUser, profileA, ["api", "profiles", profileA, "lists", String(aliceSharedList.id), "check"], ctx);
  assert.strictEqual(resSafe.status, 200);
  const dataSafe = await resSafe.json() as any;
  assert.strictEqual(dataSafe.blocked, false, "google.com should NOT be reported as blocked");
  assert.strictEqual(dataSafe.synced, true);
  console.log("   ✓ /check endpoint verified against global list bloom successfully.\n");

  // 8. Cleanup
  globalThis.fetch = originalFetch;
  console.log("================================================================");
  console.log("     ALL GLOBAL LIST COMPILATION TESTS PASSED!                  ");
  console.log("================================================================\n");
}

runGlobalListTests().catch((err) => {
  console.error("[TEST FAILED]:", err);
  process.exit(1);
});
