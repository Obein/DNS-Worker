/// <reference types="node" />
import assert from "node:assert";
import { cacheUtils } from "../src/utils/cache";
import { pipelineCache } from "../src/pipeline/cache";
import type { Env } from "../src/types";

// Mock Cache API
class MockCache {
  public store = new Map<string, Response>();
  public deleted: string[] = [];

  async put(url: string, response: Response): Promise<void> {
    this.store.set(url, response);
  }

  async match(url: string): Promise<Response | undefined> {
    const res = this.store.get(url);
    return res ? res.clone() : undefined;
  }

  async delete(url: string): Promise<boolean> {
    this.deleted.push(url);
    return this.store.delete(url);
  }
}

async function runTests() {
  console.log(">>> [TEST] Running Global Cache API Purge & Cache-Tag Tests...\n");

  // 1. Test cacheUtils.set with and without Cache-Tag
  console.log("1. Testing cacheUtils.set with and without Cache-Tag...");
  const mockCache = new MockCache();

  // 1.1 Without tags
  await cacheUtils.set(mockCache as any, "test_no_tags", { foo: "bar" }, 3600);
  const resNoTags = mockCache.store.get(cacheUtils.generateCacheUrl("test_no_tags"));
  assert(resNoTags, "Cache entry should exist");
  assert.strictEqual(resNoTags.headers.get("Cache-Control"), "public, max-age=3600");
  assert.strictEqual(resNoTags.headers.get("Cache-Tag"), null, "Cache-Tag should not be set when tags array is empty");

  // 1.2 With tags
  await cacheUtils.set(mockCache as any, "test_with_tags", { foo: "bar" }, 7200, ["tag1", "profile-p1"]);
  const resWithTags = mockCache.store.get(cacheUtils.generateCacheUrl("test_with_tags"));
  assert(resWithTags, "Cache entry should exist");
  assert.strictEqual(resWithTags.headers.get("Cache-Control"), "public, max-age=7200");
  assert.strictEqual(resWithTags.headers.get("Cache-Tag"), "tag1,profile-p1", "Cache-Tag header should be joined by comma");

  // 2. Setup mock global caches and fetch
  const originalCaches = (globalThis as any).caches;
  const originalFetch = globalThis.fetch;

  const defaultMockCache = new MockCache();
  (globalThis as any).caches = { default: defaultMockCache };

  const purgeCalls: { url: string; method?: string; headers?: Record<string, string>; body?: any }[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const urlStr = typeof input === "string" ? input : input.toString();
    const headersObj: Record<string, string> = {};
    if (init?.headers) {
      if (init.headers instanceof Headers) {
        init.headers.forEach((v, k) => { headersObj[k] = v; });
      } else if (Array.isArray(init.headers)) {
        for (const [k, v] of init.headers) { headersObj[k] = v; }
      } else {
        Object.assign(headersObj, init.headers);
      }
    }
    purgeCalls.push({
      url: urlStr,
      method: init?.method,
      headers: headersObj,
      body: init?.body ? JSON.parse(init.body as string) : undefined
    });
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  }) as any;

  try {
    const profileId = "prof_test_123";
    const testEnv: Env = {
      DB: {} as any,
      ASSETS: {},
      CF_ZONE_ID: "zone_abc_123",
      CF_PURGE_TOKEN: "token_secret_456"
    };

    // 2.1 Test pipelineCache.clear with no env (local clear only)
    console.log("2. Testing pipelineCache.clear without env (backward compatibility)...");
    purgeCalls.length = 0;
    defaultMockCache.deleted.length = 0;
    await pipelineCache.clear(profileId);
    assert.strictEqual(purgeCalls.length, 0, "No global purge fetch should be made when env is omitted");
    assert(defaultMockCache.deleted.some(u => u.includes(profileId)), "Local cache should be deleted");

    // 2.2 Test pipelineCache.clear with env and clearBloom = true
    console.log("3. Testing pipelineCache.clear(profileId, true, env)...");
    purgeCalls.length = 0;
    await pipelineCache.clear(profileId, true, testEnv);
    assert.strictEqual(purgeCalls.length, 1, "One purge request should be made");
    assert.strictEqual(purgeCalls[0].url, "https://api.cloudflare.com/client/v4/zones/zone_abc_123/purge_cache");
    assert.strictEqual(purgeCalls[0].method, "POST");
    assert.strictEqual(purgeCalls[0].headers?.["Authorization"], "Bearer token_secret_456");
    assert.deepStrictEqual(purgeCalls[0].body, {
      tags: [`profile-${profileId}`, `bloom-${profileId}`]
    });

    // 2.3 Test pipelineCache.clear with env and clearBloom = false
    console.log("4. Testing pipelineCache.clear(profileId, false, env)...");
    purgeCalls.length = 0;
    await pipelineCache.clear(profileId, false, testEnv);
    assert.strictEqual(purgeCalls.length, 1, "One purge request should be made");
    assert.deepStrictEqual(purgeCalls[0].body, {
      tags: [`profile-${profileId}`]
    });

    // 2.4 Test overloaded signature pipelineCache.clear(profileId, env)
    console.log("5. Testing overloaded signature pipelineCache.clear(profileId, env)...");
    purgeCalls.length = 0;
    await pipelineCache.clear(profileId, testEnv);
    assert.strictEqual(purgeCalls.length, 1, "One purge request should be made");
    assert.deepStrictEqual(purgeCalls[0].body, {
      tags: [`profile-${profileId}`, `bloom-${profileId}`]
    });

    // 2.5 Test overloaded signature pipelineCache.clear(profileId, env, false)
    console.log("6. Testing overloaded signature pipelineCache.clear(profileId, env, false)...");
    purgeCalls.length = 0;
    await pipelineCache.clear(profileId, testEnv, false);
    assert.strictEqual(purgeCalls.length, 1, "One purge request should be made");
    assert.deepStrictEqual(purgeCalls[0].body, {
      tags: [`profile-${profileId}`]
    });

    // 2.6 Test missing CF_ZONE_ID or CF_PURGE_TOKEN
    console.log("7. Testing env with missing CF_ZONE_ID or CF_PURGE_TOKEN...");
    purgeCalls.length = 0;
    await pipelineCache.clear(profileId, true, { ...testEnv, CF_PURGE_TOKEN: undefined });
    assert.strictEqual(purgeCalls.length, 0, "Should skip global purge when CF_PURGE_TOKEN is missing");

    await pipelineCache.clear(profileId, true, { ...testEnv, CF_ZONE_ID: undefined });
    assert.strictEqual(purgeCalls.length, 0, "Should skip global purge when CF_ZONE_ID is missing");

    // 2.7 Test network error resilience
    console.log("8. Testing resilience against Cloudflare API failure...");
    globalThis.fetch = (async () => {
      throw new Error("Simulated Cloudflare API network timeout");
    }) as any;
    // Should not throw
    await pipelineCache.clear(profileId, true, testEnv);
    console.log("  Handled API network error gracefully without throwing.");

  } finally {
    (globalThis as any).caches = originalCaches;
    globalThis.fetch = originalFetch;
  }

  console.log("\n>>> [TEST] All Global Cache API Purge tests passed successfully!");
}

runTests().catch((e) => {
  console.error("Test failed:", e);
  process.exit(1);
});
