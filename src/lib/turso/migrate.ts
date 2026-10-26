/**
 * @file migrate.ts
 * @description Automatic SQL schema migration runner for Turso (libSQL) database.
 * Supports both universal runtime auto-migration (Cloudflare Workers via EMBEDDED_MIGRATIONS)
 * and filesystem-based migrations (Node.js Serverfull mode & CLI tools).
 */

import { TursoD1Database } from './index';
import { EMBEDDED_MIGRATIONS } from './embeddedMigrations';

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
  lastApplied: string | null;
}

/**
 * Ensures the `_cf_d1_migrations` table exists on Turso.
 *
 * @param db - TursoD1Database instance.
 */
export async function ensureTursoMigrationsTable(db: TursoD1Database): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS _cf_d1_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      applied_at INTEGER NOT NULL
    );
  `);
}

/**
 * Queries migration status from Turso.
 *
 * @param db - TursoD1Database instance.
 * @returns Object containing applied migration count and name of latest applied file.
 */
export async function getTursoMigrationStats(db: TursoD1Database): Promise<TursoMigrationStats> {
  try {
    await ensureTursoMigrationsTable(db);
    const result = await db
      .prepare('SELECT count(*) as count, max(name) as lastApplied FROM _cf_d1_migrations')
      .first<{ count: number; lastApplied: string | null }>();
    return {
      count: result?.count || 0,
      lastApplied: result?.lastApplied || null
    };
  } catch {
    return { count: 0, lastApplied: null };
  }
}

/**
 * Runs all pending migrations against Turso.
 * If migrationsOrDir is omitted, uses the compiled EMBEDDED_MIGRATIONS map,
 * allowing safe execution in serverless runtimes (Cloudflare Workers) without filesystem access.
 *
 * @param db - TursoD1Database instance.
 * @param migrationsOrDir - Optional directory path or custom Record<string, string> migration map.
 * @returns Number of newly applied migrations.
 */
export async function runTursoMigrations(
  db: TursoD1Database,
  migrationsOrDir?: string | Record<string, string>
): Promise<number> {
  await ensureTursoMigrationsTable(db);

  let migrationsMap: Record<string, string> = EMBEDDED_MIGRATIONS;

  if (typeof migrationsOrDir === 'object' && migrationsOrDir !== null) {
    migrationsMap = migrationsOrDir;
  } else if (typeof migrationsOrDir === 'string') {
    const { fs: fsMod, path: pathMod } = await getFs();
    if (fsMod && pathMod && fsMod.existsSync(migrationsOrDir)) {
      const files = fsMod
        .readdirSync(migrationsOrDir)
        .filter((f: string) => f.endsWith('.sql'))
        .sort();
      migrationsMap = {};
      for (const file of files) {
        migrationsMap[file] = fsMod.readFileSync(pathMod.join(migrationsOrDir, file), 'utf-8');
      }
    }
  }

  const files = Object.keys(migrationsMap).sort();

  const appliedQuery = await db.prepare('SELECT name FROM _cf_d1_migrations').all<{ name: string }>();
  const appliedSet = new Set((appliedQuery.results || []).map((r) => r.name));

  let appliedCount = 0;
  for (const file of files) {
    if (appliedSet.has(file)) continue;

    const sql = migrationsMap[file];
    if (!sql || !sql.trim()) continue;

    console.log(`[Turso Migrations] Applying ${file}...`);
    try {
      await db.exec(sql);
      await db
        .prepare('INSERT INTO _cf_d1_migrations (name, applied_at) VALUES (?, ?)')
        .bind(file, Math.floor(Date.now() / 1000))
        .run();
      appliedCount++;
    } catch (err: any) {
      console.error(`[Turso Migrations] Failed to apply ${file}:`, err.message || err);
      throw err;
    }
  }

  if (appliedCount > 0) {
    console.log(`[Turso Migrations] Successfully applied ${appliedCount} migration(s).`);
  } else {
    console.log('[Turso Migrations] Database schema is up-to-date.');
  }

  return appliedCount;
}

let tursoMigrationsPromise: Promise<number> | null = null;

/**
 * Ensures all schema migrations are applied to Turso once per worker isolate lifecycle.
 * Deduplicates concurrent cold start requests.
 *
 * @param db - TursoD1Database instance.
 * @returns Number of applied migrations.
 */
export async function ensureTursoMigrations(db: TursoD1Database): Promise<number> {
  if (!tursoMigrationsPromise) {
    tursoMigrationsPromise = runTursoMigrations(db).catch(err => {
      tursoMigrationsPromise = null;
      throw err;
    });
  }
  return tursoMigrationsPromise;
}
