/**
 * @file test_performance_and_runtime.ts
 * @description Unit tests for unified DNS_CACHE_SIZE, V8 engine tuning, cluster scaling,
 * SQLite concurrency maintenance, and multi-runtime execution coordination.
 */

import { DatabaseSync } from 'node:sqlite';
import { dnsCache, DEFAULT_DNS_CACHE_SIZE, syncDnsCacheSize, SizeCappedMap } from '../src/pipeline/cache';
import { tuneV8Engine } from '../src/serverfull/v8';
import { getClusterInfo } from '../src/serverfull/cluster';
import { NodeD1Database } from '../src/serverfull/db';
import { getActiveRuntimeDescription, handleRuntimeSwitch } from '../src/serverfull/commands/checkEnv';
import { getServerfullConfig } from '../src/serverfull/config';

console.log('================================================================');
console.log('   High-Performance Runtime, Cache & Concurrency Test Suite     ');
console.log('================================================================\n');

// 1. Validate DEFAULT_DNS_CACHE_SIZE and SizeCappedMap
console.log('1. Validating unified DNS_CACHE_SIZE and default 20k capacity...');
if (DEFAULT_DNS_CACHE_SIZE !== 20000) {
  throw new Error(`Expected DEFAULT_DNS_CACHE_SIZE = 20000, got ${DEFAULT_DNS_CACHE_SIZE}`);
}
if (dnsCache.getMaxEntries() !== 20000) {
  throw new Error(`Expected initial dnsCache capacity 20000, got ${dnsCache.getMaxEntries()}`);
}
console.log('   ✓ Default 20,000 DNS cache capacity verified.');

// 2. Validate dynamic syncDnsCacheSize
console.log('2. Validating dynamic syncDnsCacheSize with custom Env values...');
syncDnsCacheSize({ DNS_CACHE_SIZE: 35000 } as any);
if (dnsCache.getMaxEntries() !== 35000) {
  throw new Error(`Expected dnsCache capacity 35000, got ${dnsCache.getMaxEntries()}`);
}

// Reset back to 20k
syncDnsCacheSize({ DNS_CACHE_SIZE: 20000 } as any);
if (dnsCache.getMaxEntries() !== 20000) {
  throw new Error(`Expected dnsCache capacity 20000, got ${dnsCache.getMaxEntries()}`);
}

// Test SizeCappedMap LRU eviction behavior
const testMap = new SizeCappedMap<string, number>(3);
testMap.set('a', 1);
testMap.set('b', 2);
testMap.set('c', 3);
testMap.set('d', 4); // should evict 'a'
if (testMap.has('a') || !testMap.has('b') || !testMap.has('d')) {
  throw new Error('SizeCappedMap failed to evict oldest entry on overflow');
}
testMap.setMaxEntries(2); // should evict 'b'
if (testMap.size !== 2 || testMap.has('b') || !testMap.has('c') || !testMap.has('d')) {
  throw new Error('SizeCappedMap failed to downsize properly on setMaxEntries');
}
console.log('   ✓ Dynamic cache resizing and LRU eviction verified.');

// 3. Validate tuneV8Engine execution
console.log('3. Validating V8 engine tuning...');
tuneV8Engine();
console.log('   ✓ V8 engine runtime tuning executed successfully.');

// 4. Validate Cluster info resolution
console.log('4. Validating multi-core cluster info resolution...');
const singleCluster = getClusterInfo(1);
if (singleCluster.workersCount !== 1) {
  throw new Error(`Expected workersCount = 1, got ${singleCluster.workersCount}`);
}

const multiCluster = getClusterInfo(4);
const isBun = Boolean((process.versions as Record<string, string | undefined>).bun);
if (!isBun && multiCluster.workersCount !== 4) {
  throw new Error(`Expected workersCount = 4 under Node, got ${multiCluster.workersCount}`);
}
console.log(`   ✓ Cluster worker count verified (Node/Bun auto-adaptive: ${multiCluster.workersCount} workers).`);

// 5. Validate SQLite concurrency maintenance (checkpoint & optimize)
console.log('5. Validating SQLite WAL checkpoint and PRAGMA optimize...');
const tempDb = new DatabaseSync(':memory:');
tempDb.exec('PRAGMA foreign_keys = ON;');
tempDb.exec('CREATE TABLE test_perf (id INTEGER PRIMARY KEY, name TEXT);');
tempDb.exec("INSERT INTO test_perf (name) VALUES ('alpha'), ('beta');");

const nodeD1 = new NodeD1Database(tempDb, ':memory:');
// Verify checkpoint does not throw on in-memory or WAL db
nodeD1.checkpoint('PASSIVE');
nodeD1.checkpoint('TRUNCATE');
// Verify optimize executes successfully
nodeD1.optimize();
nodeD1.close();
console.log('   ✓ SQLite PRAGMA wal_checkpoint and PRAGMA optimize verified.');

// 6. Validate Runtime description and switching
console.log('6. Validating active runtime description and switcher...');
const runtimeDesc = getActiveRuntimeDescription();
if (!runtimeDesc.includes('v') || (!runtimeDesc.includes('Node.js') && !runtimeDesc.includes('Bun'))) {
  throw new Error(`Unexpected runtime description: ${runtimeDesc}`);
}
console.log(`   ✓ Active runtime description: ${runtimeDesc}`);

const noSwitch = handleRuntimeSwitch('auto');
if (noSwitch) {
  throw new Error('handleRuntimeSwitch should not switch when target is auto');
}
console.log('   ✓ Runtime switch guard verified.');

// 7. Validate CLI configuration parsing for workers and cache size
console.log('7. Validating ServerfullConfig workers & dnsCacheSize resolution...');
const { config, env } = getServerfullConfig({
  workers: '4',
  'dns-cache-size': '25000'
} as any);

if (config.workers !== 4) {
  throw new Error(`Expected config.workers = 4, got ${config.workers}`);
}
if (config.dnsCacheSize !== 25000) {
  throw new Error(`Expected config.dnsCacheSize = 25000, got ${config.dnsCacheSize}`);
}
if (env.DNS_CACHE_SIZE !== 25000) {
  throw new Error(`Expected env.DNS_CACHE_SIZE = 25000, got ${env.DNS_CACHE_SIZE}`);
}
console.log('   ✓ CLI options and environment mapping verified.');

console.log('\n================================================================');
console.log('   ALL HIGH-PERFORMANCE RUNTIME TESTS PASSED!                   ');
console.log('================================================================\n');
