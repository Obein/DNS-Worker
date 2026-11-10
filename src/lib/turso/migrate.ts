/**
 * @file migrate.ts
 * @description Automatic SQL schema migration runner for Turso (libSQL) database.
 * Supports both universal runtime auto-migration (Cloudflare Workers via EMBEDDED_MIGRATIONS)
 * and filesystem-based migrations (Node.js Serverfull mode & CLI tools).
 */

import { D1Database } from '@cloudflare/workers-types';
import { TursoD1Database } from './index';
import { EMBEDDED_MIGRATIONS } from './embeddedMigrations';
import { splitSqlStatements } from './sql';

let nodeFs: any = null;
let nodePath: any = null;

async function getFs() {
  if (!nodeFs && typeof process !== 'undefined' && process.versions?.node) {
    try {
      nodeFs = await import('node:fs');
      nodePath = await import('node:path');
    } catch {
      nodeFs = null;
      nodePath = null;
    }
  }
  return { fs: nodeFs, path: nodePath };
}

/**
 * Migration statistics result.
 */
export interface TursoMigrationStats {
  count: number;
  completed: boolean;
  totalAvailable: number;
  appliedCount: number;
  pendingCount: number;
  lastApplied: string | null;
  pendingFiles: string[];
}

/**
 * Ensures the `d1_migrations` table exists on database,
 * automatically migrating legacy records if available.
 *
 * @param db - D1Database or TursoD1Database instance.
 */
export async function ensureTursoMigrationsTable(db: D1Database | TursoD1Database): Promise<void> {
  // Use prepare().run() with single-line SQL to prevent Cloudflare D1 multi-line exec parser bugs
  await db
    .prepare(
      'CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, applied_at INTEGER NOT NULL)'
    )
    .run();

  // Safely import legacy _cf_d1_migrations records if table exists (for backward compatibility)
  try {
    const legacyTable = await db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='_cf_d1_migrations'")
      .first<{ name: string }>();
    if (legacyTable?.name) {
      await db
        .prepare('INSERT OR IGNORE INTO d1_migrations (name, applied_at) SELECT name, applied_at FROM _cf_d1_migrations')
        .run();
    }
  } catch {
    // Expected on Cloudflare D1 where _cf_ prefix is restricted or table does not exist
  }
}

/**
 * Executes a migration SQL script statement-by-statement, tolerating idempotent schema states
 * (such as duplicate column names or tables/indexes that already exist).
 *
 * @param db - D1Database or TursoD1Database instance.
 * @param sql - Migration script containing one or more SQL statements.
 */
export async function execMigrationSql(db: D1Database | TursoD1Database, sql: string): Promise<void> {
  const stmts = splitSqlStatements(sql);
  if (stmts.length === 0) return;

  for (let i = 0; i < stmts.length; i++) {
    const stmt = stmts[i].trim();
    if (!stmt) continue;

    try {
      if ('executePipeline' in db && typeof (db as any).executePipeline === 'function') {
        const results = await (db as any).executePipeline([
          {
            type: 'execute',
            stmt: { sql: stmt }
          },
          { type: 'close' }
        ], 60000);

        const first = results[0];
        if (first && (first.type === 'error' || first.error)) {
          const msg = (first.error?.message || '').toLowerCase();
          const stmtUpper = stmt.toUpperCase();
          const isDuplicateColumn = msg.includes('duplicate column name') && stmtUpper.startsWith('ALTER TABLE');
          const isAlreadyExists = msg.includes('already exists') && (stmtUpper.startsWith('CREATE') || stmtUpper.startsWith('ALTER'));

          if (isDuplicateColumn || isAlreadyExists) {
            console.warn(`[Migrations] Tolerating idempotent schema state on statement ${i + 1}: ${first.error?.message}`);
            continue;
          }

          throw new Error(`[Database D1] Exec error on statement ${i + 1}: ${first.error?.message || 'Error'}\nSQL: ${stmt}`);
        }
      } else {
        await db.prepare(stmt).run();
      }
    } catch (err: any) {
      const msg = (err?.message || '').toLowerCase();
      const stmtUpper = stmt.toUpperCase();
      const isDuplicateColumn = msg.includes('duplicate column name') && stmtUpper.startsWith('ALTER TABLE');
      const isAlreadyExists = msg.includes('already exists') && (stmtUpper.startsWith('CREATE') || stmtUpper.startsWith('ALTER'));

      if (isDuplicateColumn || isAlreadyExists) {
        console.warn(`[Migrations] Tolerating idempotent schema state on statement ${i + 1}: ${err.message}`);
        continue;
      }
      throw err;
    }
  }
}

/**
 * Resolves the available migrations map.
 * In Node.js environments (CLI, tests, Serverfull), prioritizes dynamically reading from
 * the local filesystem (migrations/ directory) so migrations/*.sql is the absolute Single Source of Truth.
 * In serverless environments (Cloudflare Workers) without filesystem access, falls back to EMBEDDED_MIGRATIONS.
 */
