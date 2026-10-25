/**
 * @file suiteBackend.ts
 * @description Suite 3: Backend Authentication Route Turnstile Gating Integration Tests.
 */

import assert from "node:assert";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { handleLoginRequest } from "../../src/api/auth/login";
import { handleAuthRegisterRequest } from "../../src/api/auth/register";
import { handleForgotPasswordRequest } from "../../src/api/auth/forgotPassword";
import { handleAuthConfigRequest } from "../../src/api/auth/config";
import { SystemSettingsModel } from "../../src/models/systemSettings";
import { UserModel } from "../../src/models/user";
import { NodeD1Database, runMigrations } from "../../src/serverfull/db";
import { hashPassword } from "../../src/utils/crypto";
import type { Env } from "../../src/types";
import { CF_TURNSTILE_TEST_SITEKEYS, CF_TURNSTILE_TEST_SECRETS, MockCache } from "./fixtures";

/**
 * Validates Prelogin, Register, Forgot Password, and Auth Config endpoints under Turnstile gating.
 */
export async function runBackendSuite(): Promise<void> {
  console.log("\n--- Suite 3: Backend Auth Routes Turnstile Gating Integration ---");

  // Setup in-memory SQLite database and apply migrations
  const rawDb = new DatabaseSync(":memory:");
  const migrationsDir = path.resolve(__dirname, "../../migrations");
  runMigrations(rawDb, migrationsDir);
  const db = new NodeD1Database(rawDb);

  const mockCache = new MockCache();
  const originalCaches = (globalThis as any).caches;
  const originalFetch = globalThis.fetch;

  (globalThis as any).caches = { default: mockCache };

  const env: Env = {
    DB: db,
    ASSETS: { fetch: async () => new Response("Not Found", { status: 404 }) },
    JWT_SECRET: "test_jwt_secret_must_be_at_least_32_characters_long_for_security",
    PREAUTH_TTL_SECONDS: "300"
  };

  const settingsModel = new SystemSettingsModel(db);
  const userModel = new UserModel(db, env);

  // Seed test user
  const passwordHash = await hashPassword("SecurePassword123!");
  await userModel.create({
    id: "user_alice_test_123",
    username: "alice",
    passwordHash,
    role: "admin",
    passwordVersion: 2
  });
  const testUser = await userModel.getByUsername("alice");
  assert(testUser, "Test user alice must be seeded in database");

  try {
    // ------------------------------------------------------------------------
    // 3.1 Pre-login Endpoint (/api/auth/prelogin)
    // ------------------------------------------------------------------------
    console.log("3.1 Testing /api/auth/prelogin Turnstile gating...");

    // Enable Turnstile for login with test secret
    await settingsModel.set("turnstile_enabled_login", "true");
    await settingsModel.set("turnstile_secret_key", CF_TURNSTILE_TEST_SECRETS.ALWAYS_PASSES.secretKey);
    SystemSettingsModel.clearMemoryCache();

    // Mock fetch for siteverify: return success only if token is "valid_token"
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body?.toString() || "";
      const params = new URLSearchParams(body);
      const token = params.get("response");
      const secret = params.get("secret");

      if (secret === CF_TURNSTILE_TEST_SECRETS.ALWAYS_PASSES.secretKey && token === "valid_token") {
        return new Response(JSON.stringify({ success: true }));
      }
      return new Response(JSON.stringify({
        success: false,
        "error-codes": ["invalid-input-response"]
      }));
    }) as any;

    // Case 1: Missing turnstileToken -> Expect 400
    const reqMissingToken = new Request("https://obexdns.internal/api/auth/prelogin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "alice" })
    });
    const resMissing = await handleLoginRequest(reqMissingToken, env);
    assert.strictEqual(resMissing.status, 400, "Missing Turnstile token must return HTTP 400");
    assert.strictEqual(await resMissing.text(), "Verification failed");

    // Case 2: Invalid turnstileToken -> Expect 400
    const reqInvalidToken = new Request("https://obexdns.internal/api/auth/prelogin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "alice", turnstileToken: "bad_token" })
    });
    const resInvalid = await handleLoginRequest(reqInvalidToken, env);
    assert.strictEqual(resInvalid.status, 400, "Invalid Turnstile token must return HTTP 400");
    assert.strictEqual(await resInvalid.text(), "Verification failed");

    // Case 3: Valid turnstileToken -> Expect 200 with preauth session
    const reqValidToken = new Request("https://obexdns.internal/api/auth/prelogin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "alice", turnstileToken: "valid_token" })
    });
    const resValid = await handleLoginRequest(reqValidToken, env);
    assert.strictEqual(resValid.status, 200, "Valid Turnstile token must succeed with HTTP 200");
    const validJson = (await resValid.json()) as any;
    assert.strictEqual(typeof validJson.nonce, "string", "Response must contain challenge nonce");
    assert.strictEqual(validJson.requires_password, true, "Response must specify requires_password");
    assert(resValid.headers.get("Set-Cookie")?.includes("preauth_session"), "Response must issue preauth_session cookie");

    // Case 4: Turnstile disabled -> Missing token should succeed
    await settingsModel.set("turnstile_enabled_login", "false");
    SystemSettingsModel.clearMemoryCache();

    const reqDisabled = new Request("https://obexdns.internal/api/auth/prelogin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "alice" })
    });
    const resDisabled = await handleLoginRequest(reqDisabled, env);
    assert.strictEqual(resDisabled.status, 200, "When Turnstile login is disabled, prelogin succeeds without token");

    console.log("  PASS: /api/auth/prelogin Turnstile gating verified.");

    // ------------------------------------------------------------------------
    // 3.2 Registration Endpoint (/api/auth/register)
    // ------------------------------------------------------------------------
    console.log("3.2 Testing /api/auth/register Turnstile gating...");

    await settingsModel.set("turnstile_enabled_signup", "true");
    await settingsModel.set("turnstile_secret_key", CF_TURNSTILE_TEST_SECRETS.ALWAYS_PASSES.secretKey);
    await settingsModel.set("registration_enabled", "true");
    SystemSettingsModel.clearMemoryCache();

    const cfGeoHeaders = {
      "Content-Type": "application/json",
      "CF-IPLatitude": "37.7749",
      "CF-IPLongitude": "-122.4194"
    };

    // Case 1: Missing turnstileToken -> Expect 400
    const reqRegMissing = new Request("https://obexdns.internal/api/auth/register", {
      method: "POST",
      headers: cfGeoHeaders,
      body: JSON.stringify({ username: "bob_test_123", password: "Password123!@#" })
    });
    const resRegMissing = await handleAuthRegisterRequest(reqRegMissing, env);
    assert.strictEqual(resRegMissing.status, 400, "Registration without Turnstile token must return HTTP 400");
    assert.strictEqual(await resRegMissing.text(), "Verification failed");

    // Case 2: Invalid turnstileToken -> Expect 400
    const reqRegInvalid = new Request("https://obexdns.internal/api/auth/register", {
      method: "POST",
      headers: cfGeoHeaders,
      body: JSON.stringify({ username: "bob_test_123", password: "Password123!@#", turnstileToken: "fake_token" })
    });
    const resRegInvalid = await handleAuthRegisterRequest(reqRegInvalid, env);
    assert.strictEqual(resRegInvalid.status, 400, "Registration with invalid Turnstile token must return HTTP 400");

    // Case 3: Valid turnstileToken -> Expect 200 and user registered
    const reqRegValid = new Request("https://obexdns.internal/api/auth/register", {
      method: "POST",
      headers: cfGeoHeaders,
      body: JSON.stringify({ username: "bob_test_123", password: "Password123!@#", turnstileToken: "valid_token" })
    });
    const resRegValid = await handleAuthRegisterRequest(reqRegValid, env);
    assert.strictEqual(resRegValid.status, 200, "Registration with valid Turnstile token must succeed");
    const registeredUser = await userModel.getByUsername("bob_test_123");
    assert(registeredUser, "User bob_test_123 should be created in database");

    // Case 4: Turnstile signup disabled -> Can register without token
    await settingsModel.set("turnstile_enabled_signup", "false");
    SystemSettingsModel.clearMemoryCache();

    const reqRegDisabled = new Request("https://obexdns.internal/api/auth/register", {
      method: "POST",
      headers: cfGeoHeaders,
      body: JSON.stringify({ username: "charlie_test_123", password: "Password123!@#" })
    });
    const resRegDisabled = await handleAuthRegisterRequest(reqRegDisabled, env);
    assert.strictEqual(resRegDisabled.status, 200, "Registration succeeds without token when Turnstile is disabled");

    console.log("  PASS: /api/auth/register Turnstile gating verified.");

    // ------------------------------------------------------------------------
    // 3.3 Forgot Password Endpoint (/api/auth/forgot-password/init)
    // ------------------------------------------------------------------------
    console.log("3.3 Testing /api/auth/forgot-password/init Turnstile gating...");

    await settingsModel.set("turnstile_enabled_login", "true");
    await settingsModel.set("turnstile_secret_key", CF_TURNSTILE_TEST_SECRETS.ALWAYS_PASSES.secretKey);
    SystemSettingsModel.clearMemoryCache();

    // Case 1: Missing turnstileToken -> Expect 400
    const reqFpMissing = new Request("https://obexdns.internal/api/auth/forgot-password/init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "alice" })
    });
    const resFpMissing = await handleForgotPasswordRequest(reqFpMissing, env);
    assert.strictEqual(resFpMissing.status, 400, "Forgot password init without token must return HTTP 400");
    assert.strictEqual(await resFpMissing.text(), "Verification failed");

    // Case 2: Invalid turnstileToken -> Expect 400
    const reqFpInvalid = new Request("https://obexdns.internal/api/auth/forgot-password/init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "alice", turnstileToken: "wrong_token" })
    });
    const resFpInvalid = await handleForgotPasswordRequest(reqFpInvalid, env);
    assert.strictEqual(resFpInvalid.status, 400, "Forgot password init with invalid token must return HTTP 400");

    // Case 3: Valid turnstileToken -> Expect 200
    const reqFpValid = new Request("https://obexdns.internal/api/auth/forgot-password/init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "alice", turnstileToken: "valid_token" })
    });
    const resFpValid = await handleForgotPasswordRequest(reqFpValid, env);
    assert.strictEqual(resFpValid.status, 200, "Forgot password init with valid token must return HTTP 200");

    // Case 4: Turnstile disabled -> Missing token succeeds
    await settingsModel.set("turnstile_enabled_login", "false");
    SystemSettingsModel.clearMemoryCache();

    const reqFpDisabled = new Request("https://obexdns.internal/api/auth/forgot-password/init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "alice" })
    });
    const resFpDisabled = await handleForgotPasswordRequest(reqFpDisabled, env);
    assert.strictEqual(resFpDisabled.status, 200, "Forgot password init succeeds without token when Turnstile is disabled");

    console.log("  PASS: /api/auth/forgot-password/init Turnstile gating verified.");

    // ------------------------------------------------------------------------
    // 3.4 Public Configuration Endpoint (/api/auth/config)
    // ------------------------------------------------------------------------
    console.log("3.4 Testing /api/auth/config exposure...");

    await settingsModel.set("turnstile_site_key", CF_TURNSTILE_TEST_SITEKEYS.VISIBLE_ALWAYS_PASSES.sitekey);
    await settingsModel.set("turnstile_enabled_signup", "true");
    await settingsModel.set("turnstile_enabled_login", "true");
    SystemSettingsModel.clearMemoryCache();

    const reqConfig = new Request("https://obexdns.internal/api/auth/config", { method: "GET" });
    const resConfig = await handleAuthConfigRequest(reqConfig, env);
    assert.strictEqual(resConfig.status, 200);
    const configData = (await resConfig.json()) as any;

    assert.strictEqual(configData.turnstile_site_key, CF_TURNSTILE_TEST_SITEKEYS.VISIBLE_ALWAYS_PASSES.sitekey);
    assert.strictEqual(configData.turnstile_enabled_signup, true);
    assert.strictEqual(configData.turnstile_enabled_login, true);
    console.log("  PASS: /api/auth/config accurately returns configured sitekey and gating flags.");

  } finally {
    (globalThis as any).caches = originalCaches;
    globalThis.fetch = originalFetch;
    rawDb.close();
  }
}
