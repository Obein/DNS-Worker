/**
 * @file db.ts
 * @description SQLite D1Database adapter and automatic schema migration runner for Serverfull mode.
 */

import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { D1Database, D1PreparedStatement, D1Result, D1ExecResult, D1DatabaseSession } from '@cloudflare/workers-types';

export class NodeD1PreparedStatement implements D1PreparedStatement {
  private params: any[] = [];

  constructor(
    public readonly db: DatabaseSync,
    public readonly sql: string
  ) {}

  bind(...values: any[]): D1PreparedStatement {
    this.params = values.map(v => (typeof v === 'boolean' ? (v ? 1 : 0) : v));
    return this as unknown as D1PreparedStatement;
  }

  async first<T = unknown>(colName?: string): Promise<T | null> {
    try {
      const stmt = this.db.prepare(this.sql);
      const row = stmt.get(...this.params) as Record<string, any> | undefined;
      if (!row) return null;
      if (colName) {
        return (row[colName] ?? null) as T;
      }
      return row as T;
    } catch (err: any) {
      console.warn(`[SQLite D1] Query error in first(): ${err.message}\nSQL: ${this.sql}`);
      throw err;
    }
  }

  async all<T = unknown>(): Promise<D1Result<T>> {
    try {
      const stmt = this.db.prepare(this.sql);
      const rows = stmt.all(...this.params) as T[];
      return {
        results: rows,
        success: true,
        meta: {
          duration: 0,
          size_after: 0,
          rows_read: rows.length,
          rows_written: 0,
          last_row_id: 0,
          changed_db: false,
          changes: 0
        }
      };
    } catch (err: any) {
      console.warn(`[SQLite D1] Query error in all(): ${err.message}\nSQL: ${this.sql}`);
      throw err;
    }
  }

  async run<T = unknown>(): Promise<D1Result<T>> {
    try {
      const stmt = this.db.prepare(this.sql);
      const result = stmt.run(...this.params);
      const changes = Number(result.changes);
      const lastInsertRowid = Number(result.lastInsertRowid);
      return {
        results: [],
        success: true,
        meta: {
          duration: 0,
          size_after: 0,
          rows_read: 0,
          rows_written: changes,
          last_row_id: lastInsertRowid,
          changed_db: changes > 0,
          changes: changes
        }
      };
    } catch (err: any) {
      console.warn(`[SQLite D1] Query error in run(): ${err.message}\nSQL: ${this.sql}`);
      throw err;
    }
  }

  async raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<any> {
    try {
      const stmt = this.db.prepare(this.sql);
      const rows = stmt.all(...this.params) as Record<string, any>[];
      const rawRows = rows.map(r => Object.values(r));
      if (options?.columnNames && rows.length > 0) {
        return [Object.keys(rows[0]), ...rawRows];
      }
      return rawRows;
    } catch (err: any) {
      console.warn(`[SQLite D1] Query error in raw(): ${err.message}\nSQL: ${this.sql}`);
      throw err;
    }
  }
}

export class NodeD1Database implements D1Database {
  constructor(public readonly rawDb: DatabaseSync) {}

  prepare(query: string): D1PreparedStatement {
    return new NodeD1PreparedStatement(this.rawDb, query) as unknown as D1PreparedStatement;
  }

  async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    this.rawDb.exec('BEGIN IMMEDIATE');
    try {
      const results: D1Result<T>[] = [];
      for (const stmt of statements) {
        const res = await stmt.run<T>();
        results.push(res);
      }
      this.rawDb.exec('COMMIT');
      return results;
    } catch (err) {
      this.rawDb.exec('ROLLBACK');
      throw err;
    }
  }

  async exec(query: string): Promise<D1ExecResult> {
    this.rawDb.exec(query);
    return { count: 0, duration: 0 };
  }

  async dump(): Promise<ArrayBuffer> {
    throw new Error('dump() is not supported in NodeD1Database');
  }

  withSession(_constraintOrBookmark?: string): D1DatabaseSession {
    const session = Object.assign(this, {
      getBookmark: () => null
    });
    return session as unknown as D1DatabaseSession;
  }
}

/**
 * Runs all pending migrations from migrations/ directory.
 */
export function runMigrations(db: DatabaseSync, migrationsDir: string): void {
  // Ensure migrations tracking table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS _cf_d1_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      applied_at INTEGER NOT NULL
    );
  `);

  if (!fs.existsSync(migrationsDir)) {
    console.warn(`[Migrations] Directory not found: ${migrationsDir}`);
    return;
  }

  const files = fs.readdirSync(migrationsDir)
    .filter((f: string) => f.endsWith('.sql'))
    .sort();

  const stmtGet = db.prepare('SELECT name FROM _cf_d1_migrations WHERE name = ?');
  const stmtInsert = db.prepare('INSERT INTO _cf_d1_migrations (name, applied_at) VALUES (?, ?)');

  let appliedCount = 0;
  for (const file of files) {
    const existing = stmtGet.get(file);
    if (existing) continue;

    const filePath = path.join(migrationsDir, file);
    const sql = fs.readFileSync(filePath, 'utf-8');

    console.log(`[Migrations] Applying ${file}...`);
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(sql);
      stmtInsert.run(file, Math.floor(Date.now() / 1000));
      db.exec('COMMIT');
      appliedCount++;
    } catch (err: any) {
      db.exec('ROLLBACK');
      console.error(`[Migrations] Failed to apply ${file}:`, err.message || err);
      throw err;
    }
  }

  if (appliedCount > 0) {
    console.log(`[Migrations] Successfully applied ${appliedCount} migration(s).`);
  } else {
    console.log('[Migrations] Database schema is up-to-date.');
  }
}

/**
 * Initializes SQLite database for Serverfull mode with WAL mode and runs pending migrations.
 */
export function initServerfullDb(dbPath: string, rootDir: string = process.cwd()): NodeD1Database {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  console.log(`[SQLite D1] Connecting to database at: ${dbPath}`);
  const rawDb = new DatabaseSync(dbPath);

  // Configure SQLite for high concurrency & integrity
  rawDb.exec('PRAGMA journal_mode = WAL;');
  rawDb.exec('PRAGMA synchronous = NORMAL;');
  rawDb.exec('PRAGMA foreign_keys = ON;');

  // Run migrations
  const migrationsDir = path.join(rootDir, 'migrations');
  runMigrations(rawDb, migrationsDir);

  return new NodeD1Database(rawDb);
}
