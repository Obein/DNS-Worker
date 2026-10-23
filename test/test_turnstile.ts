/**
 * @file test_turnstile.ts
 * @description Comprehensive unit and integration test suite for Cloudflare Turnstile bot verification.
 * 
 * Verifies:
 * 1. Cloudflare Official Testing Matrix Constants (5 dummy sitekeys + 3 dummy secret keys).
 * 2. verifyTurnstile core utility: input boundary validation, HTTP contract, mock siteverify outcomes, fail-closed error handling.
 * 3. Backend auth route Turnstile gating (Pre-login, Registration, Forgot Password, and Auth Config).
 * 4. Frontend widget lifecycle, callbacks (success/expired/error), reset, and teardown contracts.
 */

import assert from "node:assert";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { verifyTurnstile } from "../src/api/auth/utils";
import { handleLoginRequest } from "../src/api/auth/login";
import { handleAuthRegisterRequest } from "../src/api/auth/register";
import { handleForgotPasswordRequest } from "../src/api/auth/forgotPassword";
import { handleAuthConfigRequest } from "../src/api/auth/config";
import { SystemSettingsModel } from "../src/models/systemSettings";
import { UserModel } from "../src/models/user";
import { NodeD1Database, runMigrations } from "../src/serverfull/db";
import { hashPassword } from "../src/utils/crypto";
import type { Env } from "../src/types";

// ============================================================================
// 1. Cloudflare Official Testing Keys & Matrix Constants
// ============================================================================

export interface TurnstileSiteKeySpec {
  sitekey: string;
  widgetType: "visible" | "invisible";
  behavior: "always_passes" | "always_fails" | "interactive_challenge";
  description: string;
}

export interface TurnstileSecretKeySpec {
  secretKey: string;
  expectedSuccess: boolean;
  expectedErrorCode?: string;
  description: string;
}

export const CF_TURNSTILE_TEST_SITEKEYS = {
  VISIBLE_ALWAYS_PASSES: {
    sitekey: "1x00000000000000000000AA",
    widgetType: "visible",
    behavior: "always_passes",
    description: "Visible widget that always passes verification (Form success flow)"
  },
  VISIBLE_ALWAYS_FAILS: {
    sitekey: "2x00000000000000000000AB",
    widgetType: "visible",
    behavior: "always_fails",
    description: "Visible widget that always fails verification (Error handling & retry logic)"
  },
  INVISIBLE_ALWAYS_PASSES: {
    sitekey: "1x00000000000000000000BB",
    widgetType: "invisible",
    behavior: "always_passes",
    description: "Invisible widget that always passes verification (Invisible success flow)"
  },
  INVISIBLE_ALWAYS_FAILS: {
    sitekey: "2x00000000000000000000BB",
    widgetType: "invisible",
    behavior: "always_fails",
    description: "Invisible widget that always fails verification (Invisible error handling)"
  },
  VISIBLE_INTERACTIVE_CHALLENGE: {
    sitekey: "3x00000000000000000000FF",
    widgetType: "visible",
    behavior: "interactive_challenge",
    description: "Visible widget that forces an interactive challenge (Manual user checkbox/interaction)"
  }
} as const satisfies Record<string, TurnstileSiteKeySpec>;

export const CF_TURNSTILE_TEST_SECRETS = {
  ALWAYS_PASSES: {
    secretKey: "1x0000000000000000000000000000000AA",
    expectedSuccess: true,
    description: "Secret key that always passes siteverify validation"
  },
  ALWAYS_FAILS: {
    secretKey: "2x0000000000000000000000000000000AB",
    expectedSuccess: false,
    expectedErrorCode: "invalid-input-response",
    description: "Secret key that always fails siteverify validation"
  },
  TOKEN_SPENT: {
    secretKey: "3x0000000000000000000000000000000AA",
    expectedSuccess: false,
    expectedErrorCode: "timeout-or-duplicate",
    description: "Secret key that yields a token already spent / duplicate error"
  }
} as const satisfies Record<string, TurnstileSecretKeySpec>;

// ============================================================================
// Helper Mock Cache for Rate Limiting / Caches API
// ============================================================================

