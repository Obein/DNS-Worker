/**
 * @file suiteCore.ts
 * @description Suite 2: verifyTurnstile Core Function Unit Tests.
 */

import assert from "node:assert";
import { verifyTurnstile } from "../../src/api/auth/utils";
import { CF_TURNSTILE_TEST_SECRETS } from "./fixtures";

/**
 * Validates input boundary guards, wire HTTP contract, mock secrets, and fail-closed behavior.
 */
export async function runCoreSuite(): Promise<void> {
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
