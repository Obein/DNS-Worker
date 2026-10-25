/**
 * @file fixtures.ts
 * @description Cloudflare Turnstile official testing keys, specification matrices, and mock cache.
 */

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

/**
 * Mock Cache for rate limiting and Cloudflare Caches API simulation.
 */
export class MockCache {
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
