/**
 * @file test_distribute_filter.ts
 * @description Integration and unit tests for:
 * 1. Admin "Distribute Filter" (下发系统级列表至各用户作为用户级列表)
 * 2. User-level filter lists (/api/account/user-lists) applied to all profiles
 * 3. Tagging: "系统" for system lists, "用户" for user lists, "配置" for profile lists
 * 4. Profile-level duplication: Profile lists and User/System lists allow duplicates
 * 5. Profile simultaneous toggle: Toggling off in a profile disables both profile and user/system lists
 * 6. Deletion constraints: User/system lists cannot be deleted in profile settings
 * 7. No-profile users: Receive system lists into user_lists without failure
 * 8. Automatic inheritance when a user creates a new profile
 * 9. Admin revocation strictly revoking system lists while preserving user and profile lists
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
  console.log("   User & System Filter Lists Unit & Integration Tests          ");
  console.log("================================================================\n");

  initNodeGlobals();

  // 1. Initialize SQLite Database and run schema migrations
  console.log("1. Initializing in-memory DB and running migrations...");
  const rawDb = new DatabaseSync(":memory:");
  const migrationsDir = path.resolve(__dirname, "../migrations");
  runMigrations(rawDb, migrationsDir);
  const db = new NodeD1Database(rawDb);
  console.log("   ✓ All migrations applied successfully (including 0067_add_user_lists).\n");

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
  // - Bob (user_bob) - has 1 profile, ALREADY has shared.txt manually in user_lists
  // - Charlie (user_charlie) - has 2 profiles (Home, Work), no lists
  // - Dave (user_dave) - has 0 profiles!
  console.log("2. Creating test users and profiles...");
  const now = Math.floor(Date.now() / 1000);

  const adminUser: User = { id: "u_admin", username: "admin_user", role: "admin" };
  const aliceUser: User = { id: "u_alice", username: "user_alice", role: "user" };
  const bobUser: User = { id: "u_bob", username: "user_bob", role: "user" };
  const charlieUser: User = { id: "u_charlie", username: "user_charlie", role: "user" };
  const daveUser: User = { id: "u_dave", username: "user_dave", role: "user" };

  for (const u of [adminUser, aliceUser, bobUser, charlieUser, daveUser]) {
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
  // Bob profile & Bob pre-adds shared.txt as a user-level list
  await profileModel.create({ id: "p_bob", owner_id: bobUser.id, name: "Bob Default", settings: defaultSettings });
  const sharedUrl = "http://93.184.216.34/adblock_shared.txt";
  await listModel.addUserList(bobUser.id, sharedUrl, false); // Bob manually added it to his user_lists

  // Charlie profiles (Home & Work)
  await profileModel.create({ id: "p_charlie_1", owner_id: charlieUser.id, name: "Charlie Home", settings: defaultSettings });
  await profileModel.create({ id: "p_charlie_2", owner_id: charlieUser.id, name: "Charlie Work", settings: defaultSettings });

  // Dave has NO profile!

  console.log("   ✓ Test users and profiles prepared.\n");

  // Intercept fetch so global list compile succeeds
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const urlStr = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (urlStr.includes("adblock_shared.txt") || urlStr.includes("user_custom.txt")) {
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

  // 5. Test Admin Distributing Filter as System List to All Users
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
  assert.strictEqual(distData.totalUsers, 5, "Total 5 users in system");
  // Admin, Alice, Charlie, Dave added (4 users); Bob already had it in user_lists (skipped = 1)
  assert.strictEqual(distData.addedCount, 4, "Should add to 4 users who did not have the filter in user_lists");
  assert.strictEqual(distData.skippedCount, 1, "Should skip 1 user (Bob) who already had the filter");
  assert.strictEqual(distData.failedCount, 0, "Dave has 0 profiles but was successfully added to user_lists!");
  assert.deepStrictEqual(distData.skippedUsernames, ["user_bob"]);
  assert.ok(distData.addedUsernames.includes("user_alice"));
  assert.ok(distData.addedUsernames.includes("user_charlie"));
  assert.ok(distData.addedUsernames.includes("user_dave"));
  assert.ok(distData.addedUsernames.includes("admin_user"));
  console.log("   ✓ System distribution completed: 4 users added (including Dave with 0 profiles), 1 existing user skipped.\n");

  // 6. Verify User Profile Inherits System List with 'system' Scope
  console.log("6. Verifying system list inheritance on GET /api/profiles/:id/lists...");
  const reqAliceLists = new Request(`http://localhost/api/profiles/p_alice/lists`);
  const resAliceLists = await handleProfileListsRequest(reqAliceLists, env, aliceUser, "p_alice", ["api", "profiles", "p_alice", "lists"], ctx);
  const aliceLists = await resAliceLists.json() as any[];
  assert.strictEqual(aliceLists.length, 1, "Alice should have 1 list");
  assert.strictEqual(aliceLists[0].url, sharedUrl);
  assert.strictEqual(aliceLists[0].scope, "system", "Should have scope = 'system'");
  assert.strictEqual(Boolean(aliceLists[0].is_system), true);
  assert.strictEqual(aliceLists[0].enabled, true);
  console.log("   ✓ Alice's profile correctly inherited system list with scope = 'system'.\n");

  // 7. Verify Profile-level Duplication & Simultaneous Toggle
  console.log("7. Testing profile-level duplication and simultaneous toggle...");
  // 7a. Alice manually adds sharedUrl to p_alice as a Profile-level list (duplication allowed!)
  const addProfileListReq = new Request(`http://localhost/api/profiles/p_alice/lists`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: sharedUrl })
  });
  const addProfileListRes = await handleProfileListsRequest(addProfileListReq, env, aliceUser, "p_alice", ["api", "profiles", "p_alice", "lists"], ctx);
  assert.strictEqual(addProfileListRes.status, 201, "Should allow adding duplicate URL at profile level");

  const resAliceAfterDuplicate = await handleProfileListsRequest(reqAliceLists, env, aliceUser, "p_alice", ["api", "profiles", "p_alice", "lists"], ctx);
  const aliceListsDup = await resAliceAfterDuplicate.json() as any[];
  assert.strictEqual(aliceListsDup.length, 2, "Alice profile now has 2 lists (1 profile-level, 1 system-level)");
  const profileLevelList = aliceListsDup.find((l) => l.scope === "profile");
  const systemLevelList = aliceListsDup.find((l) => l.scope === "system");
  assert.ok(profileLevelList, "Profile-level list exists");
  assert.ok(systemLevelList, "System-level list exists");
  assert.strictEqual(profileLevelList.url, sharedUrl);
  assert.strictEqual(systemLevelList.url, sharedUrl);

  // 7b. Toggle disable on p_alice: Should simultaneously disable BOTH the Profile list and the System list
  console.log("   Testing simultaneous toggle...");
  const toggleReq = new Request(`http://localhost/api/profiles/p_alice/lists/${systemLevelList.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled: false })
  });
  const toggleRes = await handleProfileListsRequest(toggleReq, env, aliceUser, "p_alice", ["api", "profiles", "p_alice", "lists", String(systemLevelList.id)], ctx);
  assert.strictEqual(toggleRes.status, 200);

  const resAliceAfterToggle = await handleProfileListsRequest(reqAliceLists, env, aliceUser, "p_alice", ["api", "profiles", "p_alice", "lists"], ctx);
  const aliceListsToggled = await resAliceAfterToggle.json() as any[];
  for (const l of aliceListsToggled) {
    if (l.url === sharedUrl) {
      assert.strictEqual(l.enabled, false, `Both lists with URL ${sharedUrl} must be disabled in this profile`);
    }
  }

  // 7c. Toggle enable back: Both should be enabled
  const toggleBackReq = new Request(`http://localhost/api/profiles/p_alice/lists/${profileLevelList.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled: true })
  });
  await handleProfileListsRequest(toggleBackReq, env, aliceUser, "p_alice", ["api", "profiles", "p_alice", "lists", String(profileLevelList.id)], ctx);
  const resAliceAfterReenable = await handleProfileListsRequest(reqAliceLists, env, aliceUser, "p_alice", ["api", "profiles", "p_alice", "lists"], ctx);
  const aliceListsReenabled = await resAliceAfterReenable.json() as any[];
  for (const l of aliceListsReenabled) {
    if (l.url === sharedUrl) {
      assert.strictEqual(l.enabled, true, `Both lists with URL ${sharedUrl} must be enabled in this profile`);
    }
  }
  console.log("   ✓ Duplication and simultaneous profile toggle verified successfully.\n");

  // 8. Testing Prohibition of Deleting User/System List from Profile Page
  console.log("8. Testing prohibition of deleting user/system list from profile page...");
  const deleteSystemListReq = new Request(`http://localhost/api/profiles/p_alice/lists/${systemLevelList.id}`, {
    method: "DELETE"
  });
  const deleteSystemListRes = await handleProfileListsRequest(deleteSystemListReq, env, aliceUser, "p_alice", ["api", "profiles", "p_alice", "lists", String(systemLevelList.id)], ctx);
  assert.strictEqual(deleteSystemListRes.status, 400, "Must reject deleting system list from profile view");
  console.log("   ✓ Profile view correctly rejected deleting user/system list with 400 Bad Request.\n");

  // 9. Testing User-level Filter Lists Management (/api/account/user-lists)
  console.log("9. Testing user-level filter lists management (/api/account/user-lists)...");
  const customUrl = "http://93.184.216.34/user_custom.txt";
  const addUserListReq = new Request("http://localhost/api/account/user-lists", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: customUrl })
  });
  const addUserListRes = await handleAccountRequest(addUserListReq, env, aliceUser, ctx);
  assert.strictEqual(addUserListRes.status, 201, "User adding user-level list must succeed");

  const getUserListsReq = new Request("http://localhost/api/account/user-lists", { method: "GET" });
  const getUserListsRes = await handleAccountRequest(getUserListsReq, env, aliceUser, ctx);
  const aliceUserLists = await getUserListsRes.json() as any[];
  assert.strictEqual(aliceUserLists.length, 2, "Alice should have 2 lists in user_lists (1 system, 1 user-created)");
  const customUserList = aliceUserLists.find((l) => l.url === customUrl);
  assert.ok(customUserList, "Custom user list found");
  assert.strictEqual(customUserList.is_system, 0, "Custom user list has is_system = 0");

  // Check that Alice's profile automatically inherits the custom user list!
  const resAliceListsWithCustom = await handleProfileListsRequest(reqAliceLists, env, aliceUser, "p_alice", ["api", "profiles", "p_alice", "lists"], ctx);
  const aliceProfileListsWithCustom = await resAliceListsWithCustom.json() as any[];
  const userScopeList = aliceProfileListsWithCustom.find((l) => l.url === customUrl);
  assert.ok(userScopeList, "Profile inherited user-level list");
  assert.strictEqual(userScopeList.scope, "user");
  console.log("   ✓ User-level list added, correctly tagged as 'user', and inherited across profiles.\n");

  // 10. Testing Dave Creating Profile and Inheriting System List
  console.log("10. Testing Dave (who received list when having 0 profiles) creating first profile...");
  await profileModel.create({ id: "p_dave", owner_id: daveUser.id, name: "Dave Default", settings: defaultSettings });
  const reqDaveLists = new Request(`http://localhost/api/profiles/p_dave/lists`);
  const resDaveLists = await handleProfileListsRequest(reqDaveLists, env, daveUser, "p_dave", ["api", "profiles", "p_dave", "lists"], ctx);
  const daveLists = await resDaveLists.json() as any[];
  assert.strictEqual(daveLists.length, 1, "Dave's new profile automatically inherits system list");
  assert.strictEqual(daveLists[0].url, sharedUrl);
  assert.strictEqual(daveLists[0].scope, "system");
  console.log("   ✓ Dave's new profile automatically inherited system list.\n");

  // 11. Testing Deleting User List from /account and Forbidden on System List
  console.log("11. Testing delete permissions on /api/account/user-lists/:id...");
  const deleteSystemOnAccountReq = new Request(`http://localhost/api/account/user-lists/${systemLevelList.user_list_id}`, {
    method: "DELETE"
  });
  const deleteSystemOnAccountRes = await handleAccountRequest(deleteSystemOnAccountReq, env, aliceUser, ctx);
  assert.strictEqual(deleteSystemOnAccountRes.status, 403, "User cannot delete system list from /account");

  const deleteCustomOnAccountReq = new Request(`http://localhost/api/account/user-lists/${customUserList.id}`, {
    method: "DELETE"
  });
  const deleteCustomOnAccountRes = await handleAccountRequest(deleteCustomOnAccountReq, env, aliceUser, ctx);
  assert.strictEqual(deleteCustomOnAccountRes.status, 200, "User can delete their own user list from /account");
  console.log("   ✓ User list deleted from /account, system list deletion blocked with 403 Forbidden.\n");

  // 12. Testing Admin Revocation
  console.log("12. Testing Admin Revoking System List (DELETE /api/admin/distribute-filter)...");
  const revokeReq = new Request("http://localhost/api/admin/distribute-filter", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: sharedUrl })
  });
  const revokeRes = await handleAccountRequest(revokeReq, env, adminUser, ctx);
  assert.strictEqual(revokeRes.status, 200, "Revoke request must succeed with 200 OK");

  // Verify Alice's profile state:
  // System list is gone; Profile-level list is PRESERVED!
  const resAliceFinal = await handleProfileListsRequest(reqAliceLists, env, aliceUser, "p_alice", ["api", "profiles", "p_alice", "lists"], ctx);
  const aliceFinalLists = await resAliceFinal.json() as any[];
  assert.strictEqual(aliceFinalLists.length, 1, "Alice should only have her profile-level list remaining");
  assert.strictEqual(aliceFinalLists[0].scope, "profile");
  assert.strictEqual(aliceFinalLists[0].url, sharedUrl);

  // Verify Bob's state:
  // Bob's user list was created as is_system = 0, so it must be PRESERVED!
  const reqBobLists = new Request(`http://localhost/api/profiles/p_bob/lists`);
  const resBobFinal = await handleProfileListsRequest(reqBobLists, env, bobUser, "p_bob", ["api", "profiles", "p_bob", "lists"], ctx);
  const bobFinalLists = await resBobFinal.json() as any[];
  assert.strictEqual(bobFinalLists.length, 1, "Bob's user-added list must be untouched");
  assert.strictEqual(bobFinalLists[0].url, sharedUrl);
  assert.strictEqual(bobFinalLists[0].scope, "user");
  console.log("   ✓ Revocation verified: system lists removed, profile lists and user-created lists safely preserved.\n");

  // Cleanup
  globalThis.fetch = originalFetch;
  console.log("================================================================");
  console.log("     ALL USER & SYSTEM FILTER LIST TESTS PASSED!                ");
  console.log("================================================================\n");
}

runDistributeFilterTests().catch((err) => {
  console.error("[TEST FAILED]:", err);
  process.exit(1);
});