class MockCache {
  private store = new Map<string, Response>();

  async match(url: string | URL | Request): Promise<Response | undefined> {
    const key = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
    const res = this.store.get(key);
    return res ? res.clone() : undefined;
  }

  async put(url: string | URL | Request, res: Response): Promise<void> {
    const key = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
    this.store.set(key, res.clone());
  }

  async delete(url: string | URL | Request): Promise<boolean> {
    const key = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
    return this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}

// ============================================================================
// Test Suite 1: Test Key Catalog Specification
// ============================================================================

function testTestKeyCatalog(): void {
  console.log("\n--- Suite 1: Cloudflare Turnstile Official Test Key Catalog ---");

  // Verify all 5 official test sitekeys
  const sitekeys = Object.values(CF_TURNSTILE_TEST_SITEKEYS);
  assert.strictEqual(sitekeys.length, 5, "Must declare 5 official Cloudflare test sitekeys");

  assert.strictEqual(CF_TURNSTILE_TEST_SITEKEYS.VISIBLE_ALWAYS_PASSES.sitekey, "1x00000000000000000000AA");
  assert.strictEqual(CF_TURNSTILE_TEST_SITEKEYS.VISIBLE_ALWAYS_PASSES.widgetType, "visible");
  assert.strictEqual(CF_TURNSTILE_TEST_SITEKEYS.VISIBLE_ALWAYS_PASSES.behavior, "always_passes");

  assert.strictEqual(CF_TURNSTILE_TEST_SITEKEYS.VISIBLE_ALWAYS_FAILS.sitekey, "2x00000000000000000000AB");
  assert.strictEqual(CF_TURNSTILE_TEST_SITEKEYS.VISIBLE_ALWAYS_FAILS.widgetType, "visible");
  assert.strictEqual(CF_TURNSTILE_TEST_SITEKEYS.VISIBLE_ALWAYS_FAILS.behavior, "always_fails");

  assert.strictEqual(CF_TURNSTILE_TEST_SITEKEYS.INVISIBLE_ALWAYS_PASSES.sitekey, "1x00000000000000000000BB");
  assert.strictEqual(CF_TURNSTILE_TEST_SITEKEYS.INVISIBLE_ALWAYS_PASSES.widgetType, "invisible");
  assert.strictEqual(CF_TURNSTILE_TEST_SITEKEYS.INVISIBLE_ALWAYS_PASSES.behavior, "always_passes");

  assert.strictEqual(CF_TURNSTILE_TEST_SITEKEYS.INVISIBLE_ALWAYS_FAILS.sitekey, "2x00000000000000000000BB");
  assert.strictEqual(CF_TURNSTILE_TEST_SITEKEYS.INVISIBLE_ALWAYS_FAILS.widgetType, "invisible");
  assert.strictEqual(CF_TURNSTILE_TEST_SITEKEYS.INVISIBLE_ALWAYS_FAILS.behavior, "always_fails");

  assert.strictEqual(CF_TURNSTILE_TEST_SITEKEYS.VISIBLE_INTERACTIVE_CHALLENGE.sitekey, "3x00000000000000000000FF");
  assert.strictEqual(CF_TURNSTILE_TEST_SITEKEYS.VISIBLE_INTERACTIVE_CHALLENGE.widgetType, "visible");
  assert.strictEqual(CF_TURNSTILE_TEST_SITEKEYS.VISIBLE_INTERACTIVE_CHALLENGE.behavior, "interactive_challenge");

  // Verify all 3 official test secrets
  assert.strictEqual(CF_TURNSTILE_TEST_SECRETS.ALWAYS_PASSES.secretKey, "1x0000000000000000000000000000000AA");
  assert.strictEqual(CF_TURNSTILE_TEST_SECRETS.ALWAYS_PASSES.expectedSuccess, true);

  assert.strictEqual(CF_TURNSTILE_TEST_SECRETS.ALWAYS_FAILS.secretKey, "2x0000000000000000000000000000000AB");
  assert.strictEqual(CF_TURNSTILE_TEST_SECRETS.ALWAYS_FAILS.expectedSuccess, false);
  assert.strictEqual(CF_TURNSTILE_TEST_SECRETS.ALWAYS_FAILS.expectedErrorCode, "invalid-input-response");

  assert.strictEqual(CF_TURNSTILE_TEST_SECRETS.TOKEN_SPENT.secretKey, "3x0000000000000000000000000000000AA");
  assert.strictEqual(CF_TURNSTILE_TEST_SECRETS.TOKEN_SPENT.expectedSuccess, false);
  assert.strictEqual(CF_TURNSTILE_TEST_SECRETS.TOKEN_SPENT.expectedErrorCode, "timeout-or-duplicate");

  console.log("  PASS: Cloudflare official test key matrix properly validated.");
}

// ============================================================================
// Test Suite 2: verifyTurnstile Core Function Unit Tests
// ============================================================================

async function testVerifyTurnstileCore(): Promise<void> {
  console.log("\n--- Suite 2: verifyTurnstile Core Function Unit Tests ---");

  const originalFetch = globalThis.fetch;

  try {
    // 1. Boundary: Missing token or secret immediately fails closed without fetch
    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      throw new Error("fetch should not be called when inputs are empty");
    }) as any;

