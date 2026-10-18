/**
 * @file database.ts
 * @description Local SQLite and remote Turso database inspection utilities.
 */

import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createTursoClient } from '../../lib/turso';
import { getTursoMigrationStats } from '../../lib/turso/migrate';

/**
 * Information regarding SQLite or Turso database state.
 */
export interface DbStatusInfo {
  exists: boolean;
  sizeFormatted?: string;
  migrationsCount?: number;
  usersCount?: number;
  profilesCount?: number;
  statusText: string;
}

/**
 * Inspects the SQLite database file and queries metadata if available.
 *
 * @param dbPath - Path to the SQLite database file.
 * @returns Database status metrics.
 */
export function inspectDatabase(dbPath: string): DbStatusInfo {
  if (!fs.existsSync(dbPath)) {
    return {
      exists: false,
      statusText: 'Not Initialized (File does not exist yet; created on first start)'
    };
  }

  try {
    const stats = fs.statSync(dbPath);
    const sizeFormatted = stats.size > 1024 * 1024
      ? `${(stats.size / (1024 * 1024)).toFixed(2)} MB`
      : `${(stats.size / 1024).toFixed(1)} KB`;

    let migrationsCount = 0;
    let usersCount = 0;
    let profilesCount = 0;

    try {
      const rawDb = new DatabaseSync(dbPath, { readOnly: true });

      const migTable = rawDb.prepare("SELECT count(*) as cnt FROM sqlite_master WHERE type='table' AND name='d1_migrations'").get() as { cnt: number } | undefined;
      if (migTable && migTable.cnt > 0) {
        const migRow = rawDb.prepare('SELECT count(*) as count FROM d1_migrations').get() as { count: number } | undefined;
        migrationsCount = migRow?.count || 0;
      }

      const usersTable = rawDb.prepare("SELECT count(*) as cnt FROM sqlite_master WHERE type='table' AND name='users'").get() as { cnt: number } | undefined;
      if (usersTable && usersTable.cnt > 0) {
        const userRow = rawDb.prepare('SELECT count(*) as count FROM users').get() as { count: number } | undefined;
        usersCount = userRow?.count || 0;
      }

      const profTable = rawDb.prepare("SELECT count(*) as cnt FROM sqlite_master WHERE type='table' AND name='profiles'").get() as { cnt: number } | undefined;
      if (profTable && profTable.cnt > 0) {
        const profRow = rawDb.prepare('SELECT count(*) as count FROM profiles').get() as { count: number } | undefined;
        profilesCount = profRow?.count || 0;
      }

      rawDb.close();
    } catch {
      // Ignore database inspection query errors (e.g. locked database)
    }

    const details = [
      sizeFormatted,
      migrationsCount > 0 ? `${migrationsCount} migrations` : null,
      usersCount > 0 ? `${usersCount} user(s)` : null,
      profilesCount > 0 ? `${profilesCount} profile(s)` : null
    ].filter(Boolean).join(', ');

    return {
      exists: true,
      sizeFormatted,
      migrationsCount,
      usersCount,
      profilesCount,
      statusText: `Ready (${details})`
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      exists: true,
      statusText: `Exists (Read warning: ${errorMsg})`
    };
  }
}

/**
 * Inspects remote Turso database connectivity, migration status, and table metrics.
 *
 * @param url - Turso database URL.
 * @param token - Turso authorization token.
 * @returns Database status metrics.
 */
export async function inspectTursoDatabase(url: string, token: string): Promise<DbStatusInfo> {
  try {
    const db = createTursoClient(url, token);
    const migStats = await getTursoMigrationStats(db);
    let usersCount = 0;
    let profilesCount = 0;
    try {
      const userRes = await db.prepare('SELECT count(*) as count FROM users').first<{ count: number }>();
      usersCount = userRes?.count || 0;
      const profRes = await db.prepare('SELECT count(*) as count FROM profiles').first<{ count: number }>();
      profilesCount = profRes?.count || 0;
    } catch {
      // Tables might not exist if migrations haven't run yet
    }

    const details = [
      migStats.count > 0 ? `${migStats.count} migrations` : null,
      usersCount > 0 ? `${usersCount} user(s)` : null,
      profilesCount > 0 ? `${profilesCount} profile(s)` : null
    ].filter(Boolean).join(', ');

    return {
      exists: true,
      migrationsCount: migStats.count,
      usersCount,
      profilesCount,
      statusText: `Ready (Connected${details ? `: ${details}` : ''})`
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      exists: false,
      statusText: `Connection Failed (${errorMsg})`
    };
  }
}
