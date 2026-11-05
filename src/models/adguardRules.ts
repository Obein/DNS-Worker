/**
 * @file adguardRules.ts
 * @description Data access model for list and profile level AdGuard extended rules (exceptions, rewrites, and patterns).
 */

import { D1Database } from "@cloudflare/workers-types";
import { AdGuardPayload } from "../lib/adguard/types";

export class AdguardRulesModel {
  constructor(private db: D1Database) {}

  // ─── List-Level Operations ────────────────────────────────────────────────

  /**
   * Upserts the AdGuard extended rules payload for a specific subscription list.
   */
  async upsertListRules(listId: number, payload: AdGuardPayload, now: number): Promise<boolean> {
    const jsonStr = JSON.stringify(payload);
    const result = await this.db.prepare(
      `INSERT INTO list_adguard_rules (list_id, payload, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(list_id) DO UPDATE SET
         payload = excluded.payload,
         updated_at = excluded.updated_at`
    ).bind(listId, jsonStr, now).run();

    return result.success;
  }

  /**
   * Retrieves the AdGuard extended rules payload for a specific list.
   */
  async getListRules(listId: number): Promise<AdGuardPayload | null> {
    const row = await this.db.prepare(
      "SELECT payload FROM list_adguard_rules WHERE list_id = ?"
    ).bind(listId).first<{ payload: string }>();

    if (!row || !row.payload) return null;
    try {
      return JSON.parse(row.payload) as AdGuardPayload;
    } catch {
      return null;
    }
  }

  /**
   * Deletes the AdGuard extended rules for a specific list.
   */
  async deleteListRules(listId: number): Promise<boolean> {
    const result = await this.db.prepare(
      "DELETE FROM list_adguard_rules WHERE list_id = ?"
    ).bind(listId).run();
    return result.success;
  }

  // ─── Profile-Level Active Operations ──────────────────────────────────────

  /**
   * Upserts the compiled AdGuard extended rules payload for an active profile.
   */
  async upsertProfileRules(profileId: string, payload: AdGuardPayload, now: number): Promise<boolean> {
    const jsonStr = JSON.stringify(payload);
    const result = await this.db.prepare(
      `INSERT INTO profile_adguard_rules (profile_id, payload, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(profile_id) DO UPDATE SET
         payload = excluded.payload,
         updated_at = excluded.updated_at`
    ).bind(profileId, jsonStr, now).run();

    return result.success;
  }

  /**
   * Retrieves the compiled AdGuard rules payload for an active profile.
   */
  async getProfileRules(profileId: string): Promise<AdGuardPayload | null> {
    const row = await this.db.prepare(
      "SELECT payload FROM profile_adguard_rules WHERE profile_id = ?"
    ).bind(profileId).first<{ payload: string }>();

    if (!row || !row.payload) return null;
    try {
      return JSON.parse(row.payload) as AdGuardPayload;
    } catch {
      return null;
    }
  }

  /**
   * Clears the active compiled AdGuard rules for a profile.
   */
  async clearProfileRules(profileId: string): Promise<boolean> {
    const result = await this.db.prepare(
      "DELETE FROM profile_adguard_rules WHERE profile_id = ?"
    ).bind(profileId).run();
    return result.success;
  }

  // ─── Profile-Level Staging & Promotion Operations ─────────────────────────

  /**
   * Upserts the staged AdGuard rules payload during a sync cycle.
   */
  async upsertProfileRulesStaging(profileId: string, payload: AdGuardPayload, now: number): Promise<boolean> {
    const jsonStr = JSON.stringify(payload);
    const result = await this.db.prepare(
      `INSERT INTO profile_adguard_rules_staging (profile_id, payload, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(profile_id) DO UPDATE SET
         payload = excluded.payload,
         updated_at = excluded.updated_at`
    ).bind(profileId, jsonStr, now).run();

    return result.success;
  }

  /**
   * Clears the staged AdGuard rules for a profile.
   */
  async clearProfileRulesStaging(profileId: string): Promise<boolean> {
    const result = await this.db.prepare(
      "DELETE FROM profile_adguard_rules_staging WHERE profile_id = ?"
    ).bind(profileId).run();
    return result.success;
  }

  /**
   * Atomically promotes staged AdGuard rules to active profile_adguard_rules table.
   */
  async promoteProfileRules(profileId: string, now: number): Promise<boolean> {
    const staging = await this.db.prepare(
      "SELECT payload FROM profile_adguard_rules_staging WHERE profile_id = ?"
    ).bind(profileId).first<{ payload: string }>();

    if (!staging || !staging.payload) {
      await this.clearProfileRules(profileId);
      return true;
    }

    const statements = [
      this.db.prepare("DELETE FROM profile_adguard_rules WHERE profile_id = ?").bind(profileId),
      this.db.prepare(
        "INSERT INTO profile_adguard_rules (profile_id, payload, updated_at) VALUES (?, ?, ?)"
      ).bind(profileId, staging.payload, now),
      this.db.prepare("DELETE FROM profile_adguard_rules_staging WHERE profile_id = ?").bind(profileId)
    ];

    const results = await this.db.batch(statements);
    return results.every(r => r.success);
  }
}
