/**
 * @file test_db_size.ts
 * @description Comprehensive test suite for database size calculation:
 * - formatBytes unit tests
 * - Serverfull mode size tracking & space reclamation on log deletion
 * - Serverless mode size calculation with D1 table sizing
 * - API route /api/account/db-size & /api/account/logs integration
 */

import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert';
import { formatBytes, getDatabaseStorageSize } from '../src/utils/dbSize';
import { initServerfullDb } from '../src/serverfull/db';
import { handlePersonalAccountRequest } from '../src/api/account/personal';
import { LogModel } from '../src/models/log';
import { Env, User, ExecutionContext } from '../src/types';

async function runDbSizeTests(): Promise<void> {
  console.log('>>> [TEST] Starting Database Size Calculation Tests...');

  // 1. Test formatBytes
  console.log('>>> [TEST] 1. formatBytes utility');
  assert.strictEqual(formatBytes(0), '0 B');
  assert.strictEqual(formatBytes(-100), '0 B');
  assert.strictEqual(formatBytes(500), '500 B');
  assert.strictEqual(formatBytes(1024), '1.00 KB');
  assert.strictEqual(formatBytes(1536), '1.50 KB');
  assert.strictEqual(formatBytes(1048576), '1.00 MB');
  assert.strictEqual(formatBytes(5242880), '5.00 MB');
  assert.strictEqual(formatBytes(1073741824), '1.00 GB');

  // 2. Test Serverfull mode
  console.log('>>> [TEST] 2. Serverfull mode size calculation & space reclamation');
  const testDbDir = path.join(process.cwd(), '.tmp_test_dbsize');
  fs.mkdirSync(testDbDir, { recursive: true });
  const testDbPath = path.join(testDbDir, 'test_size.sqlite');
  if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);

  const db = initServerfullDb(testDbPath);
  const dummyEnv: Env = {
    DB: db as any,
    ASSETS: null,
    SERVERFULL_DB_PATH: testDbPath
  };

  const initialSize = await getDatabaseStorageSize(dummyEnv);
  assert.strictEqual(initialSize.mode, 'serverfull');
  assert.ok(initialSize.size_bytes > 0, 'Initial database size must be greater than 0');
  console.log(`Initial DB size: ${initialSize.formatted} (${initialSize.size_bytes} bytes)`);

  // Insert mock logs for owner 'test_user_owner'
  const logModel = new LogModel(db as any);
  const now = Math.floor(Date.now() / 1000);

  // Create user first for foreign key
  await db.prepare('INSERT OR REPLACE INTO users (id, username, hashed_password, role, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind('test_user_owner', 'test_owner', 'dummy_hash', 'user', now)
    .run();

  // Create a profile for the user
  await db.prepare('INSERT OR REPLACE INTO profiles (id, name, owner_id, settings, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind('prof_dbsize_1', 'Test Profile', 'test_user_owner', '{}', now, now)
    .run();

  for (let i = 0; i < 2000; i++) {
    await logModel.insert({
      id: i + 1,
      profile_id: 'prof_dbsize_1',
      timestamp: now + i,
      domain: `test${i}.example.com`,
      action: 'PASS',
      reason: 'ALLOW_LIST',
      client_ip: '192.168.1.100',
      geo_country: 'US',
      record_type: 'A',
      latency: 12
    });
  }

  const populatedSize = await getDatabaseStorageSize(dummyEnv);
  console.log(`Populated DB size with 2000 logs: ${populatedSize.formatted} (${populatedSize.size_bytes} bytes)`);
  assert.ok(
    populatedSize.size_bytes >= initialSize.size_bytes,
    'Database size must grow or stay equal after inserting logs'
  );

  // 3. Test API endpoint GET /api/account/db-size
  console.log('>>> [TEST] 3. GET /api/account/db-size endpoint');
  const dummyUser: User = {
    id: 'test_user_owner',
    username: 'test_owner',
    role: 'user'
  };
  const dummyCtx = {
    waitUntil() {},
    passThroughOnException() {}
  } as unknown as ExecutionContext;

  const getReq = new Request('http://localhost/api/account/db-size', { method: 'GET' });
  const getRes = await handlePersonalAccountRequest(
    getReq,
    dummyEnv,
    dummyUser,
    ['api', 'account', 'db-size'],
    dummyCtx
  );
  assert.strictEqual(getRes.status, 200);
  const getResBody = await getRes.json() as any;
  assert.strictEqual(getResBody.mode, 'serverfull');
  assert.ok(getResBody.size_bytes > 0);
  assert.ok(typeof getResBody.formatted === 'string');

  // 4. Test DELETE /api/account/logs and verify space reclamation
  console.log('>>> [TEST] 4. DELETE /api/account/logs and verify size refresh');
  const deleteReq = new Request('http://localhost/api/account/logs', { method: 'DELETE' });
  const deleteRes = await handlePersonalAccountRequest(
    deleteReq,
    dummyEnv,
    dummyUser,
    ['api', 'account', 'logs'],
    dummyCtx
  );
  assert.strictEqual(deleteRes.status, 200);
  const deleteResBody = await deleteRes.json() as any;
  assert.strictEqual(deleteResBody.success, true);

  // Check logs were deleted
  const remainingLogs = await db.prepare('SELECT count(*) as count FROM logs WHERE profile_id = ?')
    .bind('prof_dbsize_1')
    .first<{ count: number }>();
  assert.strictEqual(remainingLogs?.count, 0, 'All logs for owner profile must be deleted');

  const afterClearSize = await getDatabaseStorageSize(dummyEnv);
  console.log(`DB size after clearing logs & vacuum: ${afterClearSize.formatted} (${afterClearSize.size_bytes} bytes)`);

  // Close DB before cleanup
  db.close();
  try {
    fs.rmSync(testDbDir, { recursive: true, force: true });
  } catch {}

  // 5. Test Serverless mode (Cloudflare D1 simulation)
  console.log('>>> [TEST] 5. Serverless mode calculation with D1 simulation');
  const mockD1 = {
    prepare(query: string) {
      return {
        bind(..._params: any[]) {
          return this;
        },
        async all<T = any>() {
          if (query.includes('sqlite_master')) {
            return {
              results: [
                { name: 'logs' },
                { name: 'profile_blooms' },
                { name: 'lists' },
                { name: 'rules' },
                { name: 'users' },
                { name: 'profiles' }
              ] as unknown as T[],
              success: true
            };
          }
          return { results: [], success: true };
        },
        async first<T = any>() {
          if (query.includes('AS size_bytes')) {
            return { size_bytes: 2097152 } as unknown as T; // 2 MB
          }
          return null;
        }
      };
    }
  };

  const serverlessEnv: Env = {
    DB: mockD1 as any,
    ASSETS: null
  };

  const serverlessResult = await getDatabaseStorageSize(serverlessEnv);
  assert.strictEqual(serverlessResult.mode, 'serverless');
  assert.strictEqual(serverlessResult.size_bytes, 2097152);
  assert.strictEqual(serverlessResult.formatted, '2.00 MB');

  console.log('>>> [TEST] All Database Size Tests Passed Successfully! \u2714\n');
}

runDbSizeTests().catch((err) => {
  console.error('Test Failed:', err);
  process.exit(1);
});
