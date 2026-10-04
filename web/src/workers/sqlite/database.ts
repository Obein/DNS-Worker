/**
 * @file database.ts
 * @description SQLite WASM driver initialization, multi-tier OPFS persistence fallback,
 * DDL schema definitions, and automated schema migrations.
 */

import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import type { SqliteDatabase } from './types';

interface Sqlite3InitReturn {
  oo1?: {
    OpfsDb?: new (filename: string, mode: string) => SqliteDatabase;
    DB: new (filename: string, mode: string) => SqliteDatabase;
  };
  installOpfsSAHPoolVfs?: (options: {
    name: string;
    clearOnInit: boolean;
    initialCapacity: number;
  }) => Promise<{
    OpfsSAHPoolDb: new (filename: string) => SqliteDatabase;
  }>;
}

let db: SqliteDatabase | null = null;
let isOpfs = false;
let initPromise: Promise<boolean> | null = null;

/**
 * Retrieves the active SQLite database instance.
 *
 * @throws {Error} If the database has not yet been initialized.
 * @returns {SqliteDatabase} The initialized database handle.
 */
export function getDatabase(): SqliteDatabase {
  if (!db) {
    throw new Error('Database not initialized. Ensure initDatabase() is awaited.');
  }
  return db;
}

/**
 * Indicates whether the current database session is backed by persistent OPFS storage.
 *
 * @returns {boolean} True if backed by OPFS, false if using in-memory fallback.
 */
export function isOpfsStorage(): boolean {
  return isOpfs;
}

/**
 * Initializes the SQLite WASM runtime with automated progressive storage fallback:
 * 1. Standard OpfsDb (supports multi-tab concurrency when cross-origin isolated).
 * 2. OpfsSAHPool VFS (works in dedicated workers without SharedArrayBuffer/COOP/COEP).
 * 3. In-memory SQLite DB (fallback for incognito, restricted, or unsupported environments).
 *
 * @returns {Promise<boolean>} Resolves to true if persistent OPFS was established.
 */
