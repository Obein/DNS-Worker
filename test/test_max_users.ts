/**
 * @file test_max_users.ts
 * @description Comprehensive unit and integration test suite for User Count Limit (MAX_USERS).
 */

import assert from "node:assert";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { handleAuthRegisterRequest } from "../src/api/auth/register";
import { handleAuthConfigRequest } from "../src/api/auth/config";
import { handleAdminRequest } from "../src/api/account/admin";
import { SystemSettingsModel } from "../src/models/systemSettings";
import { UserModel } from "../src/models/user";
import { NodeD1Database, runMigrations } from "../src/serverfull/db";
import { hashPassword } from "../src/utils/crypto";
import type { Env, User, ExecutionContext } from "../src/types";

class MockCache {
  private store = new Map<string, Response>();
  async match(req: Request | string): Promise<Response | undefined> {
    const key = typeof req === "string" ? req : req.url;
    return this.store.get(key);
  }
  async put(req: Request | string, res: Response): Promise<void> {
    const key = typeof req === "string" ? req : req.url;
    this.store.set(key, res);
  }
}

const mockCtx = {
  waitUntil: () => {},
  passThroughOnException: () => {}
} as unknown as ExecutionContext;

async function runMaxUsersTestSuite(): Promise<void> {
  console.log("================================================================");
  console.log("       User Quota & Max Users Limit Unit Test Suite             ");
  console.log("================================================================");

  const rawDb = new DatabaseSync(":memory:");
  const migrationsDir = path.resolve(__dirname, "../migrations");
  runMigrations(rawDb, migrationsDir);
  const db = new NodeD1Database(rawDb);

  const mockCache = new MockCache();
  (globalThis as any).caches = { default: mockCache };

  const env: Env = {
    DB: db,
    ASSETS: { fetch: async () => new Response("Not Found", { status: 404 }) },
    JWT_SECRET: "test_jwt_secret_must_be_at_least_32_characters_long_for_security",
    MAX_USERS: "2"
  };

  const userModel = new UserModel(db, env);
  const settingsModel = new SystemSettingsModel(db);

  console.log("\n[1] Testing UserModel.count() and isEmpty()");
  assert.strictEqual(await userModel.count(), 0, "Initial user count must be 0");
  assert.strictEqual(await userModel.isEmpty(), true, "Initial user DB must be empty");

  console.log("\n[2] Testing Initial Admin Registration Bootstrap");
  // Empty DB bootstrap: Registering the first user (Admin) must succeed even if MAX_USERS is configured
  const regReq1 = new Request("http://localhost/api/auth/register", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "CF-Connecting-IP": "1.2.3.4",
      "CF-IPLatitude": "37.7749",
      "CF-IPLongitude": "-122.4194"
    },
    body: JSON.stringify({
      username: "admin_user",
      password: "Password12345!"
    })
  });
  const regRes1 = await handleAuthRegisterRequest(regReq1, env);
  assert.strictEqual(regRes1.status, 200, `First admin registration should succeed: status=${regRes1.status}`);
  assert.strictEqual(await userModel.count(), 1, "User count should be 1 after admin registration");
  assert.strictEqual(await userModel.isEmpty(), false, "Database is no longer empty");

  console.log("\n[3] Testing Public Registration below MAX_USERS");
  // User 2: Should succeed as MAX_USERS is 2
  const regReq2 = new Request("http://localhost/api/auth/register", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "CF-Connecting-IP": "1.2.3.5",
      "CF-IPLatitude": "37.7749",
      "CF-IPLongitude": "-122.4194"
    },
    body: JSON.stringify({
      username: "regular_user2",
      password: "Password12345!"
    })
  });
  const regRes2 = await handleAuthRegisterRequest(regReq2, env);
  assert.strictEqual(regRes2.status, 200, `Second user registration should succeed: status=${regRes2.status}`);
  assert.strictEqual(await userModel.count(), 2, "User count should be 2");

  console.log("\n[4] Testing Public Registration blocked when MAX_USERS reached");
  // User 3: Current count (2) >= MAX_USERS (2) -> Should be blocked with HTTP 403 max_users_reached
  const regReq3 = new Request("http://localhost/api/auth/register", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "CF-Connecting-IP": "1.2.3.6",
      "CF-IPLatitude": "37.7749",
      "CF-IPLongitude": "-122.4194"
    },
    body: JSON.stringify({
      username: "blocked_user3",
      password: "Password12345!"
    })
  });
  const regRes3 = await handleAuthRegisterRequest(regReq3, env);
  assert.strictEqual(regRes3.status, 403, "Third user registration must return HTTP 403");
  const regRes3Body = await regRes3.text();
  assert.strictEqual(regRes3Body, "max_users_reached", "Response body must be max_users_reached");
  assert.strictEqual(await userModel.count(), 2, "User count should remain 2");

  console.log("\n[5] Testing Admin User Creation blocked when MAX_USERS reached");
  const adminUser: User = {
    id: "admin_user_id",
    username: "admin_user",
    role: "admin",
    created_at: Math.floor(Date.now() / 1000)
  };

  const adminCreateReq = new Request("http://localhost/api/admin/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: "admin_created_user",
      password: "Password12345!",
      role: "user"
    })
  });
  const adminCreateRes = await handleAdminRequest(adminCreateReq, env, adminUser, ["", "api", "users"], mockCtx);
  assert.strictEqual(adminCreateRes.status, 400, "Admin creation must be blocked with HTTP 400");
  const adminCreateBody = await adminCreateRes.text();
  assert.strictEqual(adminCreateBody, "max_users_reached", "Admin creation error must be max_users_reached");

  console.log("\n[6] Testing GET /api/auth/config exposes quota and sets registration_enabled to false");
  const configReq = new Request("http://localhost/api/auth/config", { method: "GET" });
  const configRes = await handleAuthConfigRequest(configReq, env);
  assert.strictEqual(configRes.status, 200);
  const configJson = await configRes.json() as any;
  assert.strictEqual(configJson.max_users, 2, "max_users should be 2");
  assert.strictEqual(configJson.max_users_reached, true, "max_users_reached should be true");
  assert.strictEqual(configJson.registration_enabled, false, "registration_enabled should be false when max_users reached");

  console.log("\n[7] Testing Dynamic Admin Settings Update (increasing max_users to 5)");
  const patchSettingsReq = new Request("http://localhost/api/admin/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ max_users: "5" })
  });
  const patchSettingsRes = await handleAdminRequest(patchSettingsReq, env, adminUser, ["", "api", "settings"], mockCtx);
  assert.strictEqual(patchSettingsRes.status, 200, "PATCH settings should succeed");
  const updatedMaxUsers = await settingsModel.get("max_users");
  assert.strictEqual(updatedMaxUsers, "5", "system_settings.max_users must be updated to 5");

  console.log("\n[8] Testing Registration and Config after Quota Increase");
  const configRes2 = await handleAuthConfigRequest(configReq, env);
  const configJson2 = await configRes2.json() as any;
  assert.strictEqual(configJson2.max_users, 5, "max_users should now be 5");
  assert.strictEqual(configJson2.max_users_reached, false, "max_users_reached should now be false");
  assert.strictEqual(configJson2.registration_enabled, true, "registration_enabled should now be true");

  const regReq4 = new Request("http://localhost/api/auth/register", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "CF-Connecting-IP": "1.2.3.7",
      "CF-IPLatitude": "37.7749",
      "CF-IPLongitude": "-122.4194"
    },
    body: JSON.stringify({
      username: "allowed_user3",
      password: "Password12345!"
    })
  });
  const regRes4 = await handleAuthRegisterRequest(regReq4, env);
  assert.strictEqual(regRes4.status, 200, `User 3 registration should now succeed: status=${regRes4.status}`);
  assert.strictEqual(await userModel.count(), 3, "User count should now be 3");

  console.log("\n[9] Testing Unlimited Users (max_users = 0)");
  const patchUnlimitedReq = new Request("http://localhost/api/admin/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ max_users: "0" })
  });
  await handleAdminRequest(patchUnlimitedReq, env, adminUser, ["", "api", "settings"], mockCtx);
  const configRes3 = await handleAuthConfigRequest(configReq, env);
  const configJson3 = await configRes3.json() as any;
  assert.strictEqual(configJson3.max_users, null, "max_users 0 should be exposed as null (unlimited)");
  assert.strictEqual(configJson3.max_users_reached, false, "max_users_reached should be false for unlimited");
  assert.strictEqual(configJson3.registration_enabled, true, "registration_enabled should be true for unlimited");

  console.log("\n================================================================");
  console.log(">>> ALL MAX_USERS TESTS PASSED SUCCESSFULLY!                    ");
  console.log("================================================================\n");
}

runMaxUsersTestSuite().catch((err: unknown) => {
  console.error("\n[TEST FAILED]:", err);
  process.exit(1);
});