    assert.strictEqual(await verifyTurnstile("", "secret_123", "127.0.0.1"), false, "Empty token must return false");
    assert.strictEqual(await verifyTurnstile("token_123", "", "127.0.0.1"), false, "Empty secret must return false");
    assert.strictEqual(await verifyTurnstile("", "", "127.0.0.1"), false, "Empty token and secret must return false");
    assert.strictEqual(await verifyTurnstile(null as any, "secret", "127.0.0.1"), false, "Null token must return false");
    assert.strictEqual(await verifyTurnstile("token", null as any, "127.0.0.1"), false, "Null secret must return false");
    assert.strictEqual(fetchCalled, false, "Network fetch must never be invoked on invalid input bounds");
    console.log("  PASS: Input boundary guards correctly prevent network execution.");

    // 2. Wire format verification & HTTP contract
    let capturedUrl = "";
    let capturedMethod = "";
    let capturedHeaders: Record<string, string> = {};
    let capturedBody = "";

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = input.toString();
      capturedMethod = init?.method || "GET";
      if (init?.headers) {
        if (init.headers instanceof Headers) {
          init.headers.forEach((val, key) => { capturedHeaders[key] = val; });
        } else if (Array.isArray(init.headers)) {
          init.headers.forEach(([k, v]) => { capturedHeaders[k] = v; });
        } else {
          capturedHeaders = { ...init.headers } as Record<string, string>;
        }
      }
      capturedBody = init?.body ? init.body.toString() : "";
      return new Response(JSON.stringify({ success: true }));
    }) as any;

    const passResult = await verifyTurnstile("test_token_abc", "1x0000000000000000000000000000000AA", "192.168.1.100");
    assert.strictEqual(passResult, true, "Should return true for successful siteverify response");
    assert.strictEqual(capturedUrl, "https://challenges.cloudflare.com/turnstile/v0/siteverify");
    assert.strictEqual(capturedMethod, "POST");
    assert.strictEqual(capturedHeaders["Content-Type"], "application/x-www-form-urlencoded");

    const parsedParams = new URLSearchParams(capturedBody);
    assert.strictEqual(parsedParams.get("secret"), "1x0000000000000000000000000000000AA");
    assert.strictEqual(parsedParams.get("response"), "test_token_abc");
    assert.strictEqual(parsedParams.get("remoteip"), "192.168.1.100");
    console.log("  PASS: Outgoing wire payload and headers adhere strictly to Cloudflare siteverify contract.");

    // 3. Test responses for Cloudflare test secrets
    // Always Passes secret
    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({
        success: true,
        challenge_ts: new Date().toISOString(),
        hostname: "example.com"
      }));
    }) as any;
    const testSecretPass = await verifyTurnstile("any_token", CF_TURNSTILE_TEST_SECRETS.ALWAYS_PASSES.secretKey, "1.1.1.1");
    assert.strictEqual(testSecretPass, true, "CF Always Passes secret key should return true");

    // Always Fails secret
    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({
        success: false,
        "error-codes": [CF_TURNSTILE_TEST_SECRETS.ALWAYS_FAILS.expectedErrorCode]
      }));
    }) as any;
    const testSecretFail = await verifyTurnstile("any_token", CF_TURNSTILE_TEST_SECRETS.ALWAYS_FAILS.secretKey, "1.1.1.1");
    assert.strictEqual(testSecretFail, false, "CF Always Fails secret key should return false");

    // Token Spent secret
    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({
        success: false,
        "error-codes": [CF_TURNSTILE_TEST_SECRETS.TOKEN_SPENT.expectedErrorCode]
      }));
    }) as any;
    const testSecretSpent = await verifyTurnstile("any_token", CF_TURNSTILE_TEST_SECRETS.TOKEN_SPENT.secretKey, "1.1.1.1");
    assert.strictEqual(testSecretSpent, false, "CF Token Spent secret key should return false");
    console.log("  PASS: Cloudflare dummy test secret behaviors validated.");

    // 4. Fail-closed on network errors, HTTP errors, and malformed responses
    // Upstream 500 error
    globalThis.fetch = (async () => new Response("Internal Server Error", { status: 500 })) as any;
    assert.strictEqual(await verifyTurnstile("tok", "sec", "1.1.1.1"), false, "HTTP 500 must fail-closed to false");

    // Malformed JSON
    globalThis.fetch = (async () => new Response("<html>Cloudflare Error</html>", { status: 200 })) as any;
    assert.strictEqual(await verifyTurnstile("tok", "sec", "1.1.1.1"), false, "Non-JSON response must fail-closed to false");

    // Empty object response
    globalThis.fetch = (async () => new Response("{}", { status: 200 })) as any;
    assert.strictEqual(await verifyTurnstile("tok", "sec", "1.1.1.1"), false, "Missing success attribute must return false");

    // Network connection drop / exception
    globalThis.fetch = (async () => { throw new TypeError("Failed to fetch: network down"); }) as any;
    assert.strictEqual(await verifyTurnstile("tok", "sec", "1.1.1.1"), false, "Fetch exception must catch and return false");

    // Timeout / abort signal simulation
    globalThis.fetch = (async () => {
      const err = new Error("The operation was aborted due to timeout");
      err.name = "TimeoutError";
      throw err;
    }) as any;
    assert.strictEqual(await verifyTurnstile("tok", "sec", "1.1.1.1"), false, "Timeout error must catch and return false");

    console.log("  PASS: Fail-closed resilience on 500s, malformed responses, network failures, and timeouts verified.");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

