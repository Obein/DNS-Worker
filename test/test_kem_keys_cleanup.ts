import assert from "node:assert";
import { KemKeyModel } from "../src/models/kemKey";
import { LogRetentionModel } from "../src/models/log/retention";

/**
 * Unit and integration tests for KemKeyModel orphan cleanup mechanism.
 *
 * Verifies:
 * 1. "Zero Dependents" Criterion: Keys with active referencing logs are NEVER deleted,
 *    regardless of how old they are (validating "而不是以时间为准则").
 * 2. Orphan Purging: Keys with ZERO referencing logs beyond the safety window ARE purged.
 * 3. Grace Window Protection: Newly minted keys within the safety window are protected
 *    even if no logs have landed yet, preventing race conditions with active isolate memory.
 * 4. Profile Scoping: Profile-specific orphan cleanup only purges keys of the specified profile.
 * 5. Global Retention Integration: cleanupGlobal triggers orphan cleanup alongside log purging.
 */
async function runTests(): Promise<void> {
  console.log(">>> [TEST] Running KEM Keys Orphan Cleanup Tests...\n");

  const nowSec = 1791300000; // Simulated reference timestamp
  const oneHour = 3600;

  // ── Test 1: Keys with dependents are NEVER deleted (Non-time-based retention) ──
  console.log("1. Testing dependency preservation (keys with logs are NEVER deleted)...");
  {
    const executedQueries: { query: string; params: any[] }[] = [];
    const mockDb: any = {
      prepare(query: string) {
        return {
          bind(...args: any[]) {
            executedQueries.push({ query, params: args });
            return {
              async run() {
                // Simulating 0 deletions because all keys have dependents in logs
                return { meta: { changes: 0 } };
              },
              async first() {
                return null;
              }
            };
          }
        };
      }
    };

    const kemModel = new KemKeyModel(mockDb);
    const deleted = await kemModel.cleanupOrphans(oneHour, 1000);

    assert.strictEqual(deleted, 0, "No keys should be deleted if they have dependent logs");
    assert(executedQueries.length > 0, "Cleanup query should have been prepared and executed");
    const cleanupQuery = executedQueries[0];
    assert(
      cleanupQuery.query.includes("NOT EXISTS"),
      "Query must check for non-existence of referencing logs (zero dependents)"
    );
    assert(
      cleanupQuery.query.includes("SELECT 1 FROM logs"),
      "Query must specifically check referencing rows in logs table"
    );
    console.log("  ✓ Passed: Keys with active logs are preserved regardless of expiration time.");
  }

  // ── Test 2: In-Memory / SQLite Mocked State Simulation ─────────────────────────
  console.log("\n2. Testing simulated database state with orphaned vs active keys...");
  {
    // Simulating database tables in memory:
    // kem_keys:
    // - key_1: created 24h ago, HAS 10 logs in logs table -> MUST BE PRESERVED
    // - key_2: created 5h ago, HAS 0 logs in logs table -> MUST BE DELETED (orphaned)
    // - key_3: created 10m ago (recent), HAS 0 logs -> MUST BE PRESERVED (protected by grace window)
    interface MockKemKey {
      id: string;
      profile_id: string;
      kem_ct: string;
      created_at: number;
      expires_at: number;
    }
    interface MockLog {
      id: number;
      kem_key_id: string | null;
    }

    const currentNowSec = Math.floor(Date.now() / 1000);
    let kemKeysTable: MockKemKey[] = [
      { id: "key_1", profile_id: "prof_a", kem_ct: "ct1", created_at: currentNowSec - 86400, expires_at: currentNowSec - 86400 + 3600 },
      { id: "key_2", profile_id: "prof_a", kem_ct: "ct2", created_at: currentNowSec - 18000, expires_at: currentNowSec - 18000 + 3600 },
      { id: "key_3", profile_id: "prof_b", kem_ct: "ct3", created_at: currentNowSec - 600, expires_at: currentNowSec - 600 + 3600 },
    ];

    const logsTable: MockLog[] = [
      { id: 101, kem_key_id: "key_1" },
      { id: 102, kem_key_id: "key_1" },
    ];

    const mockDb: any = {
      prepare(query: string) {
        return {
          bind(...args: any[]) {
            return {
              async run() {
                if (query.includes("DELETE FROM kem_keys")) {
                  const cutoff = args[0] as number;
                  const limit = (args[1] ?? 1000) as number;

                  // Find keys matching: created_at <= cutoff AND NOT EXISTS in logs
                  const toDelete = kemKeysTable.filter((k) => {
                    const isOlderThanCutoff = k.created_at <= cutoff;
                    const hasLogs = logsTable.some((l) => l.kem_key_id === k.id);
                    return isOlderThanCutoff && !hasLogs;
                  }).slice(0, limit);

                  const deleteIds = new Set(toDelete.map((k) => k.id));
                  kemKeysTable = kemKeysTable.filter((k) => !deleteIds.has(k.id));

                  return { meta: { changes: toDelete.length } };
                }
                return { meta: { changes: 0 } };
              }
            };
          }
        };
      }
    };

    // Run cleanup through KemKeyModel with safety window = 3600s
    const kemModel = new KemKeyModel(mockDb);
    const deletedCount = await kemModel.cleanupOrphans(oneHour, 1000);
    assert.strictEqual(deletedCount, 1, "Exactly 1 orphan key (key_2) should be deleted");

    const remainingIds = kemKeysTable.map((k) => k.id);
    assert(remainingIds.includes("key_1"), "key_1 must be preserved because logs depend on it");
    assert(!remainingIds.includes("key_2"), "key_2 must be deleted because it has zero dependents");
    assert(remainingIds.includes("key_3"), "key_3 must be preserved by the safety grace window");

    console.log("  ✓ Passed: key_1 (referenced) kept, key_2 (orphan) purged, key_3 (fresh) kept.");
  }

  // ── Test 3: Profile-scoped orphan cleanup ─────────────────────────────────────
  console.log("\n3. Testing profile-scoped orphan cleanup...");
  {
    const executedQueries: { query: string; params: any[] }[] = [];
    const mockDb: any = {
      prepare(query: string) {
        return {
          bind(...args: any[]) {
            executedQueries.push({ query, params: args });
            return {
              async run() {
                return { meta: { changes: 2 } };
              }
            };
          }
        };
      }
    };

    const kemModel = new KemKeyModel(mockDb);
    const deleted = await kemModel.cleanupProfileOrphans("prof_xyz", 3600);

    assert.strictEqual(deleted, 2, "Should report 2 deleted keys");
    assert(executedQueries.length === 1, "Should execute 1 statement");
    const q = executedQueries[0];
    assert(q.query.includes("profile_id = ?"), "Must bind profile_id");
    assert.strictEqual(q.params[0], "prof_xyz", "Must bind target profile ID");
    assert(q.query.includes("NOT EXISTS"), "Must check NOT EXISTS in logs");

    console.log("  ✓ Passed: Profile-specific orphan cleanup properly scoped.");
  }

  // ── Test 4: Integration with LogRetentionModel.cleanupGlobal ──────────────────
  console.log("\n4. Testing integration with LogRetentionModel.cleanupGlobal...");
  {
    const executedQueries: { query: string; params: any[] }[] = [];
    const mockDb: any = {
      prepare(query: string) {
        const createStmt = (boundArgs: any[] = []) => ({
          query,
          params: boundArgs,
          bind(...args: any[]) {
            executedQueries.push({ query, params: args });
            return createStmt(args);
          },
          async all() {
            executedQueries.push({ query, params: boundArgs });
            if (query.includes("FROM profiles")) {
              return { results: [{ id: "p1", settings: "{}" }] };
            }
            return { results: [] };
          },
          async first() {
            return null;
          },
          async run() {
            return { meta: { changes: 1 } };
          }
        });
        return createStmt();
      },
      async batch(stmts: any[]) {
        return [{ meta: { changes: 10 } }];
      }
    };

    const retentionModel = new LogRetentionModel(mockDb);
    await retentionModel.cleanupGlobal(30, 1000, 20000);

    // Verify both logs deletion and kem_keys orphan cleanup were executed
    const kemKeyCleanup = executedQueries.find((q) => q.query.includes("DELETE FROM kem_keys"));
    assert(kemKeyCleanup, "cleanupGlobal must execute orphan kem_keys cleanup");
    assert(kemKeyCleanup.query.includes("NOT EXISTS"), "kem_keys cleanup must use zero dependents check");

    console.log("  ✓ Passed: LogRetentionModel.cleanupGlobal successfully triggers orphan kem_keys cleanup.");
  }

  console.log("\n========================================================");
  console.log("   ALL KEM KEYS CLEANUP TESTS PASSED SUCCESSFULLY! (100%)");
  console.log("========================================================");
}

runTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
