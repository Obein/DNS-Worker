/**
 * @file test_turnstile.ts
 * @description Comprehensive test runner for Cloudflare Turnstile bot verification.
 * Decomposed into specialized SRP test suites under `./turnstile/`.
 */

import { runCatalogSuite } from "./turnstile/suiteCatalog";
import { runCoreSuite } from "./turnstile/suiteCore";
import { runBackendSuite } from "./turnstile/suiteBackend";
import { runFrontendSuite } from "./turnstile/suiteFrontend";

export * from "./turnstile/fixtures";
export { runCatalogSuite } from "./turnstile/suiteCatalog";
export { runCoreSuite } from "./turnstile/suiteCore";
export { runBackendSuite } from "./turnstile/suiteBackend";
export { runFrontendSuite } from "./turnstile/suiteFrontend";

/**
 * Main Turnstile test suite coordinator.
 */
async function runTurnstileTestSuite(): Promise<void> {
  console.log("================================================================");
  console.log("   Cloudflare Turnstile Bot Verification Unit Test Suite        ");
  console.log("================================================================");

  const start = Date.now();

  runCatalogSuite();
  await runCoreSuite();
  await runBackendSuite();
  runFrontendSuite();

  const elapsed = Date.now() - start;
  console.log("\n================================================================");
  console.log(`>>> ALL TURNSTILE TESTS PASSED! (${elapsed}ms)`);
  console.log("================================================================\n");
}

runTurnstileTestSuite().catch((err: unknown) => {
  console.error("\n[TEST FAILED]:", err);
  process.exit(1);
});