export async function initDatabase(): Promise<boolean> {
  if (db) return isOpfs;
  if (initPromise) return initPromise;

  initPromise = (async (): Promise<boolean> => {
    try {
      const sqlite3 = (await (sqlite3InitModule as unknown as () => Promise<Sqlite3InitReturn>)()) as Sqlite3InitReturn;

      // 1. Try persistent OPFS storage
      // First attempt: Standard OpfsDb (supports multi-tab concurrency when cross-origin isolated)
      if (sqlite3.oo1?.OpfsDb) {
        try {
          db = new sqlite3.oo1.OpfsDb('/obex_local_logs.sqlite3', 'c');
          isOpfs = true;
          console.log('[SQLite Worker] Successfully opened OPFS persistent database via OpfsDb');
        } catch (opfsErr) {
          console.warn('[SQLite Worker] OpfsDb initialization failed, trying OpfsSAHPool:', opfsErr);
          db = null;
        }
      }

      // Second attempt: OpfsSAHPool VFS (works in dedicated workers without requiring SharedArrayBuffer or COOP/COEP)
      if (!db && typeof sqlite3.installOpfsSAHPoolVfs === 'function') {
        try {
          const poolUtil = await sqlite3.installOpfsSAHPoolVfs({
            name: 'obex-sahpool',
            clearOnInit: false,
            initialCapacity: 10,
          });
          db = new poolUtil.OpfsSAHPoolDb('/obex_local_logs.sqlite3');
          isOpfs = true;
          console.log('[SQLite Worker] Successfully opened OPFS persistent database via OpfsSAHPool');
        } catch (sahErr) {
          console.warn('[SQLite Worker] OpfsSAHPool initialization failed:', sahErr);
          db = null;
        }
      }

      // Third attempt / fallback: In-memory SQLite (e.g. Incognito/Private mode or unsupported browser)
      if (!db && sqlite3.oo1?.DB) {
        console.warn('[SQLite Worker] OPFS persistence unavailable (incognito/restricted mode), falling back to in-memory SQLite');
        db = new sqlite3.oo1.DB('/obex_local_logs_mem.sqlite3', 'c');
        isOpfs = false;
      }

      if (!db) {
        throw new Error('Failed to instantiate any SQLite storage driver (OpfsDb, OpfsSAHPool, or In-Memory).');
      }

      // 2. Performance tuning & Schema creation
      db.exec(`
        PRAGMA synchronous = NORMAL;
        
        CREATE TABLE IF NOT EXISTS local_logs (
          profile_id TEXT NOT NULL,
          timestamp INTEGER NOT NULL,
          id INTEGER NOT NULL,
          domain TEXT NOT NULL,
          record_type TEXT NOT NULL,
          action TEXT NOT NULL,
          reason TEXT,
          client_ip TEXT NOT NULL,
          geo_country TEXT,
          answer TEXT,
          dest_geoip TEXT,
          ecs TEXT,
          upstream TEXT,
          latency INTEGER,
          access_point_id TEXT,
          access_point_name TEXT,
          dest_country_code TEXT,
          dest_country TEXT,
          dest_isp TEXT,
          encrypt_version INTEGER DEFAULT 0,
          kem_key_id TEXT,
          kem_ct TEXT,
          encrypted_payload TEXT,
          PRIMARY KEY (profile_id, timestamp, id)
        );

        CREATE INDEX IF NOT EXISTS idx_local_logs_time ON local_logs (profile_id, timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_local_logs_domain ON local_logs (profile_id, domain);
        CREATE INDEX IF NOT EXISTS idx_local_logs_action ON local_logs (profile_id, action);
        CREATE INDEX IF NOT EXISTS idx_local_logs_client ON local_logs (profile_id, client_ip);

        CREATE TABLE IF NOT EXISTS sync_watermarks (
          profile_id TEXT PRIMARY KEY,
          latest_timestamp INTEGER NOT NULL,
          earliest_timestamp INTEGER NOT NULL,
          last_synced_at INTEGER NOT NULL,
          total_synced_count INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS local_settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
      `);

      // Migration: Add access_point_name column if missing from earlier schema versions
      try {
        db.exec('ALTER TABLE local_logs ADD COLUMN access_point_name TEXT;');
      } catch {
        // Ignored if column already exists
      }

      // Migration: Add encrypt_version, kem_key_id, kem_ct to local_logs if missing
      try {
        db.exec('ALTER TABLE local_logs ADD COLUMN encrypt_version INTEGER DEFAULT 0;');
      } catch {}
      try {
        db.exec('ALTER TABLE local_logs ADD COLUMN kem_key_id TEXT;');
      } catch {}
      try {
        db.exec('ALTER TABLE local_logs ADD COLUMN kem_ct TEXT;');
      } catch {}
      try {
        db.exec('UPDATE local_logs SET encrypt_version = 1 WHERE is_encrypted = 1;');
      } catch {}

      // Clean up stale logs with empty client_ip from prior bug to trigger a fresh sync
      try {
        const checkObj = db.selectObject("SELECT count(*) as count FROM local_logs WHERE client_ip = '' OR client_ip IS NULL;") as { count?: number } | undefined;
        if (checkObj && Number(checkObj.count) > 0) {
          console.log(`[SQLite Worker] Cleaning ${checkObj.count} stale logs with empty client_ip for clean resync`);
          db.exec("DELETE FROM local_logs WHERE client_ip = '' OR client_ip IS NULL; DELETE FROM sync_watermarks;");
        }
      } catch (e) {
        console.warn('[SQLite Worker] Clean stale logs check skipped:', e);
      }

      return isOpfs;
    } catch (err: unknown) {
      console.error('[SQLite Worker] Fatal initialization error:', err);
      throw err;
    }
  })();

  return initPromise;
}
