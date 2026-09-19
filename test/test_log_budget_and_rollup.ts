/// <reference types="node" />
import assert from "node:assert";
import { LogRetentionModel } from "../src/models/log/retention";
import { LogAggregationModel } from "../src/models/log/aggregation";
import { LogCoreModel } from "../src/models/log/core";

async function runTests() {
  console.log(">>> [TEST] Running Log Deletion Budget & Domain Rollup Filter Tests...\n");

  // 1. Test LogRetentionModel.cleanupGlobal batchLimit distribution
  console.log("1. Testing LogRetentionModel.cleanupGlobal batchLimit distribution...");
  {
    const executedQueries: { query: string; params: any[] }[] = [];

    const mockDb: any = {
      prepare(query: string) {
        const createObj = (boundArgs: any[] = []) => ({
          query,
          params: boundArgs,
          bind(...args: any[]) {
            return createObj(args);
          },
          async all() {
            if (query.includes("SELECT id, settings FROM profiles")) {
              return {
                results: [
                  { id: "p1", settings: JSON.stringify({ log_retention_days: 7 }) },
                  { id: "p2", settings: JSON.stringify({ log_retention_days: 7 }) },
                  { id: "p3", settings: JSON.stringify({ log_retention_days: 7 }) }
                ]
              };
            }
            return { results: [] };
          },
          async first() {
            return null;
          },
          async run() {
            return { success: true };
          }
        });
        return createObj();
      },
      async batch(statements: any[]) {
        for (const s of statements) {
          executedQueries.push({ query: s.query, params: s.params });
        }
        return [];
      }
    };

    const retentionModel = new LogRetentionModel(mockDb);

    // Run cleanupGlobal with batchLimit = 900 across 3 profiles
    // Expected perProfileLimit = Math.floor(900 / 3) = 300
    await retentionModel.cleanupGlobal(30, 900);

    const deleteStatements = executedQueries.filter(q => q.query.includes("DELETE FROM logs WHERE (profile_id, timestamp, id) IN"));
    assert.strictEqual(deleteStatements.length, 3, "Should generate delete statement for each profile");

    for (const stmt of deleteStatements) {
      assert(stmt.query.includes("LIMIT ?"), "Delete statement must bind LIMIT parameter");
      const limitParam = stmt.params[2];
      assert.strictEqual(limitParam, 300, "perProfileLimit should be 300 (900 / 3)");
    }

    console.log("  Passed: batchLimit 900 correctly distributed to 300 per profile.");
  }

  // 2. Test LogAggregationModel.aggregateHourlyRollups with minDomainCount
  console.log("\n2. Testing LogAggregationModel.aggregateHourlyRollups with minDomainCount...");
  {
    const executedQueries: { query: string; params: any[] }[] = [];

    const mockDb: any = {
      prepare(query: string) {
        return {
          bind(...args: any[]) {
            return {
              query,
              params: args,
              async first() {
                if (query.includes("FROM system_settings")) {
                  return { value: "1000000" };
                }
                return null;
              },
              async all() {
                if (query.includes("FROM profiles")) {
                  return { results: [{ id: "p1" }] };
                }
                return { results: [] };
              },
              async run() {
                return { success: true, meta: { changes: 1 } };
              }
            };
          }
        };
      },
      async batch(statements: any[]) {
        for (const s of statements) {
          executedQueries.push({ query: s.query, params: s.params });
        }
        return statements.map(() => ({ meta: { changes: 1 } }));
      }
    };

    const aggModel = new LogAggregationModel(mockDb);

    // Run aggregation for 1 hour with minDomainCount = 2
    await aggModel.aggregateHourlyRollups(1000000, 1003600, 2);

    const domainRollupStmt = executedQueries.find(q => q.query.includes("INSERT OR REPLACE INTO domain_hourly_rollups"));
    assert(domainRollupStmt !== undefined, "domain_hourly_rollups statement must be executed");
    assert(domainRollupStmt.query.includes("HAVING COUNT(*) >= ?"), "Query must include HAVING COUNT(*) >= ?");

    const boundMinCount = domainRollupStmt.params[5];
    assert.strictEqual(boundMinCount, 2, "HAVING clause must bind minDomainCount (2)");

    console.log("  Passed: domain_hourly_rollups binds HAVING COUNT(*) >= 2.");
  }

  // 3. Test LogCoreModel.cleanup maxRows default
  console.log("\n3. Testing LogCoreModel.cleanup default maxRows...");
  {
    let passedBatchLimit = 0;

    const mockDb: any = {
      prepare(query: string) {
        return {
          bind(...args: any[]) {
            if (query.includes("DELETE FROM logs WHERE")) {
              passedBatchLimit = args[2];
            }
            return {
              async run() {
                return { success: true, meta: { changes: 500 } };
              }
            };
          }
        };
      },
      async batch() {
        return [];
      }
    };

    const coreModel = new LogCoreModel(mockDb);
    // Call cleanup without maxRows (defaults to 1000)
    const deleted = await coreModel.cleanup("p1", 1000000);
    assert.strictEqual(passedBatchLimit, 1000, "Default batch limit in cleanup must be 1000");
    assert.strictEqual(deleted, 500, "Should report deleted rows correctly");

    console.log("  Passed: LogCoreModel.cleanup defaults to 1000 maxRows.");
  }

  // 4. Test LogRetentionModel.cleanupGlobal daily budget enforcement
  console.log("\n4. Testing LogRetentionModel.cleanupGlobal daily budget enforcement...");
  {
    const todayDate = new Date().toISOString().slice(0, 10);
    const mockSettings: Record<string, string> = {
      log_cleanup_daily_date: todayDate,
      log_cleanup_daily_count: "20000"
    };

    const mockSettingsModel: any = {
      async get(key: string) {
        return mockSettings[key] || null;
      },
      async setMany(settings: Record<string, string>) {
        Object.assign(mockSettings, settings);
        return true;
      }
    };

    const executedQueries: { query: string; params: any[] }[] = [];
    const mockDb: any = {
      prepare(query: string) {
        const createObj = (boundArgs: any[] = []) => ({
          query,
          params: boundArgs,
          bind(...args: any[]) {
            return createObj(args);
          },
          async all() {
            if (query.includes("SELECT id, settings FROM profiles")) {
              return { results: [{ id: "p1", settings: "{}" }] };
            }
            return { results: [] };
          }
        });
        return createObj();
      },
      async batch(statements: any[]) {
        for (const s of statements) {
          executedQueries.push({ query: s.query, params: s.params });
        }
        return statements.map(() => ({ meta: { changes: 0 } }));
      }
    };

    const retentionModel = new LogRetentionModel(mockDb, mockSettingsModel);

    // Call cleanupGlobal with dailyBudget = 20000 (already reached)
    await retentionModel.cleanupGlobal(30, 1000, 20000);

    const logDeleteStmts = executedQueries.filter(q => q.query.includes("DELETE FROM logs WHERE"));
    assert.strictEqual(logDeleteStmts.length, 0, "When daily budget is exhausted, NO DELETE FROM logs statements should be executed");

    // But rollups should still be cleaned up
    const rollupDeleteStmts = executedQueries.filter(q => q.query.includes("_hourly_rollups"));
    assert(rollupDeleteStmts.length > 0, "Rollup cleanups should still run");

    console.log("  Passed: Log deletions skipped when daily budget is exhausted.");
  }

  // 5. Test LogRetentionModel.cleanupGlobal remaining budget capping and persistence
  console.log("\n5. Testing LogRetentionModel.cleanupGlobal remaining budget capping and persistence...");
  {
    const todayDate = new Date().toISOString().slice(0, 10);
    const mockSettings: Record<string, string> = {
      log_cleanup_daily_date: todayDate,
      log_cleanup_daily_count: "19800"
    };

    const mockSettingsModel: any = {
      async get(key: string) {
        return mockSettings[key] || null;
      },
      async setMany(settings: Record<string, string>) {
        Object.assign(mockSettings, settings);
        return true;
      }
    };

    const executedQueries: { query: string; params: any[] }[] = [];
    const mockDb: any = {
      prepare(query: string) {
        const createObj = (boundArgs: any[] = []) => ({
          query,
          params: boundArgs,
          bind(...args: any[]) {
            return createObj(args);
          },
          async all() {
            if (query.includes("SELECT id, settings FROM profiles")) {
              return {
                results: [
                  { id: "p1", settings: "{}" },
                  { id: "p2", settings: "{}" }
                ]
              };
            }
            return { results: [] };
          }
        });
        return createObj();
      },
      async batch(statements: any[]) {
        for (const s of statements) {
          executedQueries.push({ query: s.query, params: s.params });
        }
        return statements.map(() => ({ meta: { changes: 100 } }));
      }
    };

    const retentionModel = new LogRetentionModel(mockDb, mockSettingsModel);

    // Remaining budget = 20000 - 19800 = 200
    // Batch limit = 1000
    // Effective batch limit = min(1000, 200) = 200
    // 2 profiles -> perProfileLimit = 200 / 2 = 100
    await retentionModel.cleanupGlobal(30, 1000, 20000);

    const logDeleteStmts = executedQueries.filter(q => q.query.includes("DELETE FROM logs WHERE"));
    assert.strictEqual(logDeleteStmts.length, 2, "Should execute delete for both profiles");
    assert.strictEqual(logDeleteStmts[0].params[2], 100, "Should cap perProfileLimit to 100 based on remaining budget");

    // Total deleted in batch: 2 statements * 100 changes = 200
    // Updated count in mockSettings: 19800 + 200 = 20000
    assert.strictEqual(mockSettings.log_cleanup_daily_count, "20000", "Should update daily deleted count to 20000");

    console.log("  Passed: Log deletions capped to remaining daily budget and counter persisted.");
  }

  console.log("\n>>> [TEST] All Log Deletion Budget & Domain Rollup Filter tests passed successfully!\n");
}

runTests().catch(err => {
  console.error(">>> [TEST ERROR]", err);
  process.exit(1);
});
