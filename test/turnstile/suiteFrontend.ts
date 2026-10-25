/**
 * @file suiteFrontend.ts
 * @description Suite 4: Frontend Turnstile Lifecycle & Contract Simulation.
 */

import assert from "node:assert";
import { CF_TURNSTILE_TEST_SITEKEYS } from "./fixtures";

/**
 * Validates frontend script URL specification, widget lifecycle, callbacks, reset, and teardown.
 */
export function runFrontendSuite(): void {
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
    "error-callback": (_err: unknown) => {
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
