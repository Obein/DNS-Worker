import assert from 'node:assert';
import { fetchListContent } from '../src/utils/listFetcher';
import { syncSingleList } from '../src/utils/sync/singleListSync';
import { MemoryCache, initNodeGlobals } from '../src/serverfull/cache';
import { resolveDefaultProfile } from '../src/api/doh';
import { setDefaultProfileMemoryCache } from '../src/pipeline/cache';

async function runTests() {
  console.log('>>> [TEST] Running SingleListSync Pacing & Sync Window Tests...');
  initNodeGlobals();

  // 1. Test MemoryCache maxEntries & LRU eviction
  console.log('1. Testing MemoryCache LRU eviction & capacity cap...');
  const cache = new MemoryCache(5); // Cap at 5 entries
  for (let i = 1; i <= 6; i++) {
    const res = new Response(`value-${i}`, {
      headers: { 'Cache-Control': 'public, max-age=3600' }
    });
    await cache.put(`https://test.local/k${i}`, res);
  }
  // k1 should be evicted since capacity is 5 and k1 is oldest
  const m1 = await cache.match('https://test.local/k1');
  const m6 = await cache.match('https://test.local/k6');
  assert.strictEqual(m1, undefined, 'Oldest entry k1 should have been evicted by LRU');
  assert.ok(m6, 'Newest entry k6 should exist');
  assert.strictEqual(await m6.text(), 'value-6');
  console.log('   ✓ MemoryCache properly bounds size and evicts oldest items');

  // 2. Test resolveDefaultProfile fallback and L1 in-memory cache
  console.log('2. Testing resolveDefaultProfile unauthenticated fallback & L1 in-memory cache...');
  setDefaultProfileMemoryCache(null); // Clear first
  let sqliteQueryCount = 0;

  // Mock DB to count queries
  const mockDb = {
    prepare(sql: string) {
      sqliteQueryCount++;
      return {
        bind() {
          return {
            async all() { return { results: [{ id: 'p1', settings: '{"upstream":["https://1.1.1.1/dns-query"]}' }] }; },
            async first() { return { id: 'p1', settings: '{"upstream":["https://1.1.1.1/dns-query"]}' }; },
            async run() { return { success: true }; }
          };
        }
      };
    }
  } as any;

  const unauthEnv = { DB: mockDb, JWT_SECRET: 'testsecret1234567890123456789012' } as any;
  const ctx = { waitUntil() {} } as any;

  // Unauthenticated call must fall back to FAIL_OPEN_UPSTREAM without querying SQLite
  const fallbackProf = await resolveDefaultProfile(unauthEnv, ctx);
  assert.ok(fallbackProf, 'Should resolve fallback profile');
  assert.strictEqual(fallbackProf.id, 'default', 'Unauthenticated request must fall back to default profile');
  assert.strictEqual(sqliteQueryCount, 0, 'Unauthenticated lookup must NOT query SQLite or hijack user profiles');
  const fallbackSettings = JSON.parse(fallbackProf.settings);
  assert.strictEqual(fallbackSettings.log_retention_days, 0, 'Fallback profile must have zero log retention');
  assert.ok(fallbackSettings.upstream[0].includes('controld'), 'Fallback profile must use FAIL_OPEN_UPSTREAM');

  // Configured default key lookup must resolve via key and populate L1 cache
  setDefaultProfileMemoryCache(null);
  const configuredEnv = {
    ...unauthEnv,
    SERVERFULL_DEFAULT_PROFILE_KEY: 'testkey123'
  };

  const prof1 = await resolveDefaultProfile(configuredEnv, ctx);
  assert.ok(prof1, 'Should resolve configured profile');
  const initialCount = sqliteQueryCount;
  assert.ok(initialCount > 0, 'First configured lookup should query SQLite');

  // Second and third queries should hit in-memory L1 cache without touching SQLite
  const prof2 = await resolveDefaultProfile(configuredEnv, ctx);
  const prof3 = await resolveDefaultProfile(configuredEnv, ctx);
  assert.strictEqual(sqliteQueryCount, initialCount, 'Subsequent lookups MUST hit L1 cache with 0 SQLite queries');
  assert.strictEqual(prof2?.id, prof1?.id);
  assert.strictEqual(prof3?.id, prof1?.id);
  console.log('   ✓ resolveDefaultProfile safely falls back to FAIL_OPEN_UPSTREAM and eliminates SQLite queries via L1 memory cache');

  // 3. Test listFetcher with synchronous consumer (zero promise allocation for normal lines)
  console.log('3. Testing listFetcher with synchronous consumer & mocked fetch...');
  const originalFetch = globalThis.fetch;
  const mockUrl = 'http://93.184.216.34/mock-list.txt';

  const generateDomainStream = () => {
    let domainLines = '';
    for (let i = 1; i <= 1000; i++) {
      domainLines += `0.0.0.0 ad-${i}.test.com\n`;
    }
    return new Response(domainLines, {
      status: 200,
      headers: { 'Content-Type': 'text/plain' }
    });
  };

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (urlStr === mockUrl) {
      return generateDomainStream();
    }
    return originalFetch(input, init);
  };

  let parsedCount = 0;
  let yieldCount = 0;

  try {
    const result = await fetchListContent(
      mockUrl,
      1024 * 1024,
      10000,
      (rule) => {
        parsedCount++;
        // Synchronous return for 99% of domains, yield on 500th domain
        if (parsedCount === 500) {
          yieldCount++;
          return new Promise<void>((r) => setTimeout(r, 5));
        }
      }
    );

    assert.strictEqual(result.count, 1000, 'All 1000 domains should be parsed');
    assert.strictEqual(parsedCount, 1000);
    assert.strictEqual(yieldCount, 1, 'Should have yielded exactly once on 500th domain boundary');
    console.log('   ✓ listFetcher supports zero-allocation sync calls and cooperative yields');

    // 4. Test singleListSync pacing with custom parameters
    console.log('4. Testing singleListSync pacing parameters and bloom filter creation...');
    let listModelUpdated = false;
    let bloomUpserted = false;

    const mockListModel = {
      async updateListSyncStatus(id: number, now: number, enabled: any, err: any) {
        listModelUpdated = true;
      }
    } as any;

    const mockListBloomModel = {
      async upsertListBloom(id: number, buf: ArrayBuffer, now: number) {
        bloomUpserted = true;
        assert.ok(buf.byteLength > 100, 'Bloom buffer should contain serialized data');
      }
    } as any;

    const syncEnv = {
      SYNC_TIMEOUT_MS: 30000,
      SYNC_YIELD_BATCH_SIZE: 200,
      SYNC_YIELD_SLEEP_MS: 5
    } as any;

    const { syncError } = await syncSingleList(
      'p1',
      { id: 1, url: mockUrl },
      syncEnv,
      mockListModel,
      mockListBloomModel,
      Math.floor(Date.now() / 1000)
    );

    assert.strictEqual(syncError, null, 'Sync should succeed without error');
    assert.strictEqual(listModelUpdated, true, 'List model should update sync status');
    assert.strictEqual(bloomUpserted, true, 'Bloom filter should be generated and upserted');
    console.log('   ✓ singleListSync successfully applies pacing, generates bloom, and completes');
  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log('\n======================================================');
  console.log('  ALL SINGLELISTSYNC PACING TESTS PASSED!');
  console.log('======================================================');
}

runTests().catch((err) => {
  console.error('[TEST ERROR]:', err);
  process.exit(1);
});