export async function resolveMigrationsMap(
  migrationsOrDir?: string | Record<string, string>
): Promise<Record<string, string>> {
  if (typeof migrationsOrDir === 'object' && migrationsOrDir !== null) {
    return migrationsOrDir;
  }

  const { fs: fsMod, path: pathMod } = await getFs();

  if (typeof migrationsOrDir === 'string') {
    if (fsMod && pathMod && fsMod.existsSync(migrationsOrDir)) {
      const files = fsMod
        .readdirSync(migrationsOrDir)
        .filter((f: string) => f.endsWith('.sql'))
        .sort();
      const map: Record<string, string> = {};
      for (const file of files) {
        map[file] = fsMod.readFileSync(pathMod.join(migrationsOrDir, file), 'utf-8');
      }
      return map;
    }
  }

  // Dynamic filesystem read in Node.js runtime when migrationsOrDir is omitted
  if (fsMod && pathMod) {
    try {
      const defaultDir = pathMod.join(process.cwd(), 'migrations');
      if (fsMod.existsSync(defaultDir)) {
        const files = fsMod
          .readdirSync(defaultDir)
          .filter((f: string) => f.endsWith('.sql'))
          .sort();
        if (files.length > 0) {
          const map: Record<string, string> = {};
          for (const file of files) {
            map[file] = fsMod.readFileSync(pathMod.join(defaultDir, file), 'utf-8');
          }
          return map;
        }
      }
    } catch {
      // Fall through to EMBEDDED_MIGRATIONS
    }
  }

  return EMBEDDED_MIGRATIONS;
}

/**
 * Queries migration status from database.
 *
 * @param db - D1Database or TursoD1Database instance.
 * @param migrationsOrDir - Optional directory path or custom Record<string, string> migration map.
 * @returns Object containing migration progress, applied counts, and pending files list.
 */
export async function getTursoMigrationStats(
  db: D1Database | TursoD1Database,
  migrationsOrDir?: string | Record<string, string>
): Promise<TursoMigrationStats> {
  const migrationsMap = await resolveMigrationsMap(migrationsOrDir);
  const files = Object.keys(migrationsMap).sort();
  try {
    await ensureTursoMigrationsTable(db);
    const appliedQuery = await db
      .prepare('SELECT name FROM d1_migrations')
      .all<{ name: string }>();
    const appliedSet = new Set((appliedQuery.results || []).map((r) => r.name));
    const pendingFiles = files.filter((f) => !appliedSet.has(f));
    const appliedCount = appliedSet.size;
    const lastApplied = (appliedQuery.results || []).length > 0
      ? (appliedQuery.results || []).map((r) => r.name).sort().pop() || null
      : null;

    return {
      count: appliedCount,
      completed: pendingFiles.length === 0,
      totalAvailable: files.length,
      appliedCount,
      pendingCount: pendingFiles.length,
      lastApplied,
      pendingFiles
    };
  } catch (err: any) {
    console.warn('[Turso Migrations] Failed to retrieve migration stats:', err.message || err);
    return {
      count: 0,
      completed: false,
      totalAvailable: files.length,
      appliedCount: 0,
      pendingCount: files.length,
      lastApplied: null,
      pendingFiles: files
    };
  }
}

/**
 * Runs all pending migrations against the database.
 * If migrationsOrDir is omitted, uses the compiled EMBEDDED_MIGRATIONS map,
 * allowing safe execution in serverless runtimes (Cloudflare Workers) without filesystem access.
 *
 * @param db - D1Database or TursoD1Database instance.
 * @param migrationsOrDir - Optional directory path or custom Record<string, string> migration map.
 * @returns Number of newly applied migrations.
 */
export async function runTursoMigrations(
  db: D1Database | TursoD1Database,
  migrationsOrDir?: string | Record<string, string>
): Promise<number> {
  await ensureTursoMigrationsTable(db);

  const migrationsMap = await resolveMigrationsMap(migrationsOrDir);
  const files = Object.keys(migrationsMap).sort();

  const appliedQuery = await db.prepare('SELECT name FROM d1_migrations').all<{ name: string }>();
  const appliedSet = new Set((appliedQuery.results || []).map((r) => r.name));

  let appliedCount = 0;
  for (const file of files) {
    if (appliedSet.has(file)) continue;

    const sql = migrationsMap[file];
    if (!sql || !sql.trim()) continue;

    console.log(`[Database Migrations] Applying ${file}...`);
    try {
      await execMigrationSql(db, sql);
      const appliedAt = Math.floor(Date.now() / 1000);
      await db
        .prepare('INSERT OR REPLACE INTO d1_migrations (name, applied_at) VALUES (?, ?)')
        .bind(file, appliedAt)
        .run();
      appliedCount++;
    } catch (err: any) {
      console.error(`[Database Migrations] Failed to apply ${file}:`, err.message || err);
      throw err;
    }
  }

  if (appliedCount > 0) {
    console.log(`[Database Migrations] Successfully applied ${appliedCount} migration(s).`);
  } else {
    console.log('[Database Migrations] Database schema is up-to-date.');
  }

  return appliedCount;
}

let tursoMigrationsPromise: Promise<number> | null = null;

/**
 * Ensures all schema migrations are applied to database once per worker isolate lifecycle.
 * Deduplicates concurrent execution requests.
 *
 * @param db - D1Database or TursoD1Database instance.
 * @returns Number of applied migrations.
 */
export async function ensureTursoMigrations(db: D1Database | TursoD1Database): Promise<number> {
  if (!tursoMigrationsPromise) {
    tursoMigrationsPromise = runTursoMigrations(db).finally(() => {
      tursoMigrationsPromise = null;
    });
  }
  return tursoMigrationsPromise;
}

// Universal aliases for database migrations across D1, Turso, and SQLite
export const ensureDatabaseMigrationsTable = ensureTursoMigrationsTable;
export const getDatabaseMigrationStats = getTursoMigrationStats;
export const runDatabaseMigrations = runTursoMigrations;
