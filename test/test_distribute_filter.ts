/**
 * @file test_distribute_filter.ts
 * @description Integration and unit tests for the Admin "Distribute Filter" (下发过滤器) feature.
 *
 * Verifies:
 * 1. RBAC authorization (only admin can distribute; regular users receive 403 Forbidden).
 * 2. SSRF validation (private/internal networks rejected with 400).
 * 3. Distribution to all users with profile auto-attachment and `is_system = 1` tagging.
 * 4. Automatic skipping when a user already has the filter across any profile.
 * 5. GET /lists API correctly surfacing `is_system` attribute.
 * 6. Regular users' ability to delete distributed filters.
 * 7. Idempotency on repeated distribution passes.
 */

import assert from "node:assert";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { NodeD1Database, runMigrations } from "../src/serverfull/db";
import { ListModel } from "../src/models/list";
import { ProfileModel } from "../src/models/profile";
import { UserModel } from "../src/models/user";
import { handleAccountRequest } from "../src/api/account";
import { handleProfileListsRequest } from "../src/api/profiles/lists";
import { initNodeGlobals } from "../src/serverfull/cache";
import type { Env, User, ExecutionContext } from "../src/types";

async function runDistributeFilterTests() {
  console.log("================================================================");
  console.log("       Admin Distribute Filter Unit & Integration Tests         ");
  console.log("================================================================\n");

  initNodeGlobals();

  // 1. Initialize SQLite Database and run schema migrations
  console.log("1. Initializing in-memory DB and running migrations...");
  const rawDb = new DatabaseSync(":memory:");
  const migrationsDir = path.resolve(__dirname, "../migrations");
  runMigrations(rawDb, migrationsDir);
  const db = new NodeD1Database(rawDb);
  console.log("   ✓ All migrations applied successfully (including 0065_add_is_system_to_lists).\n");

  const env: Env = {
    DB: db,
    ASSETS: { fetch: async () => new Response("Not Found", { status: 404 }) },
    MAX_SYNC_DOMAINS: 100000,
    BLOOM_FALSE_POSITIVE_RATE: 0.001
  };

  const ctx = {
    waitUntil(promise: Promise<any>) {
      promise.catch(() => {});
    },
    passThroughOnException() {}
  } as unknown as ExecutionContext;

  const profileModel = new ProfileModel(db);
  const listModel = new ListModel(db);
  const userModel = new UserModel(db, env);

  // Setup Users:
  // - Admin (admin_user)
  // - Alice (user_alice) - has 1 profile, no lists
  // - Bob (user_bob) - has 1 profile, ALREADY has shared.txt manually added
  // - Charlie (user_charlie) - has 2 profiles (Home, Work), no lists
  console.log("2. Creating test users and profiles...");
  const now = Math.floor(Date.now() / 1000);

  const adminUser: User = { id: "u_admin", username: "admin_user", role: "admin" };
  const aliceUser: User = { id: "u_alice", username: "user_alice", role: "user" };
  const bobUser: User = { id: "u_bob", username: "user_bob", role: "user" };
  const charlieUser: User = { id: "u_charlie", username: "user_charlie", role: "user" };

  for (const u of [adminUser, aliceUser, bobUser, charlieUser]) {
    rawDb.prepare("INSERT INTO users (id, username, hashed_password, role, created_at, timezone, locale) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
      u.id, u.username, "mock_hash", u.role, now, "UTC", "en-US"
    );
  }

  const defaultSettings = {
    upstream: ["1.1.1.1"],
    ecs: { enabled: false, use_client_ip: false },
    log_retention_days: 7,
    default_policy: "ALLOW" as const
  };

  // Admin profile
  await profileModel.create({ id: "p_admin", owner_id: adminUser.id, name: "Admin Default", settings: defaultSettings });
  // Alice profile
  await profileModel.create({ id: "p_alice", owner_id: aliceUser.id, name: "Alice Default", settings: defaultSettings });
  // Bob profile (pre-populates shared.txt)
  await profileModel.create({ id: "p_bob", owner_id: bobUser.id, name: "Bob Default", settings: defaultSettings });
  const sharedUrl = "http://93.184.216.34/adblock_shared.txt";
  await listModel.addList("p_bob", sharedUrl, false); // Bob manually added it

  // Charlie profiles (Home & Work)
  await profileModel.create({ id: "p_charlie_1", owner_id: charlieUser.id, name: "Charlie Home", settings: defaultSettings });
  await profileModel.create({ id: "p_charlie_2", owner_id: charlieUser.id, name: "Charlie Work", settings: defaultSettings });

  console.log("   ✓ Test users and profiles prepared.\n");

  // Intercept fetch so global list compile succeeds
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const urlStr = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (urlStr.includes("adblock_shared.txt")) {
      return new Response("||ad-tracker.com^\n||telemetry.org^\n", {
        status: 200,
        headers: { "Content-Type": "text/plain", "ETag": '"v1"' }
      });
    }
    return new Response("", { status: 404 });
  };

  // 3. Test RBAC: Regular user cannot call /api/admin/distribute-filter
  console.log("3. Testing RBAC permission guard (regular user access)...");
  const forbiddenReq = new Request("http://localhost/api/admin/distribute-filter", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: sharedUrl })
  });
  const forbiddenRes = await handleAccountRequest(forbiddenReq, env, aliceUser, ctx);
  assert.strictEqual(forbiddenRes.status, 403, "Non-admin user must receive 403 Forbidden");
  console.log("   ✓ RBAC correctly blocked regular user with 403 Forbidden.\n");

  // 4. Test SSRF: Internal IP/localhost URLs rejected
  console.log("4. Testing SSRF protection...");
  const ssrfReq = new Request("http://localhost/api/admin/distribute-filter", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: "http://127.0.0.1/malicious.txt" })
  });
  const ssrfRes = await handleAccountRequest(ssrfReq, env, adminUser, ctx);
  assert.strictEqual(ssrfRes.status, 400, "SSRF attempt must be rejected with 400 Bad Request");
  console.log("   ✓ SSRF protection correctly blocked private IP address.\n");

  // 5. Test Admin Distributing Filter
  console.log("5. Testing admin distribute-filter execution...");
  const distReq = new Request("http://localhost/api/admin/distribute-filter", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: sharedUrl })
  });
  const distRes = await handleAccountRequest(distReq, env, adminUser, ctx);
  assert.strictEqual(distRes.status, 200, "Distribute request must succeed with 200 OK");
  const distData = await distRes.json() as any;

  assert.strictEqual(distData.success, true);
  assert.strictEqual(distData.totalUsers, 4, "Total 4 users in system");
  // Admin, Alice, Charlie added (3 users); Bob already had it (skipped = 1)
  assert.strictEqual(distData.addedCount, 3, "Should add to 3 users who did not have the filter");
  assert.strictEqual(distData.skippedCount, 1, "Should skip 1 user (Bob) who already had the filter");
  assert.deepStrictEqual(distData.skippedUsernames, ["user_bob"]);
  assert.ok(distData.addedUsernames.includes("user_alice"));
  assert.ok(distData.addedUsernames.includes("user_charlie"));
  assert.ok(distData.addedUsernames.includes("admin_user"));
  console.log("   ✓ Distribution completed: 3 users added, 1 existing user skipped.\n");

  // 6. Verify Lists & is_system tagging on User Side
  console.log("6. Verifying is_system tagging on user-side GET /api/profiles/:id/lists...");

  // Alice
  const reqAliceLists = new Request(`http://localhost/api/profiles/p_alice/lists`);
  const resAliceLists = await handleProfileListsRequest(reqAliceLists, env, aliceUser, "p_alice", ["api", "profiles", "p_alice", "lists"], ctx);
  const aliceLists = await resAliceLists.json() as any[];
  assert.strictEqual(aliceLists.length, 1, "Alice should have 1 list");
  assert.strictEqual(aliceLists[0].url, sharedUrl);
  assert.strictEqual(Boolean(aliceLists[0].is_system), true, "Alice's list must have is_system = true");

  // Bob (who had it manually before)
  const reqBobLists = new Request(`http://localhost/api/profiles/p_bob/lists`);
  const resBobLists = await handleProfileListsRequest(reqBobLists, env, bobUser, "p_bob", ["api", "profiles", "p_bob", "lists"], ctx);
  const bobLists = await resBobLists.json() as any[];
  assert.strictEqual(bobLists.length, 1, "Bob should still only have 1 list");
  assert.strictEqual(Boolean(bobLists[0].is_system), false, "Bob's manually added list retains is_system = false");

  // Charlie (had 2 profiles, both should have received the filter)
  const charlieLists1 = await listModel.getLists("p_charlie_1");
  const charlieLists2 = await listModel.getLists("p_charlie_2");
  assert.strictEqual(charlieLists1.length, 1, "Charlie profile 1 received the list");
  assert.strictEqual(charlieLists2.length, 1, "Charlie profile 2 received the list");
  assert.strictEqual(Boolean(charlieLists1[0].is_system), true);
  assert.strictEqual(Boolean(charlieLists2[0].is_system), true);
  console.log("   ✓ User-side tagging verified: is_system = 1 for distributed lists.\n");

  // 7. Verify Regular User Can Delete Distributed Filter
  console.log("7. Testing regular user deleting system-distributed filter...");
  const deleteReq = new Request(`http://localhost/api/profiles/p_alice/lists/${aliceLists[0].id}`, {
    method: "DELETE"
  });
  const deleteRes = await handleProfileListsRequest(deleteReq, env, aliceUser, "p_alice", ["api", "profiles", "p_alice", "lists", String(aliceLists[0].id)], ctx);
  assert.ok([200, 204].includes(deleteRes.status), "User must be allowed to delete system-distributed filter (200 or 204)");

  const aliceListsAfter = await listModel.getLists("p_alice");
  assert.strictEqual(aliceListsAfter.length, 0, "Alice's list should now be deleted");
  console.log("   ✓ User successfully deleted system-distributed filter.\n");

  // 8. Test Idempotency: Repeating Distribution Skips All Current Owners
  console.log("8. Testing idempotency on repeated distribution...");
  const repeatReq = new Request("http://localhost/api/admin/distribute-filter", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: sharedUrl })
  });
  const repeatRes = await handleAccountRequest(repeatReq, env, adminUser, ctx);
  const repeatData = await repeatRes.json() as any;

  // Now: Admin, Bob, Charlie have it (3 skipped); Alice deleted it, so Alice gets it again!
  assert.strictEqual(repeatData.skippedCount, 3, "Admin, Bob, Charlie have it and should be skipped");
  assert.strictEqual(repeatData.addedCount, 1, "Alice receives it again");
  assert.deepStrictEqual(repeatData.addedUsernames, ["user_alice"]);
  console.log("   ✓ Repeated distribution properly skipped all users who already retained the filter.\n");

  // 9. Test User "Keep / Retain" list (保留为自定义列表: is_system becomes 0)
  console.log("9. Testing user retaining system-distributed list as custom list...");
  const charlieProfile1Lists = await listModel.getLists("p_charlie_1");
  assert.strictEqual(charlieProfile1Lists.length, 1);
  assert.strictEqual(Boolean(charlieProfile1Lists[0].is_system), true, "Initially marked as is_system = 1");

  const keepReq = new Request(`http://localhost/api/profiles/p_charlie_1/lists/${charlieProfile1Lists[0].id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "keep" })
  });
  const keepRes = await handleProfileListsRequest(keepReq, env, charlieUser, "p_charlie_1", ["api", "profiles", "p_charlie_1", "lists", String(charlieProfile1Lists[0].id)], ctx);
  assert.strictEqual(keepRes.status, 200, "Keep request must succeed with 200 OK");
  const keepData = await keepRes.json() as any;
  assert.strictEqual(keepData.success, true);
  assert.strictEqual(keepData.is_system, 0);

  const charlieProfile1ListsAfter = await listModel.getLists("p_charlie_1");
  assert.strictEqual(Boolean(charlieProfile1ListsAfter[0].is_system), false, "List is now user-level (is_system = 0)");
  console.log("   ✓ User successfully kept list; is_system tag converted to 0.\n");

  // 10. Test Admin Querying Distributed Lists (GET /api/admin/distribute-filter)
  console.log("10. Testing Admin GET /api/admin/distribute-filter...");
  const getDistReq = new Request("http://localhost/api/admin/distribute-filter", {
    method: "GET"
  });
  const getDistRes = await handleAccountRequest(getDistReq, env, adminUser, ctx);
  assert.strictEqual(getDistRes.status, 200);
  const distLists = await getDistRes.json() as any[];
  assert.strictEqual(distLists.length, 1, "Should list the distributed filter");
  assert.strictEqual(distLists[0].url, sharedUrl);
  // Profiles with is_system = 1: p_admin, p_alice, p_charlie_2 (total 3)
  // (p_bob was user-added, p_charlie_1 was kept -> both is_system = 0)
  assert.strictEqual(distLists[0].profileCount, 3, "Expected 3 profiles retaining system list");
  assert.strictEqual(distLists[0].userCount, 3, "Expected 3 users retaining system list");
  assert.ok(distLists[0].usernames.includes("admin_user"));
  assert.ok(distLists[0].usernames.includes("user_alice"));
  assert.ok(distLists[0].usernames.includes("user_charlie"));
  assert.ok(!distLists[0].usernames.includes("user_bob"), "Bob should not be in system list usernames");
  console.log("   ✓ GET /api/admin/distribute-filter correctly returned active system-distributed list counts.\n");

  // 11. Test Revoke RBAC & Revocation Execution (DELETE /api/admin/distribute-filter)
  console.log("11. Testing Admin Revoking Distributed Filter (DELETE /api/admin/distribute-filter)...");
  // 11a. RBAC check: regular user cannot revoke
  const revokeForbiddenReq = new Request("http://localhost/api/admin/distribute-filter", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: sharedUrl })
  });
  const revokeForbiddenRes = await handleAccountRequest(revokeForbiddenReq, env, aliceUser, ctx);
  assert.strictEqual(revokeForbiddenRes.status, 403, "Non-admin cannot revoke distributed filter");

  // 11b. Admin executes revocation
  const revokeReq = new Request("http://localhost/api/admin/distribute-filter", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: sharedUrl })
  });
  const revokeRes = await handleAccountRequest(revokeReq, env, adminUser, ctx);
  assert.strictEqual(revokeRes.status, 200, "Revoke request must succeed with 200 OK");
  const revokeData = await revokeRes.json() as any;
  assert.strictEqual(revokeData.success, true);
  assert.strictEqual(revokeData.revokedCount, 3, "Should revoke 3 system-tagged profile lists");
  assert.strictEqual(revokeData.affectedProfilesCount, 3);
  assert.strictEqual(revokeData.affectedUserCount, 3);

  // 11c. Verify Database state:
  // - Alice (was is_system = 1) -> Removed
  const aliceListsFinal = await listModel.getLists("p_alice");
  assert.strictEqual(aliceListsFinal.length, 0, "Alice's system list must be revoked");

  // - Admin (was is_system = 1) -> Removed
  const adminListsFinal = await listModel.getLists("p_admin");
  assert.strictEqual(adminListsFinal.length, 0, "Admin's system list must be revoked");

  // - Charlie profile 2 (was is_system = 1) -> Removed
  const charlie2Final = await listModel.getLists("p_charlie_2");
  assert.strictEqual(charlie2Final.length, 0, "Charlie's un-retained profile 2 list must be revoked");

  // - Bob (was is_system = 0, user-added) -> PRESERVED!
  const bobListsFinal = await listModel.getLists("p_bob");
  assert.strictEqual(bobListsFinal.length, 1, "Bob's user-added list must be untouched");
  assert.strictEqual(bobListsFinal[0].url, sharedUrl);

  // - Charlie profile 1 (was kept by user, is_system = 0) -> PRESERVED!
  const charlie1Final = await listModel.getLists("p_charlie_1");
  assert.strictEqual(charlie1Final.length, 1, "Charlie's retained list must NOT be revoked");
  assert.strictEqual(charlie1Final[0].url, sharedUrl);
  assert.strictEqual(Boolean(charlie1Final[0].is_system), false, "Remains custom user list");

  // 11d. GET /api/admin/distribute-filter should now return empty array
  const getDistAfterRes = await handleAccountRequest(getDistReq, env, adminUser, ctx);
  const distListsAfter = await getDistAfterRes.json() as any[];
  assert.strictEqual(distListsAfter.length, 0, "No active system lists remaining for this URL");
  console.log("   ✓ Revocation verified: strictly revoked is_system=1 lists, safely preserved user-added and kept lists.\n");

  // Cleanup
  globalThis.fetch = originalFetch;
  console.log("================================================================");
  console.log("     ALL DISTRIBUTE FILTER TESTS PASSED SUCCESSFULLY!           ");
  console.log("================================================================\n");
}

runDistributeFilterTests().catch((err) => {
  console.error("[TEST FAILED]:", err);
  process.exit(1);
});
