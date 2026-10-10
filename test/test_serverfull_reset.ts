/**
 * @file test_serverfull_reset.ts
 * @description Integration test for `dns-worker reset` command:
 * Verifies that the command wipes the database, re-runs migrations, and restores default .env.
 */

import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert';
import { handleResetCommand } from '../src/serverfull/reset';
import { initServerfullDb } from '../src/serverfull/db';
import { getDefaultConfigFilePath, getDefaultDbPath } from '../src/serverfull/config';

async function runResetTest(): Promise<void> {
  console.log('>>> [TEST] Starting Serverfull Reset Command Tests...');

  const dbPath = getDefaultDbPath();
  const configPath = getDefaultConfigFilePath();

  // 1. Ensure a database exists with dummy data
  const db = initServerfullDb(dbPath);
  const now = Math.floor(Date.now() / 1000);
  await db.prepare('INSERT OR REPLACE INTO users (id, username, hashed_password, role, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind('test_user_reset', 'reset_admin', 'dummy_hash', 'admin', now).run();

  const userRowBefore = await db.prepare('SELECT id FROM users WHERE id = ?').bind('test_user_reset').first<{ id: string }>();
  assert.strictEqual(userRowBefore?.id, 'test_user_reset', 'Database should contain the test user before reset');

  // 2. Put non-default content in the config file
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, 'CUSTOM_PARAM=OVERRIDDEN_VALUE\n', 'utf-8');
  assert.strictEqual(fs.readFileSync(configPath, 'utf-8'), 'CUSTOM_PARAM=OVERRIDDEN_VALUE\n');

  // Close db handle so file can be unlinked without EBUSY on Windows
  db.close();

  // 3. Execute handleResetCommand({ force: true })
  console.log('>>> [TEST] Invoking handleResetCommand with force: true...');
  await handleResetCommand({ force: true });

  // 4. Verify config file was restored to default template
  assert.strictEqual(fs.existsSync(configPath), true, 'Config file must exist after reset');
  const configContent = fs.readFileSync(configPath, 'utf-8');
  assert.strictEqual(
    configContent.includes('SERVERFULL_HOST=0.0.0.0'),
    true,
    'Config file must be restored to default template'
  );

  // 5. Verify database was wiped and fresh schema migrated
  const freshDb = initServerfullDb(dbPath);
  const userRowAfter = await freshDb.prepare('SELECT id FROM users WHERE id = ?').bind('test_user_reset').first();
  assert.strictEqual(userRowAfter, null, 'Test user should be wiped after reset');

  const tableCheck = await freshDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").first<{ name: string }>();
  assert.strictEqual(tableCheck?.name, 'users', 'Schema tables should be re-migrated and ready');

  console.log('>>> [TEST] SUCCESS: Serverfull reset command verified!');
}

runResetTest().catch((err) => {
  console.error('>>> [TEST FAILED]:', err);
  process.exit(1);
});
