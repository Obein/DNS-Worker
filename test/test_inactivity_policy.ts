/**
 * @file test_inactivity_policy.ts
 * @description Comprehensive unit and integration tests for:
 * 1. Inactivity Log Purge (INACTIVE_LOG_PURGE_DAYS, default 30 days)
 *    - Cleans logs and hourly_rollups for users with no DNS resolution activity for >= 30 days
 *    - Preserves user accounts, profiles, access points, and settings intact
 * 2. Account Inactivity Abandonment (INACTIVITY_THRESHOLD_DAYS, default 180 days)
 *    - Evaluated strictly based on DNS resolution activity (last_active_at / created_at), NEVER on web login activity
 *    - Deletes abandoned non-admin user accounts and their associated profiles and metadata
 * 3. Administrator immunity: Admin accounts and their profiles/logs are never purged by inactivity
 * 4. Custom environment variable overrides (INACTIVITY_THRESHOLD_DAYS, INACTIVE_LOG_PURGE_DAYS)
 */

import assert from "node:assert";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { NodeD1Database, runMigrations } from "../src/serverfull/db";
import { UserModel } from "../src/models/user";
import { LogModel } from "../src/models/log";
import { handleProfilesRequest } from "../src/api/profiles";
import type { Env, User, ExecutionContext } from "../src/types";

