/**
 * @file migrate.ts
 * @description Automatic SQL schema migration runner for Turso (libSQL) database.
 * Used by Serverfull mode and CLI migration scripts.
 */

import fs from 'node:fs';
import path from 'node:path';
import { TursoD1Database } from './index';

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
 * Runs all pending migrations from the given migrations directory against Turso.
 *
 * @param db - TursoD1Database instance.
 * @param migrationsDir - Directory path containing numeric SQL migration files.
 * @returns Number of newly applied migrations.
 */
export async function runTursoMigrations(
  db: TursoD1Database,
  migrationsDir: string
): Promise<number> {
  await ensureTursoMigrationsTable(db);

  if (!fs.existsSync(migrationsDir)) {
    console.warn(`[Turso Migrations] Directory not found: ${migrationsDir}`);
    return 0;
  }

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f: string) => f.endsWith('.sql'))
    .sort();

  const appliedQuery = await db.prepare('SELECT name FROM _cf_d1_migrations').all<{ name: string }>();
  const appliedSet = new Set((appliedQuery.results || []).map((r) => r.name));

  let appliedCount = 0;
  for (const file of files) {
    if (appliedSet.has(file)) continue;

    const filePath = path.join(migrationsDir, file);
    const sql = fs.readFileSync(filePath, 'utf-8');

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