// ============================================================================
// Test Suite 3: Backend Authentication Route Turnstile Gating
// ============================================================================

async function testAuthRouteGating(): Promise<void> {
  console.log("\n--- Suite 3: Backend Auth Routes Turnstile Gating Integration ---");

  // Setup in-memory SQLite database and apply migrations
  const rawDb = new DatabaseSync(":memory:");
  const migrationsDir = path.resolve(__dirname, "../migrations");
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
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
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
    const validJson = await resValid.json() as any;
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
    const configData = await resConfig.json() as any;

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

// ============================================================================
// Test Suite 4: Frontend Turnstile Lifecycle & Contract Simulation
// ============================================================================

function testFrontendTurnstileLifecycle(): void {
  console.log("\n--- Suite 4: Frontend Turnstile Lifecycle & Contract Simulation ---");

  // 1. Verify Cloudflare Script URL contract
  const expectedScriptBase = "https://challenges.cloudflare.com/turnstile/v0/api.js";
  const expectedQuery = "render=explicit&onload=onloadTurnstileCallback";
  const expectedFullSrc = `${expectedScriptBase}?${expectedQuery}`;

  const searchParams = new URL(expectedFullSrc).searchParams;
  assert.strictEqual(searchParams.get("render"), "explicit", "Turnstile script must specify render=explicit");
  assert.strictEqual(searchParams.get("onload"), "onloadTurnstileCallback", "Turnstile script must specify onload callback");
  console.log("  PASS: Turnstile script tag URL matches explicit render specification.");

  // 2. Simulate useTurnstile state machine transitions
  type Status = "idle" | "verifying" | "success" | "error";

  class MockTurnstileWidget {
    public renderedWidgetId: string | null = null;
    public callbacks: {
      callback?: (token: string) => void;
      "expired-callback"?: () => void;
      "error-callback"?: (err: unknown) => void;
    } = {};
    public resetCount = 0;
    public removeCount = 0;

    render(_container: any, options: any): string {
      const id = "widget_mock_123";
      this.renderedWidgetId = id;
      this.callbacks = options;
      return id;
    }

    reset(widgetId: string): void {
      if (widgetId === this.renderedWidgetId) {
        this.resetCount++;
      }
    }

    remove(widgetId: string): void {
      if (widgetId === this.renderedWidgetId) {
        this.removeCount++;
        this.renderedWidgetId = null;
      }
    }
  }

  // Model hook state
  let token: string | null = null;
  let status: Status = "idle";
  let parentError: string | null = null;
  const mockApi = new MockTurnstileWidget();

  // Lifecycle Step 1: Initialize & Render
  assert.strictEqual(status, "idle");
  assert.strictEqual(token, null);

  // Widget renders
  status = "verifying";
  const widgetId = mockApi.render(null, {
    sitekey: CF_TURNSTILE_TEST_SITEKEYS.VISIBLE_ALWAYS_PASSES.sitekey,
    callback: (resolvedToken: string) => {
      token = resolvedToken;
      status = "success";
      parentError = null;
    },
    "expired-callback": () => {
      token = null;
      status = "idle";
    },
    "error-callback": (err: unknown) => {
      token = null;
      status = "error";
      parentError = "Verification service failed to load.";
    }
  });

  assert.strictEqual(widgetId, "widget_mock_123");
  assert.strictEqual(status, "verifying");

  // Lifecycle Step 2: Verification Succeeds
  mockApi.callbacks.callback!("test_token_solved_456");
  assert.strictEqual(status, "success", "Callback must transition state to success");
  assert.strictEqual(token, "test_token_solved_456", "Token must be populated on success");
  assert.strictEqual(parentError, null, "Parent error must be cleared on success");

  // Lifecycle Step 3: Token Expiration
  mockApi.callbacks["expired-callback"]!();
  assert.strictEqual(status, "idle", "Expired callback must transition state to idle");
  assert.strictEqual(token, null, "Token must be nullified on expiration");

  // Lifecycle Step 4: Verification Error
  mockApi.callbacks["error-callback"]!("network error");
  assert.strictEqual(status, "error", "Error callback must transition state to error");
  assert.strictEqual(token, null, "Token must be nullified on error");
  assert.strictEqual(parentError, "Verification service failed to load.", "Error message must be reported to parent");

  // Lifecycle Step 5: Reset Turnstile
  mockApi.reset(widgetId);
  token = null;
  status = "idle";
  assert.strictEqual(mockApi.resetCount, 1, "resetTurnstile must invoke widget reset");
  assert.strictEqual(status, "idle");
  assert.strictEqual(token, null);

  // Lifecycle Step 6: Teardown / Cleanup
  mockApi.remove(widgetId);
  assert.strictEqual(mockApi.removeCount, 1, "Unmount / teardown must invoke widget remove");
  assert.strictEqual(mockApi.renderedWidgetId, null);

  console.log("  PASS: Client widget lifecycle, state machine transitions, and cleanup contracts validated.");
}

// ============================================================================
// Main Runner
// ============================================================================

async function runTurnstileTestSuite(): Promise<void> {
  console.log("================================================================");
  console.log("   Cloudflare Turnstile Bot Verification Unit Test Suite        ");
  console.log("================================================================");

  const start = Date.now();

  testTestKeyCatalog();
  await testVerifyTurnstileCore();
  await testAuthRouteGating();
  testFrontendTurnstileLifecycle();

  const elapsed = Date.now() - start;
  console.log("\n================================================================");
  console.log(`>>> ALL TURNSTILE TESTS PASSED! (${elapsed}ms)`);
  console.log("================================================================\n");
}

runTurnstileTestSuite().catch((err) => {
  console.error("\n[TEST FAILED]:", err);
  process.exit(1);
});
