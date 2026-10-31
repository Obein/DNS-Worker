/**
 * @file test_fail_open_turso.ts
 * @description Verifies that when Turso/D1 read operations are blocked
 * (e.g. "Operation was blocked: SQL read operations are forbidden"),
 * all DNS resolution paths seamlessly fail open to FAIL_OPEN_UPSTREAM
 * without throwing 500s or crashing.
 */

import assert from "node:assert";
import { SystemSettingsModel } from "../src/models/systemSettings";
import { ensureCloudflareIpRangesLoaded, isCloudflareIp } from "../src/utils/ech";
import { resolveProfileByKey, resolveDefaultProfile } from "../src/api/doh";
import { pipeline } from "../src/pipeline";
import { buildDNSQuery, parseDNSAnswer } from "../src/utils/dns";
import { Context, Env, ExecutionContext } from "../src/types";
import { DEFAULT_FAIL_OPEN_UPSTREAM } from "../src/constants/presets";

console.log(">>> [TEST] Running Turso Read-Blocked Fail-Open Fallback Tests...");

// 1. Create a simulated blocked Turso D1 database
const BLOCKED_ERROR_MSG = "[Turso D1] Query error: Operation was blocked: SQL read operations are forbidden (reads are blocked, do you need to upgrade your plan?)";

const mockBlockedDb: any = {
  prepare: (sql: string) => ({
    bind: (..._params: any[]) => ({
      first: async () => {
        throw new Error(`${BLOCKED_ERROR_MSG} SQL: ${sql}`);
      },
      all: async () => {
        throw new Error(`${BLOCKED_ERROR_MSG} SQL: ${sql}`);
      },
      run: async () => {
        throw new Error(`${BLOCKED_ERROR_MSG} SQL: ${sql}`);
      }
    }),
    first: async () => {
      throw new Error(`${BLOCKED_ERROR_MSG} SQL: ${sql}`);
    },
    all: async () => {
      throw new Error(`${BLOCKED_ERROR_MSG} SQL: ${sql}`);
    },
    run: async () => {
      throw new Error(`${BLOCKED_ERROR_MSG} SQL: ${sql}`);
    }
  }),
  batch: async () => {
    throw new Error(`${BLOCKED_ERROR_MSG} batch()`);
  }
};

const mockEnv = {
  DB: mockBlockedDb,
  FAIL_OPEN_UPSTREAM: "https://1.1.1.1/dns-query"
} as unknown as Env;

const mockCtx = {
  waitUntil: (p: Promise<any>) => { p.catch(() => {}); },
  passThroughOnException: () => {}
} as unknown as ExecutionContext;

async function runTests() {
  // Test 1: SystemSettingsModel.get under blocked reads
  const settingsModel = new SystemSettingsModel(mockBlockedDb);
  const siteKey = await settingsModel.get("turnstile_site_key");
  assert.strictEqual(siteKey, null, "get() must catch blocked read error and return null gracefully");
  console.log("  PASS: SystemSettingsModel.get gracefully returns null on blocked read");

  // Test 2: SystemSettingsModel.getAll under blocked reads
  const allSettings = await settingsModel.getAll();
  assert.ok(typeof allSettings === "object", "getAll() must return an object on blocked read");
  console.log("  PASS: SystemSettingsModel.getAll gracefully returns empty/cached object on blocked read");

  // Test 3: ensureCloudflareIpRangesLoaded under blocked reads
  await ensureCloudflareIpRangesLoaded(mockBlockedDb);
  // Verify that known Cloudflare IP is recognized via fallback preset
  const isCf = isCloudflareIp("104.16.1.1");
  assert.strictEqual(isCf, true, "104.16.1.1 must be recognized as Cloudflare IP via static preset fallback");
  console.log("  PASS: ensureCloudflareIpRangesLoaded fell back to preset Cloudflare CIDRs safely");

  // Test 4: resolveProfileByKey under blocked reads
  const fallbackProfile = await resolveProfileByKey("testkey123", mockEnv, mockCtx);
  assert.ok(fallbackProfile !== null, "resolveProfileByKey must provide emergency fallback profile");
  assert.strictEqual(fallbackProfile?.name, "Emergency Fallback");
  const parsedSettings = JSON.parse(fallbackProfile.settings);
  assert.strictEqual(parsedSettings.upstream[0], "https://1.1.1.1/dns-query", "Fallback profile must point to FAIL_OPEN_UPSTREAM");
  console.log("  PASS: resolveProfileByKey provides Emergency Fallback profile pointing to FAIL_OPEN_UPSTREAM");

  // Test 5: resolveDefaultProfile under blocked reads
  const defaultProfile = await resolveDefaultProfile(mockEnv, mockCtx);
  assert.ok(defaultProfile !== null, "resolveDefaultProfile must provide default fallback profile");
  const defaultSettings = JSON.parse(defaultProfile!.settings);
  assert.strictEqual(defaultSettings.upstream[0], "https://1.1.1.1/dns-query");
  console.log("  PASS: resolveDefaultProfile returns default profile pointing to FAIL_OPEN_UPSTREAM");

  // Test 6: Full pipeline resolution with blocked DB
  const rawQuery = buildDNSQuery("example.com", "A");
  const context: Context = {
    profileId: "testkey123",
    startTime: Date.now(),
    env: mockEnv,
    ctx: mockCtx
  };
  const request = new Request("https://dns.example.com/testkey123", {
    method: "POST",
    headers: { "Content-Type": "application/dns-message" },
    body: rawQuery
  });

  const result = await pipeline.process(
    request,
    { name: "example.com", type: "A", raw: rawQuery },
    context
  );

  assert.strictEqual(result.action, "PASS", "Pipeline must successfully resolve and PASS");
  assert.ok(result.answer.length > 0, "Pipeline must return valid DNS wire answer");
  const answers = parseDNSAnswer(result.answer);
  assert.ok(answers.length > 0, "Parsed DNS answers must not be empty");
  console.log(`  PASS: Full pipeline resolved example.com -> ${answers.map(a => a.data).join(", ")} via fail-open upstream`);

  console.log("\n======================================================");
  console.log("   ALL TURSO BLOCKED READ FAIL-OPEN TESTS PASSED!     ");
  console.log("======================================================");
}

runTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
