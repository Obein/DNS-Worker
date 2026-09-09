import { D1Database } from "@cloudflare/workers-types";
import { Rule } from "../types";

export class RuleModel {
  constructor(private db: D1Database) {}

  async getRules(profileId: string): Promise<Rule[]> {
    const { results } = await this.db.prepare("SELECT * FROM rules WHERE profile_id = ? ORDER BY id DESC")
      .bind(profileId)
      .all<Rule>();
    return results;
  }

  async addRule(profileId: string, rule: Partial<Rule>): Promise<boolean> {
    const normalizedPattern = rule.pattern ? rule.pattern.trim().toLowerCase() : "";
    const createdAt = rule.created_at ?? Math.floor(Date.now() / 1000);
    const result = await this.db.prepare(
      "INSERT INTO rules (profile_id, type, pattern, v_a, v_aaaa, v_txt, v_cname, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    )
      .bind(profileId, rule.type, normalizedPattern, rule.v_a || null, rule.v_aaaa || null, rule.v_txt || null, rule.v_cname || null, createdAt)
      .run();
    return result.success;
  }

  /**
   * Batch inserts multiple rules for a profile using D1 batch operations.
   * Chunks execution into batches of up to 100 statements to respect D1 limits.
   *
   * @param profileId - Profile identifier.
   * @param rules - Array of partial rules to insert.
   * @returns Total number of rules successfully inserted.
   */
  async addRulesBulk(profileId: string, rules: Partial<Rule>[]): Promise<number> {
    if (!rules || rules.length === 0) return 0;
    const now = Math.floor(Date.now() / 1000);
    const statements = rules.map(rule => {
      const normalizedPattern = rule.pattern ? rule.pattern.trim().toLowerCase() : "";
      const createdAt = rule.created_at ?? now;
      return this.db.prepare(
        "INSERT INTO rules (profile_id, type, pattern, v_a, v_aaaa, v_txt, v_cname, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      ).bind(
        profileId,
        rule.type,
        normalizedPattern,
        rule.v_a || null,
        rule.v_aaaa || null,
        rule.v_txt || null,
        rule.v_cname || null,
        createdAt
      );
    });

    let inserted = 0;
    for (let i = 0; i < statements.length; i += 100) {
      const chunk = statements.slice(i, i + 100);
      const results = await this.db.batch(chunk);
      for (const res of results) {
        if (res.success) inserted += res.meta.changes || 1;
      }
    }
    return inserted;
  }

  async updateRule(id: number, profileId: string, rule: Partial<Rule>): Promise<boolean> {
    const normalizedPattern = rule.pattern ? rule.pattern.trim().toLowerCase() : "";
    const result = await this.db.prepare(
      "UPDATE rules SET type = ?, pattern = ?, v_a = ?, v_aaaa = ?, v_txt = ?, v_cname = ? WHERE id = ? AND profile_id = ?"
    )
      .bind(rule.type, normalizedPattern, rule.v_a || null, rule.v_aaaa || null, rule.v_txt || null, rule.v_cname || null, id, profileId)
      .run();
    return result.success;
  }

  async getRuleByPattern(profileId: string, pattern: string): Promise<Rule | null> {
    return await this.db.prepare("SELECT * FROM rules WHERE profile_id = ? AND LOWER(pattern) = ?")
      .bind(profileId, pattern.trim().toLowerCase())
      .first<Rule | null>();
  }

  async getRuleByPatternExcludeId(profileId: string, pattern: string, id: number): Promise<Rule | null> {
    return await this.db.prepare("SELECT * FROM rules WHERE profile_id = ? AND LOWER(pattern) = ? AND id != ?")
      .bind(profileId, pattern.trim().toLowerCase(), id)
      .first<Rule | null>();
  }

  async deleteRule(id: number, profileId: string): Promise<boolean> {
    const result = await this.db.prepare("DELETE FROM rules WHERE id = ? AND profile_id = ?").bind(id, profileId).run();
    return result.success;
  }
}
