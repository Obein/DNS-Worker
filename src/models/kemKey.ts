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
export class KemKeyModel {
  constructor(private readonly db: D1Database) {}

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
        .prepare("SELECT 1 FROM logs WHERE kem_key_id = ? LIMIT 1")
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
   * are kept as long as logs reference them. A safety window (default 3600s = 1h)
   * protects newly minted keys in active isolate memory from being deleted before
   * their first log batch lands in D1.
   *
   * @param safetyWindowSec Minimum age in seconds before an unreferenced key can be purged (default 3600).
   * @param batchLimit Maximum rows to delete in a single batch (default 1000).
   * @returns Total number of orphaned keys deleted.
   */
  async cleanupOrphans(safetyWindowSec = 3600, batchLimit = 1000): Promise<number> {
    const cutoffTimestamp = Math.floor(Date.now() / 1000) - safetyWindowSec;
    try {
      const result = await this.db
        .prepare(`
          DELETE FROM kem_keys
          WHERE id IN (
            SELECT k.id FROM kem_keys k
            WHERE k.created_at <= ?
              AND NOT EXISTS (
                SELECT 1 FROM logs l WHERE l.kem_key_id = k.id
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
   * @param safetyWindowSec Minimum age in seconds before an unreferenced key can be purged (default 3600).
   * @returns Total number of orphaned keys deleted for this profile.
   */
  async cleanupProfileOrphans(profileId: string, safetyWindowSec = 3600): Promise<number> {
    const cutoffTimestamp = Math.floor(Date.now() / 1000) - safetyWindowSec;
    try {
      const result = await this.db
        .prepare(`
          DELETE FROM kem_keys
          WHERE profile_id = ?
            AND created_at <= ?
            AND NOT EXISTS (
              SELECT 1 FROM logs l WHERE l.kem_key_id = kem_keys.id
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
