/// <reference types="node" />
import assert from "node:assert";
import { pipelineCache, PROFILE_CACHE_KEY_PREFIX } from "../src/pipeline/cache";
import { pipelineConfig } from "../src/pipeline/config";
import { fetchListContent } from "../src/utils/listFetcher";
import { syncSingleList } from "../src/utils/sync/singleListSync";
import { cacheUtils } from "../src/utils/cache";
import { BloomFilter } from "../src/utils/bloom";
import type { Context, Env } from "../src/types";

// Mock Cache API
class MockCache {
  public store = new Map<string, Response>();
  public deleted: string[] = [];

  async put(url: string, response: Response): Promise<void> {
    this.store.set(url, response.clone());
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

async function runIssueVerificationTests() {
  console.log(">>> [TEST] Running Issue Reproduction & Fix Verification Tests...\n");

  const originalCaches = (globalThis as any).caches;
  const originalFetch = globalThis.fetch;
  const mockCache = new MockCache();
  (globalThis as any).caches = { default: mockCache };

  try {
    // =========================================================================
    // 1. Verify fetchListContent truncation and MAX_LIST_BYTES behavior
    // =========================================================================
    console.log("1. Testing fetchListContent truncation detection...");
    
    // Create a mock list stream with 100 domains (~2.5 KB)
    const domainLines: string[] = [];
    for (let i = 0; i < 100; i++) {
      domainLines.push(`||domain${i}.test^`);
    }
    const samplePayload = domainLines.join("\n");
    const samplePayloadBytes = new TextEncoder().encode(samplePayload);

    const mockListUrl = "http://93.184.216.34/mock-list.txt";
    globalThis.fetch = (async (url: string | URL | Request) => {
      return new Response(samplePayloadBytes, {
        status: 200,
        headers: { "Content-Type": "text/plain" }
      });
    }) as any;

    // Test 1.1: Content smaller than maxBytes -> not truncated
    const resNormal = await fetchListContent(mockListUrl, 10000, 5000, () => {});
    assert.strictEqual(resNormal.count, 100);
    assert.strictEqual(resNormal.error, null);
    assert.strictEqual(resNormal.truncated, false, "Should not be truncated when size is within limit");
    console.log("   ✓ Non-truncated list parsed completely with truncated=false.");

    // Test 1.2: Content larger than maxBytes (e.g. limit to 500 bytes) -> truncated=true
    let parsedCountTruncated = 0;
    const resTruncated = await fetchListContent(mockListUrl, 500, 5000, () => {
      parsedCountTruncated++;
    });
    assert.strictEqual(resTruncated.truncated, true, "Should be flagged as truncated");
    assert.ok(resTruncated.count < 100, "Truncated count should be less than total 100");
    assert.strictEqual(resTruncated.count, parsedCountTruncated);
    assert.strictEqual(resTruncated.error, null);
    console.log(`   ✓ Truncation detected properly (parsed ${resTruncated.count}/100 rules with truncated=true).`);

    // Test 1.3: Verify syncSingleList sets syncError warning on truncation
    console.log("2. Testing syncSingleList warning on truncation...");
    let savedSyncStatus: any = null;
    const mockListModel: any = {
      updateListSyncStatus: async (id: number, now: number | null, enabled?: number | null, syncError?: string | null) => {
        savedSyncStatus = { id, now, enabled: enabled ?? null, syncError: syncError ?? null };
        return true;
      }
    };
    const mockListBloomModel: any = {
      upsertListBloom: async () => true
    };
    const mockEnv: Env = {
      MAX_LIST_BYTES: 500, // force truncation
      DB: {
        prepare: () => ({
          bind: () => ({
            run: async () => ({ success: true })
          })
        })
      } as any,
      ASSETS: {}
    };

    const syncWarning = await syncSingleList("prof_trunc_test", { id: 42, url: mockListUrl }, mockEnv, mockListModel, mockListBloomModel, Math.floor(Date.now() / 1000));
    assert.ok(syncWarning !== null, "syncError should not be null on truncation");
    assert.ok(syncWarning?.includes("truncated"), "syncError should mention truncation");
    assert.strictEqual(savedSyncStatus?.syncError, syncWarning, "sync_error should be saved in database");
    console.log("   ✓ syncSingleList safely recorded truncation warning without silent pass.");

    // =========================================================================
    // 2. Verify L2 Cache consistency and Bloom rehydration
    // =========================================================================
    console.log("3. Testing L2 Cache versioning & Bloom Filter loading...");

    const profileId = "prof_cache_sync_test";
    const profileCacheKey = `${PROFILE_CACHE_KEY_PREFIX}:${profileId}`;
    const bloomUrl = cacheUtils.generateCacheUrl(`bloom-bin:${profileId}`);

    // Create a real small Bloom filter
    const bloom = BloomFilter.create(1000, 0.001);
    bloom.add("blocked-test.com");
    bloom.add("||blocked-test.com");
    const bloomBuffer = bloom.toUint8Array().buffer;

    let d1BloomReadCount = 0;
    const mockD1: any = {
      prepare: (sql: string) => ({
        bind: (...args: any[]) => ({
          first: async () => {
            if (sql.includes("FROM profiles WHERE id =")) {
              return { id: profileId, settings: JSON.stringify({ upstream: ["1.1.1.1"] }), list_updated_at: 100 };
            }
            if (sql.includes("FROM rules WHERE profile_id =")) {
              return null;
            }
            if (sql.includes("FROM profile_adguard_rules WHERE profile_id =")) {
              return null;
            }
            return null;
          },
          all: async () => {
            if (sql.includes("FROM profile_blooms WHERE profile_id =")) {
              d1BloomReadCount++;
              return { results: [{ bloom_filter_chunk: bloomBuffer }] };
            }
            return { results: [] };
          },
          raw: async () => []
        })
      })
    };

    const dummyCtx: any = {
      waitUntil: (p: Promise<any>) => p
    };

    const context: Context = {
      profileId,
      env: { DB: mockD1, ASSETS: {} },
      ctx: dummyCtx,
      startTime: Date.now()
    };

    // Step A: Load config from D1 (simulating first query after blocklist added)
    console.log("   - Performing first pipelineConfig.load (D1 load)...");
    const loaded1 = await pipelineConfig.load(context, () => {});
    assert.ok(loaded1?.bloom, "Bloom filter should be loaded on initial D1 fetch");
    assert.strictEqual(loaded1?.bloom?.test("blocked-test.com"), true);
    assert.strictEqual(d1BloomReadCount, 1);

    // Verify L2 cache has profile_v8 and bloom-bin
    const cachedProfileInL2 = mockCache.store.get(cacheUtils.generateCacheUrl(profileCacheKey));
    assert.ok(cachedProfileInL2, "Profile config should be stored under PROFILE_CACHE_KEY_PREFIX in L2 cache");
    const cachedBloomInL2 = mockCache.store.get(bloomUrl);
    assert.ok(cachedBloomInL2, "Bloom binary should be stored under bloom-bin in L2 cache");
    console.log("   ✓ L2 cache successfully stored profile_v8 and bloom-bin binary.");

    // Step B: Simulate clearing pipelineCache (e.g. on sync or rules change)
    console.log("   - Calling pipelineCache.clear(profileId)...");
    mockCache.deleted.length = 0;
    await pipelineCache.clear(profileId, true, context.env);

    // Verify that current version key was deleted from L2
    assert(mockCache.deleted.includes(cacheUtils.generateCacheUrl(profileCacheKey)), "profile_v8 cache key must be deleted by clear()");
    assert(mockCache.deleted.includes(bloomUrl), "bloom-bin cache key must be deleted by clear()");
    console.log("   ✓ pipelineCache.clear successfully invalidated profile_v8 and bloom-bin.");

    // Step C: Verify fallback rehydration if L2 contains config with hasBloom=true but bloom-bin is missing
    console.log("   - Testing L2 fallback rehydration when Bloom binary was evicted...");
    // Put profile config back in L2 with hasBloom: true, but leave bloom-bin empty
    await cacheUtils.set(mockCache as any, profileCacheKey, {
      settings: { upstream: ["1.1.1.1"] },
      rules: [],
      hasBloom: true
    }, 86400);
    mockCache.store.delete(bloomUrl); // simulate bloom eviction

    d1BloomReadCount = 0;
    const loadedFallback = await pipelineConfig.load(context, () => {});
    assert.ok(loadedFallback?.bloom, "Bloom filter should be restored via D1 fallback when L2 has hasBloom=true");
    assert.strictEqual(loadedFallback?.bloom?.test("blocked-test.com"), true);
    assert.strictEqual(d1BloomReadCount, 1, "D1 Bloom should have been queried exactly once as fallback");
    console.log("   ✓ Fallback gracefully rehydrated Bloom filter from D1 and repopulated L2.");

  } finally {
    (globalThis as any).caches = originalCaches;
    globalThis.fetch = originalFetch;
  }

  console.log("\n======================================================");
  console.log("   ALL ISSUE VERIFICATION & RECOVERY TESTS PASSED!    ");
  console.log("======================================================");
}

runIssueVerificationTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
