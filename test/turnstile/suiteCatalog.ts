/**
 * @file suiteCatalog.ts
 * @description Suite 1: Cloudflare Turnstile Official Test Key Catalog verification.
 */

import assert from "node:assert";
import { CF_TURNSTILE_TEST_SITEKEYS, CF_TURNSTILE_TEST_SECRETS } from "./fixtures";

/**
 * Validates the 5 official sitekeys and 3 official secrets specifications.
 */
export function runCatalogSuite(): void {
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
