import { D1Database } from "@cloudflare/workers-types";
import { KemKeyRecord } from "../types";

/**
 * Model responsible for lifecycle management and orphan cleanup of kem_keys.
 *
 * kem_keys store recipient-encapsulated post-quantum hybrid ciphertext (kem_ct)
 * required by the client to derive the DEK and decrypt query logs.
 *
 * CLEANUP RULE:
 * A kem_key must NEVER be deleted based solely on its expiration time (expires_at),
 * because doing so would make historical logs referencing this key permanently undecryptable.
 * Instead, a kem_key is eligible for automatic cleanup ONLY when no logs in the logs table
 * reference it (zero dependents), with a safety grace period to protect active in-memory
 * keys currently being rotated by running Worker isolates.
 */
let hasEnsuredKemIndexes = false;

/**
 * Ensures critical covering index exists on logs(kem_key_id) and kem_keys(created_at)
 * to prevent full table scans that otherwise read millions of rows.
 *
 * @param db - D1Database instance.
 * @returns True if index creation was initiated or already performed.
 */
export async function ensureKemIndexes(db: D1Database): Promise<boolean> {
  if (hasEnsuredKemIndexes) return true;
  try {
    const s1 = db.prepare("CREATE INDEX IF NOT EXISTS idx_logs_kem_key_id ON logs(kem_key_id) WHERE kem_key_id IS NOT NULL");
    if (typeof s1.run === "function") {
      await s1.run();
    } else if (typeof s1.bind === "function") {
      await (s1.bind() as any).run();
    }

    const s2 = db.prepare("CREATE INDEX IF NOT EXISTS idx_kem_keys_created_at ON kem_keys(created_at)");
    if (typeof s2.run === "function") {
      await s2.run();
    } else if (typeof s2.bind === "function") {
      await (s2.bind() as any).run();
    }

    hasEnsuredKemIndexes = true;
    return true;
  } catch (e) {
    console.warn("[KemKeyModel] Failed to ensure indexes:", e);
    return false;
  }
}

export class KemKeyModel {
  constructor(private readonly db: D1Database) {}

  /**
   * Resets the module-level flag for testing index creation.
   */
  static resetIndexFlag(): void {
    hasEnsuredKemIndexes = false;
  }

  /**
   * Verifies if idx_logs_kem_key_id exists in sqlite_master.
   */
  private async hasLogsKemKeyIndex(): Promise<boolean> {
    try {
      const stmt = this.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_logs_kem_key_id'");
      const row = typeof stmt.first === "function" ? await stmt.first() : await (stmt.bind() as any).first();
      return !!row;
    } catch {
      return hasEnsuredKemIndexes;
    }
  }

  /**
   * Retrieves a KEM key record by ID.
   *
   * @param id The kem_key unique identifier.
   * @returns KemKeyRecord or null if not found.
   */
  async getById(id: string): Promise<KemKeyRecord | null> {
    try {
      return await this.db
        .prepare("SELECT id, profile_id, kem_ct, created_at, expires_at FROM kem_keys WHERE id = ?")
        .bind(id)
        .first<KemKeyRecord | null>();
    } catch (err) {
      console.error(`[KemKeyModel] Failed to fetch kem_key ${id}:`, err);
      return null;
    }
  }

  /**
   * Checks whether a specific kem_key is referenced by any logs.
   *
   * @param id The kem_key unique identifier.
   * @returns True if at least one log references this key.
   */
  async hasDependents(id: string): Promise<boolean> {
    try {
      const row = await this.db
        .prepare("SELECT 1 FROM logs WHERE kem_key_id = ? AND kem_key_id IS NOT NULL LIMIT 1")
        .bind(id)
        .first<{ 1: number } | null>();
      return row !== null;
    } catch (err) {
      console.error(`[KemKeyModel] Failed to check dependents for kem_key ${id}:`, err);
      return true; // Fail safe: assume it has dependents on error to prevent accidental deletion
    }
  }