async function runInactivityPolicyTests() {
  console.log("================================================================");
  console.log("   Inactivity Retention Policy & Abandonment Unit Tests         ");
  console.log("================================================================\n");

  const rawDb = new DatabaseSync(":memory:");
  const migrationsDir = path.resolve(__dirname, "../migrations");
  runMigrations(rawDb, migrationsDir);
  const db = new NodeD1Database(rawDb);

  const env: Env = {
    DB: db,
    ASSETS: null,
    INACTIVITY_THRESHOLD_DAYS: 180,
    INACTIVE_LOG_PURGE_DAYS: 30
  };

  const userModel = new UserModel(db, env);
  const now = 1700000000; // Fixed reference timestamp (in seconds)
  const daySec = 86400;

  // Helper to insert a user
  const insertUser = (id: string, username: string, role: string, createdAt: number, lastActiveAt: number | null) => {
    rawDb.prepare(`
      INSERT INTO users (id, username, hashed_password, role, created_at, last_active_at)
      VALUES (?, ?, 'hash', ?, ?, ?)
    `).run(id, username, role, createdAt, lastActiveAt);
  };

  // Helper to insert a profile
  const insertProfile = (id: string, ownerId: string, name: string) => {
    rawDb.prepare(`
      INSERT INTO profiles (id, owner_id, name, settings, created_at, updated_at)
      VALUES (?, ?, ?, '{}', ?, ?)
    `).run(id, ownerId, name, now, now);
  };

  // Helper to insert a log entry
  const insertLog = (id: number, profileId: string, timestamp: number) => {
    rawDb.prepare(`
      INSERT INTO logs (id, profile_id, timestamp, domain, record_type, action)
      VALUES (?, ?, ?, 'example.com', 'A', 'PASS')
    `).run(id, profileId, timestamp);
  };

  // Helper to insert an hourly rollup
  const insertRollup = (profileId: string, hourTimestamp: number) => {
    rawDb.prepare(`
      INSERT INTO hourly_rollups (profile_id, metric_type, hour_timestamp, key, sub_key, access_point_id, count)
      VALUES (?, 'action', ?, 'PASS', '', '', 1)
    `).run(profileId, hourTimestamp);
  };

  // Helper to insert web activity
  const insertWebActivity = (userId: string, timestamp: number) => {
    rawDb.prepare(`
      INSERT INTO user_activity_log (user_id, action, timestamp, ip_address)
      VALUES (?, 'login_success', ?, '127.0.0.1')
    `).run(userId, timestamp);
  };

  console.log("1. Seeding test users, profiles, logs and rollups...");
  // User 1: Active user (DNS query 5 days ago)
  insertUser("user_active", "user_active", "user", now - 60 * daySec, now - 5 * daySec);
  insertProfile("prof_active", "user_active", "Active Profile");
  insertLog(1, "prof_active", now - 5 * daySec);
  insertRollup("prof_active", now - 5 * daySec);

  // User 2: Idle 35 days (DNS query 35 days ago) -> Logs should be purged, profile & user kept!
  insertUser("user_idle_35d", "user_idle_35d", "user", now - 60 * daySec, now - 35 * daySec);
  insertProfile("prof_idle_35d", "user_idle_35d", "Idle Profile");
  insertLog(2, "prof_idle_35d", now - 35 * daySec);
  insertRollup("prof_idle_35d", now - 35 * daySec);

  // User 3: Abandoned 200 days (DNS query 200 days ago) -> Account & profile deleted!
  insertUser("user_abandoned_200d", "user_abandoned_200d", "user", now - 300 * daySec, now - 200 * daySec);
  insertProfile("prof_abandoned_200d", "user_abandoned_200d", "Abandoned Profile");
  insertLog(3, "prof_abandoned_200d", now - 200 * daySec);
  insertRollup("prof_abandoned_200d", now - 200 * daySec);

  // User 4: Web active yesterday, BUT DNS query 200 days ago!
  // Requirement: "账号闲置废弃的判断要根据解析活动判断，而不是根据登录时间判断。"
  insertUser("user_web_only", "user_web_only", "user", now - 300 * daySec, now - 200 * daySec);
  insertProfile("prof_web_only", "user_web_only", "Web Only Profile");
  insertLog(4, "prof_web_only", now - 200 * daySec);
  insertRollup("prof_web_only", now - 200 * daySec);
  insertWebActivity("user_web_only", now - 1 * daySec); // Web login 1 day ago!

  // User 5: Admin user idle 300 days -> Admins should be immune!
  insertUser("admin_idle_300d", "admin_idle_300d", "admin", now - 400 * daySec, now - 300 * daySec);
  insertProfile("prof_admin", "admin_idle_300d", "Admin Profile");
  insertLog(5, "prof_admin", now - 300 * daySec);
  insertRollup("prof_admin", now - 300 * daySec);

  // User 6: Never resolved any query (last_active_at IS NULL), created 40 days ago
  // -> logs purged (if any), account preserved (40d < 180d)
  insertUser("user_never_resolved_40d", "user_never_40d", "user", now - 40 * daySec, null);
  insertProfile("prof_never_40d", "user_never_resolved_40d", "Never 40d Profile");

  // User 7: Never resolved any query (last_active_at IS NULL), created 200 days ago
  // -> abandoned and deleted!
  insertUser("user_never_resolved_200d", "user_never_200d", "user", now - 200 * daySec, null);
  insertProfile("prof_never_200d", "user_never_resolved_200d", "Never 200d Profile");

  console.log("   ✓ Initial data seeded.\n");

  console.log("2. Executing applyInactivityPolicy(now)...");
  const result = await userModel.applyInactivityPolicy(now);
  console.log("   Result:", result);

  // Assertions:
  console.log("3. Verifying User 1 (Active 5 days ago)...");
  const activeUser = rawDb.prepare("SELECT * FROM users WHERE id = 'user_active'").get();
  assert.ok(activeUser, "Active user must NOT be deleted");
  const activeProfile = rawDb.prepare("SELECT * FROM profiles WHERE id = 'prof_active'").get();
  assert.ok(activeProfile, "Active profile must NOT be deleted");
  const activeLogs = rawDb.prepare("SELECT COUNT(*) as c FROM logs WHERE profile_id = 'prof_active'").get() as any;
  assert.strictEqual(activeLogs.c, 1, "Active user query logs must remain intact");
  const activeRollups = rawDb.prepare("SELECT COUNT(*) as c FROM hourly_rollups WHERE profile_id = 'prof_active'").get() as any;
  assert.strictEqual(activeRollups.c, 1, "Active user hourly rollups must remain intact");
  console.log("   ✓ Active user completely preserved.\n");

  console.log("4. Verifying User 2 (Idle 35 days)...");
  const idleUser = rawDb.prepare("SELECT * FROM users WHERE id = 'user_idle_35d'").get();
  assert.ok(idleUser, "Idle (35d) user account must NOT be deleted (180d threshold)");
  const idleProfile = rawDb.prepare("SELECT * FROM profiles WHERE id = 'prof_idle_35d'").get();
  assert.ok(idleProfile, "Idle (35d) profile must NOT be deleted (configs preserved!)");
  const idleLogs = rawDb.prepare("SELECT COUNT(*) as c FROM logs WHERE profile_id = 'prof_idle_35d'").get() as any;
  assert.strictEqual(idleLogs.c, 0, "Idle (35d) query logs MUST be purged");
  const idleRollups = rawDb.prepare("SELECT COUNT(*) as c FROM hourly_rollups WHERE profile_id = 'prof_idle_35d'").get() as any;
  assert.strictEqual(idleRollups.c, 0, "Idle (35d) hourly rollups MUST be purged");
  console.log("   ✓ Idle 35d: logs purged, profile & user preserved.\n");

  console.log("5. Verifying User 3 (Abandoned 200 days)...");
  const abandonedUser = rawDb.prepare("SELECT * FROM users WHERE id = 'user_abandoned_200d'").get();
  assert.strictEqual(abandonedUser, undefined, "Abandoned user (200d > 180d) MUST be deleted");
  const abandonedProfile = rawDb.prepare("SELECT * FROM profiles WHERE id = 'prof_abandoned_200d'").get();
  assert.strictEqual(abandonedProfile, undefined, "Abandoned profile MUST be deleted");
  const abandonedLogs = rawDb.prepare("SELECT COUNT(*) as c FROM logs WHERE profile_id = 'prof_abandoned_200d'").get() as any;
  assert.strictEqual(abandonedLogs.c, 0, "Abandoned logs MUST be purged");
  console.log("   ✓ Abandoned 200d: account, profile and logs completely deleted.\n");

  console.log("6. Verifying User 4 (Web logged in yesterday, but DNS resolution idle 200 days)...");
  // The user explicitly stated: "账号闲置废弃的判断要根据解析活动判断，而不是根据登录时间判断。"
  const webOnlyUser = rawDb.prepare("SELECT * FROM users WHERE id = 'user_web_only'").get();
  assert.strictEqual(
    webOnlyUser,
    undefined,
    "User with no DNS resolution for 200d must be deleted even if they logged in yesterday on Web"
  );
  const webOnlyProfile = rawDb.prepare("SELECT * FROM profiles WHERE id = 'prof_web_only'").get();
  assert.strictEqual(webOnlyProfile, undefined, "Web-only profile must be deleted with abandoned user");
  console.log("   ✓ Inactivity correctly judged by DNS resolution activity, ignoring web logins.\n");

  console.log("7. Verifying User 5 (Admin idle 300 days)...");
  const adminUser = rawDb.prepare("SELECT * FROM users WHERE id = 'admin_idle_300d'").get();
  assert.ok(adminUser, "Admin accounts must NEVER be deleted by inactivity policy");
  const adminProfile = rawDb.prepare("SELECT * FROM profiles WHERE id = 'prof_admin'").get();
  assert.ok(adminProfile, "Admin profiles must NEVER be deleted by inactivity policy");
  const adminLogs = rawDb.prepare("SELECT COUNT(*) as c FROM logs WHERE profile_id = 'prof_admin'").get() as any;
  assert.strictEqual(adminLogs.c, 1, "Admin query logs must NOT be touched by user inactivity policy");
  console.log("   ✓ Admin account immune from inactivity cleanup.\n");

  console.log("8. Verifying Users 6 & 7 (Never resolved queries, fallback to created_at)...");
  const never40d = rawDb.prepare("SELECT * FROM users WHERE id = 'user_never_resolved_40d'").get();
  assert.ok(never40d, "User created 40d ago without queries must NOT be deleted (40 < 180)");
  const never200d = rawDb.prepare("SELECT * FROM users WHERE id = 'user_never_resolved_200d'").get();
  assert.strictEqual(never200d, undefined, "User created 200d ago without queries MUST be deleted (200 >= 180)");
  console.log("   ✓ Users without resolution history correctly fall back to created_at.\n");

  console.log("9. Verifying custom threshold overrides...");
  // Test with custom options: inactiveLogPurgeDays: 3, inactivityDays: 10
  const customUserModel = new UserModel(db, {
    ...env,
    INACTIVITY_THRESHOLD_DAYS: "10",
    INACTIVE_LOG_PURGE_DAYS: "3"
  });

  // User 1 was active 5 days ago. With 3-day purge, its logs should now be purged!
  // But with 10-day abandonment, the user should still exist (5 < 10).
  const customResult = await customUserModel.applyInactivityPolicy(now);
  const activeLogsAfter = rawDb.prepare("SELECT COUNT(*) as c FROM logs WHERE profile_id = 'prof_active'").get() as any;
  assert.strictEqual(activeLogsAfter.c, 0, "Logs for 5-day idle user purged with custom 3-day threshold");
  const activeUserAfter = rawDb.prepare("SELECT * FROM users WHERE id = 'user_active'").get();
  assert.ok(activeUserAfter, "User active 5 days ago preserved under custom 10-day abandonment threshold");
  console.log("   ✓ Custom threshold overrides fully operational.\n");

  console.log("10. Verifying DELETE /api/profiles/:id/logs (Clear profile logs endpoint)...");
  // Seed fresh log and rollup for prof_active
  insertLog(101, "prof_active", now);
  insertRollup("prof_active", now);
  const beforeCount = rawDb.prepare("SELECT COUNT(*) as c FROM logs WHERE profile_id = 'prof_active'").get() as any;
  assert.strictEqual(beforeCount.c, 1, "Log row must exist before deletion");

  const req = new Request("https://example.com/api/profiles/prof_active/logs", {
    method: "DELETE"
  });
  const mockUser: User = { id: "user_active", username: "user_active", role: "user" };
  const mockCtx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;
  const res = await handleProfilesRequest(req, env, mockUser, mockCtx);
  assert.strictEqual(res.status, 200, "DELETE /api/profiles/:id/logs should return 200 OK");
  const resBody = await res.json() as any;
  assert.strictEqual(resBody.success, true, "Response should have success: true");

  const afterCount = rawDb.prepare("SELECT COUNT(*) as c FROM logs WHERE profile_id = 'prof_active'").get() as any;
  assert.strictEqual(afterCount.c, 0, "Log rows for profile must be deleted");
  const afterRollups = rawDb.prepare("SELECT COUNT(*) as c FROM hourly_rollups WHERE profile_id = 'prof_active'").get() as any;
  assert.strictEqual(afterRollups.c, 0, "Hourly rollups for profile must be deleted");
  const profileStillExists = rawDb.prepare("SELECT * FROM profiles WHERE id = 'prof_active'").get();
  assert.ok(profileStillExists, "Profile itself must NOT be deleted when clearing profile logs");
  console.log("   ✓ Profile log clearing endpoint deleted logs & rollups while preserving profile.\n");

  console.log("================================================================");
  console.log("   All Inactivity Retention Policy tests passed successfully!   ");
  console.log("================================================================\n");
}

runInactivityPolicyTests().catch((err) => {
  console.error("Test failed with error:", err);
  process.exit(1);
});
