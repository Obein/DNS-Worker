/// <reference types="node" />
import assert from "node:assert";
import { rebuildProfileBloom } from "../src/utils/sync/orchestrator";
import { BloomFilter } from "../src/utils/bloom";
import type { Env } from "../src/types";

async function runTests() {
  console.log(">>> [TEST] Running rebuildProfileBloom Unit Tests...\n");

  // Mock database stores
  let profileStore: any = {
    id: "prof_1",
    list_updated_at: 1000 // Prior timestamp
  };

  const listStore = [
    { id: 1, profile_id: "prof_1", url: "https://example.com/list1.txt", enabled: 1 },
    { id: 2, profile_id: "prof_1", url: "https://example.com/list2.txt", enabled: 1 }
  ];

  // Create two separate bloom filters matching testEnv parameters
  const bloom1 = BloomFilter.create(10000, 0.001);
  bloom1.add("malware1.com");
  const bloom2 = BloomFilter.create(10000, 0.001);
  bloom2.add("malware2.com");

  const listBloomStore = new Map<number, ArrayBuffer>([
    [1, bloom1.toUint8Array().buffer as ArrayBuffer],
    [2, bloom2.toUint8Array().buffer as ArrayBuffer]
  ]);

  let profileBloomStore: ArrayBuffer | null = null;

  // Mock DB
  const mockDb: any = {
    prepare(sql: string) {
      return {
        bind(...args: any[]) {
          return {
            async first() {
              if (sql.includes("FROM profiles WHERE id = ?")) {
                return profileStore.id === args[0] ? profileStore : null;
              }
              return null;
            },
            async all() {
              if (sql.includes("FROM lists WHERE profile_id = ?")) {
                return { results: listStore.filter(l => l.profile_id === args[0]) };
              }
              if (sql.includes("FROM list_blooms WHERE list_id = ?")) {
                const buf = listBloomStore.get(args[0]);
                return { results: buf ? [{ bloom_filter_chunk: buf }] : [] };
              }
              return { results: [] };
            },
            async run() {
              if (sql.includes("UPDATE profiles SET list_updated_at = ? WHERE id = ?")) {
                profileStore.list_updated_at = args[0];
                return { success: true };
              }
              if (sql.includes("INSERT INTO profile_blooms")) {
                profileBloomStore = args[2];
                return { success: true };
              }
              if (sql.includes("DELETE FROM profile_blooms WHERE profile_id = ?")) {
                profileBloomStore = null;
                return { success: true };
              }
              return { success: true };
            }
          };
        }
      };
    },
    async batch(statements: any[]) {
      for (const stmt of statements) {
        await stmt.run();
      }
      return statements.map(() => ({ success: true }));
    }
  };

  const testEnv: Env = {
    DB: mockDb,
    ASSETS: {},
    MAX_SYNC_DOMAINS: 10000,
    BLOOM_FALSE_POSITIVE_RATE: 0.001
  };

  const mockCtx: any = {
    waitUntil(p: Promise<any>) {
      // simulate execution context
      p.catch(() => {});
    }
  };

  // Test 1: Rebuild with 2 active lists
  console.log("1. Testing rebuildProfileBloom with 2 lists...");
  await rebuildProfileBloom("prof_1", testEnv, mockCtx);

  assert(profileBloomStore !== null, "Profile bloom should have been created");
  const mergedBloom = BloomFilter.fromUint8Array(new Uint8Array(profileBloomStore!));
  assert.strictEqual(mergedBloom.test("malware1.com"), true, "Should contain domain from list 1");
  assert.strictEqual(mergedBloom.test("malware2.com"), true, "Should contain domain from list 2");
  assert.strictEqual(mergedBloom.test("safe.com"), false, "Should not contain unlisted domain");
  assert.strictEqual(profileStore.list_updated_at, 1000, "priorListUpdatedAt should be preserved");

  // Test 2: Simulate list 1 deleted -> rebuild with only list 2 remaining
  console.log("2. Testing rebuildProfileBloom after deleting list 1...");
  listStore.shift(); // remove list 1
  listBloomStore.delete(1);

  await rebuildProfileBloom("prof_1", testEnv, mockCtx);

  assert(profileBloomStore !== null, "Profile bloom should have been updated");
  const updatedBloom = BloomFilter.fromUint8Array(new Uint8Array(profileBloomStore!));
  assert.strictEqual(updatedBloom.test("malware1.com"), false, "Should NO LONGER contain domain from deleted list 1");
  assert.strictEqual(updatedBloom.test("malware2.com"), true, "Should still contain domain from list 2");
  assert.strictEqual(profileStore.list_updated_at, 1000, "priorListUpdatedAt should still be preserved");

  // Test 3: Simulate list 2 deleted -> rebuild with 0 lists remaining
  console.log("3. Testing rebuildProfileBloom after deleting all lists...");
  listStore.shift(); // remove list 2
  listBloomStore.delete(2);

  await rebuildProfileBloom("prof_1", testEnv, mockCtx);
  assert.strictEqual(profileBloomStore, null, "Profile bloom should be cleared when 0 lists remain");
  assert.strictEqual(profileStore.list_updated_at, 1000, "priorListUpdatedAt should still be preserved");

  console.log("\n>>> [TEST] All rebuildProfileBloom tests passed successfully!");
}

runTests().catch((e) => {
  console.error("Test failed:", e);
  process.exit(1);
});