  /**
   * Automatically purges orphaned kem_keys that have ZERO dependent rows in logs.
   *
   * Criterion: NOT EXISTS (SELECT 1 FROM logs WHERE logs.kem_key_id = kem_keys.id)
   * Notice: Time (expires_at) is NOT the deletion criterion. Even very old keys
   * are kept as long as logs reference them. A safety window (default 86400s = 24h)
   * protects newly minted keys in active isolate memory and recent retention periods
   * from triggering unnecessary subqueries.
   *
   * @param safetyWindowSec Minimum age in seconds before an unreferenced key can be purged (default 86400 = 24h).
   * @param batchLimit Maximum rows to delete in a single batch (default 100).
   * @returns Total number of orphaned keys deleted.
   */
  async cleanupOrphans(safetyWindowSec = 86400, batchLimit = 100): Promise<number> {
    const cutoffTimestamp = Math.floor(Date.now() / 1000) - safetyWindowSec;
    try {
      // 1. Ensure covering index on logs(kem_key_id) exists to guarantee index-seek instead of full scan
      await ensureKemIndexes(this.db);

      // 2. Defensive index check: if index is missing and could not be verified, abort to save read quota
      const indexReady = await this.hasLogsKemKeyIndex();
      if (!indexReady && !hasEnsuredKemIndexes) {
        console.warn("[KemKeyModel] Aborting orphan cleanup: idx_logs_kem_key_id index is not confirmed. Run migrations to enable index-based cleanup.");
        return 0;
      }

      // 3. Fast index seek to check if any candidate keys older than the safety window exist.
      // If none exist, skip the correlated subquery entirely to save database read quota.
      const candidate = await this.db
        .prepare("SELECT id FROM kem_keys WHERE created_at <= ? LIMIT 1")
        .bind(cutoffTimestamp)
        .first<{ id: string } | null>();

      if (!candidate) {
        return 0;
      }

      const result = await this.db
        .prepare(`
          DELETE FROM kem_keys
          WHERE id IN (
            SELECT k.id FROM kem_keys k
            WHERE k.created_at <= ?
              AND NOT EXISTS (
                SELECT 1 FROM logs l WHERE l.kem_key_id = k.id AND l.kem_key_id IS NOT NULL
              )
            LIMIT ?
          )
        `)
        .bind(cutoffTimestamp, batchLimit)
        .run();

      const deletedCount = result.meta?.changes ?? result.meta?.rows_written ?? 0;
      return deletedCount;
    } catch (err) {
      console.error("[KemKeyModel] Failed to cleanup orphaned kem_keys:", err);
      return 0;
    }
  }

  /**
   * Automatically purges orphaned kem_keys specifically belonging to a single profile.
   * Useful when a profile's logs have been explicitly cleared or disabled.
   *
   * @param profileId Profile identifier.
   * @param safetyWindowSec Minimum age in seconds before an unreferenced key can be purged (default 86400 = 24h).
   * @returns Total number of orphaned keys deleted for this profile.
   */
  async cleanupProfileOrphans(profileId: string, safetyWindowSec = 86400): Promise<number> {
    const cutoffTimestamp = Math.floor(Date.now() / 1000) - safetyWindowSec;
    try {
      await ensureKemIndexes(this.db);

      // Fast check if any candidate keys exist for this profile
      const candidate = await this.db
        .prepare("SELECT id FROM kem_keys WHERE profile_id = ? AND created_at <= ? LIMIT 1")
        .bind(profileId, cutoffTimestamp)
        .first<{ id: string } | null>();

      if (!candidate) {
        return 0;
      }

      const result = await this.db
        .prepare(`
          DELETE FROM kem_keys
          WHERE profile_id = ?
            AND created_at <= ?
            AND NOT EXISTS (
              SELECT 1 FROM logs l WHERE l.kem_key_id = kem_keys.id AND l.kem_key_id IS NOT NULL
            )
        `)
        .bind(profileId, cutoffTimestamp)
        .run();

      const deletedCount = result.meta?.changes ?? result.meta?.rows_written ?? 0;
      return deletedCount;
    } catch (err) {
      console.error(`[KemKeyModel] Failed to cleanup profile orphan kem_keys for ${profileId}:`, err);
      return 0;
    }
  }
}
