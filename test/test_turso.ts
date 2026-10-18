/**
 * @file test_turso.ts
 * @description Comprehensive unit and integration test suite for Turso (libSQL) Hrana HTTP adapter.
 * Tests:
 * 1. Protocol serialization / deserialization (including binary BLOBs).
 * 2. URL normalization and masking.
 * 3. SQL statement splitting.
 * 4. D1Database interface adherence (prepare, bind, run, first, all, raw, batch, exec) via mock Hrana pipeline server.
 * 5. Schema migration tracking and idempotency.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import {
  toHranaValue,
  fromHranaValue,
  normalizeTursoUrl,
  maskDatabaseUrl,
  isTursoConfigured,
  getDatabaseService,
  splitSqlStatements,
  createTursoClient,
  HranaRequest,
  HranaStepResult,
  HranaPipelineResponse
} from '../src/lib/turso';
import { runTursoMigrations, getTursoMigrationStats } from '../src/lib/turso/migrate';

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string): void {
  if (!condition) {
    console.error(`  FAIL: ${msg}`);
    failed++;
    throw new Error(`Assertion failed: ${msg}`);
  } else {
    console.log(`  PASS: ${msg}`);
    passed++;
  }
}

async function runTestSuite(): Promise<void> {
  console.log('\n--- Test Suite 1: Utility & Protocol Serialization ---');

  // 1. URL Normalization
  assert(
    normalizeTursoUrl('libsql://my-db.turso.io') === 'https://my-db.turso.io',
    'normalizeTursoUrl handles libsql:// protocol'
  );
  assert(
    normalizeTursoUrl('https://my-db.turso.io/') === 'https://my-db.turso.io',
    'normalizeTursoUrl trims trailing slash'
  );
  assert(
    normalizeTursoUrl('http://127.0.0.1:8080') === 'http://127.0.0.1:8080',
    'normalizeTursoUrl keeps http:// for local emulators'
  );

  // 2. URL Masking
  assert(
    maskDatabaseUrl('https://my-db.turso.io/some/secret/path') === 'https://my-db.turso.io',
    'maskDatabaseUrl masks sensitive subpaths'
  );

  // 3. Environment check
  assert(
    isTursoConfigured({ TURSO_DATABASE_URL: 'libsql://foo', TURSO_AUTH_TOKEN: 'bar' }) === true,
    'isTursoConfigured returns true with credentials'
  );
  assert(
    isTursoConfigured({ TURSO_DATABASE_URL: 'libsql://foo' }) === false,
    'isTursoConfigured returns false when token missing'
  );
  assert(
    isTursoConfigured({}) === false,
    'isTursoConfigured returns false when empty'
  );

  // 4. DATABASE_SERVICE resolution
  assert(
    getDatabaseService({}, false) === 'D1',
    'getDatabaseService defaults to D1 in Serverless mode'
  );
  assert(
    getDatabaseService({}, true) === 'File',
    'getDatabaseService defaults to File in Serverfull mode'
  );
  assert(
    getDatabaseService({ DATABASE_SERVICE: 'Turso' }, false) === 'Turso',
    'DATABASE_SERVICE=Turso resolves to Turso in Serverless'
  );
  assert(
    getDatabaseService({ DATABASE_SERVICE: 'turso' }, true) === 'Turso',
    'DATABASE_SERVICE=turso (lowercase) resolves to Turso in Serverfull'
  );
  assert(
    getDatabaseService({ DATABASE_SERVICE: 'File' }, false) === 'File',
    'DATABASE_SERVICE=File resolves to File'
  );
  assert(
    getDatabaseService({ DATABASE_SERVICE: 'D1' }, true) === 'D1',
    'DATABASE_SERVICE=D1 resolves to D1'
  );
  assert(
    getDatabaseService({ TURSO_DATABASE_URL: 'libsql://foo', TURSO_AUTH_TOKEN: 'bar' }, true) === 'Turso',
    'getDatabaseService auto-enables Turso when credentials provided without DATABASE_SERVICE'
  );
  assert(
    getDatabaseService({ DATABASE_SERVICE: 'File', TURSO_DATABASE_URL: 'libsql://foo', TURSO_AUTH_TOKEN: 'bar' }, true) === 'File',
    'DATABASE_SERVICE=File overrides Turso credentials'
  );

  // 5. Value serialization (toHranaValue & fromHranaValue)
  assert(toHranaValue(null).type === 'null', 'null serialized as null');
  assert(toHranaValue(undefined).type === 'null', 'undefined serialized as null');
  assert(toHranaValue('hello').type === 'text' && (toHranaValue('hello') as any).value === 'hello', 'string serialized as text');
  assert(toHranaValue(42).type === 'integer' && (toHranaValue(42) as any).value === '42', 'integer serialized as integer');
  assert(toHranaValue(3.14).type === 'float' && (toHranaValue(3.14) as any).value === 3.14, 'float serialized as float');
  assert(toHranaValue(true).type === 'integer' && (toHranaValue(true) as any).value === '1', 'boolean true serialized as integer 1');
  assert(toHranaValue(false).type === 'integer' && (toHranaValue(false) as any).value === '0', 'boolean false serialized as integer 0');

  // Binary BLOB serialization
  const testBytes = new Uint8Array([10, 20, 30, 40, 50]);
  const hranaBlob = toHranaValue(testBytes.buffer);
  assert(hranaBlob.type === 'blob', 'ArrayBuffer serialized as blob');
  const restoredAb = fromHranaValue(hranaBlob);
  assert(restoredAb instanceof ArrayBuffer, 'fromHranaValue deserializes blob to ArrayBuffer');
  assert(new Uint8Array(restoredAb)[2] === 30, 'ArrayBuffer contents preserved identically');

  // 5. Statement Splitting
  const sampleSql = `
    -- First statement with comment
    CREATE TABLE test (id INTEGER PRIMARY KEY, note TEXT);
    /* Block comment
       with semicolon ; inside */
    INSERT INTO test VALUES (1, 'hello; world; string');
    SELECT * FROM test WHERE note = "another; semicolon";
  `;
  const stmts = splitSqlStatements(sampleSql);
  assert(stmts.length === 3, `splitSqlStatements splits correctly into 3 queries (got ${stmts.length})`);
  assert(stmts[0].startsWith('CREATE TABLE'), 'Statement 1 is CREATE TABLE');
  assert(stmts[1].includes("'hello; world; string'"), 'Statement 2 keeps internal string semicolons intact');
  assert(stmts[2].startsWith('SELECT'), 'Statement 3 is SELECT');

  console.log('\n--- Test Suite 2: Mock Hrana Pipeline & D1Database Adapter ---');

  // Setup an in-memory SQLite backend inside an in-process fetch mock
  const originalFetch = globalThis.fetch;
  const mockDb = new DatabaseSync(':memory:');
  const TEST_TOKEN = 'secret-turso-token-12345';
  const mockServerUrl = 'https://mock-turso.example.com';

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
    if (url.endsWith('/v2/pipeline')) {
      const headers = new Headers(init?.headers);
      const authHeader = headers.get('authorization');
      if (authHeader !== `Bearer ${TEST_TOKEN}`) {
        return new Response(JSON.stringify({ message: 'Unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const bodyText = typeof init?.body === 'string' ? init.body : '';
      const payload = JSON.parse(bodyText);
      const requests: HranaRequest[] = payload.requests || [];
      const stepResults: HranaStepResult[] = [];

      for (const r of requests) {
        if (r.type === 'close') {
          stepResults.push({ type: 'ok', response: { type: 'close' } });
          continue;
        }

        if (r.type === 'execute' && r.stmt) {
          const sql = r.stmt.sql;
          const args = (r.stmt.args || []).map(a => {
            const val = fromHranaValue(a);
            return val instanceof ArrayBuffer ? new Uint8Array(val) : val;
          });

          try {
            const trimmed = sql.trim().toUpperCase();
            if (trimmed.startsWith('SELECT') || trimmed.startsWith('PRAGMA')) {
              const stmt = mockDb.prepare(sql);
              const rows = stmt.all(...args) as Record<string, any>[];
              const cols = rows.length > 0
                ? Object.keys(rows[0]).map(name => ({ name }))
                : [];
              const hranaRows = rows.map(row => Object.values(row).map(toHranaValue));
              stepResults.push({
                type: 'ok',
                response: {
                  type: 'execute',
                  result: {
                    cols,
                    rows: hranaRows,
                    affected_row_count: 0,
                    last_insert_rowid: null
                  }
                }
              });
            } else {
              const stmt = mockDb.prepare(sql);
              const result = stmt.run(...args);
              stepResults.push({
                type: 'ok',
                response: {
                  type: 'execute',
                  result: {
                    cols: [],
                    rows: [],
                    affected_row_count: Number(result.changes),
                    last_insert_rowid: String(result.lastInsertRowid)
                  }
                }
              });
            }
          } catch (execErr: any) {
            stepResults.push({
              type: 'error',
              error: { message: execErr.message, code: 'SQLITE_ERROR' }
            });
            break;
          }
        }
      }

      const responsePayload: HranaPipelineResponse = {
        baton: null,
        base_url: null,
        results: stepResults
      };
      return new Response(JSON.stringify(responsePayload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(null, { status: 404 });
  }) as any;

  const tursoClient = createTursoClient(mockServerUrl, TEST_TOKEN);

  try {
    // 1. exec() - Multi-statement execution
    const execRes = await tursoClient.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        data BLOB
      );
    `);
    assert(execRes.count > 0, 'tursoClient.exec() executes table creation');

    // 2. prepare().bind().run()
    const runRes = await tursoClient
      .prepare('INSERT INTO users (name, data) VALUES (?, ?)')
      .bind('Alice', new Uint8Array([1, 2, 3, 4]))
      .run();
    assert(runRes.success === true, 'run() successfully executed insert');
    assert(runRes.meta.rows_written === 1, 'run() reports 1 written row');
    assert(runRes.meta.last_row_id === 1, 'run() returns correct last_row_id');

    // 3. prepare().bind().first()
    const firstUser = await tursoClient
      .prepare('SELECT id, name, data FROM users WHERE id = ?')
      .bind(1)
      .first<{ id: number; name: string; data: ArrayBuffer }>();
    assert(firstUser !== null && firstUser.name === 'Alice', 'first() retrieves user record correctly');
    assert(firstUser?.data instanceof ArrayBuffer, 'first() retrieves BLOB column as ArrayBuffer');
    assert(new Uint8Array(firstUser!.data)[3] === 4, 'BLOB binary bytes match stored data');

    // 4. prepare().all()
    const allUsers = await tursoClient
      .prepare('SELECT id, name FROM users')
      .all<{ id: number; name: string }>();
    assert(allUsers.results.length === 1, 'all() retrieves row array');
    assert(allUsers.results[0].name === 'Alice', 'all() item data matches');

    // 5. prepare().raw()
    const rawRows = await tursoClient
      .prepare('SELECT id, name FROM users')
      .raw({ columnNames: true });
    assert(rawRows[0][0] === 'id' && rawRows[0][1] === 'name', 'raw() returns header columns');
    assert(rawRows[1][1] === 'Alice', 'raw() returns row values array');

    // 6. batch() - Transactional batch execution
    const batchRes = await tursoClient.batch([
      tursoClient.prepare('INSERT INTO users (name) VALUES (?)').bind('Bob'),
      tursoClient.prepare('INSERT INTO users (name) VALUES (?)').bind('Charlie'),
      tursoClient.prepare('SELECT count(*) as count FROM users')
    ]);
    assert(batchRes.length === 3, 'batch() returns results for all batched operations');
    assert(batchRes[0].meta.rows_written === 1, 'batch item 1 wrote 1 row');
    assert(batchRes[1].meta.rows_written === 1, 'batch item 2 wrote 1 row');
    assert((batchRes[2].results[0] as any).count === 3, 'batch item 3 reports 3 total users');

    console.log('\n--- Test Suite 3: Schema Migrations & Idempotency ---');

    // Create a temporary migrations directory
    const tempMigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'turso-test-mig-'));
    fs.writeFileSync(
      path.join(tempMigDir, '0000_profiles.sql'),
      `CREATE TABLE profiles (id TEXT PRIMARY KEY, name TEXT);
       INSERT INTO profiles (id, name) VALUES ('p1', 'Default');`
    );
    fs.writeFileSync(
      path.join(tempMigDir, '0001_rules.sql'),
      `CREATE TABLE rules (id TEXT PRIMARY KEY, domain TEXT);
       INSERT INTO rules (id, domain) VALUES ('r1', 'example.com');`
    );

    // Initial migration execution
    const applied1 = await runTursoMigrations(tursoClient, tempMigDir);
    assert(applied1 === 2, `runTursoMigrations applied 2 initial migrations (got ${applied1})`);

    // Verification of applied migration stats
    const stats = await getTursoMigrationStats(tursoClient);
    assert(stats.count === 2, 'getTursoMigrationStats reports 2 applied migrations');
    assert(stats.lastApplied === '0001_rules.sql', 'lastApplied matches latest migration filename');

    // Idempotency: Running again should apply 0
    const applied2 = await runTursoMigrations(tursoClient, tempMigDir);
    assert(applied2 === 0, 'runTursoMigrations applied 0 migrations on second run (idempotent)');

    // Verify created table contents
    const profRow = await tursoClient.prepare('SELECT name FROM profiles WHERE id = ?').bind('p1').first<{ name: string }>();
    assert(profRow?.name === 'Default', 'Migration initialized profile table content');

    // Cleanup temp dir
    fs.rmSync(tempMigDir, { recursive: true, force: true });

  } finally {
    globalThis.fetch = originalFetch;
    mockDb.close();
  }

  console.log(`\n================================`);
  console.log(`TURSO TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log(`================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTestSuite().catch(err => {
  console.error('Unhandled test failure:', err);
  process.exit(1);
});
