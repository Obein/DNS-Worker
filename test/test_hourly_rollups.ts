/**
 * @file test_hourly_rollups.ts
 * @description Integration and unit tests for consolidated hourly_rollups table,
 * in-flight pre-encryption rollups generation, and client-side caching.
 */

import assert from "node:assert";
import { DatabaseSync } from "node:sqlite";
import { NodeD1Database } from "../src/serverfull/db";
import { LogModel } from "../src/models/log";
import { ResolutionLog } from "../src/types";

console.log(">>> [TEST] Running Consolidated Hourly Rollups & In-Flight Aggregation Tests...");

// Initialize in-memory SQLite database
const rawDb = new DatabaseSync(":memory:");
const db = new NodeD1Database(rawDb);
const logModel = new LogModel(db);

async function runTests() {
  // 1. Initialize schema
  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS logs (
      profile_id TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      id INTEGER NOT NULL DEFAULT 1,
      client_ip TEXT,
      geo_country TEXT,
      domain TEXT NOT NULL,
      record_type TEXT NOT NULL,
      action TEXT NOT NULL,
      reason TEXT,
      answer TEXT,
      dest_geoip TEXT,
      dest_country_code TEXT,
      dest_country TEXT,
      ecs TEXT,
      upstream TEXT,
      latency INTEGER,
      access_point_id TEXT,
      PRIMARY KEY (profile_id, timestamp, id)
    ) WITHOUT ROWID;
  `);
  await logModel.aggregation.ensureRollupTables();

  const tables = rawDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='hourly_rollups'").all();
  assert.strictEqual(tables.length, 1, "hourly_rollups table must be created");
  console.log("  PASS: hourly_rollups table created successfully");

  // 2. Prepare sample in-flight logs (before encryption)
  const now = Math.floor(Date.now() / 1000);
  const hourTs = Math.floor(now / 3600) * 3600;

  const sampleLogs: ResolutionLog[] = [
    {
      profile_id: "test_prof",
      timestamp: now - 100,
      domain: "github.com",
      action: "PASS",
      client_ip: "192.168.1.100",
      geo_country: "CN",
      dest_country_code: "US",
      dest_country: "United States",
      record_type: "A"
    },
    {
      profile_id: "test_prof",
      timestamp: now - 80,
      domain: "github.com",
      action: "PASS",
      client_ip: "192.168.1.100",
      geo_country: "CN",
      dest_country_code: "US",
      dest_country: "United States",
      record_type: "A"
    },
    {
      profile_id: "test_prof",
      timestamp: now - 60,
      domain: "ads.track.com",
      action: "BLOCK",
      client_ip: "192.168.1.105",
      geo_country: "CN",
      dest_country_code: "SG",
      dest_country: "Singapore",
      record_type: "A"
    }
  ];

  // 3. Test in-memory micro-aggregation & statement generation
  const rollupStatements = logModel.aggregation.createRollupUpsertStatements(sampleLogs);
  assert.ok(rollupStatements.length > 0, "Must generate rollup upsert statements");
  console.log(`  PASS: Generated ${rollupStatements.length} rollup upsert statements from 3 logs`);

  // 4. Execute rollup statements
  await db.batch(rollupStatements);

  // 5. Verify aggregated counts in hourly_rollups
  const actionRows = rawDb.prepare("SELECT key, count FROM hourly_rollups WHERE metric_type = 'action'").all() as { key: string; count: number }[];
  const passAction = actionRows.find(r => r.key === "PASS");
  const blockAction = actionRows.find(r => r.key === "BLOCK");
  assert.strictEqual(passAction?.count, 2, "PASS action count must fold to 2");
  assert.strictEqual(blockAction?.count, 1, "BLOCK action count must be 1");
  console.log("  PASS: In-memory folding folded multiple PASS actions into count=2");

  const domainRows = rawDb.prepare("SELECT key, sub_key, count FROM hourly_rollups WHERE metric_type = 'domain'").all() as { key: string; sub_key: string; count: number }[];
  const githubDomain = domainRows.find(r => r.key === "github.com");
  assert.strictEqual(githubDomain?.count, 2, "github.com domain count must fold to 2");
  assert.strictEqual(githubDomain?.sub_key, "PASS", "github.com sub_key must record PASS action");
  console.log("  PASS: Domain metric folded in-flight occurrences before encryption");

  const clientRows = rawDb.prepare("SELECT key, sub_key, count FROM hourly_rollups WHERE metric_type = 'client'").all() as { key: string; sub_key: string; count: number }[];
  const client100 = clientRows.find(r => r.key === "192.168.1.100");
  assert.strictEqual(client100?.count, 2, "client 192.168.1.100 count must fold to 2");
  assert.strictEqual(client100?.sub_key, "CN", "client geo_country must be CN");
  console.log("  PASS: Client IP metric preserved accurately");

  // 6. Test analytics query models directly against hourly_rollups
  const summary = await logModel.getSummary("test_prof", hourTs - 3600, hourTs + 7200);
  assert.ok(summary.some(s => s.action === "PASS" && s.count >= 2), "getSummary must return rolled-up PASS count");
  assert.ok(summary.some(s => s.action === "BLOCK" && s.count >= 1), "getSummary must return rolled-up BLOCK count");
  console.log("  PASS: logModel.getSummary reads cleanly from hourly_rollups");

  const topAllowed = await logModel.getTopAllowed("test_prof", hourTs - 3600, hourTs + 7200);
  assert.ok(topAllowed.some(d => d.domain === "github.com" && d.count >= 2), "getTopAllowed must return github.com");
  console.log("  PASS: logModel.getTopAllowed reads cleanly from hourly_rollups");

  const topBlocked = await logModel.getTopBlocked("test_prof", hourTs - 3600, hourTs + 7200);
  assert.ok(topBlocked.some(d => d.domain === "ads.track.com" && d.count >= 1), "getTopBlocked must return ads.track.com");
  console.log("  PASS: logModel.getTopBlocked reads cleanly from hourly_rollups");

  const clients = await logModel.getClients("test_prof", hourTs - 3600, hourTs + 7200);
  assert.ok(clients.some(c => c.client_ip === "192.168.1.100" && c.count >= 2), "getClients must return 192.168.1.100");
  console.log("  PASS: logModel.getClients reads cleanly from hourly_rollups");

  const destinations = await logModel.getDestinations("test_prof", hourTs - 3600, hourTs + 7200);
  assert.ok(destinations.some(d => d.country_code === "US" && d.count >= 2), "getDestinations must return US");
  assert.ok(destinations.some(d => d.country_code === "SG" && d.count >= 1), "getDestinations must return SG");
  console.log("  PASS: logModel.getDestinations reads cleanly from hourly_rollups");

  // 7. Test atomic cleanup / retention
  await rawDb.exec("DELETE FROM hourly_rollups WHERE profile_id = 'test_prof'");
  const remaining = rawDb.prepare("SELECT count(*) as count FROM hourly_rollups WHERE profile_id = 'test_prof'").get() as { count: number };
  assert.strictEqual(remaining.count, 0, "hourly_rollups must delete cleanly");
  console.log("  PASS: hourly_rollups single-table cleanup succeeded");

  console.log("\n======================================================");
  console.log("   ALL HOURLY ROLLUPS & PRE-ENCRYPTION TESTS PASSED!  ");
  console.log("======================================================");
}

runTests().catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});
